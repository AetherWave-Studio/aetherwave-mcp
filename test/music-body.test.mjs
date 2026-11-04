// Music request body: the title must reach Suno on instrumentals, and custom mode
// must never go out untitled (the route 400s it). Run: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { musicRequestBody, sunoStyleLimit } from "../dist/music-body.js";

test("a titled instrumental goes custom with the description as style", () => {
  assert.deepEqual(
    musicRequestBody({ prompt: "dark synthwave", instrumental: true, title: "Neon Rain" }),
    { customMode: true, style: "dark synthwave", title: "Neon Rain", instrumental: true, model: "V5_5" },
  );
});

test("a titled instrumental keeps tuning fields, including a deliberate zero, but not audioWeight", () => {
  const body = musicRequestBody({
    prompt: "ambient", instrumental: true, title: "T", styleWeight: 0, weirdnessConstraint: 0.4, audioWeight: 0.5, negativeTags: "drums",
  });
  assert.equal(body.styleWeight, 0);
  assert.equal(body.weirdnessConstraint, 0.4);
  assert.equal(body.negativeTags, "drums");
  assert.equal("audioWeight" in body, false);
});

test("an instrumental whose description exceeds the model style cap stays simple", () => {
  const prompt = "x".repeat(sunoStyleLimit("V4") + 1);
  const body = musicRequestBody({ prompt, instrumental: true, title: "T", model: "V4" });
  assert.equal(body.customMode, false);
  assert.equal("title" in body, false);
  assert.equal(musicRequestBody({ prompt, instrumental: true, title: "T", model: "V5_5" }).customMode, true);
});

test("an untitled instrumental and a vocal song without lyrics stay simple", () => {
  assert.deepEqual(musicRequestBody({ prompt: "lofi", instrumental: true }), {
    customMode: false, prompt: "lofi", instrumental: true, model: "V5_5",
  });
  assert.equal(musicRequestBody({ prompt: "pop", title: "Hit" }).customMode, false);
});

test("lyrics go custom, and an untitled lyric request gets a title from the description", () => {
  const body = musicRequestBody({ prompt: "indie folk, warm", lyrics: "  la la  " });
  assert.equal(body.customMode, true);
  assert.equal(body.prompt, "la la");
  assert.equal(body.style, "indie folk, warm");
  assert.equal(body.title, "indie folk, warm");
  assert.equal(body.vocalGender, "m");
  assert.equal(musicRequestBody({ prompt: "p".repeat(90), lyrics: "x" }).title.length, 60);
  assert.equal(musicRequestBody({ prompt: "p", lyrics: "x", title: "Mine", audioWeight: 0 }).audioWeight, 0);
});

test("every custom-mode body carries title and style (the route rejects either missing)", () => {
  const cases = [
    { prompt: "a", lyrics: "b" },
    { prompt: "a", lyrics: "b", title: "  " },
    { prompt: "a", instrumental: true, title: "c" },
  ];
  for (const c of cases) {
    const body = musicRequestBody(c);
    assert.equal(body.customMode, true);
    assert.ok(body.title && body.style, JSON.stringify(c));
  }
});

test("the tool builds its body through musicRequestBody", async () => {
  const src = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(src, /const submitBody = musicRequestBody\(args\);/);
});
