/**
 * Comic book (Graphic Novel Engine) tools.
 *
 * Every tool here is a thin wrapper over an existing /api/graphic-novel/* route
 * in the platform repo (server/graphic-novel-routes.ts). The request and
 * response shapes below were read off those route handlers on 2026-09-25, not
 * off the web page or the docs. If a route's `req.body` destructure changes,
 * these tools drift silently: re-read the handler, not this comment.
 *
 * The pipeline is slow and serial (a 12-page book measured ~65 minutes of
 * drawing, 1.5 to 6 minutes a panel), so NO tool blocks for a whole step.
 * Every long step starts and returns; `aetherwave_comic_status` is how an agent
 * comes back. A request that outlives its short client deadline is reported as
 * "still working", never as a failure, because the server keeps going.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AetherwaveClient } from "./api.js";

/* ─── Contract constants (read from the platform, 2026-09-25) ─────────────── */

/** Art styles offered by the Graphic Novel Studio page (`#inputArtStyle`). */
export const ART_STYLES = [
  "manga",
  "anime",
  "marvel",
  "dc-comic",
  "comic-noir",
  "franco-belgian",
  "retro-silver-age",
  "webtoon",
  "underground-indie",
  "painted-realism",
  "pixar-3d",
  "hyper-realistic",
  "custom",
] as const;

export const GENRES = [
  "action",
  "adventure",
  "fantasy",
  "sci-fi",
  "horror",
  "romance",
  "mystery",
  "thriller",
  "slice-of-life",
  "superhero",
  "historical",
  "literary",
] as const;

/* Only the two panel engines the page exposes. The route also accepts older
 * keys (nano-banana-2, flux, ...), but on 2026-09-25 every key except
 * "gpt-image-2-5" DRAWS on GPT Image 1.5 (+ GPT Image 2 for the cover) while
 * being PRICED by its own key - so "nano-banana-2" bills 4 cr a panel for a
 * 9 cr panel. Exposing those keys would sell a model the book does not use. */
export const IMAGE_MODELS = ["gpt-image-2", "gpt-image-2-5"] as const;

/** Panel states the server stores on gn_panels.status. */
type PanelState = "pending" | "generating" | "complete" | "error";

/** Hosts whose images are permanent AetherWave storage (R2). */
const PERMANENT_IMAGE_HOSTS = ["media.aetherwavestudio.com"];

/* Short deadlines: MCP clients commonly give a tool call ~60 s. */
const REFERENCE_TIMEOUT_MS = 50_000;
const REDRAW_TIMEOUT_MS = 50_000;
const EXPORT_WAIT_MS = 40_000;

/* ─── Pure helpers (exported for tests) ───────────────────────────────────── */

/** True when a URL is one of the character's own images or permanent AetherWave storage. */
export function isAcceptableReference(url: string, character: any): boolean {
  const own = new Set<string>([
    ...(Array.isArray(character?.referenceOptions) ? character.referenceOptions : []),
    ...(character?.referenceImageUrl ? [character.referenceImageUrl] : []),
  ]);
  if (own.has(url)) return true;
  try {
    const host = new URL(url).hostname;
    return PERMANENT_IMAGE_HOSTS.includes(host);
  } catch {
    return false;
  }
}

export type DrawingState =
  | "no_script"
  | "not_started"
  | "drawing"
  | "redrawing"
  | "stalled"
  | "done";

/**
 * Where the drawing step really is.
 *
 * `batchRunning: false` does NOT mean finished. A deploy restarts the server,
 * the in-memory run dies, boot recovery flips the orphaned panel back to
 * "pending", and the status route simply reports batchRunning:false with
 * panels still pending (seen twice on the demo book, 07:35 and 07:46 on
 * 2026-09-25). A client that read that as "done" would assemble a book with
 * holes in it. So: anything pending or failed with no run is STALLED.
 */
export function classifyDrawing(project: any, ps: any): {
  state: DrawingState;
  reason: string;
} {
  const total = Number(ps?.total || 0);
  const completed = Number(ps?.completed || 0);
  const failed = Number(ps?.failed || 0);
  const pending = Number(ps?.pending || 0);
  const generating = Number(ps?.generating || 0);
  if (total === 0) {
    return { state: "no_script", reason: "No panels yet: the script has not been written." };
  }
  if (ps?.batchRunning) {
    return {
      state: "drawing",
      reason: `A drawing run is active (panel ${ps.batchCurrent || "?"} of this run). Panels draw one at a time, 1.5 to 6 minutes each.`,
    };
  }
  if (generating > 0) {
    return {
      state: "redrawing",
      reason: `${generating} panel(s) drawing outside a run (a single-panel redraw).`,
    };
  }
  if (pending + failed > 0) {
    if (project?.status === "script-ready" && completed === 0 && failed === 0) {
      return { state: "not_started", reason: "Script is ready; drawing has not been started." };
    }
    const parts: string[] = [];
    if (pending > 0) {
      parts.push(
        `${pending} panel(s) were never drawn because the run ended early (a server restart, the balance ran out, or it was stopped)`,
      );
    }
    if (failed > 0) parts.push(`${failed} panel(s) failed (see failedPanels for each reason)`);
    return {
      state: "stalled",
      reason: `${parts.join("; ")}. No run is active. Call aetherwave_comic_draw again: it resumes with only the pending and failed panels, and a panel is charged only when it succeeds.`,
    };
  }
  return { state: "done", reason: `All ${completed} panels are drawn.` };
}

