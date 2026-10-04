/**
 * Gallery upload + user manual tools (0.3.1).
 *
 *  - aetherwave_upload_to_gallery: put a file the user already has (a local
 *    file on the npx server, a public URL, or a data URL) into their AetherWave
 *    gallery, so every other tool can use it by URL.
 *  - aetherwave_get_user_manual: the link to an AetherWave user manual PDF and,
 *    on the npx server, a copy saved to the user's Downloads folder.
 *
 * Why every source goes through POST /api/user/gallery/upload (multipart):
 * it is the route that checks the user's STORAGE QUOTA before writing to R2.
 * /api/save-to-gallery takes a URL directly but never checks the quota
 * (verified server/routes.ts 2026-10-04), so a tool on that route would let an
 * agent fill R2 past the plan limit. A URL is therefore fetched HERE and
 * re-sent as a file.
 *
 * The remote connector fetches URLs on our Railway host, so URL fetches refuse
 * anything that resolves to a private, loopback or link-local address (SSRF).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { basename, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { AetherwaveClient } from "./api.js";

/** Cloudflare in front of aetherwavestudio.com rejects request bodies over
 *  100 MB, so stay under it. Larger files: the web uploader (multipart R2). */
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".flac": "audio/flac", ".ogg": "audio/ogg",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
};

/** image | audio | video for a MIME type, or null when the gallery cannot hold it. */
export function mediaKind(mime: string | null | undefined): "image" | "audio" | "video" | null {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return null;
}

export function mimeFromName(name: string): string | null {
  return MIME_BY_EXT[extname(name).toLowerCase()] || null;
}

