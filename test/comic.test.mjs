// Unit tests for the comic tools' pure logic. Run: npm test (builds first).
// Every "fires" test has a control that proves the check can also stay quiet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDrawing, summarizeComic, isAcceptableReference, IMAGE_MODELS } from "../dist/comic.js";

const ps = (o) => ({ total: 27, completed: 0, failed: 0, generating: 0, pending: 0, batchRunning: false, batchCurrent: 0, ...o });

// The exact status the demo book returned right after the 07:35 deploy killed its run.
const afterDeploy = ps({ completed: 5, failed: 1, pending: 21, batchRunning: false });

test("stalled: pending panels with no active run (deploy killed the run)", () => {
  const r = classifyDrawing({ status: "generating-panels" }, afterDeploy);
  assert.equal(r.state, "stalled");
  assert.match(r.reason, /21 panel\(s\) were never drawn/);
  assert.match(r.reason, /1 panel\(s\) failed/);
});

test("control: the same counts with a run active read as drawing, not stalled", () => {
  assert.equal(classifyDrawing({ status: "generating-panels" }, { ...afterDeploy, batchRunning: true }).state, "drawing");
});

test("stalled: a finished run that left failures behind", () => {
  const r = classifyDrawing({ status: "panels-ready" }, ps({ completed: 23, failed: 4 }));
  assert.equal(r.state, "stalled");
});

test("control: every panel complete reads as done", () => {
  assert.equal(classifyDrawing({ status: "panels-ready" }, ps({ completed: 27 })).state, "done");
});

test("not_started only for a fresh script with nothing drawn or failed", () => {
  assert.equal(classifyDrawing({ status: "script-ready" }, ps({ pending: 27 })).state, "not_started");
  // control: same counts on a project whose run began and died are stalled, not not_started
  assert.equal(classifyDrawing({ status: "generating-panels" }, ps({ pending: 27 })).state, "stalled");
});

test("a lone generating panel outside a run is a redraw", () => {
  assert.equal(classifyDrawing({ status: "panels-ready" }, ps({ completed: 26, generating: 1 })).state, "redrawing");
});

test("no panels means no script", () => {
  assert.equal(classifyDrawing({ status: "draft" }, ps({ total: 0 })).state, "no_script");
});

const full = {
  project: { id: "p1", title: "T", status: "generating-panels", artStyle: "franco-belgian", imageModel: "gpt-image-2" },
  panelCreditCost: 9,
  characters: [
    { id: "c1", name: "Odile", role: "protagonist", referenceImageUrl: "https://media.aetherwavestudio.com/a.jpg", referenceOptions: ["https://media.aetherwavestudio.com/a.jpg"] },
  ],
  pages: [
    { id: "pg1", pageNumber: 1, assembledImageUrl: null },
    { id: "pg2", pageNumber: 2, assembledImageUrl: null },
  ],
  panels: [
    { id: "x1", pageId: "pg1", panelIndex: 0, status: "complete", imageUrl: "u", sceneDescription: "s" },
    { id: "x2", pageId: "pg2", panelIndex: 1, status: "error", errorMessage: "the prompt may violate our content policies", sceneDescription: "Bastien cups Odile's face" },
    { id: "x3", pageId: "pg2", panelIndex: 0, status: "pending", sceneDescription: "s" },
  ],
};

test("summary surfaces each failed panel's reason and page", () => {
  const s = summarizeComic(full, ps({ total: 3, completed: 1, failed: 1, pending: 1 }));
  assert.equal(s.drawing, "stalled");
  assert.equal(s.failedPanels.length, 1);
  assert.equal(s.failedPanels[0].panelId, "x2");
  assert.equal(s.failedPanels[0].page, 2);
  assert.match(s.failedPanels[0].errorMessage, /content policies/);
  assert.equal(s.creditsToFinishDrawing, 18);
  assert.match(s.nextStep, /aetherwave_comic_draw/);
  assert.equal(s.panelList, undefined, "summary omits the full panel list");
});

test("control: detail 'panels' lists every panel in page order", () => {
  const s = summarizeComic(full, ps({ total: 3, completed: 1, failed: 1, pending: 1 }), "panels");
  assert.deepEqual(s.panelList.map((p) => p.panelId), ["x1", "x3", "x2"]);
});

test("reference guard refuses a temporary link", () => {
  assert.equal(isAcceptableReference("https://tempfile.aiquickdraw.com/x.png", full.characters[0]), false);
  assert.equal(isAcceptableReference("not a url", full.characters[0]), false);
});

test("control: reference guard accepts the character's own image and permanent storage", () => {
  assert.equal(isAcceptableReference("https://media.aetherwavestudio.com/a.jpg", full.characters[0]), true);
  assert.equal(isAcceptableReference("https://media.aetherwavestudio.com/users/1/image/b.jpg", {}), true);
});

test("only the two engines the studio exposes are offered", () => {
  assert.deepEqual([...IMAGE_MODELS], ["gpt-image-2", "gpt-image-2-5"]);
});
