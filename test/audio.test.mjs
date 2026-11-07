// Voiceover tools (0.5.0, Fish Audio) end to end against a fake platform. Run: npm test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAudioTools, SPEECH_DEADLINE_MS } from "../dist/audio.js";
import { AetherwaveClient } from "../dist/api.js";

let platform, base, calls, speechDelayMs, estimateShape, speechMode;
before(async () => {
  platform = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      calls.push({ method: req.method, url: req.url, body, key: req.headers["x-aw-key"] });
      const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (req.method === "GET" && req.url === "/api/v1/audio/voices") {
        return send(200, { success: true, data: { defaultVoice: "sarah", voices: [{ voice: "sarah", name: "Sarah" }], maxChars: 1000 } });
      }
      if (req.method === "POST" && req.url === "/api/v1/audio/speech/estimate") {
        if (estimateShape === "missing") return send(200, { success: true, data: { voice: body.voice } });
        if (estimateShape === "null") return send(200, { success: true, data: { estimatedCredits: null, voice: body.voice } });
        if (body.voice === "nova") return send(400, { success: false, error: 'Unknown voice "nova". Voices: sarah, eric.' });
        return send(200, { success: true, data: { estimatedCredits: Math.max(2, Math.ceil(Buffer.byteLength(body.text) * 0.005)), voice: body.voice } });
      }
      if (req.method === "POST" && req.url === "/api/v1/audio/speech") {
        if (speechMode === "refunded") return send(504, { success: false, error: "Voiceover timed out. Try a shorter text.", refunded: true });
        if (speechMode === "refund-failed") return send(502, { success: false, error: "Voiceover failed at the provider. Try again.", refunded: false });
        if (speechMode === "proxy") { res.writeHead(502, { "Content-Type": "text/html" }); return res.end("<html>Bad Gateway</html>"); }
        if (speechMode === "reset") return req.socket.destroy();
        return setTimeout(() => send(200, {
          success: true,
          data: { audioUrl: "https://media.example/s.mp3", voice: body.voice, durationSec: 3.1, creationId: "c9" },
          creditsUsed: 2, creditsRemaining: 98,
        }), speechDelayMs);
      }
      send(404, { error: "no route" });
    });
  });
  await new Promise((r) => platform.listen(0, r));
  base = `http://127.0.0.1:${platform.address().port}`;
});
after(() => platform.close());