/** True for loopback, private, link-local, CGNAT, unspecified and ULA addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(v) === 6) {
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  return true; // not an IP at all: refuse rather than guess
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`Not a valid URL: ${raw}`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https URLs can be uploaded");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`Could not resolve ${host}`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`Refusing to fetch ${host}: it resolves to a private address`);
  return u;
}

type Media = { bytes: Uint8Array; mime: string; filename: string };

/** Fetch a public URL with the size cap enforced while streaming. */
async function fromUrl(raw: string): Promise<Media> {
  /* Redirects are followed BY HAND, each hop checked before it is requested:
   * with redirect "follow" a public URL that 302s to an internal address
   * would already have been fetched by the time res.url could be checked. */
  let u = await assertPublicUrl(raw);
  let res: Response | null = null;
  for (let hop = 0; hop <= 5; hop++) {
    res = await fetch(u, { redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel().catch(() => {});
      if (hop === 5) throw new Error("Too many redirects");
      u = await assertPublicUrl(new URL(loc, u).href);
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`Fetching the URL failed: ${res?.status} ${res?.statusText}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_UPLOAD_BYTES) throw new Error(tooBig(declared));
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The URL returned no content");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UPLOAD_BYTES) { await reader.cancel().catch(() => {}); throw new Error(tooBig(total)); }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  const name = decodeURIComponent(basename(u.pathname)) || "upload";
  const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim();
  const mime = mediaKind(headerMime) ? headerMime : mimeFromName(name) || headerMime;
  return { bytes, mime, filename: name };
}

function fromDataUrl(raw: string): Media {
  const m = raw.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!m) throw new Error("Not a valid data URL");
  const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(tooBig(bytes.length));
  const ext = Object.entries(MIME_BY_EXT).find(([, v]) => v === m[1])?.[0] || "";
  return { bytes, mime: m[1], filename: `upload${ext}` };
}

async function fromFile(path: string): Promise<Media> {
  const full = resolve(path);
  const info = await stat(full).catch(() => null);
  if (!info || !info.isFile()) throw new Error(`No such file: ${full}`);
  if (info.size > MAX_UPLOAD_BYTES) throw new Error(tooBig(info.size));
  const mime = mimeFromName(full);
  if (!mime) throw new Error(`Unsupported file type ${extname(full) || "(none)"}. Images: png jpg webp gif. Audio: mp3 wav m4a flac ogg. Video: mp4 webm mov.`);
  return { bytes: await readFile(full), mime, filename: basename(full) };
}

function tooBig(n: number) {
  return `The file is ${(n / 1048576).toFixed(1)} MB; uploads through the MCP are limited to 95 MB. Upload larger files on the website: https://aetherwavestudio.com/gallery.html`;
}

/** User manuals hosted on R2 under manuals/<key>-user-manual.pdf. Every key
 *  here must exist; the weekly audit HEAD-checks each one. */
export const MANUALS = {
  mcp: { title: "AetherWave MCP User Manual", url: "https://media.aetherwavestudio.com/manuals/mcp-user-manual.pdf" },
  "graphic-novel": { title: "Graphic Novel Studio User Manual", url: "https://media.aetherwavestudio.com/manuals/graphic-novel-user-manual.pdf" },
  "ugc-studio": { title: "UGC Studio User Manual", url: "https://media.aetherwavestudio.com/manuals/ugc-studio-user-manual.pdf" },
  "project-studio": { title: "Project Studio User Manual", url: "https://media.aetherwavestudio.com/manuals/project-studio-user-manual.pdf" },
} as const;
type ManualKey = keyof typeof MANUALS;

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

export function registerGalleryTools(server: McpServer, client: AetherwaveClient, { local }: { local: boolean }) {
  server.registerTool(
    "aetherwave_upload_to_gallery",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Upload a file to your AetherWave gallery",
      description:
        "Saves an image, audio file or video the user already has into their AetherWave gallery and returns its permanent URL, so any other AetherWave tool can use it (edit it, animate it, master it, put it on merch). " +
        "Give exactly one source: `url` (a public http or https link), `dataUrl`, or " +
        (local ? "`filePath` (a file on this computer). " : "`filePath` (only works with the npx server on the user's own computer, not on this remote connector). ") +
        "Free: no credits, but it counts against the account's storage. Up to 95 MB; larger files go through the website uploader. " +
        "Images: png jpg webp gif. Audio: mp3 wav m4a flac ogg. Video: mp4 webm mov.",
      inputSchema: {
        filePath: z.string().optional().describe("Path to a local file. npx server only."),
        url: z.string().optional().describe("Public http or https link to the file."),
        dataUrl: z.string().optional().describe("A data: URL with the file contents."),
        title: z.string().max(200).optional().describe("Title shown in the gallery. Defaults to the file name."),
        description: z.string().max(2000).optional().describe("Optional description."),
        tags: z.array(z.string()).max(20).optional().describe("Optional tags."),
      },
    },
    async (args) => {
      try {
        const given = [args.filePath, args.url, args.dataUrl].filter((v) => typeof v === "string" && v.trim()).length;
        if (given !== 1) throw new Error("Give exactly one source: filePath, url or dataUrl.");
        if (args.filePath && !local) throw new Error("This remote connector cannot read files on your computer. Pass a public url or a dataUrl, or use the npx server for local files.");
        const media = args.filePath ? await fromFile(args.filePath) : args.url ? await fromUrl(args.url.trim()) : fromDataUrl(args.dataUrl!.trim());
        const kind = mediaKind(media.mime);
        if (!kind) throw new Error(`The gallery holds images, audio and video; this is ${media.mime || "an unknown type"}.`);
        if (media.bytes.length === 0) throw new Error("The file is empty.");

        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(media.bytes)], { type: media.mime }), media.filename);
        form.append("title", args.title || media.filename.replace(/\.[^.]+$/, ""));
        if (args.description) form.append("description", args.description);
        if (args.tags?.length) form.append("tags", JSON.stringify(args.tags));
        const data = await client.postForm<any>("/api/user/gallery/upload", form);
        const creation = data.creation || {};
        return text({
          success: true,
          creationId: creation.id ?? null,
          url: data.url || creation.contentUrl || null,
          type: kind,
          title: creation.title || creation.prompt || args.title || media.filename,
          sizeBytes: media.bytes.length,
          next: "Use this url as the input to any other AetherWave tool. It is permanent and is listed by aetherwave_list_my_creations.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const keys = Object.keys(MANUALS) as [ManualKey, ...ManualKey[]];
  server.registerTool(
    "aetherwave_get_user_manual",
    {
      annotations: { readOnlyHint: !local, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Get an AetherWave user manual (PDF)",
      description:
        "Returns the download link for an AetherWave user manual PDF" +
        (local ? " and, unless `saveTo` is \"none\", saves a copy to the user's Downloads folder (or a folder given in `saveTo`) and returns the path. " : ". ") +
        "Manuals: `mcp` (this MCP server: every tool, prices, long jobs, characters, comics, merch, troubleshooting), `graphic-novel` (Graphic Novel Studio), `ugc-studio` (UGC Studio), `project-studio` (Project Studio video editor). Free. " +
        "Use it when the user asks for the manual, documentation, a guide or help with how AetherWave or these tools work.",
      inputSchema: {
        manual: z.enum(keys).optional().describe("Which manual. Defaults to 'mcp'."),
        ...(local
          ? { saveTo: z.string().optional().describe("Folder to save the PDF in. Defaults to the Downloads folder. Pass \"none\" to only return the link.") }
          : {}),
      },
    },
    async (args: any) => {
      try {
        const key: ManualKey = args.manual || "mcp";
        const m = MANUALS[key];
        const result: Record<string, unknown> = { manual: key, title: m.title, url: m.url };
        if (local && args.saveTo !== "none") {
          const res = await fetch(m.url);
          if (!res.ok) throw new Error(`Downloading the manual failed: ${res.status}`);
          const bytes = Buffer.from(await res.arrayBuffer());
          const dir = resolve(args.saveTo || join(homedir(), "Downloads"));
          await mkdir(dir, { recursive: true });
          const path = join(dir, basename(new URL(m.url).pathname));
          await writeFile(path, bytes);
          Object.assign(result, { savedTo: path, sizeBytes: bytes.length });
        }
        return text(result);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
