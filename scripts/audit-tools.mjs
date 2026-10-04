// Live audit of every MCP tool against production, over real MCP stdio.
//
//   node scripts/audit-tools.mjs [--budget 300] [--out docs/audit.json]
//
// Reads the API key (and PRINTFUL_API_TOKEN) from the platform repo's .env
// and NEVER prints either. Spends credits: cheapest model/params per tool,
// and a hard cap (default 300) below which any further paid call is skipped
// and recorded as "not run (cost)". Every "running" result is followed with
// aetherwave_get_job so that tool is exercised once per pipeline kind.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BUDGET = Number(opt("--budget", 300));
const OUT = opt("--out", `docs/audit-${new Date().toISOString().slice(0, 10)}.json`);
const ONLY = opt("--only", "") ? new Set(opt("--only", "").split(",")) : null;
let prior = {}; try { for (const r of JSON.parse(readFileSync(OUT, "utf8")).rows) prior[r.tool] = prior[r.tool] || r; } catch {}
const BASE = process.env.AETHERWAVE_BASE_URL || "https://aetherwavestudio.com";
const envText = (() => { try { return readFileSync(process.env.PLATFORM_ENV_FILE || "E:/Gits/AI-Record-Label-Maker/.env", "utf8"); } catch { return ""; } })();
const envVal = (k) => (envText.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const API_KEY = process.env.AETHERWAVE_API_KEY || envVal("STUDIO_ART_API_KEY");
if (!API_KEY) throw new Error("STUDIO_ART_API_KEY not found in platform .env");
const PRINTFUL = process.env.PRINTFUL_API_TOKEN || envVal("PRINTFUL_API_TOKEN");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: {
    ...process.env,
    AETHERWAVE_API_KEY: API_KEY,
    AETHERWAVE_BASE_URL: BASE,
    ...(PRINTFUL ? { PRINTFUL_API_TOKEN: PRINTFUL } : {}),
    ...(envVal("PRINTFUL_STORE_ID") ? { PRINTFUL_STORE_ID: envVal("PRINTFUL_STORE_ID") } : {}),
    AETHERWAVE_ADMIN_TOOLS: "1",
  },
});
const mcp = new Client({ name: "tool-audit", version: "0" });
await mcp.connect(transport);
const { tools } = await mcp.listTools();
console.log(`registered tools: ${tools.length}`);