async function connect() {
  calls = [];
  speechDelayMs = 0;
  estimateShape = "normal";
  speechMode = "ok";
  const server = new McpServer({ name: "t", version: "0" });
  registerAudioTools(server, new AetherwaveClient({ apiKey: "aw_live_test", baseUrl: base }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const call = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  return { isError: !!r.isError, text: r.content[0].text };
};

test("generate_speech quotes first, then speaks with the key; default voice sarah", async () => {
  const c = await connect();
  const r = await call(c, "aetherwave_generate_speech", { text: "Welcome to the show." });
  assert.equal(r.isError, false, r.text);
  const out = JSON.parse(r.text);
  assert.equal(out.audioUrl, "https://media.example/s.mp3");
  assert.equal(out.creditsUsed, 2);
  assert.deepEqual(calls.map((x) => x.url), ["/api/v1/audio/speech/estimate", "/api/v1/audio/speech"]);
  assert.deepEqual(calls[1].body, { text: "Welcome to the show.", voice: "sarah" });
  assert.equal(calls[1].key, "aw_live_test");
});

test("maxCredits under the quote refuses before the paid call", async () => {
  const c = await connect();
  const r = await call(c, "aetherwave_generate_speech", { text: "a".repeat(1000), voice: "eric", maxCredits: 4 });
  assert.equal(r.isError, true);
  assert.match(r.text, /cost 5 credits, over maxCredits 4\. Nothing was charged/);
  assert.deepEqual(calls.map((x) => x.url), ["/api/v1/audio/speech/estimate"]);
});

test("an unknown voice fails at the free quote; the paid route is never called", async () => {
  const c = await connect();
  const r = await call(c, "aetherwave_generate_speech", { text: "Hi", voice: "nova" });
  assert.equal(r.isError, true);
  assert.match(r.text, /Unknown voice "nova"/);
  assert.ok(!calls.some((x) => x.url === "/api/v1/audio/speech"));
});

test("text over 1,000 characters is refused by the schema, nothing sent", async () => {
  const c = await connect();
  const r = await call(c, "aetherwave_generate_speech", { text: "a".repeat(1001) });
  assert.equal(r.isError, true);
  assert.equal(calls.length, 0);
});

test("the tools never touch the ElevenLabs / OpenAI routes", async () => {
  const c = await connect();
  await call(c, "aetherwave_generate_speech", { text: "Hi" });
  await call(c, "aetherwave_list_voices", {});
  assert.ok(calls.every((x) => !/\/api\/tts\/|\/api\/v1\/audio\/sfx/.test(x.url)), JSON.stringify(calls.map((x) => x.url)));
});

test("list_voices returns the platform's voice data", async () => {
  const c = await connect();
  const r = await call(c, "aetherwave_list_voices", {});
  assert.equal(r.isError, false, r.text);
  assert.equal(JSON.parse(r.text).defaultVoice, "sarah");
});

test("maxCredits fails CLOSED: an estimate with no price field makes no paid call", async () => {
  const c = await connect();
  estimateShape = "missing";
  const r = await call(c, "aetherwave_generate_speech", { text: "Hi there", maxCredits: 5 });
  assert.equal(r.isError, true);
  assert.match(r.text, /did not return a price.*Nothing was charged/);
  assert.deepEqual(calls.map((x) => x.url), ["/api/v1/audio/speech/estimate"]);
});

test("maxCredits fails CLOSED on a null price too (Number(null) would read as 0)", async () => {
  const c = await connect();
  estimateShape = "null";
  const r = await call(c, "aetherwave_generate_speech", { text: "Hi there", maxCredits: 5 });
  assert.equal(r.isError, true);
  assert.ok(!calls.some((x) => x.url === "/api/v1/audio/speech"));
});

test("without maxCredits a missing price does not block the call", async () => {
  const c = await connect();
  estimateShape = "missing";
  const r = await call(c, "aetherwave_generate_speech", { text: "Hi there" });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(calls.map((x) => x.url), ["/api/v1/audio/speech/estimate", "/api/v1/audio/speech"]);
});

test("the speech deadline outlasts the platform's 45 s Fish timeout and stays inside the 50 s tool contract", () => {
  assert.ok(SPEECH_DEADLINE_MS > 45_000 && SPEECH_DEADLINE_MS <= 50_000, String(SPEECH_DEADLINE_MS));
});

test("a route failure says whether the charge was refunded (refunded: true)", async () => {
  const c = await connect();
  speechMode = "refunded";
  const r = await call(c, "aetherwave_generate_speech", { text: "Hi there" });
  assert.equal(r.isError, true);
  const out = JSON.parse(r.text);
  assert.equal(out.state, "failed"); assert.equal(out.refunded, true);
  assert.match(out.error, /timed out/); assert.match(out.next, /refunded\. It is safe to try again/);
});

test("a failed refund is surfaced, never reported as refunded", async () => {
  const c = await connect();
  speechMode = "refund-failed";
  const r = await call(c, "aetherwave_generate_speech", { text: "Hi there" });
  const out = JSON.parse(r.text);
  assert.equal(r.isError, true); assert.equal(out.state, "failed"); assert.equal(out.refunded, false);
  assert.match(out.next, /refund did NOT go through\. Do not retry/);
});

test("a proxy error page mid-call is 'unknown' (may have been charged), not a failure", async () => {
  const c = await connect();
  speechMode = "proxy";
  const r = await call(c, "aetherwave_generate_speech", { text: "Hi there" });
  const out = JSON.parse(r.text);
  assert.equal(r.isError, true); assert.equal(out.state, "unknown"); assert.equal(out.checkWith, "aetherwave_list_my_creations");
  assert.ok(!("refunded" in out)); assert.match(out.next, /Do NOT resubmit/);
});

test("a dropped connection mid-call is 'unknown' too", async () => {
  const c = await connect();
  speechMode = "reset";
  const r = await call(c, "aetherwave_generate_speech", { text: "Hi there" });
  const out = JSON.parse(r.text);
  assert.equal(r.isError, true); assert.equal(out.state, "unknown");
});
