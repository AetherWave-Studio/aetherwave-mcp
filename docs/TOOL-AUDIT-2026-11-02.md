| # | Tool | Args | Result | Tool wall time | Followed with get_job | Credits | Note |
|---|------|------|--------|---------------:|-----------------------|--------:|------|
| 1 | `aetherwave_balance` |  | pass | 1.0 s |  | 0 |  |
| 2 | `aetherwave_list_characters` |  | pass | 0.6 s |  | 0 |  |
| 3 | `aetherwave_list_image_models` |  | pass | 0.1 s |  | 0 |  |
| 4 | `aetherwave_list_video_models` |  | pass | 0.1 s |  | 0 |  |
| 5 | `aetherwave_list_master_presets` |  | pass | 0.2 s |  | 0 |  |
| 6 | `aetherwave_list_my_creations` | `{"type":"video","limit":300}` | pass | 0.5 s |  | 0 |  |
| 7 | `aetherwave_upload_to_gallery` | `{"dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSU…","title":"MCP audit 2026-11-02 (delete me)"}` | pass | 1.5 s |  | 0 | leaves one 1x1 image in the gallery |
| 8 | `aetherwave_get_user_manual` | `{"manual":"mcp","saveTo":"none"}` | pass | 0.0 s |  | 0 | manual mcp |
| 9 | `aetherwave_get_user_manual` | `{"manual":"graphic-novel","saveTo":"none"}` | pass | 0.0 s |  | 0 | manual graphic-novel |
| 10 | `aetherwave_get_user_manual` | `{"manual":"ugc-studio","saveTo":"none"}` | pass | 0.0 s |  | 0 | manual ugc-studio |
| 11 | `aetherwave_get_user_manual` | `{"manual":"project-studio","saveTo":"none"}` | pass | 0.0 s |  | 0 | manual project-studio |
| 12 | `aetherwave_generate_image` | `{"prompt":"AetherWave Studio audit: a neon pink and…","model":"z-image-turbo","aspectRatio":"1:1"}` | pass | 8.7 s |  | 2 |  |
| 13 | `aetherwave_get_job` | `{"taskId":"img_1793587843840_4fn7wpi5k","kind":"image"}` | pass | 0.1 s |  | 0 |  |
| 14 | `aetherwave_edit_image` | `{"prompt":"make the waveform gold","imageUrl":"https://media.aetherwavestudio.com/users…","model":"grok-imagine-i2i"}` | pass | 11.6 s |  | 10 |  |
| 15 | `aetherwave_upscale_image` | `{"imageUrl":"https://media.aetherwavestudio.com/users…","upscaleFactor":"2x"}` | pass | 11.3 s |  | 4 |  |
| 16 | `aetherwave_remove_background` | `{"imageUrl":"https://media.aetherwavestudio.com/users…"}` | pass | 8.4 s |  | 5 |  |
| 17 | `aetherwave_reframe_image` | `{"imageUrl":"https://media.aetherwavestudio.com/users…","aspectRatio":"16:9","speed":"turbo"}` | pass (running -> get_job done) | 45.1 s | 1 polls, 10 s | 5 |  |
| 18 | `aetherwave_generate_video` | `{"prompt":"AetherWave Studio audit: a neon pink and…","model":"grok-imagine-t2v","duration":6,"resolution":"480p","aspectRatio":"16:9"}` | pass (running -> get_job done) | 45.1 s | 1 polls, 10 s | 24 |  |
| 19 | `aetherwave_upscale_video` | `{"videoUrl":"https://media.aetherwavestudio.com/users…","targetResolution":"1080p"}` | pass | 25.9 s |  | 29 |  |
| 20 | `aetherwave_remove_background_video` | `{"videoUrl":"https://media.aetherwavestudio.com/users…","bgType":"color","customColor":"#00ff00"}` | pass (running -> get_job done) | 45.5 s | 1 polls, 12 s | 9 |  |
| 21 | `aetherwave_reframe_video` | `{"videoUrl":"https://media.aetherwavestudio.com/users…","reframeAspectRatio":"9:16"}` | pass (running -> get_job done) | 46.2 s | 3 polls, 31 s | 70 |  |
| 22 | `aetherwave_generate_music` | `{"prompt":"lo-fi hip hop, warm, short","lyrics":"Neon lights on a quiet street\nWaveforms rolling to the beat","title":"MCP Audit 0930","vocalGender":"f","model":"V4_5"}` | pass | 24.7 s |  | 20 |  |
| 23 | `aetherwave_master_audio` | `{"audioUrl":"https://media.aetherwavestudio.com/users…","preset":"streaming","trackTitle":"MCP audit master"}` | pass | 5.8 s |  | 0 |  |
| 24 | `aetherwave_list_voices` |  | pass | 0.1 s |  | 0 |  |
| 25 | `aetherwave_generate_speech` | `{"text":"AetherWave MCP audit, voiceover check.","voice":"eric","maxCredits":2}` | pass | 2.3 s |  | 2 |  |
| 26 | `aetherwave_comic_estimate` | `{"pageCount":12}` | pass | 0.5 s |  | 0 |  |
| 27 | `aetherwave_comic_status` |  | pass | 0.4 s |  | 0 |  |
| 28 | `aetherwave_comic_character_reference` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120","action":"approve","characterId":"03a83789-6f63-4f89-86b0-8d5610f69c2c","imageUrl":"https://media.aetherwavestudio.com/users…"}` | pass | 4.7 s |  | 0 | re-approves the already approved image (free, idempotent) |
| 29 | `aetherwave_comic_write_script` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120"}` | pass (refused as designed: This project already has 27 panels (27 drawn). Writing a new script deletes all of them. Pass replaceExisting: true only) | 0.7 s |  | 0 | expected: refused, the book already has panels |
| 30 | `aetherwave_comic_draw` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120"}` | pass | 0.8 s |  | 0 | expected: nothing to draw on a finished book |
| 31 | `aetherwave_comic_assemble` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120"}` | pass | 1.4 s |  | 0 | re-assembles the finished demo book (free) |
| 32 | `aetherwave_comic_redraw_panel` |  | not run (9 cr and it permanently replaces a panel of a finished book) |  |  | 0 |  |
| 33 | `aetherwave_comic_export` | `{"projectId":"f4a21ddc-8497-4435-be27-94513f3cd120","format":"cbz"}` | pass | 26.8 s |  | 0 |  |
| 34 | `aetherwave_comic_create` | `{"title":"MCP audit throwaway","premise":"A studio robot audits its own tools and finds one that lies.","genre":"sci-fi","artStyle":"webtoon","pageCount":4,"characters":[{"name":"Auditor","role":"protagonist","visualDescription":"a small chrome robot with a clipboard and one glowing cyan eye"}]}` | pass | 1.3 s |  | 0 | leaves a draft project on the account; delete from the Graphic Novel Studio |
| 35 | `aetherwave_merch_garments` |  | pass | 0.4 s |  | 0 |  |
| 36 | `aetherwave_merch_prepare_design` | `{"image":"https://media.aetherwavestudio.com/users…","knockout":false}` | pass | 0.8 s |  | 1 |  |
| 37 | `aetherwave_merch_mockup` | `{"designUrl":"https://media.aetherwavestudio.com/merch…","garmentId":71,"color":"Black","placement":"front","widthIn":8}` | pass | 8.7 s |  | 3 |  |
| 38 | `aetherwave_merch_mockup` | `{"designUrl":"https://media.aetherwavestudio.com/merch…","garmentId":71,"color":"Black","placement":"front","widthIn":8,"async":true}` | pass | 1.3 s |  | 3 | async:true |
| 39 | `aetherwave_merch_mockup_status` | `{"taskKey":"gt-995926651"}` | pass | 5.2 s |  | 0 |  |
| 40 | `aetherwave_get_job` | `{"taskId":"gt-995926651","kind":"merch-mockup"}` | pass | 0.4 s |  | 0 | merch-mockup kind |
| 41 | `aetherwave_printful_list_products` | `{"limit":3}` | pass | 0.5 s |  | 0 |  |
| 42 | `aetherwave_printful_create_product` | `{"name":"MCP AUDIT 2026-11-02 (delete me)","garmentId":71,"color":"Black","placement":"front","printfileUrl":"https://media.aetherwavestudio.com/merch…","retailPrice":29.99,"sizes":["M"]}` | pass | 0.7 s |  | 0 | created then deleted again via Printful API in the same run; DELETE -> 200 |
| 43 | `aetherwave_shop_create_listing` |  | not run (creates a real product in AetherWave's Printful store and a /shop listing; not reversible from the tool) |  |  | 0 |  |

rows 43: pass 41, fail 0, not run 2; credits by balance delta this run 187 (start 1092, end 905)
