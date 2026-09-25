// aetherwave_comic_export against a fake API: the 409 (already exporting) and
// 429 (service busy) answers the platform gives since review of #724.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AetherwaveClient } from "../dist/api.js";
import { registerComicTools } from "../dist/comic.js";

let server, base, mode = "409";
const hits = [];
before(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url === "/api/quickstart/balance") return json(200, { username: "alice" });
    if (req.method === "POST" && req.url === "/api/graphic-novel/bookB/export/pdf") {
      if (mode === "409") return json(409, { error: "already", exportId: "job-A", format: "pdf", status: "building", statusPath: "/api/graphic-novel/bookA/export/jobs/job-A" });
      return json(429, { error: "busy", retryAfterSeconds: 30 });
    }
    if (req.url === "/api/graphic-novel/bookA/export/jobs/job-A") return json(200, { exportId: "job-A", format: "pdf", status: "complete", url: "https://media.aetherwavestudio.com/tmp/uploads/u/a.pdf", bytes: 1e6 });
    json(404, { error: "not found" });
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function callExport() {
  const mcp = new McpServer({ name: "t", version: "0" });
  registerComicTools(mcp, new AetherwaveClient({ apiKey: "aw_live_test", baseUrl: base }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  const r = await client.callTool({ name: "aetherwave_comic_export", arguments: { projectId: "bookB", format: "pdf" } });
  await client.close();
  return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
}

test("409: polls the export already building (on its own statusPath) instead of failing", async () => {
  mode = "409"; hits.length = 0;
  const r = await callExport();
  assert.equal(r.isError, false);
  assert.equal(r.body.alreadyExporting, true);
  assert.equal(r.body.exportId, "job-A");
  assert.equal(r.body.projectId, "bookA");
  assert.equal(r.body.status, "complete");
  assert.match(r.body.url, /a\.pdf$/);
  assert.ok(hits.includes("GET /api/graphic-novel/bookA/export/jobs/job-A"), "polled the running job's path");
});

test("control, 429: refuses with a retry hint and polls nothing", async () => {
  mode = "429"; hits.length = 0;
  const r = await callExport();
  assert.equal(r.isError, true);
  assert.equal(r.body.refused, true);
  assert.equal(r.body.retryAfterSeconds, 30);
  assert.ok(!hits.some((h) => h.includes("/export/jobs/")), "no job was polled");
});
