// Embedding surface (VoxBot Chat imports this): every tool has a policy, the
// embedded session forwards the member's session and honours the host's path
// allowlist, operator tools never leak, and `character` resolves a UGC
// character into references + identity text. Run: npm test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getPinned } from "../dist/gallery.js";
import {
  buildServer, AetherwaveClient, connectEmbedded, TOOL_POLICY, toolPolicy, runsWithoutConfirm,
  pickCharacter, applyCharacter, CHARACTER_DEFAULT_IMAGE_MODEL,
} from "../dist/embed.js";

/** Every tool name a server registers, with its annotations. */
async function toolsOf(local, env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  try {
    const server = buildServer(new AetherwaveClient({ apiKey: "aw_live_test", baseUrl: "http://127.0.0.1:9" }), { local });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), c.connect(b)]);
    const { tools } = await c.listTools();
    await c.close();
    return tools;
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ── policy ──────────────────────────────────────────────────────────────────
test("every tool, in every mode, has a policy row; no row is stale", async () => {
  const all = new Map();
  for (const t of [
    ...(await toolsOf(false)),
    ...(await toolsOf(true)),
    ...(await toolsOf(true, { PRINTFUL_API_TOKEN: "x", AETHERWAVE_ADMIN_TOOLS: "1" })),
  ]) all.set(t.name, t);
  const missing = [...all.keys()].filter((n) => !toolPolicy(n));
  assert.deepEqual(missing, [], `tools with no TOOL_POLICY row: ${missing.join(", ")}`);
  const stale = Object.keys(TOOL_POLICY).filter((n) => !all.has(n));
  assert.deepEqual(stale, [], `TOOL_POLICY rows for tools that do not exist: ${stale.join(", ")}`);
});

test("policy agrees with the MCP annotations, and every paid tool says how it is quoted", async () => {
  for (const t of await toolsOf(true, { PRINTFUL_API_TOKEN: "x", AETHERWAVE_ADMIN_TOOLS: "1" })) {
    const p = toolPolicy(t.name);
    if (t.annotations?.readOnlyHint === true) assert.equal(p.charge, "none", `${t.name} is read-only but marked as charging`);
    if (t.annotations?.destructiveHint === true) assert.equal(p.effect, "destructive", `${t.name} is destructive in its annotations`);
    if (p.charge === "credits") assert.ok(p.quote, `${t.name} charges credits but has no quote note`);
  }
});

test("runsWithoutConfirm: only free, non-destructive, embeddable tools; unknown names fail closed", () => {
  assert.equal(runsWithoutConfirm("aetherwave_balance"), true);
  assert.equal(runsWithoutConfirm("aetherwave_list_characters"), true);
  assert.equal(runsWithoutConfirm("aetherwave_generate_image"), false);
  assert.equal(runsWithoutConfirm("aetherwave_comic_write_script"), false);
  assert.equal(runsWithoutConfirm("aetherwave_shop_create_listing"), false);
  assert.equal(runsWithoutConfirm("aetherwave_not_a_tool"), false);
});

// ── characters ──────────────────────────────────────────────────────────────
const TEAMS = [
  { name: "ICONIC", characters: [
    { id: "c-amy", name: "Amy UGC", handle: "amy_ugc", identityBlock: "Amy: 27, auburn bob, freckles.", referenceImages: ["https://m.example/amy1.png", "https://m.example/amy2.png"] },
    { id: "c-cade", name: "Cade Ellison", handle: "cade", identityBlock: "Cade: 30, dark buzz cut.", referenceImages: ["https://m.example/cade1.png"] },
    { id: "c-katie", name: "Katie Lee", identityBlock: null, referenceImages: [], heroImageUrl: "https://m.example/katie.png" },
    { id: "c-draft", name: "Draft Dan", referenceImages: [] },
  ] },
];

test("pickCharacter: exact name, handle, id, then a unique substring", () => {
  assert.equal(pickCharacter(TEAMS, "Cade Ellison").id, "c-cade");
  assert.equal(pickCharacter(TEAMS, "@amy_ugc").id, "c-amy");
  assert.equal(pickCharacter(TEAMS, "c-cade").id, "c-cade");
  assert.equal(pickCharacter(TEAMS, "amy").id, "c-amy");
  assert.deepEqual(pickCharacter(TEAMS, "katie").referenceImages, ["https://m.example/katie.png"]);
});