/** Build the compact status an agent reads. `detail` adds every panel. */
export function summarizeComic(full: any, ps: any, detail: "summary" | "panels" = "summary") {
  const project = full?.project || {};
  const pages: any[] = Array.isArray(full?.pages) ? full.pages : [];
  const panels: any[] = Array.isArray(full?.panels) ? full.panels : [];
  const characters: any[] = Array.isArray(full?.characters) ? full.characters : [];
  const perPanel = Number(full?.panelCreditCost || 0);
  const pageNo = new Map<string, number>(pages.map((p) => [p.id, p.pageNumber]));
  const trim = (s: unknown, n: number) =>
    typeof s === "string" ? (s.length > n ? s.slice(0, n) + "..." : s) : null;

  const drawing = classifyDrawing(project, ps);
  const failedPanels = panels
    .filter((p) => (p.status as PanelState) === "error")
    .map((p) => ({
      panelId: p.id,
      page: pageNo.get(p.pageId) ?? null,
      panelIndex: p.panelIndex,
      errorMessage: p.errorMessage || null,
      scene: trim(p.sceneDescription, 300),
    }));
  const openPanels = Number(ps?.pending || 0) + Number(ps?.failed || 0);
  const assembled = pages.filter((p) => p.assembledImageUrl);
  const stalePages = pages.filter((p) => p.assembledImageUrl && p.assemblyStaleAt).map((p) => p.pageNumber);
  const missingPages = pages.filter((p) => !p.assembledImageUrl).map((p) => p.pageNumber);

  let nextStep: string;
  const unapproved = characters.filter((c) => !c.referenceImageUrl).map((c) => c.name);
  switch (true) {
    case project.status === "scripting":
      nextStep = "The script is being written (about 2 to 3 minutes). Check status again shortly.";
      break;
    case project.status === "error" && panels.length === 0:
      nextStep = `Script writing failed: ${project.errorMessage || "no reason recorded"}. Call aetherwave_comic_write_script to try again.`;
      break;
    case panels.length === 0:
      nextStep = unapproved.length
        ? `Approve a reference image for: ${unapproved.join(", ")} (aetherwave_comic_character_reference), then call aetherwave_comic_write_script.`
        : "Call aetherwave_comic_write_script.";
      break;
    case drawing.state === "drawing" || drawing.state === "redrawing":
      nextStep = "Drawing is in progress. Check back in a few minutes.";
      break;
    case drawing.state === "not_started" || drawing.state === "stalled":
      nextStep = `Call aetherwave_comic_draw (about ${openPanels * perPanel} credits for ${openPanels} panel(s)).${
        failedPanels.length
          ? " For a panel that keeps failing on a content refusal, reword it with aetherwave_comic_redraw_panel instead."
          : ""
      }`;
      break;
    case project.status === "assembling":
      nextStep = "Pages are being assembled (about 4 seconds a page). Check status again shortly.";
      break;
    case assembled.length === pages.length && pages.length > 0 && stalePages.length === 0:
      nextStep = "The book is assembled. Call aetherwave_comic_export for a PDF, EPUB, CBZ or bundle link.";
      break;
    default:
      nextStep = stalePages.length
        ? `Pages ${stalePages.join(", ")} changed since assembly. Call aetherwave_comic_assemble.`
        : "All panels are drawn. Call aetherwave_comic_assemble.";
  }

  const out: Record<string, unknown> = {
    projectId: project.id,
    title: project.title,
    projectStatus: project.status,
    projectError: project.errorMessage || null,
    artStyle: project.artStyle,
    imageModel: project.imageModel,
    creditsPerPanel: perPanel,
    drawing: drawing.state,
    drawingDetail: drawing.reason,
    panels: {
      total: Number(ps?.total || 0),
      completed: Number(ps?.completed || 0),
      failed: Number(ps?.failed || 0),
      pending: Number(ps?.pending || 0),
      generating: Number(ps?.generating || 0),
      batchRunning: !!ps?.batchRunning,
    },
    creditsToFinishDrawing: openPanels * perPanel,
    failedPanels,
    pages: {
      total: pages.length,
      assembled: assembled.length,
      missing: missingPages,
      staleSinceAssembly: stalePages,
      urls: assembled.map((p) => ({ page: p.pageNumber, url: p.assembledImageUrl })),
    },
    characters: characters.map((c) => ({
      characterId: c.id,
      name: c.name,
      role: c.role,
      approvedReference: c.referenceImageUrl || null,
      referenceOptions: Array.isArray(c.referenceOptions) ? c.referenceOptions : [],
    })),
    nextStep,
  };
  if (detail === "panels") {
    out.panelList = panels
      .slice()
      .sort(
        (a, b) =>
          (pageNo.get(a.pageId) ?? 0) - (pageNo.get(b.pageId) ?? 0) || a.panelIndex - b.panelIndex,
      )
      .map((p) => ({
        panelId: p.id,
        page: pageNo.get(p.pageId) ?? null,
        panelIndex: p.panelIndex,
        status: p.status,
        imageUrl: p.imageUrl || null,
        scene: trim(p.sceneDescription, 200),
        charactersPresent: p.charactersPresent || [],
        errorMessage: p.errorMessage || null,
      }));
  }
  return out;
}

