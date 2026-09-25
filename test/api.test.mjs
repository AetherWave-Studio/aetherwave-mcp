// AetherwaveClient.request(): the two behaviours the comic tools rely on.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AetherwaveClient } from "../dist/api.js";

let server, base, bytesWritten = 0;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/stream") {
      // An old server answering an export with the file itself.
      res.writeHead(200, { "Content-Type": "application/pdf" });
      const chunk = Buffer.alloc(64 * 1024);
      const pump = () => { while (res.write(chunk)) { bytesWritten += chunk.length; if (bytesWritten > 50e6) return res.end(); } };
      res.on("drain", pump); pump();
      return;
    }
    if (req.url === "/slow") return setTimeout(() => res.end("{}"), 2000);
    if (req.url === "/json") { res.writeHead(202, { "Content-Type": "application/json" }); return res.end('{"exportId":"e1"}'); }
    if (req.url === "/api/quickstart/balance") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"username":"alice","credits":5,"subscription_plan":"studio"}'); }
    res.writeHead(404, { "Content-Type": "application/json" }); res.end('{"error":"nope"}');
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const client = () => new AetherwaveClient({ apiKey: "aw_live_test", baseUrl: base });

test("a non-JSON 2xx is refused without downloading the body", async () => {
  await assert.rejects(client().request("POST", "/stream", {}), (e) => e.notJson === true && e.status === 200);
  assert.ok(bytesWritten < 50e6, `server wrote ${bytesWritten} bytes; the client must stop early`);
});

test("control: a JSON 2xx comes back with its status", async () => {
  const r = await client().request("POST", "/json", {});
  assert.equal(r.status, 202);
  assert.equal(r.data.exportId, "e1");
});

test("a request past its deadline reports timedOut, not a failure", async () => {
  await assert.rejects(client().request("GET", "/slow", undefined, { timeoutMs: 200 }), (e) => e.timedOut === true);
});

test("control: an HTTP error keeps its status and is not a timeout", async () => {
  await assert.rejects(client().request("GET", "/missing", undefined, { timeoutMs: 5000 }), (e) => e.status === 404 && !e.timedOut);
});

test("whoami names the billed account", async () => {
  assert.deepEqual(await client().whoami(), { username: "alice", credits: 5, plan: "studio" });
});

test("control: whoami reports null, never throws, when the lookup fails", async () => {
  const dead = new AetherwaveClient({ apiKey: "aw_live_test", baseUrl: "http://127.0.0.1:1" });
  assert.equal((await dead.whoami()).username, null);
});