// Retries: a deploy restart serves an HTML error page for a minute or two, and
// one bad read here used to crash the whole run before any tool was called.
const balance = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${BASE}/api/quickstart/balance`, { headers: { "X-AW-Key": API_KEY } });
      const j = await r.json();
      return typeof j.credits === "number" ? j.credits : NaN;
    } catch (err) {
      if (attempt >= 5) throw err;
      console.log(`balance read failed (${err.message.slice(0, 60)}), retry ${attempt}/4 in 30 s`);
      await new Promise((res) => setTimeout(res, 30_000));
    }
  }
};
const startBalance = await balance();
let spent = 0;
const rows = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const call = async (name, args) => {
  const t0 = Date.now();
  const r = await mcp.callTool({ name, arguments: args }, undefined, { timeout: 20 * 60_000 });
  const ms = Date.now() - t0;
  const txt = r.content?.[0]?.text || "";
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  return { isError: !!r.isError, body, ms };
};

/** Poll get_job until terminal; returns { final, polls, ms }. */
const follow = async (taskId, kind, extra = {}, maxMs = 10 * 60_000) => {
  const t0 = Date.now();
  let polls = 0, last;
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 10_000));
    polls++;
    last = await call("aetherwave_get_job", { taskId, kind, ...extra });
    if (last.isError || last.body?.done || last.body?.failed) break;
  }
  return { final: last, polls, ms: Date.now() - t0 };
};

/**
 * Run one tool once and record it.
 * @param est estimated credits (0 = free); skipped when it would break the cap
 * @param check optional (body) => string|null, a contract check; a string is a mismatch note
 */
async function audit(name, args, { est = 0, check = null, followKind = null, followExtra = {}, note = "", skip = null } = {}) {
  if (ONLY && !ONLY.has(name) && prior[name]) {
    const old = prior[name];
    rows.push(old);
    let body; try { body = JSON.parse(old.response); } catch { body = undefined; }
    log(name, "-> (prior run)", old.result);
    return { ...old, body };
  }
  const row = { tool: name, args, est, result: "", ms: 0, credits: 0, note };
  rows.push(row);
  if (skip) { row.result = skip; log(name, "->", skip); return row; }
  if (est > 0 && spent + est > BUDGET) { row.result = `not run (cost: est ${est}, spent ${spent}/${BUDGET})`; log(name, "->", row.result); return row; }
  const b0 = await balance();
  let r;
  try { r = await call(name, args); } catch (e) { row.result = `fail (transport: ${e.message})`; log(name, "->", row.result); return row; }
  row.ms = r.ms;
  row.response = typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 700) : String(r.body).slice(0, 700);
  // A deliberate refusal (refuse() in src/comic.ts) is isError + { refused: true }.
  // When the row's contract check expects that refusal, it is the pass path.
  if (r.isError && r.body?.refused && check && !check(r.body)) {
    row.result = `pass (refused as designed: ${String(r.body.message).slice(0, 120)})`;
  } else if (r.isError) {
    row.result = `fail (${String(typeof r.body === "object" ? r.body.message || JSON.stringify(r.body) : r.body).slice(0, 200)})`;
  } else if (r.body?.state === "running" && followKind) {
    const f = await follow(r.body.taskId, followKind, followExtra);
    row.followed = { polls: f.polls, ms: f.ms, final: f.final?.body ? JSON.stringify(f.final.body).slice(0, 500) : String(f.final?.body) };
    row.result = f.final?.body?.done ? "pass (running -> get_job done)" : `fail (running -> ${f.final?.body?.state || f.final?.body})`;
    if (f.final?.body?.done) r.body = { ...r.body, ...f.final.body };
  } else {
    row.result = "pass";
  }
  if (check && row.result.startsWith("pass")) { const m = check(r.body); if (m) { row.mismatch = m; row.result += " (mismatch noted)"; } }
  const b1 = await balance();
  row.credits = Number.isNaN(b0) || Number.isNaN(b1) ? null : b0 - b1;
  if (row.credits > 0) spent += row.credits;
  log(name, "->", row.result, `${(r.ms / 1000).toFixed(1)}s`, `${row.credits}cr`, `(spent ${spent})`);
  return { ...row, body: r.body };
}

const PROMPT = "AetherWave Studio audit: a neon pink and cyan waveform over a dark studio desk, minimal, no text";

// ─── free reads ────────────────────────────────────────────────────────────
await audit("aetherwave_balance", {}, { check: (b) => (typeof b.credits === "number" ? null : "no numeric credits") });
await audit("aetherwave_list_characters", {}, { check: (b) => (Array.isArray(b.characters) ? null : "no characters array") });
const im = await audit("aetherwave_list_image_models", {}, { check: (b) => (b && ((Array.isArray(b.models) || (b.models && typeof b.models === "object"))) ? null : "no models table") });
await audit("aetherwave_list_video_models", {}, { check: (b) => (b && (Array.isArray(b.models) || (b.models && typeof b.models === "object")) ? null : "no models table") });
await audit("aetherwave_list_master_presets", {}, { check: (b) => (b && (Array.isArray(b.presets) || Array.isArray(b)) ? null : "no presets array") });
const vids = await audit("aetherwave_list_my_creations", { type: "video", limit: 300 }, { check: (b) => (Array.isArray(b.items) ? null : "no items") });
const shortVideo = (vids.body?.items || []).filter((v) => v.duration && v.duration <= 4).sort((a, b) => a.duration - b.duration)[0];
const auds = await call("aetherwave_list_my_creations", { type: "audio", limit: 20 });
const sourceAudio = (auds.body?.items || []).find((a) => a.duration && a.duration < 120 && /\.mp3$/i.test(a.contentUrl || ""));

// ─── images (cheapest models) ──────────────────────────────────────────────
const gen = await audit("aetherwave_generate_image", { prompt: PROMPT, model: "z-image-turbo", aspectRatio: "1:1" }, {
  est: 3, followKind: "image", check: (b) => (b.images?.length || b.imageUrls?.length ? null : "no images in result"),
});
const imageUrl = gen.body?.images?.[0]?.url || gen.body?.images?.[0] || gen.body?.imageUrls?.[0];
if (gen.body?.taskId) {
  await audit("aetherwave_get_job", { taskId: gen.body.taskId, kind: "image" }, { check: (b) => (b.done ? null : `state ${b.state}`) });
} else {
  await audit("aetherwave_get_job", {}, { skip: "not run (no taskId from generate_image)" });
}
await audit("aetherwave_edit_image", { prompt: "make the waveform gold", imageUrl, model: "grok-imagine-i2i" }, { est: 6, followKind: "image", check: (b) => (b.images?.length || b.imageUrls?.length ? null : "no images"), skip: imageUrl ? null : "not run (no source image)" });
await audit("aetherwave_upscale_image", { imageUrl, upscaleFactor: "2x" }, { est: 12, followKind: "image", check: (b) => (b.images?.length || b.imageUrls?.length ? null : "no images"), skip: imageUrl ? null : "not run (no source image)" });
await audit("aetherwave_remove_background", { imageUrl }, { est: 5, followKind: "image", check: (b) => (b.images?.length || b.imageUrls?.length ? null : "no images"), skip: imageUrl ? null : "not run (no source image)" });
await audit("aetherwave_reframe_image", { imageUrl, aspectRatio: "16:9", speed: "turbo" }, { est: 5, followKind: "image", check: (b) => (b.images?.length || b.imageUrls?.length ? null : "no images"), skip: imageUrl ? null : "not run (no source image)" });

// ─── video + video edits (3 s gallery clip keeps per-second tools cheap) ───
await audit("aetherwave_generate_video", { prompt: PROMPT + ", slow camera push in", model: "grok-imagine-t2v", duration: 6, resolution: "480p", aspectRatio: "16:9" }, {
  est: 24, followKind: "video", check: (b) => (b.videoUrl ? null : "no videoUrl"),
});
const vUrl = shortVideo?.contentUrl;
const vd = shortVideo?.duration || 3;
await audit("aetherwave_upscale_video", { videoUrl: vUrl, targetResolution: "1080p" }, { est: Math.ceil(7 * vd), followKind: "video-edit", check: (b) => (b.videoUrl ? null : "no videoUrl"), skip: vUrl ? null : "not run (no short gallery video)" });
await audit("aetherwave_remove_background_video", { videoUrl: vUrl, bgType: "color", customColor: "#00ff00" }, { est: Math.ceil(2 * vd), followKind: "video-edit", check: (b) => (b.videoUrl ? null : "no videoUrl"), skip: vUrl ? null : "not run (no short gallery video)" });
await audit("aetherwave_reframe_video", { videoUrl: vUrl, reframeAspectRatio: "9:16" }, { est: Math.ceil(17 * vd), followKind: "video-edit", check: (b) => (b.videoUrl ? null : "no videoUrl"), skip: vUrl ? null : "not run (no short gallery video)" });

// ─── music (custom mode, so title + lyrics are PROBED, not assumed) ────────
const TITLE = "MCP Audit 0930";
await audit("aetherwave_generate_music", { prompt: "lo-fi hip hop, warm, short", lyrics: "Neon lights on a quiet street\nWaveforms rolling to the beat", title: TITLE, vocalGender: "f", model: "V4_5" }, {
  est: 20, followKind: "music",
  check: (b) => {
    const tracks = b.tracks || [];
    if (!tracks.length) return "no tracks";
    const titles = tracks.map((t) => t.title);
    return titles.some((t) => t === TITLE) ? null : `custom-mode title not honoured: got ${JSON.stringify(titles)}`;
  },
});
await audit("aetherwave_master_audio", { audioUrl: sourceAudio?.contentUrl, preset: "streaming", trackTitle: "MCP audit master" }, {
  est: 20, check: (b) => (b.masteredUrl || b.state === "running" ? null : "no masteredUrl"), skip: sourceAudio ? null : "not run (no short mp3 in gallery)",
});

// ─── comic (free paths on the finished demo book; paid steps budget-gated) ─
const est = await audit("aetherwave_comic_estimate", { pageCount: 12 }, { check: (b) => (typeof b.totalCredits === "number" ? null : "no totalCredits") });
const list = await audit("aetherwave_comic_status", {}, { check: (b) => (Array.isArray(b.projects) ? null : "no projects") });
const finished = (list.body?.projects || []).find((p) => p.status === "complete");
const pid = finished?.projectId || finished?.id;
const st = await call("aetherwave_comic_status", { projectId: pid });
const ch = st.body?.characters?.find((c) => c.approvedReference);
await audit("aetherwave_comic_character_reference", { projectId: pid, action: "approve", characterId: ch?.characterId, imageUrl: ch?.approvedReference }, { skip: pid && ch ? null : "not run (no finished book with an approved character)", note: "re-approves the already approved image (free, idempotent)" });
await audit("aetherwave_comic_write_script", { projectId: pid }, { skip: pid ? null : "not run (no finished book)", note: "expected: refused, the book already has panels", check: (b) => (b.refused ? null : "did not refuse on a book with panels") });
await audit("aetherwave_comic_draw", { projectId: pid }, { skip: pid ? null : "not run (no finished book)", note: "expected: nothing to draw on a finished book" });
await audit("aetherwave_comic_assemble", { projectId: pid }, { skip: pid ? null : "not run (no finished book)", note: "re-assembles the finished demo book (free)" });
await audit("aetherwave_comic_redraw_panel", {}, { skip: "not run (9 cr and it permanently replaces a panel of a finished book)" });
const ex = await audit("aetherwave_comic_export", { projectId: pid, format: "cbz" }, { followKind: "comic-export", followExtra: { projectId: pid }, skip: pid ? null : "not run (no finished book)", check: (b) => (b.url || b.downloadUrl || b.status === "building" ? null : "no url") });
if (ex.body?.status === "building" && ex.body?.exportId) {
  await audit("aetherwave_get_job", { taskId: ex.body.exportId, kind: "comic-export", projectId: pid }, { note: "comic-export kind" });
}
const scriptEst = est.body?.scriptCredits ?? 999;
const created = await audit("aetherwave_comic_create", { title: "MCP audit throwaway", premise: "A studio robot audits its own tools and finds one that lies.", genre: "sci-fi", artStyle: "webtoon", pageCount: 4, characters: [{ name: "Auditor", role: "protagonist", visualDescription: "a small chrome robot with a clipboard and one glowing cyan eye" }] }, {
  est: 0, note: "leaves a draft project on the account; delete from the Graphic Novel Studio",
});

// ─── merch ─────────────────────────────────────────────────────────────────
await audit("aetherwave_merch_garments", {}, { check: (b) => (Array.isArray(b) || Array.isArray(b.garments) ? null : "no garment list") });
const prep = await audit("aetherwave_merch_prepare_design", { image: imageUrl, knockout: false }, { est: 1, check: (b) => (b.designUrl ? null : "no designUrl"), skip: imageUrl ? null : "not run (no source image)" });
const mock = await audit("aetherwave_merch_mockup", { designUrl: prep.body?.designUrl, garmentId: 71, color: "Black", placement: "front", widthIn: 8 }, {
  est: 3, followKind: "merch-mockup", check: (b) => (b.mockups?.length || b.printfileUrl ? null : "no mockups/printfile"), skip: prep.body?.designUrl ? null : "not run (no designUrl)",
});
// A second render with async:true to get a taskKey back (exercises the new flag,
// merch_mockup_status, and get_job kind merch-mockup).
const mockAsync = await audit("aetherwave_merch_mockup", { designUrl: prep.body?.designUrl, garmentId: 71, color: "Black", placement: "front", widthIn: 8, async: true }, {
  est: 3, note: "async:true", check: (b) => (b.state === "running" && b.taskId ? null : "async did not return a running taskId"), skip: prep.body?.designUrl ? null : "not run (no designUrl)",
});
const taskKey = mockAsync.body?.taskId;
await audit("aetherwave_merch_mockup_status", { taskKey }, { skip: taskKey ? null : "not run (no taskKey from async mockup)", check: (b) => (b.status ? null : "no status") });
if (taskKey) await audit("aetherwave_get_job", { taskId: taskKey, kind: "merch-mockup" }, { note: "merch-mockup kind", check: (b) => (b.state ? null : "no state") });

// ─── conditional tools ─────────────────────────────────────────────────────
if (PRINTFUL) {
  await audit("aetherwave_printful_list_products", { limit: 3 }, { check: (b) => (Array.isArray(b) ? null : "not an array") });
  const printfileUrl = mock.body?.printfileUrl;
  const cp = await audit("aetherwave_printful_create_product", { name: `MCP AUDIT ${new Date().toISOString().slice(0, 10)} (delete me)`, garmentId: 71, color: "Black", placement: "front", printfileUrl, retailPrice: 29.99, sizes: ["M"] }, {
    skip: printfileUrl ? null : "not run (no printfileUrl from mockup)", note: "created then deleted again via Printful API in the same run",
  });
  if (cp.body?.printfulProductId) {
    let storeId = envVal("PRINTFUL_STORE_ID");
    if (!storeId) {
      const stores = (await (await fetch("https://api.printful.com/stores", { headers: { Authorization: `Bearer ${PRINTFUL}` } })).json())?.result || [];
      if (stores.length === 1) storeId = String(stores[0].id);
    }
    const del = await fetch(`https://api.printful.com/store/products/${cp.body.printfulProductId}`, { method: "DELETE", headers: { Authorization: `Bearer ${PRINTFUL}`, ...(storeId ? { "X-PF-Store-Id": storeId } : {}) } });
    rows[rows.length - 1].note += `; DELETE -> ${del.status}`;
    log("printful product deleted ->", del.status);
  }
} else {
  await audit("aetherwave_printful_list_products", {}, { skip: "not run (no PRINTFUL_API_TOKEN)" });
  await audit("aetherwave_printful_create_product", {}, { skip: "not run (no PRINTFUL_API_TOKEN)" });
}
await audit("aetherwave_shop_create_listing", {}, { skip: "not run (creates a real product in AetherWave's Printful store and a /shop listing; not reversible from the tool)" });

const endBalance = await balance();
const summary = { registered: tools.map((t) => t.name), startBalance, endBalance, spentByDelta: startBalance - endBalance, spentTracked: spent, budget: BUDGET, rows };
writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(`\nbalance ${startBalance} -> ${endBalance} (spent ${startBalance - endBalance}); pass ${rows.filter((r) => r.result.startsWith("pass")).length}, fail ${rows.filter((r) => r.result.startsWith("fail")).length}, not run ${rows.filter((r) => r.result.startsWith("not run")).length}`);
await mcp.close();
