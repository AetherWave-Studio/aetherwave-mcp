# Tool audit 2026-11-04 (release check for 0.5.0, against production)

Scope: a release re-check, not the full weekly run. The full run of 2026-11-02 (`docs/TOOL-AUDIT-2026-11-02.md`, 41 pass 0 fail) is two days old, and no platform route a tool calls has changed since then: of the 27 `server/` files changed on platform main between 2026-11-02 and today, none is a route these tools call (`routes.ts` changed only `/home` and `/quick-create`). So this run is read-only probes plus ONE paid call, on `generate_speech`.

- Build: `dist/` from this branch, over real MCP stdio, `AETHERWAVE_BASE_URL=https://aetherwavestudio.com`, Boss-Free key.
- Registered: 35 default tools, 38 with admin tools.
- Balance: 591 before, 589 after. Spent 2 credits (the one paid call).

| # | Tool | Args | Result | Credits | Note |
|---|------|------|--------|--------:|------|
| 1 | `aetherwave_balance` |  | pass | 0 |  |
| 2 | `aetherwave_list_characters` |  | pass | 0 |  |
| 3 | `aetherwave_list_image_models` |  | pass | 0 |  |
| 4 | `aetherwave_list_video_models` |  | pass | 0 |  |
| 5 | `aetherwave_list_master_presets` |  | pass | 0 |  |
| 6 | `aetherwave_list_my_creations` | `{"type":"audio","limit":5}` | pass | 0 |  |
| 7-10 | `aetherwave_get_user_manual` | mcp, graphic-novel, ugc-studio, project-studio | pass | 0 | every URL answers 200 application/pdf |
| 11 | `aetherwave_get_job` | the 2026-11-02 image task | 404 Task not found | 0 | expected: image tasks expire; the success path needs a fresh paid task and was not re-run |
| 12 | `aetherwave_comic_estimate` | `{"pageCount":12}` | pass | 0 |  |
| 13 | `aetherwave_comic_status` |  | pass | 0 |  |
| 14 | `aetherwave_merch_garments` |  | pass | 0 |  |
| 15 | `aetherwave_printful_list_products` | `{"limit":3}` | pass | 0 | admin tool |
| 16 | `aetherwave_list_voices` |  | pass | 0 | 9 voices, 5 per 1,000 bytes, min 2, max 1,000 chars, default sarah; identical to `GET /api/v1/audio/voices` |
| 17 | `aetherwave_generate_speech` | `{"text":"hello","voice":"nova"}` | pass (refused) | 0 | unknown voice lists the voices, nothing charged |
| 18 | `aetherwave_generate_speech` | 600 chars, `maxCredits: 2` | pass (refused) | 0 | priced at 3, refused before any charge |
| 19 | `aetherwave_generate_speech` | 64 chars, voice eric, `maxCredits: 2` | pass | 2 | creditsUsed 2; the audioUrl serves 200 audio/mpeg, 61,857 bytes, MP3 frame header, 3.9 s |

Not run this time (paid or writing; last passed 2026-11-02): generate_image, edit_image, upscale_image, remove_background, reframe_image, generate_video, upscale_video, remove_background_video, reframe_video, generate_music, master_audio, upload_to_gallery, the comic write/draw/assemble/export/create tools, merch_prepare_design, merch_mockup, merch_mockup_status, printful_create_product. Skipped by design as always: comic_redraw_panel, shop_create_listing.
