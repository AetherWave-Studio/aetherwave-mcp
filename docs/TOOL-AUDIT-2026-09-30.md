# MCP tool audit, 2026-09-30

Every tool the `@aetherwave-studio/mcp` server registers, run once against **production** (`https://aetherwavestudio.com`) over real MCP stdio, on the Boss-Free account (platform `STUDIO_ART_API_KEY`, never printed). Runner: `scripts/audit-tools.mjs`; raw record with response snippets: `docs/audit-2026-09-30.json`; table rendered by `scripts/render-audit.mjs`.

Branch under test: `fix/soft-deadline-and-tool-audit` (soft deadline + `async`/`wait` on every long tool, `aetherwave_get_job` over six pipelines). Three passes were made (first run, then reruns for tools that were fixed or starved of inputs); the table shows the final result per tool, so tool rows that passed on an earlier run keep that run's timing.

## Summary

| | |
|---|---|
| Tools registered | 34 (31 default + `aetherwave_printful_create_product`, `aetherwave_printful_list_products`, `aetherwave_shop_create_listing`) |
| Rows | 36 (two tools exercised twice: `get_job` per pipeline kind, `merch_mockup` sync and `async:true`) |
| Pass | 34 |
| Fail | 0 (after the two fixes below; 3 failed on the first pass) |
| Not run | 2: `aetherwave_comic_redraw_panel` (9 cr and it permanently replaces a panel of a finished book), `aetherwave_shop_create_listing` (creates a real product in AetherWave's Printful store plus a /shop listing; nothing in the tool reverses it) |
| Credits spent | **171** of the 300 cap (balance 2082 -> 1911; run 1: 74, run 2: 11, run 3: 86; every figure is a `/api/quickstart/balance` delta read before and after the call) |
| Soft-deadline path exercised | `reframe_image`, `remove_background_video`, `reframe_video` all returned `state: "running"` at 45.1 s and `aetherwave_get_job` recovered each of them (kinds `image`, `video-edit`); `merch_mockup async:true` returned in 1.2 s and was recovered with kind `merch-mockup` |

## Fixed during the audit (both under 20 lines)

1. **`aetherwave_printful_list_products` / `aetherwave_printful_create_product` failed with `Printful 400: This endpoint requires store_id`.** An account-level Printful token has no store attached and every `/store/*` call needs `X-PF-Store-Id`; the tools only sent it when `PRINTFUL_STORE_ID` was set. Now, when it is not set, the server asks `/stores` once and uses the id if the token sees exactly one store (an error names them if there are several). Both tools pass on the rerun. The throwaway product `476694562` was deleted (`DELETE /store/products/476694562` -> 200, with the store header; the runner's own delete had the same missing-header bug, since fixed).
2. **`aetherwave_reframe_image` reported `state=FAILED` on a job that then succeeded and charged 5 credits.** `/api/reframe-image` writes KIE's queue status (including a transient `FAILED`) straight into the task state via `onQueueUpdate`, then falls back to fal, flips back to `processing`, and finishes `SUCCESS`. The poller took the first `FAILED` as terminal. `submitAndPoll` now requires a failure on two consecutive polls before believing it (one extra poll interval on a real failure; tests in `test/api.test.mjs`). Rerun: pass. **The platform-side cause is still there** (`server/image-routes.ts`, reframe `onQueueUpdate`); any client polling that route sees the same flap.

## Contract and pricing mismatches found (platform side, not fixed here)

| Tool | What the tool / model table says | What happened | Where |
|------|----------------------------------|---------------|-------|
| `aetherwave_edit_image` with `grok-imagine-i2i` | 6 credits (`/api/image/models` says `credits: {fixed: 6}`) | **charged 10** | `/api/edit-image` prices `number` and `{tiered}` shapes and falls through to `creditCost = 10` ("Unknown credits structure") for `{fixed}`; the admission charge is reconciled to that same 10. Every grok-imagine-i2i edit overbills by 4. |
| `aetherwave_generate_image` with `z-image-turbo` | described as 3 cr | charged 2 (table says `{fixed: 2}`) | description drift; fixed in this PR's text |
| `aetherwave_edit_image` description | "returns 2 variations" | one image (table `outputCount: 1`) | description drift; fixed in this PR's text |
| `aetherwave_generate_video` grok-imagine-t2v 480p 6 s | 4 cr/s = 24 | balance delta 29 | the delta window also caught the 5-credit charge of the reframe job that flipped from FAILED to SUCCESS during this call; not a video overcharge |
| `aetherwave_upscale_video` 1080p, 3 s source | 7 cr/s = 21 | 22 | per-second rounding (3.1 s source); within expectation |
| `aetherwave_reframe_video` 3 s source | 17 cr/s = 51 | 52 | same rounding |
| `aetherwave_master_audio` | 20 cr; free on Producer/Mogul/Ultimate | 0 (Boss-Free is Ultimate) | as described |
| `aetherwave_generate_music` custom mode | title honoured only in custom mode | `tracks[0].title === "MCP Audit 0930"` | the lyrics/title adapter works; probed the output, not the echo |

## Pipelines `aetherwave_get_job` now covers

Verified in the platform repo at `origin/main` (grep of `server/`), and each one hit live in this audit except comic-export (its route exists and the export tool's own follow-up poll uses it; the export finished inside the call so the `get_job` path was not needed live):

| kind | status route | file | tools that return it |
|------|--------------|------|----------------------|
| `image` | `GET /api/generate-image/status/:taskId` | `server/image-routes.ts` | generate_image, edit_image, upscale_image, reframe_image, remove_background |
| `video` | `GET /api/generate-video/status/:taskId` | `server/video-routes.ts` | generate_video |
| `video-edit` | `GET /api/video/edit/status/:taskId` | `server/video-routes.ts` | upscale_video, reframe_video, remove_background_video |
| `music` | `GET /api/music-status/:taskId` | `server/routes.ts` | generate_music |
| `merch-mockup` | `GET /api/merch/mockup/:taskKey` | `server/merch-admin-routes.ts` | merch_mockup (taskKey) |
| `comic-export` | `GET /api/graphic-novel/:id/export/jobs/:exportId` | `server/graphic-novel-routes.ts` | comic_export (exportId + projectId) |

Not coverable: `aetherwave_master_audio`. `POST /api/master-audio` is synchronous and returns no job id (it polls the Python service itself, `server/routes.ts`). The tool now soft-deadlines the request at 45 s and, when it outlives the call, points at `aetherwave_list_my_creations type "audio"` instead of inviting a second charged run. A platform-side async master route would close this.

## Leftovers on the Boss-Free account

- Comic project **"MCP audit throwaway"** (`4b9a8e69-954b-4cd5-a25c-f122100064b5`), a free draft with no script. Delete from the Graphic Novel Studio.
- Gallery items from the run: 1 z-image-turbo image, 1 grok edit, 1 upscale, 1 cutout, 2 reframes, 1 grok video, 1 upscaled / 1 green-screen / 1 reframed 3 s clip, 2 Suno tracks titled "MCP Audit 0930", 1 mastered WAV "MCP audit master", 1 merch design and 2 mockups (temporary Printful links).
- Printful: nothing left (the audit product was deleted, 200).

## Table

| # | Tool | Args | Result | Tool wall time | Followed with get_job | Credits | Note |
|---|------|------|--------|---------------:|-----------------------|--------:|------|
| 1 | `aetherwave_balance` |  | pass | 0.4 s |  | 0 |  |
| 2 | `aetherwave_list_characters` |  | pass | 0.5 s |  | 0 |  |
| 3 | `aetherwave_list_image_models` |  | pass | 1.4 s |  | 0 |  |
| 4 | `aetherwave_list_video_models` |  | pass | 0.1 s |  | 0 |  |
| 5 | `aetherwave_list_master_presets` |  | pass | 0.1 s |  | 0 |  |
| 6 | `aetherwave_list_my_creations` | `{"type":"video","limit":300}` | pass | 0.6 s |  | 0 |  |
| 7 | `aetherwave_generate_image` | `{"prompt":"AetherWave Studio audit: a neon pink and…","model":"z-image-turbo","aspectRatio":"1:1"}` | pass | 16.1 s |  | 2 |  |
| 8 | `aetherwave_get_job` | `{"taskId":"img_1790811854674_4znyhq6m6","kind":"image"}` | pass | 0.1 s |  | 0 |  |
| 9 | `aetherwave_edit_image` | `{"prompt":"make the waveform gold","imageUrl":"https://media.aetherwavestudio.com/users…","model":"grok-imagine-i2i"}` | pass | 16.0 s |  | 10 |  |
| 10 | `aetherwave_upscale_image` | `{"imageUrl":"https://media.aetherwavestudio.com/users…","upscaleFactor":"2x"}` | pass | 5.8 s |  | 4 |  |
| 11 | `aetherwave_remove_background` | `{"imageUrl":"https://media.aetherwavestudio.com/users…"}` | pass | 8.3 s |  | 5 |  |
| 12 | `aetherwave_reframe_image` | `{"imageUrl":"https://media.aetherwavestudio.com/users…","aspectRatio":"16:9","speed":"turbo"}` | pass (running -> get_job done) | 45.1 s | 1 polls, 10 s | 5 |  |
| 13 | `aetherwave_generate_video` | `{"prompt":"AetherWave Studio audit: a neon pink and…","model":"grok-imagine-t2v","duration":6,"resolution":"480p","aspectRatio":"16:9"}` | pass | 40.6 s |  | 29 |  |
| 14 | `aetherwave_upscale_video` | `{"videoUrl":"https://media.aetherwavestudio.com/users…","targetResolution":"1080p"}` | pass | 24.1 s |  | 22 |  |
| 15 | `aetherwave_remove_background_video` | `{"videoUrl":"https://media.aetherwavestudio.com/users…","bgType":"color","customColor":"#00ff00"}` | pass (running -> get_job done) | 45.1 s | 7 polls, 71 s | 7 |  |
| 16 | `aetherwave_reframe_video` | `{"videoUrl":"https://media.aetherwavestudio.com/users…","reframeAspectRatio":"9:16"}` | pass (running -> get_job done) | 45.1 s | 8 polls, 81 s | 52 |  |
| 17 | `aetherwave_generate_music` | `{"prompt":"lo-fi hip hop, warm, short","lyrics":"Neon lights on a quiet street\nWaveforms rolling to the beat","title":"MCP Audit 0930","vocalGender":"f","model":"V4_5"}` | pass | 25.3 s |  | 20 |  |
| 18 | `aetherwave_master_audio` | `{"audioUrl":"https://media.aetherwavestudio.com/users…","preset":"streaming","trackTitle":"MCP audit master"}` | pass | 6.6 s |  | 0 |  |
| 19 | `aetherwave_comic_estimate` | `{"pageCount":12}` | pass | 0.7 s |  | 0 |  |
| 20 | `aetherwave_comic_status` |  | pass | 0.9 s |  | 0 |  |
| 21 | `aetherwave_comic_character_reference` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120","action":"approve","characterId":"03a83789-6f63-4f89-86b0-8d5610f69c2c","imageUrl":"https://media.aetherwavestudio.com/users…"}` | pass | 1.2 s |  | 0 | re-approves the already approved image (free, idempotent) |
| 22 | `aetherwave_comic_write_script` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120"}` | pass (refused as designed: existing panels, replaceExisting not set) | 0.7 s |  | 0 | expected: refused, the book already has panels |
| 23 | `aetherwave_comic_draw` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120"}` | pass | 0.9 s |  | 0 | expected: nothing to draw on a finished book |
| 24 | `aetherwave_comic_assemble` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120"}` | pass | 0.9 s |  | 0 | re-assembles the finished demo book (free) |
| 25 | `aetherwave_comic_redraw_panel` |  | not run (9 cr and it permanently replaces a panel of a finished book) |  |  | 0 |  |
| 26 | `aetherwave_comic_export` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120","format":"cbz"}` | pass | 18.8 s |  | 0 |  |
| 27 | `aetherwave_comic_create` | `{"title":"MCP audit throwaway","premise":"A studio robot audits its own tools and finds one that lies.","genre":"sci-fi","artStyle":"webtoon","pageCount":4,"characters":[{"name":"Auditor","role":"protagonist","visualDescription":"a small chrome robot with a clipboard and one glowing cyan eye"}]}` | pass | 1.0 s |  | 0 | leaves a draft project on the account; delete from the Graphic Novel Studio |
| 28 | `aetherwave_merch_garments` |  | pass | 0.2 s |  | 0 |  |
| 29 | `aetherwave_merch_prepare_design` | `{"image":"https://media.aetherwavestudio.com/users…","knockout":false}` | pass | 0.9 s |  | 1 |  |
| 30 | `aetherwave_merch_mockup` | `{"designUrl":"https://media.aetherwavestudio.com/merch…","garmentId":71,"color":"Black","placement":"front","widthIn":8}` | pass | 11.2 s |  | 3 |  |
| 31 | `aetherwave_merch_mockup` | `{"designUrl":"https://media.aetherwavestudio.com/merch…","garmentId":71,"color":"Black","placement":"front","widthIn":8,"async":true}` | pass | 1.2 s |  | 3 | async:true |
| 32 | `aetherwave_merch_mockup_status` | `{"taskKey":"gt-976577900"}` | pass | 9.7 s |  | 0 |  |
| 33 | `aetherwave_get_job` | `{"taskId":"gt-976577900","kind":"merch-mockup"}` | pass | 0.3 s |  | 0 | merch-mockup kind |
| 34 | `aetherwave_printful_list_products` | `{"limit":3}` | pass | 0.5 s |  | 0 |  |
| 35 | `aetherwave_printful_create_product` | `{"name":"MCP AUDIT 2026-09-30 (delete me)","garmentId":71,"color":"Black","placement":"front","printfileUrl":"https://media.aetherwavestudio.com/merch…","retailPrice":29.99,"sizes":["M"]}` | pass | 0.6 s |  | 0 | created then deleted again via Printful API in the same run; DELETE -> 400; DELETE -> 404 |
| 36 | `aetherwave_shop_create_listing` |  | not run (creates a real product in AetherWave's Printful store and a /shop listing; not reversible from the tool) |  |  | 0 |  |

rows 36: pass 34, fail 0, not run 2; credits by balance delta this run 86 (start 1997, end 1911)

Wall time is the tool call itself as seen by the MCP client. "Followed with get_job" is the extra time the runner spent polling after a `running` result. Credits are balance deltas around the call; a delta can catch a charge from an earlier job that settled late (see generate_video above).
