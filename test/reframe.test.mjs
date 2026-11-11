// Image reframe: since platform #1308 (2026-11-11) the route is a flat 12 credits on fal Bria
// Expand and takes a plain ratio string. The tool must send the ratio verbatim, send no speed,
// and never advertise the retired Ideogram tiers. Run: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { REFRAME_IMAGE_CREDITS, REFRAME_RATIOS, reframeImageBody } from "../dist/reframe.js";

test("reframeImageBody sends the ratio verbatim as aspectRatio, and no speed or Ideogram key", () => {
  for (const r of REFRAME_RATIOS) {
    assert.deepEqual(reframeImageBody({ imageUrl: "https://x/y.png", aspectRatio: r, speed: "quality" }), { imageUrl: "https://x/y.png", aspectRatio: r });
  }
});

test("the ratio list is the route's eleven, including the two built with an explicit canvas", () => {
  assert.deepEqual([...REFRAME_RATIOS].sort(), ["1:1", "16:9", "2:3", "21:9", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "9:21"].sort());
  assert.equal(REFRAME_IMAGE_CREDITS, 12);
});

test("the reframe_image tool text carries no retired price or model", async () => {
  const src = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('"aetherwave_reframe_image"'), src.indexOf('"aetherwave_upscale_video"'));
  assert.ok(block.length > 200, "reframe_image block not found");
  for (const stale of ["5 cr", "10 cr", "14 cr", "5cr", "14cr", "Ideogram", "image_size", "presetMap"]) {
    assert.ok(!block.includes(stale), `stale reframe text still present: ${stale}`);
  }
  assert.match(block, /reframeImageBody\(args\)/);
});