test("pickCharacter refuses unknown, ambiguous and unfinished characters with the names you do have", () => {
  assert.throws(() => pickCharacter(TEAMS, "Zed"), /No UGC character matches "Zed".*Amy UGC, Cade Ellison/);
  const twoAmys = [{ characters: [{ id: "a1", name: "Amy UGC", referenceImages: ["https://m.example/a1.png"] }, { id: "a2", name: "Amy Rose", referenceImages: ["https://m.example/a2.png"] }] }];
  assert.throws(() => pickCharacter(twoAmys, "amy"), /more than one character \(Amy UGC, Amy Rose\)/);
  assert.equal(pickCharacter(twoAmys, "Amy Rose").id, "a2");
  assert.throws(() => pickCharacter(TEAMS, "Draft Dan"), /no approved reference pack/);
  assert.throws(() => pickCharacter([], "Amy"), /no UGC characters yet/);
});

test("pickCharacter never matches the middle of a name: 'mia' does not attach Jamia", () => {
  const t = [{ characters: [{ id: "j", name: "Jamia Cole", referenceImages: ["https://m.example/j.png"] }] }];
  assert.throws(() => pickCharacter(t, "mia"), /No UGC character matches "mia"/);
  assert.equal(pickCharacter(t, "cole").id, "j");
});

test("pickCharacter: the same character listed in two teams is one character, not ambiguous", () => {
  const amy = { id: "c-amy", name: "Amy UGC", referenceImages: ["https://m.example/amy1.png"] };
  assert.equal(pickCharacter([{ characters: [amy] }, { characters: [amy] }], "Amy UGC").id, "c-amy");
});

test("applyCharacter: a pack larger than the cap uses its first anchors; overflow names the real room", () => {
  const big = { id: "b", name: "Big Pack", identityBlock: null, referenceImages: Array.from({ length: 12 }, (_, i) => `https://m.example/p${i}.png`) };
  assert.equal(applyCharacter("x", [], big, 9).referenceImages.length, 9);
  assert.throws(() => applyCharacter("x", ["https://m.example/shirt.png"], big, 9), /fills all 9 reference slots/);
  const amy = pickCharacter(TEAMS, "Amy");
  const many = Array.from({ length: 8 }, (_, i) => `https://m.example/own${i}.png`);
  assert.throws(() => applyCharacter("x", many, amy, 9), /uses 2 reference image\(s\).*at most 7 of your own \(got 8\)/);
  assert.equal(applyCharacter("x", many.slice(0, 7), amy, 9).referenceImages.length, 9);
});

test("applyCharacter: character anchors first, caller refs after, deduped; identity text once", () => {
  const ch = pickCharacter(TEAMS, "Amy");
  const out = applyCharacter("Amy wearing the shirt, facing forward", ["https://m.example/shirt.png", "https://m.example/amy1.png"], ch);
  assert.deepEqual(out.referenceImages, ["https://m.example/amy1.png", "https://m.example/amy2.png", "https://m.example/shirt.png"]);
  assert.equal(out.prompt, "Amy wearing the shirt, facing forward\n\nAmy: 27, auburn bob, freckles.");
  assert.equal(applyCharacter(out.prompt, [], ch).prompt, out.prompt);
});

test("buildServer loaded through embed defaults to REMOTE mode: no local file reads, no operator tools", async () => {
  const names = (await toolsOf(undefined, { PRINTFUL_API_TOKEN: "x", AETHERWAVE_ADMIN_TOOLS: "1" })).map((t) => t.name);
  assert.ok(!names.includes("aetherwave_printful_list_products"));
  assert.ok(!names.includes("aetherwave_shop_create_listing"));
  const server = buildServer(new AetherwaveClient({ apiKey: "aw_live_test", baseUrl: "http://127.0.0.1:9" }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), c.connect(b)]);
  const r = await c.callTool({ name: "aetherwave_upload_to_gallery", arguments: { filePath: "C:/Windows/win.ini" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /cannot read files on your computer/);
  await c.close();
});

// ── embedded session against a fake platform ────────────────────────────────
let platform, base, seen;
before(async () => {
  platform = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url === "/api/quickstart/balance") return json({ credits: 1234, plan: "studio" });
      if (req.url === "/api/ugc/teams") return json({ teams: TEAMS });
      if (req.url === "/api/generate-image") return json({ taskId: "img_1" });
      if (req.url.startsWith("/api/generate-image/status/")) return json({ state: "success", images: ["https://m.example/out.png"] });
      res.writeHead(404); res.end("{}");
    });
  });
  await new Promise((r) => platform.listen(0, r));
  base = `http://127.0.0.1:${platform.address().port}`;
});
after(() => platform.close());

