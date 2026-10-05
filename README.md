# @aetherwave-studio/mcp

[![aetherwave-mcp MCP server](https://glama.ai/mcp/servers/AetherWave-Studio/aetherwave-mcp/badges/card.svg)](https://glama.ai/mcp/servers/AetherWave-Studio/aetherwave-mcp)

[![aetherwave-mcp MCP server](https://glama.ai/mcp/servers/AetherWave-Studio/aetherwave-mcp/badges/score.svg)](https://glama.ai/mcp/servers/AetherWave-Studio/aetherwave-mcp)

Model Context Protocol server for [AetherWave Studio](https://aetherwavestudio.com). Drop it into any MCP-compatible client (Claude Code, Cursor, Continue, Claude Desktop, custom agents) and your LLM can generate, edit, upscale, reframe, and master across every flagship creative AI provider through one API key, one credit pool.

One install. One token. Thirty-three default tools covering:

- **Music** - Suno V3.5 / V4 / V4.5 / V5 / V5.5
- **Image gen** - Grok Imagine, GPT Image 2, Seedream V4, Wan 2.7, Nano Banana 2, Flux 2, Qwen Image, Z-Image Turbo
- **Image edit** - Grok Imagine I2I, Seedream V4 Edit, Flux Kontext, Wan 2.5 Spicy, Qwen Edit, GPT Image 1.5
- **Image utility** - 2x / 4x upscale, Recraft background removal (with fal BiRefNet v2 fallback), Ideogram V3 Reframe
- **Video** - Grok Imagine (KIE+fal fallback), Wan 2.7, Hailuo 02, Seedance Pro/Lite, Kling 2.6 (audio), VEO 3.1, Happy Horse
- **Video utility** - Atlas upscaler (1080p/2K), rembg u2netp background removal, Luma Ray 2 Flash reframe
- **Audio mastering** - 12 genre/style presets via the AetherWave Python service
- **Gallery** - upload your own images, audio and video (local file, URL or data URL), and a paginated list of your saved creations
- **User manuals** - the MCP, Graphic Novel Studio, UGC Studio and Project Studio manuals as PDF links (saved to Downloads on the npx server)
- **Comic books** - 9 tools driving the AetherWave Graphic Novel Engine end to end: cast, character references, script, panels, lettered pages, and a PDF / EPUB / CBZ download link
- **Merch** - 4 tools: garment catalog, design-to-mockup, and (with `PRINTFUL_API_TOKEN`) 2 more that create and list products in your own Printful store, plus 1 admin shop-listing tool

Every generation tool submits the job and waits up to a soft 45 s deadline for the result. Fast jobs come back with the final URL in one round-trip; anything longer returns `state: "running"` with a `taskId`, and `aetherwave_get_job` covers every pipeline (image, video, music, mastering, comics, merch) for polling. Pass `async: true` on any tool to return immediately. Results auto-save to your Cloudflare R2 gallery so URLs don't expire.

The comic tools are built around this from the start: a book takes about an hour to draw, so each slow step starts and returns at once, and `aetherwave_comic_status` is how the agent checks back. See [Make a comic book with the MCP](#make-a-comic-book-with-the-mcp).

## Quick start

```bash
# 1. Get a key at https://aetherwavestudio.com/profile (Developer tab)
# 2. Add to your MCP client config (see below)
# 3. Restart the client
# 4. Ask your agent to "generate a synthwave album cover, then animate it"
```

### Claude Code

```bash
claude mcp add aetherwave \
  -e AETHERWAVE_API_KEY=aw_live_your_key_here \
  -- npx -y @aetherwave-studio/mcp
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "aetherwave": {
      "command": "npx",
      "args": ["-y", "@aetherwave-studio/mcp"],
      "env": {
        "AETHERWAVE_API_KEY": "aw_live_..."
      }
    }
  }
}
```

Restart Claude Desktop.

### Cursor

In Cursor Settings -> MCP -> Add new server:

```json
{
  "aetherwave": {
    "command": "npx",
    "args": ["-y", "@aetherwave-studio/mcp"],
    "env": { "AETHERWAVE_API_KEY": "aw_live_..." }
  }
}
```

### Continue (VS Code / JetBrains)

In your `~/.continue/config.yaml`:

```yaml
mcpServers:
 - name: aetherwave
    command: npx
    args: ["-y", "@aetherwave-studio/mcp"]
    env:
      AETHERWAVE_API_KEY: aw_live_...
```

### Custom / programmatic clients

Standard stdio MCP server. Any client that speaks JSON-RPC 2.0 over stdio per the [MCP spec](https://spec.modelcontextprotocol.io/) can connect:

```bash
AETHERWAVE_API_KEY=aw_live_... npx -y @aetherwave-studio/mcp
```

## Tools at a glance

| Tool | Purpose |
|------|---------|
| `aetherwave_list_characters` | Your saved UGC characters with identity block, reference pack, voice and personality |
| `aetherwave_get_job` | Poll any job a tool handed back as `state: "running"` (or submitted with `async: true`), or recover one whose call timed out. Covers image, video, video-edit, music, merch-mockup and comic-export |
| `aetherwave_balance` | Current credit balance + plan |
| `aetherwave_list_image_models` | Enumerate every image model with cost, speed, I2I support |
| `aetherwave_list_video_models` | Enumerate every video model with cost-per-second, durations, resolutions |
| `aetherwave_list_master_presets` | Enumerate the 12 mastering presets with target LUFS, tags, descriptions |
| `aetherwave_generate_image` | T2I or I2I across 8+ models. Default `grok-imagine-t2i` (6 cr, 2 outputs) |
| `aetherwave_generate_video` | T2V or I2V across 7+ model families. Native audio, reference-image identity lock, async submit |
| `aetherwave_generate_music` | Suno V5.5 by default. Two tracks per submission, lyrics + instrumental |
| `aetherwave_edit_image` | I2I editing. Default `grok-imagine-i2i` (10 cr, one image) |
| `aetherwave_upscale_image` | 2x or 4x upscale, 4 cr |
| `aetherwave_reframe_image` | Ideogram V3 Reframe to a new aspect ratio (outpaints edges) |
| `aetherwave_remove_background` | Recraft primary + fal BiRefNet v2 fallback (auto failover). Output auto-saved to gallery |
| `aetherwave_upscale_video` | Atlas (1080p, 2K) or BytePlus (1080p to 8K) video upscale |
| `aetherwave_remove_background_video` | Frame-by-frame bg removal via rembg u2netp. Transparent WebM or solid color output. 2 cr/sec |
| `aetherwave_reframe_video` | Luma Ray 2 Flash reframe to new aspect ratio |
| `aetherwave_master_audio` | AI mastering across 12 genre/style presets. 20 cr/track, free on Producer / Mogul / Ultimate plans |
| `aetherwave_list_my_creations` | Paginated gallery read for chained workflows |
| `aetherwave_upload_to_gallery` | Put your own image, audio or video into your gallery from a local file (npx only), a URL or a data URL. Free, counts against storage, up to 95 MB |
| `aetherwave_get_user_manual` | Link to a user manual PDF (`mcp`, `graphic-novel`, `ugc-studio`, `project-studio`); on the npx server also saves it to Downloads |
| `aetherwave_comic_estimate` | Free quote for a comic: script + panel credits for a page count |
| `aetherwave_comic_create` | Create a comic project (title, premise, cast, art style). Free |
| `aetherwave_comic_character_reference` | Generate (6 cr each) or approve a character's reference image |
| `aetherwave_comic_write_script` | Start writing the script (2-3 min, charged on use, about 40 cr for 12 pages) |
| `aetherwave_comic_draw` | Start drawing every undrawn panel (9 cr a panel, charged on success). Safe to call again |
| `aetherwave_comic_status` | Progress, stalled runs, failed panels with reasons, page URLs, next step. Free |
| `aetherwave_comic_redraw_panel` | Redraw one panel, optionally with a reworded scene (9 cr on success) |
| `aetherwave_comic_assemble` | Lay out and letter the pages (about 4 s a page). Free |
| `aetherwave_comic_export` | PDF, EPUB, CBZ or bundle as a download link that lasts about a day. Free |

Every generation tool includes a model-selection rubric in its description. Your agent can pick the right model from prompt intent without round-tripping `list_image_models` or `list_video_models`.

## Make a comic book with the MCP

Nine tools drive the AetherWave Graphic Novel Engine from start to finish, so an agent can turn one sentence into a finished, lettered comic. You say something like:

> Make me a 12-page Franco-Belgian adventure comic about a 14-year-old courier and her grumbling mechanic uncle who fly the village's last airmail balloon over the Alps at night to deliver a letter that stops a dam from flooding their home. All ages. Keep it under 350 credits.

and the agent runs this sequence:

| Step | Tool | What happens | Time | Credits |
|------|------|--------------|------|---------|
| 1 | `aetherwave_balance` | Confirms which account pays and that it can afford the book | instant | 0 |
| 2 | `aetherwave_comic_estimate` | Quotes an upper bound (it assumes 4 panels a page) | instant | 0 |
| 3 | `aetherwave_comic_create` | Creates the project and the cast; returns `projectId` and each `characterId` | seconds | 0 |
| 4 | `aetherwave_comic_character_reference` with `action: "generate"` | Draws a full-body reference for each character, in the book's style | up to about a minute | 6 each |
| 5 | `aetherwave_comic_character_reference` with `action: "approve"` | Locks the chosen image; every panel uses it to keep the face the same | seconds | 0 |
| 6 | `aetherwave_comic_write_script` | Starts the script: chapters, pages, panels, dialogue, captions | 2-3 min | charged on use |
| 7 | `aetherwave_comic_status` | Polls until `projectStatus` is `script-ready`, then reads `creditsToFinishDrawing`, the real panel price | instant | 0 |
| 8 | `aetherwave_comic_draw` | Starts drawing every panel, one at a time; `maxCredits` caps the run | 1.5-6 min a panel | 9 a panel, on success |
| 9 | `aetherwave_comic_status` | Polls every few minutes. `drawing: "stalled"` means the run ended with panels left: call `aetherwave_comic_draw` again | instant | 0 |
| 10 | `aetherwave_comic_redraw_panel` | For a panel that keeps failing on a content refusal: reword its scene and redraw | 1.5-6 min | 9, on success |
| 11 | `aetherwave_comic_assemble` | Lays out and letters every page | about 4 s a page | 0 |
| 12 | `aetherwave_comic_export` | Returns a PDF (or EPUB / CBZ / bundle) download link | about 15-30 s | 0 |

### Measured on a real book

"The Last Balloon Post" (2026-09-25) was made exactly this way, through the same API these tools call:

- **12 pages, 27 panels, 301 credits**: 27 panels x 9 = 243, script 40, three character references 18. The estimate had quoted 462, because it assumes 48 panels for 12 pages. Re-quote from `creditsToFinishDrawing` once the script exists.
- **About 65 minutes of drawing**, 1.5 to 6 minutes a panel, strictly one after another. About 80 minutes end to end.
- **9 panel failures along the way, none charged**: 3 content-filter refusals, 4 upstream "Internal Error" flakes, 2 panels cut off when the server restarted. Every one was drawn on a later run.
- **Assembly took about 45 seconds** for 12 pages. The PDF was **130 MB**, which is why export returns a link rather than the file.

### Rules the agent should follow

- **Approve references before writing the script.** Approving re-describes the character from the picture, and the script writer reads that description. A character with no approved reference is drawn from text alone and their face drifts between panels.
- **Never treat a stopped run as finished.** A server restart ends a drawing run silently. `aetherwave_comic_status` reports `drawing: "stalled"` whenever panels are pending or failed and no run is active. `aetherwave_comic_draw` is safe to call again: it draws only what is missing and never double-starts (a second start reports `alreadyDrawing`).
- **Reword, do not retry, a refused panel.** `failedPanels[].errorMessage` in the status carries the reason. A content refusal repeats on a plain retry; `aetherwave_comic_redraw_panel` with a new `prompt` replaces the scene description for that drawing. Scenes of physical contact between an adult and a child are refused by the image filter.
- **Rewriting the script deletes every panel.** `aetherwave_comic_write_script` refuses on a project that has panels unless `replaceExisting: true`.
- **Re-assemble after a redraw** on a page that was already assembled; `aetherwave_comic_status` lists those pages under `pages.staleSinceAssembly`.
- **Only permanent images can be references.** `approve` refuses temporary links (for example a raw provider result URL), because the book would break when the link expires.
- Every comic tool result carries `account`: the AetherWave username that is paying. Check it if you run more than one MCP connection.

## Programmatic video with your own characters

The tools above compose into something the API could not do before: **hand an agent a description and get back a finished multi-shot film, starring a character you already created, with one consistent face and voice throughout.**

A UGC character is a recurring on-screen person you have saved in AetherWave - their locked appearance, an approved pack of reference images, a voice and a personality. `aetherwave_list_characters` is how an agent discovers they exist. Without it, an agent told *"shoot this with my Amy character"* has no way to learn who Amy is, and invents a different face for every clip.

### The loop

```js
// 1. Discover the character. There is no other way to find them.
const { characters } = await listCharacters({ name: "amy" });
const amy = characters[0];

// 2. Build every prompt from her stored identity - VERBATIM, never paraphrased.
//    Identical text is identical conditioning; that IS the consistency mechanism.
const prompt = [
  shotDescription,
  amy.identityBlock,                    // "CORE IDENTITY: same woman, Nordic, ..."
  `Her speaking voice: ${amy.voiceSpec ?? amy.voiceDescriptor}`,
  `She says exactly this and nothing else: "${line}"`,
].join("\n\n");

// 3. Submit async, anchored to her approved pack, with audio on.
const { taskId } = await generateVideo({
  prompt,
  model: "seedance-2-mini",
  duration: 12,
  resolution: "480p",
  aspectRatio: "16:9",
  generateAudio: true,                  // without this the clip is SILENT
  referenceImages: amy.referenceImages, // NOT imageUrl - that drops the anchors
  async: true,                          // returns in ~2s, survives the client timeout
});

// 4. Poll until the render lands.
let job;
do { await sleep(15000); job = await getJob({ taskId, kind: "video" }); }
while (!job.done && !job.error);

// 5. Repeat per shot, then assemble the clips in order.
```

### The four rules that actually keep a character consistent

1. **Append `identityBlock` verbatim to every prompt.** Rewriting it in your own words breaks the lock - identical text is the whole mechanism.
2. **Pass `referenceImages`, never `imageUrl`.** A first frame switches the engine to first-frame mode and discards the anchors. When a character has an approved pack, that pack *replaces* the hero image rather than riding alongside it; mixing them pulls the face two ways.
3. **Keep the voice text byte-identical across clips**, for the same reason as the identity block.
4. **Set `generateAudio: true` on anything with dialogue.** It is off by default and free on Seedance 2.x, so a silent clip is never the cheaper choice - just a worse one.

### Writing lines to length

`duration` is authoritative. The engine honours the seconds you ask for to within ~0.1s and then **fits the line to that length by changing pace**, rather than finishing early. So write the line to the clip, not the clip to the line - roughly **2 words per second** is the measured working figure. A words-per-minute number in a voice description describes the character, not the engine; budgeting by it overran a 22-clip production by 35%.

Spell hard words the way they should be *spoken*: `"super intelligence"` renders more reliably than `"superintelligence"`.

### ⚠️ Verify the speech before you assemble

A take can come back saying the **wrong words** and still report `success` with a URL. Re-rendering an identical prompt has produced one clean take and one that dropped an entire sentence - it is per-take randomness, and nothing in the response distinguishes them. On a 22-clip production, four clips were mis-spoken and none was detectable without listening.

For anything assembled unattended, transcribe each clip and score it against the line you asked for before using it, and re-shoot the ones that fail. Checking costs nothing; the clip already cost credits. Score against **the script**, not against whatever the previous step handed you.

## Sell merch from a conversation (Printful)

Turn any design into a print-on-demand product by asking for it:

> "Make a tee that says NIGHT SHIFT in chrome letters, put it on a black Bella+Canvas 3001, show me mockups, then add it to my Printful store at $29.99."

| Tool | Cost | What it does |
|---|---|---|
| `aetherwave_merch_garments` | free | Tees, tanks, hoodies, hats: colours, US in-stock sizes, print areas in inches, embroidery thread colours |
| `aetherwave_merch_prepare_design` | 1 credit | Any image (AetherWave URL, data URL, or a local file path) becomes a transparent, trimmed print PNG. `knockout` removes a plain background without eating white lettering inside the art |
| `aetherwave_merch_mockup` | 3 credits | Builds the print file at the garment's real print area and DPI, then renders Printful mockups. Refunded if the render fails; bad garment, colour or placement is never charged. 20 an hour |
| `aetherwave_merch_mockup_status` | free | Checks a render that outlived the 90-second wait |
| `aetherwave_printful_create_product` | free | Creates the product in **your own** Printful store |
| `aetherwave_printful_list_products` | free | Lists your store's products |

### Connect your Printful store

Add your Printful token to the server's env. It is used only between your machine and `api.printful.com`; **it never goes to AetherWave.**

```json
{
  "mcpServers": {
    "aetherwave": {
      "command": "npx",
      "args": ["-y", "@aetherwave-studio/mcp"],
      "env": {
        "AETHERWAVE_API_KEY": "aw_live_...",
        "PRINTFUL_API_TOKEN": "your Printful private token",
        "PRINTFUL_STORE_ID": "only needed for account-level tokens"
      }
    }
  }
}
```

Create the token in Printful under Settings > API (a private token scoped to one store is simplest). The two `aetherwave_printful_*` tools appear only when `PRINTFUL_API_TOKEN` is set, and only on the local `npx` server: the remote connector never asks for your store key. Products land in Printful; publishing to Shopify, Etsy and other connected channels happens there as usual.

**Before you promote a product:** Printful charges per order (garment, shipping, and in the US often sales tax). Check that your retail price covers it. You are the seller: only print artwork and wording you have the rights to.

**Printify:** coming next. Its catalog works differently (the same garment from several print providers, with their own prices and stock), so it gets its own tools rather than a half-working flag.

## Tools reference

### `aetherwave_balance`

Returns current credit balance. No inputs.

**Returns:** `{ credits, plan, ... }`

### `aetherwave_list_image_models`

Returns every image model with credit cost, supported inputs, resolution/aspect options. No inputs.

**Returns:** `{ models: [...] }`

### `aetherwave_list_video_models`

Returns every video model with per-second credit cost, durations, resolutions, aspect ratios. No inputs.

**Returns:** `{ models: [...] }`

### `aetherwave_list_master_presets`

Returns every mastering preset with target LUFS, tags, descriptions, difficulty. No inputs. Call this before `master_audio` when you don't know which preset fits the track.

**Returns:** `{ presets: [...] }` (each: `{ id, name, description, target_lufs, tags, difficulty, icon }`)

### `aetherwave_generate_image`

T2I or I2I. Submits, polls, returns final URLs.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `prompt` | string | yes | - | Text description of the image |
| `model` | string | no | `grok-imagine-t2i` | Model ID. Use `list_image_models` for full list |
| `aspectRatio` | string | no | model default | e.g. `1:1`, `16:9`, `9:16` |
| `resolution` | string | no | model default | `1K`, `2K`, some accept `480p`/`720p` |
| `referenceImages` | string[] | no | - | URLs for I2I; required if model is I2I |
| `numImages` | int (1-8) | no | model default | For multi-output models |
| `negative_prompt` | string | no | - | Supported by some models |
| `seed` | int | no | - | Deterministic generation, supported by some |

**Selection signals (built into the tool description):** single best image → `gpt-image-2-t2i` (9 cr at 1K, 12 at 2K). Photoreal → `gpt-image-2-t2i` or `nano-banana-2`. Text-in-image → `gpt-image-2-t2i`. NSFW → `wan-2.5-spicy-t2i`. Premium → `grok-imagine-quality-t2i` (14 cr). Cheapest → `z-image-turbo` (2 cr).

**Returns:** `{ taskId, state, images, autoSaved, creationIds }`

### `aetherwave_list_characters`

Your saved UGC characters - the recurring, named people you shoot with - with everything needed to hold one consistent across a production. **Call this first whenever a request names a person the user already has.**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | no | Case-insensitive substring filter on name or handle. Omit to list all |

**Returns:** `{ count, characters[], usage }`, each character carrying:

| Field | Why it matters |
|-------|----------------|
| `identityBlock` | The locked CORE IDENTITY string. Append **verbatim** to every prompt |
| `referenceImages` | The approved pack. Pass as `referenceImages` on `generate_video` |
| `hasApprovedPack` | True when a pack exists - prefer it over `heroImageUrl` |
| `heroImageUrl` | Single fallback anchor for characters with no pack |
| `voiceId` / `voiceSpec` / `voiceDescriptor` | Voice conditioning text; keep byte-identical across clips |
| `personality` | Tones, quirks, speechStyle - the tonal direction the user wrote |
| `negativeLock` | The character's negative prompt |
| `engineParams` | Per-mode reference strengths |

### Long jobs return within 45 seconds

MCP clients (claude.ai, Claude Desktop, Cursor) abandon a tool call at about 60 seconds. Before 0.3.0 every long tool blocked for 6 to 15 minutes, so a 90-second image render "failed" on the client while the job finished and was charged, and the taskId died with the abandoned call.

Now every tool that submits a job (`generate_image`, `edit_image`, `upscale_image`, `reframe_image`, `remove_background`, `generate_video`, `upscale_video`, `reframe_video`, `remove_background_video`, `generate_music`, `merch_mockup`, `comic_export`) polls for at most ~45 seconds and then returns:

```json
{ "state": "running", "taskId": "…", "kind": "image", "checkWith": "aetherwave_get_job", "pollEverySeconds": 10, "next": "…" }
```

Poll `aetherwave_get_job` with that `taskId` and `kind` until `done`. Two explicit escapes on each of those tools:

| Arg | Effect |
|-----|--------|
| `async: true` | Submit and return the taskId immediately, no polling |
| `wait: true` | The old long block (6-15 min budget). **Only if your client permits calls over 60 s** |

`master_audio` has no job id (the request itself is the job): it also returns within ~45 s, and a master that outlives the call is saved to the gallery - find it with `aetherwave_list_my_creations` type `audio` rather than resubmitting.

### `aetherwave_get_job`

Check a job by `taskId`. Use it for any `state: "running"` result, after an `async: true` submit, **or to recover any generation whose call timed out**, since the job keeps running server-side and saves to your gallery regardless of what happened to the client.

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `taskId` | string | yes | The taskId (or taskKey / exportId) a tool returned |
| `kind` | enum | yes | `image` (generate, edit, upscale, reframe, remove-background), `video`, `video-edit` (upscale/reframe/remove-background video), `music`, `merch-mockup`, `comic-export` |
| `projectId` | string | for `comic-export` | The comic project the export belongs to |

**Returns:** `{ taskId, kind, state, done, failed, videoUrl, imageUrls, tracks, mockups, downloadUrl, autoSaved, creationIds, error, next, raw }`

### `aetherwave_generate_video`

T2V or I2V. Submits, polls for up to ~45 s, and returns the URL if the render finished - otherwise `state: "running"` with the taskId (video takes 1-8 min, so that is the usual case).

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `prompt` | string | yes | - | Text description of the scene |
| `model` | string | no | `grok-imagine-t2v` | Model ID. Use `list_video_models` |
| `duration` | int (2-30) | no | model default | Seconds. Grok accepts 6-15 |
| `resolution` | enum | no | model default | `480p`, `720p`, `1080p`, `2K` |
| `aspectRatio` | string | no | model default | e.g. `16:9`, `9:16`, `1:1` |
| `imageUrl` | string | no | - | Required for I2V models |
| `endImageUrl` | string | no | - | Some I2V models support first+last frame |
| `mode` | enum | no | `normal` | Grok Imagine: `fun`, `normal`, `spicy` |
| `generateAudio` | bool | no | `false` | **Render speech/sound with the video.** Clips are SILENT without it. Free on Seedance 2.x at every resolution |
| `referenceImages` | string[] (max 9) | no | - | Identity anchors held consistent across the clip. Mutually exclusive with `imageUrl`. https URLs are fetched and encoded for you |
| `async` | bool | no | `false` | Return a `taskId` immediately instead of waiting |
| `wait` | bool | no | `false` | Block up to 8 min. Only if your client permits calls over 60 s |

**Returns (finished):** `{ taskId, state, videoUrl, fallbackProvider, autoSaved, creationId, kieTaskId }`
**Returns (still rendering, or `async`):** `{ state: "running", taskId, kind: "video", checkWith, pollEverySeconds, next }`

> A render takes 1-8 minutes and most MCP clients abandon a call at 60 seconds (`MCP error -32001`), so this tool returns `state: "running"` within ~45 s and you poll `aetherwave_get_job`. The job itself is submitted, billed and saved to your gallery regardless of what the client does.

> ⚠️ **`imageUrl` and `referenceImages` are not additive.** A supplied first frame switches the engine to first-frame mode *exclusively* and drops the reference images - which silently disables the only no-drift mechanism available. Passing both is rejected with an explicit error rather than quietly honouring one.

### `aetherwave_generate_music`

Suno music generation. Two tracks per submission.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `prompt` | string | yes | - | Style/mood/topic description |
| `instrumental` | boolean | no | `false` | If true, no vocals |
| `model` | enum | no | `V5_5` | `V3_5`, `V4`, `V4_5`, `V5`, `V5_5` |
| `title` | string | no | - | Optional title for the tracks |
| `lyrics` | string | no | - | Custom lyrics, omit to let Suno write them |

**Returns:** `{ taskId, status, tracks }`

### `aetherwave_edit_image`

I2I editing guided by a text prompt.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `prompt` | string | yes | - | Text description of the edit |
| `imageUrl` | string | yes | - | Public URL of source image |
| `model` | string | no | `grok-imagine-i2i` | 10 cr, one image |
| `aspectRatio` | string | no | source ratio | e.g. `1:1`, `16:9` |
| `resolution` | string | no | model default | Some models: `1K`, `2K`, `4K` |
| `quality` | enum | no | model default | `low`, `medium`, `high` (GPT Image) |
| `maxImages` | int (1-8) | no | - | For multi-output models |
| `renderingSpeed` | enum | no | model default | `turbo`, `balanced`, `quality` |
| `negative_prompt` | string | no | - | Supported by some models |

**Selection signals:** subtle edits / character consistency → `flux-kontext-pro`. NSFW → `wan-2.5-spicy-i2i`. Highest quality → `gpt-image-1.5-i2i` or `grok-imagine-quality-i2i`. Single-output / 4K → `seedream-v4-edit`.

**URL gotcha:** source URLs with spaces or parentheses may fail upstream. Prefer clean URLs without special characters.

**Returns:** `{ taskId, state, images, autoSaved, creationIds }`

### `aetherwave_upscale_image`

Upscales 2x or 4x for a flat 4 credits.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `imageUrl` | string | yes | - | Public URL of source image |
| `upscaleFactor` | enum | no | `2x` | `2x` or `4x` |

Credit cost scales with source resolution × factor.

**Returns:** `{ taskId, state, images, autoSaved, creationIds }`

### `aetherwave_reframe_image`

Ideogram V3 Reframe. Outpaints edges to fit a new aspect ratio.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `imageUrl` | string | yes | - | Public URL of source image |
| `aspectRatio` | string | yes | - | Target ratio: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `21:9` |
| `speed` | enum | no | `balanced` | `turbo` (5 cr), `balanced` (10 cr), `quality` (14 cr) |

**Returns:** `{ taskId, state, images, autoSaved, creationIds }`

### `aetherwave_remove_background`

Recraft primary + fal.ai BiRefNet v2 fallback. ~5 cr per image.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `imageUrl` | string | yes | - | Public URL of source image |

**Returns:** `{ taskId, state, images }` (PNG with transparent alpha)

### `aetherwave_upscale_video`

Two engines. Atlas reaches 1080p and 2K; BytePlus reaches 1080p, 2K, 4K and 8K and is selected automatically for 4K and 8K.

A tier is not a dimension: the names are 16:9 standards, so the source is fitted inside the tier's box and the smaller dimension wins. A square source at `4k` returns 2160x2160, not 3840x3840. For an exact pixel target, take the highest sensible tier and resize in ffmpeg.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `videoUrl` | string | yes | - | Public URL of source video (MP4) |
| `targetResolution` | enum | no | `1080p` | `1080p`, `2k`, `4k`, `8k`. Atlas: 7 cr/s at 1080p (up to 53s), 10 cr/s at 2k (up to 23s), source 30fps or less. BytePlus: 4 / 8 / 16 / 62 cr/s |
| `upscaleProvider` | enum | no | `atlas` at 1080p/2k | `atlas` or `byteplus`. 4k and 8k always run on BytePlus |

**Returns:** `{ taskId, status, videoUrl, autoSaved, creationId }`

### `aetherwave_remove_background_video`

Frame-by-frame background removal via rembg u2netp on AetherWave's Python service. 2 cr/sec.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `videoUrl` | string | yes | - | Public URL of source video (MP4) |
| `bgType` | enum | no | `transparent` | `transparent` = alpha WebM, `color` = solid replacement |
| `customColor` | string | no | `#00ff00` | Hex color for solid replacement when `bgType: "color"` |

**Returns:** `{ taskId, status, videoUrl, autoSaved, creationId }`

### `aetherwave_reframe_video`

Luma Ray 2 Flash reframe to a new aspect ratio. 17 cr/sec.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `videoUrl` | string | yes | - | Public URL of source video (MP4) |
| `reframeAspectRatio` | enum | yes | - | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9` |
| `reframePrompt` | string | no | - | Optional steering prompt for new edge content (e.g. "extend the sky with sunset clouds") |

**Returns:** `{ taskId, status, videoUrl, autoSaved, creationId }`

### `aetherwave_master_audio`

AI mastering via the AetherWave Python service. Synchronous response (route polls internally, expect 30s-5min). 20 credits per track. Free on Artist, Producer, Mogul and Ultimate plans. Output is WAV (~50MB per 3-min track) and auto-rehosted to Cloudflare R2.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `audioUrl` | string | yes | - | Public URL to MP3 or WAV |
| `preset` | string | yes | - | One of 12 (see below) |
| `trackTitle` | string | no | - | Optional title for gallery row |

**Preset list (12, retrieved live from `/api/master-presets`):**

| Preset | Name | Target LUFS | Use for |
|--------|------|-------------|---------|
| `streaming` | Streaming Ready | -14 | Spotify, Apple Music, YouTube |
| `loud` | Loud & Punchy | -9 | Competitive loudness |
| `gentle` | Gentle Touch | -16 | Acoustic, classical, jazz |
| `hip_hop` | Hip Hop / Trap | -11 | Heavy low + crisp highs + 808s |
| `edm` | EDM / Electronic | -10 | House, techno, dubstep, drops |
| `pop` | Pop / Top 40 | -12 | Radio-ready polish |
| `rock` | Rock / Alternative | -12 | Punchy mids, gritty edge |
| `lofi` | Lo-Fi / Chill | -14 | Warm, relaxed |
| `rnb` | R&B / Soul | -13 | |
| `acoustic` | Acoustic / Folk | -16 | Preserves dynamics |
| `cinematic` | Cinematic / Orchestral | -18 | Wide dynamics |
| `podcast` | Podcast / Voice | -16 | Voice-forward |

**Returns:** `{ success, masteredUrl, preset, trackTitle, creditsCharged, isFree }`

### `aetherwave_upload_to_gallery`

Saves a file the user already has into their AetherWave gallery and returns a permanent URL that every other tool accepts. Free (no credits); it counts against the account's storage, and an upload over the plan's storage is refused with the space left.

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `filePath` | string | one of the three | A file on this computer. **npx server only**; the remote connector cannot read your disk |
| `url` | string | one of the three | Public http or https link. Fetched by the server; links that resolve to private or internal addresses are refused |
| `dataUrl` | string | one of the three | A `data:` URL |
| `title` | string | no | Gallery title. Defaults to the file name |
| `description` | string | no | |
| `tags` | string[] | no | Up to 20 |

Types: images png jpg webp gif, audio mp3 wav m4a flac ogg, video mp4 webm mov. Up to 95 MB per file; larger files go through the website uploader.

**Returns:** `{ success, creationId, url, type, title, sizeBytes }`

### `aetherwave_get_user_manual`

The download link for a user manual PDF. On the npx server it also saves the PDF to the user's Downloads folder (or `saveTo`), and returns the path. Free.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `manual` | enum | no | `mcp` | `mcp`, `graphic-novel`, `ugc-studio`, `project-studio` |
| `saveTo` | string | no | Downloads | npx server only. A folder, or `"none"` for the link only |

**Returns:** `{ manual, title, url, savedTo?, sizeBytes? }`

### `aetherwave_list_my_creations`

Paginated gallery read. Useful for chaining ("reframe my last 5 images to 9:16").

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `type` | enum | no | all | `image`, `video`, `audio` |
| `limit` | int (1-500) | no | 100 | Max items |
| `offset` | int | no | 0 | Pagination offset |
| `favoritesOnly` | boolean | no | `false` | Filter to favorites |

**Returns:** `{ items, total, offset, limit, hasMore }`. Each item: `{ id, type, title, prompt, model, createdAt, isFavorite, contentUrl, thumbnailUrl, visibility, rating, duration?, width?, height?, likeCount, totalPlays, metadata }`.

### Comic book tools

All nine wrap the `/api/graphic-novel/*` routes the Graphic Novel Studio web app uses, so a book made through the MCP opens in the studio and the reverse. Every result includes `account`, the username that is billed.

#### `aetherwave_comic_estimate`

Free upper-bound quote. Assumes 4 panels a page, so short books usually cost less (12 pages: quoted 462, cost 301).

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `pageCount` | int (4-64) | yes | - | The studio offers 12, 16, 24, 32, 48, 64 |
| `imageModel` | enum | no | `gpt-image-2` | `gpt-image-2` (faster: GPT Image 1.5 panels + GPT Image 2 cover) or `gpt-image-2-5` (quality, slower). 9 cr a panel either way |

**Returns:** `{ account, scriptCredits, panelCredits, assumedPanels, creditsPerPanel, totalCredits, imageModel, note }`

#### `aetherwave_comic_create`

Creates the project and its cast. Free. Nothing is generated yet.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `title` | string | yes | - | Painted into the cover panel |
| `premise` | string | yes | - | The situation, goal and stakes |
| `characters` | array (1-12) | yes | - | Each `{ name, visualDescription, role?, personalityNotes?, backstoryNotes? }`. `role` is `protagonist`, `antagonist`, `supporting` (default) or `minor`; the cover is drawn around the protagonist |
| `artStyle` | enum | no | `marvel` | `manga`, `anime`, `marvel`, `dc-comic`, `comic-noir`, `franco-belgian`, `retro-silver-age`, `webtoon`, `underground-indie`, `painted-realism`, `pixar-3d`, `hyper-realistic`, `custom` |
| `genre` | enum | no | `fantasy` | `action`, `adventure`, `fantasy`, `sci-fi`, `horror`, `romance`, `mystery`, `thriller`, `slice-of-life`, `superhero`, `historical`, `literary` |
| `contentRating` | enum | no | `teen` | `all-ages`, `teen`, `mature` |
| `pageCount` | int (4-64) | no | 24 | Target pages |
| `imageModel` | enum | no | `gpt-image-2` | As above. Locked once created |
| `settingDescription` | string | no | - | Places, era, landmarks. Every panel prompt includes it |
| `toneNotes`, `keyScenes`, `chapterOutline`, `additionalNotes` | string | no | - | Steer the script writer |
| `referenceWorks` | string[] | no | - | Comics or films to evoke |
| `aspectRatio` | enum | no | `2:3` | `2:3` or `4:5`. Locked once created |
| `stylePreset` | enum | no | `default` | Balloon style: `default`, `cartoon-yellow`, `comic-classic`, `oblong-classic`. Locked once created |

**Returns:** `{ account, projectId, status, characters: [{ characterId, name, role }], estimate, nextStep }`

#### `aetherwave_comic_character_reference`

`action: "generate"` draws `count` (1-4) full-body references in the book's style, 6 credits each, and adds them to the character's options. `editPrompt` alone steers a fresh drawing; `editPrompt` with `baseUrl` (one of the character's images) edits that image and keeps the same person. If the call runs past about 50 seconds the images still land server-side and show up in `aetherwave_comic_status`.

`action: "approve"` (free) sets `imageUrl` as the reference. Only the character's own images or permanent AetherWave storage (`media.aetherwavestudio.com`) are accepted.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `projectId` | string | yes | - | |
| `action` | enum | yes | - | `generate` or `approve` |
| `characterId` or `characterName` | string | one of | - | Name is matched without case |
| `count` | int (1-4) | no | 1 | generate |
| `editPrompt` | string (max 500) | no | - | generate |
| `baseUrl` | URL | no | - | generate; needs `editPrompt` |
| `imageUrl` | URL | approve | - | |

**Returns (generate):** `{ account, characterId, characterName, newImages, creditsCharged, stillGenerating, errors, referenceOptions, nextStep }`. **Returns (approve):** `{ account, approved, characterId, characterName, referenceImageUrl }`

#### `aetherwave_comic_write_script`

Starts the script and returns. About 2 to 3 minutes; charged on actual use when it finishes (40 credits for the 12-page book). Refuses on a project that already has panels unless `replaceExisting: true`, because a new script deletes them all.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `projectId` | string | yes | - | |
| `replaceExisting` | boolean | no | `false` | Required to rewrite a script that already has panels |

**Returns:** `{ account, started, status, message, warning?, nextStep }`. `warning` names characters with no approved reference.

#### `aetherwave_comic_draw`

`action: "start"` (default) starts drawing every pending or failed panel, one at a time, and returns. 9 credits a panel, charged only on success; the balance must cover the whole run to start. Calling it while a run is active starts nothing and reports `alreadyDrawing`. `action: "stop"` asks the active run to stop after its current panel.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `projectId` | string | yes | - | |
| `action` | enum | no | `start` | `start` or `stop` |
| `maxCredits` | int | no | - | start: refuse if the remaining panels would cost more |

**Returns:** `{ account, started, panelsQueued, creditsPerPanel, upToCredits, message, expectedMinutes, nextStep }`, or `{ started: false, alreadyDrawing: true }`

#### `aetherwave_comic_status`

Free. The one tool to poll. With no `projectId` it lists your recent comic projects.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `projectId` | string | no | - | Omit to list projects |
| `detail` | enum | no | `summary` | `panels` adds every panel (`panelId`, page, status, image URL, scene, error) |

**Returns:** `{ account, projectId, title, projectStatus, projectError, drawing, drawingDetail, panels: { total, completed, failed, pending, generating, batchRunning }, creditsToFinishDrawing, failedPanels: [{ panelId, page, panelIndex, errorMessage, scene }], pages: { total, assembled, missing, staleSinceAssembly, urls }, characters: [{ characterId, name, role, approvedReference, referenceOptions }], nextStep }`

`drawing` is one of `no_script`, `not_started`, `drawing`, `redrawing`, `stalled`, `done`. **`stalled`** means panels are pending or failed and no run is active; call `aetherwave_comic_draw` again.

#### `aetherwave_comic_redraw_panel`

Redraws one panel. 9 credits on success, nothing on failure. `prompt` replaces the panel's scene description for this drawing (dialogue and captions are kept), which is how to get past a content refusal. Refused while a full run is active. If the redraw outlasts about 50 seconds the tool returns `stillDrawing: true` and the result appears in `aetherwave_comic_status`.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `projectId` | string | yes | - | |
| `panelId` | string | yes | - | From `failedPanels` or `detail: "panels"` |
| `prompt` | string (max 4000) | no | - | New scene description |

**Returns:** `{ account, redrawn, panelId, status, imageUrl }`, `{ redrawn: false, stillDrawing: true }`, or a refusal carrying the panel's `errorMessage`

#### `aetherwave_comic_assemble`

Free. Lays out and letters every page, about 4 seconds a page, and returns at once. Refuses while panels are drawing, and refuses while any panel is undrawn unless `allowPartial: true` (pages with an undrawn panel are skipped and the book is marked `pages-partial`).

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `projectId` | string | yes | - | |
| `allowPartial` | boolean | no | `false` | Assemble the complete pages anyway |

**Returns:** `{ account, started, pages, message, nextStep }`

#### `aetherwave_comic_export`

Free. Builds the assembled book and returns a download link on AetherWave storage that lasts about a day. Usually finishes within the call (a 12-page PDF took about 15 seconds to build and upload in testing); otherwise it returns an `exportId` to check with a second call. One export builds per account at a time: if one is already building, the tool reports that one (`alreadyExporting: true`, with its `projectId`) instead of starting another. When the service is busy it refuses with `retryAfterSeconds`.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `projectId` | string | yes | - | |
| `format` | enum | no | `pdf` | `pdf`, `epub` (fixed layout, Kindle ready), `cbz`, `bundle` (all three plus page PNGs) |
| `includeBackMatter` | boolean | no | `true` | Append the project's promotional back pages if turned on |
| `exportId` | string | no | - | Check an export started earlier |

**Returns:** `{ account, exportId, format, status, url, megabytes, note }`. `status` is `building`, `complete` or `error`.

## Credits & pricing

AetherWave uses a single credit pool. Buy bundles starting at $4.99 / 500 credits (bundle credits never expire) or subscribe to Studio ($9.99/mo, 1,700 credits; no free trial, billing starts at signup). Both work for API calls.

Typical costs:

- **Image gen** - 2 cr (Z-Image Turbo) to 34 cr (premium models at 4K); default 6 cr for 2 images
- **Image edit** - 6 cr to 34 cr; default 10 cr (Grok Imagine I2I)
- **Image utility** - 4 cr (2x or 4x upscale), 5 cr (background removal), 5 / 10 / 14 cr (reframe by speed)
- **Video** - 4 cr/sec (Grok Imagine at 480p) up to 143 cr/sec (Seedance 2 at 1080p); VEO 3.1 is a fixed 42 / 84 / 350 cr per 8 s clip
- **Music** - 20 cr per generation (2 tracks)
- **Mastering** - 20 cr/track (free on Artist / Producer / Mogul / Ultimate)
- **Comic books** - 9 cr a panel (charged on success), 6 cr a character reference, script charged on use (about 40 cr for 12 pages). A 12-page, 27-panel book cost 301 cr

See live pricing at https://aetherwavestudio.com/buy-credits or via `aetherwave_list_*_models`.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AETHERWAVE_API_KEY` | yes | - | Your API key. Get one at /profile -> Developer tab. Must start with `aw_live_`. |
| `AETHERWAVE_BASE_URL` | no | `https://aetherwavestudio.com` | Override the API base URL (useful for staging or self-hosted). |

## Troubleshooting

**"AETHERWAVE_API_KEY environment variable is required"**
Your MCP client isn't passing the env var. Make sure the `env` block in your client config has `AETHERWAVE_API_KEY` set. After editing config, fully restart the client.

**"AetherWave API ... failed: 401 - Invalid API key"**
The key has been revoked or regenerated. Visit https://aetherwavestudio.com/profile -> Developer tab and copy a fresh key.

**"AetherWave API ... failed: 402 - Insufficient credits"**
Your balance is too low for the requested operation. Call `aetherwave_balance` to confirm, then top up at https://aetherwavestudio.com/buy-credits.

**"AetherWave generation timed out after Xs"**
The provider is queueing. The job may still complete server-side - check the AetherWave gallery at https://aetherwavestudio.com/gallery.html. If timeouts persist for a particular model, try a different one (e.g. switch from `grok-imagine-t2v` to `wan-2-7-t2v`, or `gpt-image-1.5-i2i` to `grok-imagine-i2i`).

**"Unprocessable Entity" on reframe**
Ideogram's URL fetcher chokes on source URLs containing spaces, parentheses, or other special characters. Use clean URLs (try downloading and re-uploading to a clean R2 path if needed).

**"internal error, please try again later" on remove_background**
KIE Recraft transient outage. The tool will auto-fall-back to fal.ai BiRefNet v2 on retry, but a single call returning this error means both providers refused. Wait a minute and retry.

**Comic status says `drawing: "stalled"`**
The drawing run ended with panels left: a server restart, the balance ran out, or it was stopped. Call `aetherwave_comic_draw` again; it draws only the missing panels and charges only for panels that succeed.

**A comic panel keeps failing with "may violate our content policies"**
Retrying the same scene gets the same refusal. Reword it with `aetherwave_comic_redraw_panel` and a new `prompt`. Physical contact between an adult and a child is refused even in an all-ages book.

**`aetherwave_comic_export` says the server "does not support export links yet"**
The AetherWave server you are pointed at predates export links. Download the book from the Graphic Novel Studio in the web app.

**Soul Forge band generation**
Not exposed via MCP. Soul Forge remains a consumer feature on the web at https://aetherwavestudio.com/soul-forge.

## Versioning

This package follows semver. Tools that change behavior in a breaking way will bump the major version. New tools and additive parameters bump the minor version. Bug fixes bump the patch version.

**0.3.1** (unreleased): `aetherwave_upload_to_gallery` and `aetherwave_get_user_manual`, 33 default tools.

**0.3.0** (2026-09-30): soft 45 s deadline on every long tool (returns `state: "running"` + `taskId` instead of timing out the client), `async: true` on every tool, `aetherwave_get_job` covers all pipelines, 9 comic tools, 4 merch tools (+2 Printful tools with `PRINTFUL_API_TOKEN`, +1 admin), 31 default tools.

The MCP protocol version itself (currently `2024-11-05`) is negotiated at handshake time by the SDK; no client config needed.

## Links

- AetherWave Studio: https://aetherwavestudio.com
- Developer docs: https://aetherwavestudio.com/developers
- Get an API key: https://aetherwavestudio.com/profile (Developer tab)
- Buy credits: https://aetherwavestudio.com/buy-credits
- GitHub: https://github.com/AetherWave-Studio/aetherwave-mcp
- npm: https://www.npmjs.com/package/@aetherwave-studio/mcp

## License

MIT. See LICENSE.
