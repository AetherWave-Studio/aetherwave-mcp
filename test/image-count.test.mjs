// Image output count: the tools must send `maxImages`, the only count field the
// platform reads (no live model declares supportsNumImages). Run: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { imageCountBody, MAX_IMAGE_COUNT } from "../dist/image-count.js";

test("imageCountBody sends maxImages, and numImages is an alias for it", () => {
  assert.deepEqual(imageCountBody({ maxImages: 4 }), { maxImages: 4 });
  assert.deepEqual(imageCountBody({ numImages: 3 }), { maxImages: 3 });
  assert.deepEqual(imageCountBody({ maxImages: 2, numImages: 5 }), { maxImages: 2 });
  assert.deepEqual(imageCountBody({}), {});
});

test("the cap matches the largest live model range (seedream-v4, 1-6)", () => {
  assert.equal(MAX_IMAGE_COUNT, 6);
});

test("no tool request body sends a bare numImages field again", async () => {
  const src = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /numImages:\s*args\.numImages/);
  assert.match(src, /\.\.\.imageCountBody\(args\)/);
});