const ALLOW = new Set(["GET /api/quickstart/balance", "GET /api/ugc/teams", "POST /api/generate-image"]);
const embed = () => connectEmbedded({
  baseUrl: base,
  headers: { Cookie: "connect.sid=member-session", "X-Forwarded-For": "203.0.113.7" },
  allowRequest: (m, p) => ALLOW.has(`${m} ${p.split("?")[0]}`) || (m === "GET" && p.startsWith("/api/generate-image/status/")),
});

test("embedded session: offers the member tools, never the operator ones", async () => {
  const s = await embed();
  const names = s.tools.map((t) => t.name);
  assert.ok(names.includes("aetherwave_generate_image"));
  assert.ok(names.includes("aetherwave_list_characters"));
  for (const n of ["aetherwave_printful_list_products", "aetherwave_printful_create_product", "aetherwave_shop_create_listing"]) assert.ok(!names.includes(n), n);
  assert.ok(s.tools.every((t) => t.policy && t.inputSchema));
  await assert.rejects(s.call("aetherwave_shop_create_listing", {}), /not offered/);
  await s.close();
});

test("embedded session: the member's session headers ride every request, and no API key is sent", async () => {
  seen = [];
  const s = await embed();
  const r = await s.call("aetherwave_balance", {});
  assert.equal(r.isError ?? false, false, r.content?.[0]?.text);
  const req = seen.find((x) => x.url === "/api/quickstart/balance");
  assert.equal(req.headers.cookie, "connect.sid=member-session");
  assert.equal(req.headers["x-forwarded-for"], "203.0.113.7");
  assert.equal(req.headers["x-aw-key"], undefined);
  await s.close();
});

test("embedded session: a path outside the host allowlist is refused before the network", async () => {
  seen = [];
  const s = await embed();
  const r = await s.call("aetherwave_list_my_creations", { type: "image" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /refused by the host's allowlist/);
  assert.equal(seen.length, 0);
  await s.close();
});

test("generate_image with character: references, identity text and the reference-capable default model reach the platform", async () => {
  seen = [];
  const s = await embed();
  const r = await s.call("aetherwave_generate_image", { prompt: "Amy wearing this shirt, facing forward", character: "Amy", referenceImages: ["https://m.example/shirt.png"], aspectRatio: "1:1" });
  assert.equal(r.isError ?? false, false, r.content?.[0]?.text);
  const sub = seen.find((x) => x.url === "/api/generate-image").body;
  assert.equal(sub.model, CHARACTER_DEFAULT_IMAGE_MODEL);
  assert.deepEqual(sub.referenceImages, ["https://m.example/amy1.png", "https://m.example/amy2.png", "https://m.example/shirt.png"]);
  assert.match(sub.prompt, /facing forward\n\nAmy: 27, auburn bob, freckles\.$/);
  assert.equal(JSON.parse(r.content[0].text).character, "Amy UGC");
  await s.close();
});

test("generate_image: an unknown character is an error and nothing is submitted", async () => {
  seen = [];
  const s = await embed();
  const r = await s.call("aetherwave_generate_image", { prompt: "x", character: "Nobody" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No UGC character matches "Nobody"/);
  assert.ok(!seen.some((x) => x.url === "/api/generate-image"));
  await s.close();
});

test("generate_video refuses a reference URL that resolves to a private address (SSRF guard), before submitting", async () => {
  seen = [];
  const s = await embed();
  for (const url of ["http://127.0.0.1:9/x.png", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/a.png"]) {
    const r = await s.call("aetherwave_generate_video", { prompt: "x", referenceImages: [url] });
    assert.equal(r.isError, true, url);
    assert.match(r.content[0].text, /private address/, url);
  }
  assert.ok(!seen.some((x) => x.url === "/api/generate-video"));
  await s.close();
});

test("getPinned connects to the CHECKED address, not a fresh DNS answer (rebinding guard)", async () => {
  seen = [];
  const port = new URL(base).port;
  // a hostname that does not resolve at all: only the pinned address can reach the fake platform
  const r = await getPinned(new URL(`http://rebind.invalid:${port}/api/quickstart/balance`), "127.0.0.1", 4);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).credits, 1234);
  assert.equal(seen[0].headers.host, `rebind.invalid:${port}`);
});
