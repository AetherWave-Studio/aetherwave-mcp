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

// ─── submitAndPoll soft deadline ───────────────────────────────────────────
// MCP clients abandon a call at ~60 s. A job that is not terminal by the soft
// deadline must come back as running WITH its taskId, not keep blocking.
import { jobStatusPath, runningResult, JOB_KINDS } from "../dist/api.js";

let pollServer, pollBase;
const polls = { forever: 0, flips: 0, none: 0 };
before(async () => {
  pollServer = http.createServer((req, res) => {
    const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.method === "POST" && req.url === "/submit") return json(200, { taskId: "job-1" });
    if (req.url === "/status/forever/job-1") { polls.forever++; return json(200, { state: "processing" }); }
    if (req.url === "/status/flips/job-1") { polls.flips++; return json(200, { state: polls.flips >= 2 ? "success" : "processing", images: ["u"] }); }
    if (req.url === "/status/none/job-1") { polls.none++; return json(200, { state: "processing" }); }
    json(404, { error: "nope" });
  });
  await new Promise((r) => pollServer.listen(0, r));
  pollBase = `http://127.0.0.1:${pollServer.address().port}`;
});
after(() => pollServer.close());
const pollClient = () => new AetherwaveClient({ apiKey: "aw_live_test", baseUrl: pollBase });

test("a job still processing at the soft deadline returns running with its taskId", async () => {
  const t0 = Date.now();
  const r = await pollClient().submitAndPoll({
    submitPath: "/submit", submitBody: {}, statusPath: (id) => `/status/forever/${id}`,
    timeoutMs: 60_000, softDeadlineMs: 600, pollIntervalMs: 100,
  });
  const took = Date.now() - t0;
  assert.equal(r.running, true);
  assert.equal(r.taskId, "job-1");
  assert.equal(r.status.state, "processing", "the last status seen travels with the running result");
  assert.ok(took >= 550 && took < 3000, `returned at ${took}ms; must be at the soft deadline, not the 60 s budget`);
  assert.ok(polls.forever >= 3, `polled ${polls.forever} times before the deadline`);
});

test("control: a job that finishes before the soft deadline returns done, not running", async () => {
  const r = await pollClient().submitAndPoll({
    submitPath: "/submit", submitBody: {}, statusPath: (id) => `/status/flips/${id}`,
    timeoutMs: 60_000, softDeadlineMs: 5_000, pollIntervalMs: 50,
  });
  assert.equal(r.running, false);
  assert.equal(r.status.state, "success");
  assert.deepEqual(r.status.images, ["u"]);
});

test("softDeadlineMs 0 (async) submits and returns without a single poll", async () => {
  const r = await pollClient().submitAndPoll({
    submitPath: "/submit", submitBody: {}, statusPath: (id) => `/status/none/${id}`,
    timeoutMs: 60_000, softDeadlineMs: 0, pollIntervalMs: 50,
  });
  assert.equal(r.running, true);
  assert.equal(r.taskId, "job-1");
  assert.equal(polls.none, 0, "async must not poll");
});

test("control: wait mode (soft deadline >= budget) still ends in the old timeout error", async () => {
  await assert.rejects(
    pollClient().submitAndPoll({
      submitPath: "/submit", submitBody: {}, statusPath: (id) => `/status/forever/${id}`,
      timeoutMs: 400, softDeadlineMs: 400, pollIntervalMs: 50,
    }),
    (e) => /timed out after 0s \(taskId=job-1\)/.test(e.message),
  );
});

test("the default soft deadline is inside the ~60 s MCP client limit", async () => {
  const { DEFAULT_SOFT_DEADLINE_MS } = await import("../dist/api.js");
  assert.ok(DEFAULT_SOFT_DEADLINE_MS <= 50_000 && DEFAULT_SOFT_DEADLINE_MS >= 30_000, `${DEFAULT_SOFT_DEADLINE_MS}`);
});

test("every job kind maps to a status path; comic-export needs a projectId", () => {
  for (const k of JOB_KINDS) {
    if (k === "comic-export") {
      assert.throws(() => jobStatusPath(k, "e1"), /projectId/);
      assert.equal(jobStatusPath(k, "e 1", "p/1"), "/api/graphic-novel/p%2F1/export/jobs/e%201");
    } else {
      assert.match(jobStatusPath(k, "t 1"), /^\/api\/.*t%201$/);
    }
  }
  assert.equal(jobStatusPath("music", "abc"), "/api/music-status/abc");
  assert.equal(jobStatusPath("merch-mockup", "k"), "/api/merch/mockup/k");
});

test("runningResult names the tool and kind the model must poll with", () => {
  const r = runningResult("t9", "video-edit", { lastState: "PROCESSING" });
  assert.equal(r.state, "running");
  assert.equal(r.checkWith, "aetherwave_get_job");
  assert.equal(r.kind, "video-edit");
  assert.equal(r.pollEverySeconds, 10);
  assert.equal(r.lastState, "PROCESSING");
  assert.match(r.next, /taskId "t9" and kind "video-edit"/);
});

// ─── a transient FAILED must not end a job that then succeeds ──────────────
let flapServer, flapBase;
const flap = { once: 0, twice: 0 };
before(async () => {
  flapServer = http.createServer((req, res) => {
    const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.method === "POST" && req.url === "/submit") return json({ taskId: "r1" });
    // The reframe route on 2026-09-30: FAILED for one poll, then PROCESSING, then SUCCESS.
    if (req.url === "/status/once/r1") { flap.once++; return json({ state: ["FAILED", "PROCESSING", "SUCCESS"][Math.min(flap.once - 1, 2)], images: ["u"] }); }
    if (req.url === "/status/twice/r1") { flap.twice++; return json({ state: "FAILED", error: "really failed" }); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => flapServer.listen(0, r));
  flapBase = `http://127.0.0.1:${flapServer.address().port}`;
});
after(() => flapServer.close());
const flapClient = () => new AetherwaveClient({ apiKey: "aw_live_test", baseUrl: flapBase });

test("a FAILED that flips back to PROCESSING and then SUCCESS is a success", async () => {
  const r = await flapClient().submitAndPoll({
    submitPath: "/submit", submitBody: {}, statusPath: (id) => `/status/once/${id}`,
    timeoutMs: 10_000, softDeadlineMs: 5_000, pollIntervalMs: 30,
  });
  assert.equal(r.running, false);
  assert.equal(r.status.state, "SUCCESS");
  assert.equal(flap.once, 3);
});

test("control: a FAILED seen on two consecutive polls is a failure, with the server's reason", async () => {
  await assert.rejects(
    flapClient().submitAndPoll({
      submitPath: "/submit", submitBody: {}, statusPath: (id) => `/status/twice/${id}`,
      timeoutMs: 10_000, softDeadlineMs: 5_000, pollIntervalMs: 30,
    }),
    (e) => /failed \(taskId=r1\): really failed/.test(e.message),
  );
  assert.equal(flap.twice, 2, "exactly one confirming poll");
});
