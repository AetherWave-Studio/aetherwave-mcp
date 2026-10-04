// Gallery upload + manual tools: pure helpers, and the upload end to end
// against a fake platform over real MCP stdio-free calls. Run: npm test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mediaKind, mimeFromName, isPrivateAddress, MANUALS, registerGalleryTools } from "../dist/gallery.js";
import { AetherwaveClient } from "../dist/api.js";

test("mediaKind maps image/audio/video and refuses the rest", () => {
  assert.equal(mediaKind("image/png"), "image");
  assert.equal(mediaKind("audio/mpeg; charset=x"), "audio");
  assert.equal(mediaKind("video/mp4"), "video");
  assert.equal(mediaKind("application/pdf"), null);
  assert.equal(mediaKind(""), null);
});

test("mimeFromName knows the supported extensions only", () => {
  assert.equal(mimeFromName("a/B.JPG"), "image/jpeg");
  assert.equal(mimeFromName("x.mov"), "video/quicktime");
  assert.equal(mimeFromName("x.exe"), null);
});

test("isPrivateAddress: private ranges fire, public addresses stay quiet", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "104.16.1.1", "172.32.0.1", "2606:4700::1111"])
    assert.equal(isPrivateAddress(ip), false, ip);
});

test("every manual URL points at the R2 manuals folder", () => {
  for (const m of Object.values(MANUALS)) assert.match(m.url, /^https:\/\/media\.aetherwavestudio\.com\/manuals\/[a-z-]+-user-manual\.pdf$/);
});

// ── end to end against a fake platform ──────────────────────────────────────
let platform, base, received;
before(async () => {
  platform = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/user/gallery/upload") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received = { headers: req.headers, body: Buffer.concat(chunks).toString("latin1") };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, url: "https://media.example/u/1.png", creation: { id: "c1", title: "Cover" } }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => platform.listen(0, r));
  base = `http://127.0.0.1:${platform.address().port}`;
});
after(() => platform.close());

async function connect(local) {
  const server = new McpServer({ name: "t", version: "0" });
  registerGalleryTools(server, new AetherwaveClient({ apiKey: "aw_live_test", baseUrl: base }), { local });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const call = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  return { isError: !!r.isError, text: r.content[0].text };
};

test("a local file is uploaded as multipart 'file' with the API key and title", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awgal-"));
  const f = join(dir, "cover.png");
  await writeFile(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  const c = await connect(true);
  const r = await call(c, "aetherwave_upload_to_gallery", { filePath: f, title: "Cover", tags: ["a", "b"] });
  assert.equal(r.isError, false, r.text);
  const out = JSON.parse(r.text);
  assert.equal(out.creationId, "c1");
  assert.equal(out.type, "image");
  assert.equal(received.headers["x-aw-key"], "aw_live_test");
  assert.match(received.headers["content-type"], /^multipart\/form-data; boundary=/);
  assert.match(received.body, /name="file"; filename="cover.png"/);
  assert.match(received.body, /Content-Type: image\/png/);
  assert.match(received.body, /name="tags"\r\n\r\n\["a","b"\]/);
});

test("a data URL uploads; control: a PDF data URL is refused before any request", async () => {
  const c = await connect(false);
  received = null;
  const ok = await call(c, "aetherwave_upload_to_gallery", { dataUrl: "data:audio/mpeg;base64," + Buffer.from("ID3abc").toString("base64") });
  assert.equal(ok.isError, false, ok.text);
  assert.match(received.body, /filename="upload.mp3"/);
  received = null;
  const bad = await call(c, "aetherwave_upload_to_gallery", { dataUrl: "data:application/pdf;base64,JVBERi0=" });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /images, audio and video/);
  assert.equal(received, null);
});

test("the remote connector refuses file paths; exactly one source is required", async () => {
  const c = await connect(false);
  const r = await call(c, "aetherwave_upload_to_gallery", { filePath: "C:/x.png" });
  assert.equal(r.isError, true);
  assert.match(r.text, /cannot read files on your computer/);
  const two = await call(c, "aetherwave_upload_to_gallery", { url: "https://a.example/x.png", dataUrl: "data:image/png;base64,AA==" });
  assert.match(two.text, /exactly one source/);
});

test("a URL that points at a private address is refused (SSRF guard)", async () => {
  const c = await connect(false);
  for (const url of [`${base}/x.png`, "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"]) {
    const r = await call(c, "aetherwave_upload_to_gallery", { url });
    assert.equal(r.isError, true, url);
    assert.match(r.text, /private address|Only http and https/, url);
  }
});

test("get_user_manual: remote returns the link only and offers no saveTo", async () => {
  const c = await connect(false);
  const { tools } = await c.listTools();
  const t = tools.find((x) => x.name === "aetherwave_get_user_manual");
  assert.equal("saveTo" in t.inputSchema.properties, false);
  const r = JSON.parse((await call(c, "aetherwave_get_user_manual", { manual: "graphic-novel" })).text);
  assert.equal(r.url, MANUALS["graphic-novel"].url);
  assert.equal(r.savedTo, undefined);
  // control: the local server does offer saveTo
  const lc = await connect(true);
  const lt = (await lc.listTools()).tools.find((x) => x.name === "aetherwave_get_user_manual");
  assert.equal("saveTo" in lt.inputSchema.properties, true);
});