/* ─── MCP plumbing ────────────────────────────────────────────────────────── */

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

function refuse(message: string, extra: Record<string, unknown> = {}) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ refused: true, message, ...extra }, null, 2) }],
  };
}

const enc = encodeURIComponent;

/** Register every aetherwave_comic_* tool on a server. */
export function registerComicTools(server: McpServer, client: AetherwaveClient): void {
  const account = async () => (await client.whoami()).username;
  const loadProject = (id: string) => client.get<any>(`/api/graphic-novel/${enc(id)}`);
  const loadPanelStatus = (id: string) => client.get<any>(`/api/graphic-novel/${enc(id)}/panels/status`);

  // ─── estimate ────────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_comic_estimate",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "Estimate the credit cost of a comic book",
      description:
        "Free. Quotes a comic before anything is made: script credits plus panel credits for a page count and panel engine. The quote assumes 4 panels a page, so it runs HIGH for short books (a 12-page book was quoted 462 and cost 301 because the script wrote 27 panels, not 48). The real panel price is known after the script: aetherwave_comic_status reports creditsToFinishDrawing, and aetherwave_comic_draw accepts maxCredits. Character references cost 6 credits each on top.",
      inputSchema: {
        pageCount: z.coerce.number().int().min(4).max(64).describe("Target page count. The studio offers 12, 16, 24, 32, 48, 64."),
        imageModel: z
          .enum(IMAGE_MODELS)
          .optional()
          .describe("Panel engine. 'gpt-image-2' (default, faster: GPT Image 1.5 panels + GPT Image 2 cover) or 'gpt-image-2-5' (quality, slower, every panel on GPT Image 2.5). Both 9 credits a panel."),
      },
    },
    async (args) => {
      try {
        const data = await client.post<any>("/api/graphic-novel/estimate", {
          storyInput: { targetPageCount: args.pageCount, imageModel: args.imageModel || "gpt-image-2" },
        });
        return text({
          account: await account(),
          scriptCredits: data.scriptGeneration?.credits,
          panelCredits: data.panelGeneration?.credits,
          assumedPanels: data.panelGeneration?.estimatedPanelCount,
          creditsPerPanel: data.panelGeneration?.creditsPerPanel,
          totalCredits: data.totalCredits,
          imageModel: data.imageModel,
          note: "Upper-bound quote at 4 panels a page. Character references are extra (6 credits each).",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── create ──────────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_comic_create",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Create a comic book project",
      description: `Free. Creates a comic book project (the AetherWave Graphic Novel Engine) and returns its projectId and each character's characterId. Nothing is generated yet.

The full flow, one tool per step. Every slow step starts and returns; come back with aetherwave_comic_status.
1. aetherwave_comic_create (this) - title, premise, cast, style.
2. aetherwave_comic_character_reference - generate a reference image per character, then approve one. Do this BEFORE the script: approving rewrites the character's description from the picture, and every panel uses the approved image to keep the face consistent.
3. aetherwave_comic_write_script - about 2 to 3 minutes, charged on actual use (a 12-page script cost 40).
4. aetherwave_comic_draw - draws every panel, one at a time, 1.5 to 6 minutes each (a 12-page book with 27 panels took about 65 minutes). 9 credits a panel, charged only on success.
5. aetherwave_comic_assemble - lays out the pages and letters them, about 45 seconds for 12 pages. Free.
6. aetherwave_comic_export - a PDF, EPUB, CBZ or bundle download link. Free.

Characters: give each a concrete visualDescription (age, hair, face, clothes, one signature item). The script writer and every panel read it.`,
      inputSchema: {
        title: z.string().min(1).max(200).describe("Book title. The cover panel paints it into the art."),
        premise: z.string().min(1).describe("What the story is about: the situation, the goal, the stakes. A paragraph is ideal."),
        characters: z
          .array(
            z.object({
              name: z.string().min(1).max(100),
              role: z.enum(["protagonist", "antagonist", "supporting", "minor"]).optional().describe("Defaults to 'supporting'. Mark exactly one protagonist: the cover is drawn around them."),
              visualDescription: z.string().min(1).describe("How they look, concretely."),
              personalityNotes: z.string().optional(),
              backstoryNotes: z.string().optional(),
            }),
          )
          .min(1)
          .max(12)
          .describe("The cast. At least one."),
        artStyle: z.enum(ART_STYLES).optional().describe("Art style. Default 'marvel'. 'custom' means describe the look in toneNotes."),
        genre: z.enum(GENRES).optional().describe("Default 'fantasy'."),
        contentRating: z.enum(["all-ages", "teen", "mature"]).optional().describe("Default 'teen'."),
        pageCount: z.coerce.number().int().min(4).max(64).optional().describe("Target pages. Default 24. The studio offers 12, 16, 24, 32, 48, 64. The script may land on fewer panels per page than the estimate assumes."),
        imageModel: z.enum(IMAGE_MODELS).optional().describe("Panel engine. 'gpt-image-2' (default, faster) or 'gpt-image-2-5' (quality, slower). 9 credits a panel either way. Locked once created."),
        settingDescription: z.string().optional().describe("Where and when: places, era, recurring landmarks. Every panel prompt includes it."),
        toneNotes: z.string().optional().describe("Mood, pacing, humour, visual references."),
        keyScenes: z.string().optional().describe("Moments the script must include."),
        chapterOutline: z.string().optional().describe("Optional outline if you want to steer the structure."),
        additionalNotes: z.string().optional().describe("Anything else for the script writer."),
        referenceWorks: z.array(z.string()).optional().describe("Comics or films to evoke, as short titles."),
        aspectRatio: z.enum(["2:3", "4:5"]).optional().describe("Page shape. Default '2:3' (comic book). Locked once created."),
        stylePreset: z.enum(["default", "cartoon-yellow", "comic-classic", "oblong-classic"]).optional().describe("Speech balloon and caption style. Default 'default'. Locked once created."),
      },
    },
    async (args) => {
      try {
        const storyInput: Record<string, unknown> = {
          title: args.title,
          premise: args.premise,
          characters: args.characters.map((c) => ({
            name: c.name,
            role: c.role || "supporting",
            visualDescription: c.visualDescription,
            personalityNotes: c.personalityNotes || null,
            backstoryNotes: c.backstoryNotes || null,
          })),
          artStyle: args.artStyle || "marvel",
          genre: args.genre || "fantasy",
          contentRating: args.contentRating || "teen",
          targetPageCount: args.pageCount || 24,
          imageModel: args.imageModel || "gpt-image-2",
          settingDescription: args.settingDescription || "",
          toneNotes: args.toneNotes || null,
          keyScenes: args.keyScenes || null,
          chapterOutline: args.chapterOutline || null,
          additionalNotes: args.additionalNotes || undefined,
          referenceWorks: args.referenceWorks || [],
          aspectRatio: args.aspectRatio || "2:3",
          stylePreset: args.stylePreset || "default",
        };
        const created = await client.post<any>("/api/graphic-novel", { storyInput });
        // The create route does not return character ids; the project read does.
        const full = await loadProject(created.projectId);
        return text({
          account: await account(),
          projectId: created.projectId,
          status: created.status,
          characters: (full.characters || []).map((c: any) => ({ characterId: c.id, name: c.name, role: c.role })),
          estimate: {
            scriptCredits: created.estimatedScriptCredits,
            panelCredits: created.estimatedPanelCredits,
            totalCredits: created.estimatedTotalCredits,
            note: "Upper bound at 4 panels a page; references are 6 credits each on top.",
          },
          nextStep: "Call aetherwave_comic_character_reference with action 'generate' for each character, then 'approve' the one you want.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── character reference ─────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_comic_character_reference",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Generate or approve a comic character's reference image",
      description: `Gives a comic character a reference image, which every panel uses to keep that character looking the same.

action 'generate' (6 credits per image): draws 'count' (1 to 4) full-body references in the book's art style. Each new image is ADDED to the character's options, nothing is replaced. With editPrompt alone, the note steers a fresh drawing ("older, with a grey beard"). With editPrompt AND baseUrl (one of this character's existing images) it edits that image and keeps the same person. Images are saved to permanent AetherWave storage. If the call runs out of time the images still land: read them from aetherwave_comic_status (characters[].referenceOptions).

action 'approve' (free): sets imageUrl as the character's reference and re-describes the character from the picture. Approve before aetherwave_comic_write_script. Only the character's own images or other permanent AetherWave images (media.aetherwavestudio.com) are accepted: a temporary link would break every panel when it expires.

Identify the character by characterId (from aetherwave_comic_create or aetherwave_comic_status) or by exact characterName.`,
      inputSchema: {
        projectId: z.string().min(1),
        action: z.enum(["generate", "approve"]),
        characterId: z.string().optional(),
        characterName: z.string().optional().describe("Alternative to characterId: the character's name, matched without case."),
        count: z.coerce.number().int().min(1).max(4).optional().describe("generate: how many images, 1 to 4 (default 1). 6 credits each."),
        editPrompt: z.string().max(500).optional().describe("generate: what to change or emphasise."),
        baseUrl: z.string().url().optional().describe("generate: one of this character's existing images to edit. Requires editPrompt."),
        imageUrl: z.string().url().optional().describe("approve: the image to approve."),
      },
    },
    async (args) => {
      try {
        const full = await loadProject(args.projectId);
        const chars: any[] = full.characters || [];
        const char = args.characterId
          ? chars.find((c) => c.id === args.characterId)
          : chars.find((c) => String(c.name).toLowerCase() === String(args.characterName || "").toLowerCase());
        if (!char) {
          return refuse("Character not found in this project. Pass a characterId or exact characterName.", {
            characters: chars.map((c) => ({ characterId: c.id, name: c.name })),
          });
        }
        const base = `/api/graphic-novel/${enc(args.projectId)}/characters/${enc(char.id)}`;

        if (args.action === "approve") {
          if (!args.imageUrl) return refuse("action 'approve' needs imageUrl.");
          if (!isAcceptableReference(args.imageUrl, char)) {
            return refuse(
              "That image is not one of this character's references and is not permanent AetherWave storage. The platform stores the approved URL as-is, so a temporary link (for example a tempfile.aiquickdraw.com result) would break every panel once it expires. Generate a reference with action 'generate' instead.",
              { referenceOptions: char.referenceOptions || [] },
            );
          }
          const data = await client.post<any>(`${base}/approve-reference`, { imageUrl: args.imageUrl });
          return text({
            account: await account(),
            approved: true,
            characterId: data.characterId,
            characterName: data.characterName,
            referenceImageUrl: data.referenceImageUrl,
          });
        }

        if (args.baseUrl && !args.editPrompt) return refuse("baseUrl needs an editPrompt describing the change.");
        const count = args.count || 1;
        const body: Record<string, string> = {};
        if (args.editPrompt) body.editPrompt = args.editPrompt;
        if (args.baseUrl) body.baseUrl = args.baseUrl;
        const settled = await Promise.allSettled(
          Array.from({ length: count }, () =>
            client.request<any>("POST", `${base}/generate-reference`, body, { timeoutMs: REFERENCE_TIMEOUT_MS }),
          ),
        );
        const made: string[] = [];
        const errors: string[] = [];
        let stillRunning = 0;
        let options: string[] | null = null;
        for (const s of settled) {
          if (s.status === "fulfilled") {
            if (s.value.data?.image) made.push(s.value.data.image);
            if (Array.isArray(s.value.data?.images)) options = s.value.data.images;
          } else if ((s.reason as any)?.timedOut) {
            stillRunning++;
          } else {
            errors.push((s.reason as Error)?.message || String(s.reason));
          }
        }
        return text({
          account: await account(),
          characterId: char.id,
          characterName: char.name,
          newImages: made,
          creditsCharged: made.length * 6,
          stillGenerating: stillRunning,
          errors,
          referenceOptions: options ?? char.referenceOptions ?? [],
          nextStep: stillRunning
            ? "Some images are still being drawn server-side; they will appear in aetherwave_comic_status under this character's referenceOptions."
            : "Look at the images, then call this tool with action 'approve' and the imageUrl you want.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── write script ────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_comic_write_script",
    {
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      title: "Write the comic's script (starts, then returns)",
      description:
        "Starts writing the script: chapters, pages, panels, dialogue and captions. Returns immediately; it takes about 2 to 3 minutes, then aetherwave_comic_status shows the panels. Charged on actual use when it finishes (a 12-page script cost 40 credits). Approve character references first. Re-writing a script DELETES every page and panel already made, including drawn panels, so a project that already has panels needs replaceExisting: true.",
      inputSchema: {
        projectId: z.string().min(1),
        replaceExisting: z.boolean().optional().describe("Required as true when the project already has panels. They are all deleted."),
      },
    },
    async (args) => {
      try {
        const full = await loadProject(args.projectId);
        const panels: any[] = full.panels || [];
        if (full.project?.status === "scripting") {
          return text({ account: await account(), started: false, status: "scripting", message: "The script is already being written. Check aetherwave_comic_status." });
        }
        if (panels.length > 0 && !args.replaceExisting) {
          const drawn = panels.filter((p) => p.status === "complete").length;
          return refuse(
            `This project already has ${panels.length} panels (${drawn} drawn). Writing a new script deletes all of them. Pass replaceExisting: true only if that is intended.`,
          );
        }
        const unapproved = (full.characters || []).filter((c: any) => !c.referenceImageUrl).map((c: any) => c.name);
        const data = await client.post<any>(`/api/graphic-novel/${enc(args.projectId)}/script`, {});
        return text({
          account: await account(),
          started: data.status === "scripting",
          status: data.status,
          message: data.message,
          warning: unapproved.length
            ? `No approved reference for: ${unapproved.join(", ")}. Their panels will be drawn from text alone and faces will drift between panels.`
            : undefined,
          nextStep: "Check aetherwave_comic_status in about 2 to 3 minutes.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── draw ────────────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_comic_draw",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Draw the comic's panels (starts, then returns)",
      description:
        "action 'start' (default): starts drawing every panel that is not drawn yet (pending or failed), one at a time, 1.5 to 6 minutes each, and returns immediately. 9 credits a panel, charged only when a panel succeeds. Safe to call again at any time: if a run is active it reports alreadyDrawing and starts nothing; if a run died (a server restart ends a run silently) it resumes with just the missing panels. Pass maxCredits to refuse a run that would cost more. Follow progress with aetherwave_comic_status. action 'stop': asks the active run to stop after the panel it is on.",
      inputSchema: {
        projectId: z.string().min(1),
        action: z.enum(["start", "stop"]).optional(),
        maxCredits: z.coerce.number().int().min(0).optional().describe("start: refuse if the panels left to draw would cost more than this."),
      },
    },
    async (args) => {
      try {
        const id = enc(args.projectId);
        if (args.action === "stop") {
          const data = await client.post<any>(`/api/graphic-novel/${id}/panels/cancel`, {});
          return text({ account: await account(), stopped: true, message: data.message });
        }
        const [full, ps] = await Promise.all([loadProject(args.projectId), loadPanelStatus(args.projectId)]);
        const panels: any[] = full.panels || [];
        if (panels.length === 0) {
          return refuse(
            full.project?.status === "scripting"
              ? "The script is still being written. Check aetherwave_comic_status in a minute or two."
              : "This project has no panels yet. Call aetherwave_comic_write_script first.",
          );
        }
        if (ps.batchRunning) {
          return text({ account: await account(), started: false, alreadyDrawing: true, panels: ps, message: "A drawing run is already active. Nothing new was started." });
        }
        const toDraw = panels.filter((p) => ["pending", "error", "generating"].includes(p.status)).length;
        const perPanel = Number(full.panelCreditCost || 0);
        const quote = toDraw * perPanel;
        if (toDraw === 0) {
          return text({ account: await account(), started: false, message: "Every panel is already drawn. Call aetherwave_comic_assemble." });
        }
        if (args.maxCredits !== undefined && quote > args.maxCredits) {
          return refuse(`Drawing ${toDraw} panel(s) at ${perPanel} credits costs up to ${quote}, over maxCredits ${args.maxCredits}. Nothing was started.`);
        }
        let data: any;
        try {
          data = await client.post<any>(`/api/graphic-novel/${id}/panels/generate`, {});
        } catch (err: any) {
          if (err?.status === 409) {
            return text({ account: await account(), started: false, alreadyDrawing: true, message: err?.body?.error || "Already drawing." });
          }
          if (err?.status === 402) {
            return refuse("Not enough credits for the panels left to draw. The whole run must be affordable to start.", {
              required: err?.body?.required,
              available: err?.body?.available,
            });
          }
          throw err;
        }
        return text({
          account: await account(),
          started: !!data.totalPanels,
          panelsQueued: data.totalPanels ?? 0,
          creditsPerPanel: data.creditsPerPanel ?? perPanel,
          upToCredits: data.estimatedCredits ?? quote,
          message: data.message,
          expectedMinutes: data.totalPanels ? `${Math.round(data.totalPanels * 1.5)} to ${data.totalPanels * 6}` : undefined,
          nextStep: "Check aetherwave_comic_status every few minutes. If it reports 'stalled', call this tool again.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── assemble ────────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_comic_assemble",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Assemble the comic's pages (starts, then returns)",
      description:
        "Free. Lays out every page from its drawn panels and letters the speech balloons and captions, then marks the book complete. Returns immediately; about 4 seconds a page (12 pages took about 45 seconds). A page with any undrawn panel is skipped and the book is marked 'pages-partial', so by default this refuses until every panel is drawn. Also re-run it after redrawing a panel on an assembled page. Then aetherwave_comic_export.",
      inputSchema: {
        projectId: z.string().min(1),
        allowPartial: z.boolean().optional().describe("Assemble the complete pages even though some panels are not drawn."),
      },
    },
    async (args) => {
      try {
        const ps = await loadPanelStatus(args.projectId);
        if (ps.batchRunning) return refuse("Panels are still drawing. Assemble when aetherwave_comic_status reports drawing: 'done'.");
        if (!ps.total) return refuse("This project has no panels yet.");
        if (ps.completed < ps.total && !args.allowPartial) {
          return refuse(
            `${ps.total - ps.completed} of ${ps.total} panels are not drawn, so their pages would be skipped. Finish them with aetherwave_comic_draw, or pass allowPartial: true.`,
            { panels: ps },
          );
        }
        const data = await client.post<any>(`/api/graphic-novel/${enc(args.projectId)}/assemble`, {});
        return text({
          account: await account(),
          started: true,
          pages: data.totalPages,
          message: data.message,
          nextStep: "Check aetherwave_comic_status in about a minute; projectStatus becomes 'complete'.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── status ──────────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_comic_status",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "Check a comic book's progress",
      description:
        "Free. Where a comic is and what to do next. Reports the project status, the drawing state, every failed panel with its reason, assembled page URLs, and each character's reference images, plus a nextStep. drawing is one of: no_script, not_started, drawing, redrawing, stalled, done. 'stalled' means panels are still pending or failed and NO run is active: a server restart or a failure ended the run, and aetherwave_comic_draw must be called again. Never treat a stopped run as finished. With no projectId it lists your recent comic projects.",
      inputSchema: {
        projectId: z.string().optional().describe("Omit to list your recent comic projects."),
        detail: z.enum(["summary", "panels"]).optional().describe("'panels' adds every panel with its image URL, scene and status (panelIds for aetherwave_comic_redraw_panel)."),
      },
    },
    async (args) => {
      try {
        if (!args.projectId) {
          const data = await client.get<any>("/api/graphic-novel?pageSize=20");
          return text({
            account: await account(),
            total: data.meta?.total,
            projects: (data.projects || []).map((p: any) => ({
              projectId: p.id,
              title: p.title,
              status: p.status,
              pages: p.actualPageCount ?? p.targetPageCount,
              artStyle: p.artStyle,
              updatedAt: p.updatedAt,
            })),
          });
        }
        const [full, ps] = await Promise.all([loadProject(args.projectId), loadPanelStatus(args.projectId)]);
        return text({ account: await account(), ...summarizeComic(full, ps, args.detail || "summary") });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── redraw one panel ────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_comic_redraw_panel",
    {
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      title: "Redraw one comic panel, optionally reworded",
      description:
        "Redraws a single panel, replacing its current image. 9 credits, charged only on success. Pass prompt to replace the panel's scene description for this drawing: the way to get past a content-filter refusal (see failedPanels[].errorMessage in aetherwave_comic_status) is to reword the scene, not to retry it. Dialogue and captions are kept. A redraw takes 1.5 to 6 minutes; if it outlasts this call the tool returns stillDrawing and the result shows up in aetherwave_comic_status. Refused while a full drawing run is active. If the panel's page was already assembled, re-run aetherwave_comic_assemble afterwards.",
      inputSchema: {
        projectId: z.string().min(1),
        panelId: z.string().min(1).describe("From aetherwave_comic_status (failedPanels, or detail: 'panels')."),
        prompt: z.string().max(4000).optional().describe("New scene description for this panel. Omit to redraw the same scene."),
      },
    },
    async (args) => {
      try {
        const ps = await loadPanelStatus(args.projectId);
        if (ps.batchRunning) {
          return refuse("A drawing run is active and may draw this panel too. Wait for it, or stop it with aetherwave_comic_draw action 'stop'.");
        }
        const path = `/api/graphic-novel/${enc(args.projectId)}/panels/${enc(args.panelId)}/regenerate`;
        const body = args.prompt ? { promptOverride: args.prompt } : {};
        try {
          const { data } = await client.request<any>("POST", path, body, { timeoutMs: REDRAW_TIMEOUT_MS });
          return text({
            account: await account(),
            redrawn: true,
            panelId: data.panel?.id,
            status: data.panel?.status,
            imageUrl: data.panel?.imageUrl,
          });
        } catch (err: any) {
          if (err?.timedOut) {
            return text({
              account: await account(),
              redrawn: false,
              stillDrawing: true,
              message: "The redraw is still running on the server. Check aetherwave_comic_status in a few minutes.",
            });
          }
          if (err?.status === 402) {
            return refuse("Not enough credits for a redraw.", { required: err?.body?.required, available: err?.body?.available });
          }
          if (err?.status === 500 || err?.status === 502 || err?.status === 524) {
            const full = await loadProject(args.projectId).catch(() => null);
            const panel = (full?.panels || []).find((p: any) => p.id === args.panelId);
            return refuse("The redraw failed. Nothing was charged.", {
              panelStatus: panel?.status ?? null,
              errorMessage: panel?.errorMessage ?? null,
            });
          }
          throw err;
        }
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ─── export ──────────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_comic_export",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      title: "Export a finished comic as a download link",
      description:
        "Free. Builds the assembled book as 'pdf', 'epub' (fixed-layout, Kindle ready), 'cbz' (comic readers) or 'bundle' (a ZIP of all three plus page PNGs), and returns a download URL that lasts about a day. Files are large (a 12-page PDF measured 130 MB). The build usually finishes within this call; if not, it returns an exportId, and calling again with that exportId returns the link. One export builds per account at a time: if one is already building, this reports that one (alreadyExporting, with its projectId) instead of starting a second. When the service is busy it refuses with retryAfterSeconds. Assemble first.",
      inputSchema: {
        projectId: z.string().min(1),
        format: z.enum(["pdf", "epub", "cbz", "bundle"]).optional().describe("Default 'pdf'."),
        includeBackMatter: z.boolean().optional().describe("Append the project's promotional back pages if it has them turned on. Default true."),
        exportId: z.string().optional().describe("Check on an export started earlier instead of starting a new one."),
      },
    },
    async (args) => {
      const id = enc(args.projectId);
      const jobPath = (exportId: string) => `/api/graphic-novel/${id}/export/jobs/${enc(exportId)}`;
      const view = async (job: any) => ({
        account: await account(),
        exportId: job.exportId,
        format: job.format,
        status: job.status,
        url: job.url || undefined,
        megabytes: typeof job.bytes === "number" ? Math.round(job.bytes / 1e5) / 10 : undefined,
        error: job.error || undefined,
        note:
          job.status === "complete"
            ? "The link expires after about a day. Download or re-host it."
            : job.status === "building"
              ? "Still building. Call again with this exportId."
              : undefined,
      });
      try {
        if (args.exportId) {
          try {
            return text(await view(await client.get<any>(jobPath(args.exportId))));
          } catch (err: any) {
            if (err?.status === 404) {
              return refuse("That export is gone: it expired or a server restart lost it. Start a new export without exportId.");
            }
            throw err;
          }
        }
        const format = args.format || "pdf";
        let started: any;
        try {
          started = (
            await client.request<any>(
              "POST",
              `/api/graphic-novel/${id}/export/${format}`,
              { deliver: "url", includeBackMatter: args.includeBackMatter !== false },
              { timeoutMs: 30_000 },
            )
          ).data;
        } catch (err: any) {
          if (err?.status === 409 && err?.body?.exportId) {
            // One URL export builds per account at a time: poll the one already running.
            started = {
              exportId: err.body.exportId,
              format: err.body.format,
              statusPath: err.body.statusPath,
              alreadyExporting: true,
            };
          } else if (err?.status === 429) {
            return refuse("Too many exports are building on AetherWave right now. Nothing was started; try again shortly.", {
              retryAfterSeconds: err?.body?.retryAfterSeconds ?? 30,
            });
          } else if (err?.notJson) {
            return refuse(
              "This AetherWave server does not support export links yet (it streamed the file instead). Download the book from the Graphic Novel Studio in the web app.",
            );
          } else {
            throw err;
          }
        }
        if (!started?.exportId) {
          return refuse("The export did not start.", { response: started });
        }
        const deadline = Date.now() + EXPORT_WAIT_MS;
        // A 409 names the job already building for this account, possibly for
        // another book, so poll the path the server gave rather than rebuilding it.
        const pollPath: string = started.statusPath || jobPath(started.exportId);
        let job: any = { ...started, exportId: started.exportId, status: "building" };
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 3000));
          job = await client.get<any>(pollPath);
          if (job.status !== "building") break;
        }
        const out: Record<string, unknown> = await view({ ...job, exportId: started.exportId });
        if (started.alreadyExporting) {
          out.alreadyExporting = true;
          const m = /\/api\/graphic-novel\/([^/]+)\/export\/jobs\//.exec(pollPath);
          if (m) out.projectId = decodeURIComponent(m[1]);
          out.message =
            "An export was already building for this account (one at a time), so this reports that export instead of starting a new one. It may be a different book or format; check format and url.";
        }
        return job.status === "error" ? refuse(`Export failed: ${job.error || "unknown error"}`, out) : text(out);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
