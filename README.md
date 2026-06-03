# @aetherwave-studio/mcp

Model Context Protocol server for [AetherWave Studio](https://aetherwavestudio.com). Drop it into any MCP-compatible client (Claude Code, Cursor, Continue, Claude Desktop, custom agents) and your LLM can generate, edit, upscale, reframe, and master across every flagship creative AI provider through one API key, one credit pool.

One install. One token. Sixteen tools covering:

- **Music** - Suno V3.5 / V4 / V4.5 / V5 / V5.5
- **Image gen** - Grok Imagine, GPT Image 2, Seedream V4, Wan 2.7, Imagen 4, Nano Banana, Ideogram V3, Z-Image Turbo
- **Image edit** - Grok Imagine I2I, Seedream V4 Edit, Flux Kontext, Wan 2.5 Spicy, Qwen Edit, Midjourney I2I, GPT Image 1.5
- **Image utility** - Topaz upscale, Recraft background removal (with fal BiRefNet v2 fallback), Ideogram V3 Reframe
- **Video** - Grok Imagine (KIE+fal fallback), Wan 2.7, Hailuo 02, Seedance Pro/Lite, Kling 2.6 (audio), VEO 3.1, Happy Horse
- **Video utility** - Atlas upscaler (1080p/2K), rembg u2netp background removal, Luma Ray 2 Flash reframe
- **Audio mastering** - 12 genre/style presets via the AetherWave Python service
- **Gallery read** - paginated list of your saved creations

Every generation tool submits the job, polls until terminal state, and returns the final URL. The agent gets a single round-trip, no manual polling loop. Results auto-save to your Cloudflare R2 gallery so URLs don't expire.

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
| `aetherwave_balance` | Current credit balance + plan |
| `aetherwave_list_image_models` | Enumerate every image model with cost, speed, I2I support |
| `aetherwave_list_video_models` | Enumerate every video model with cost-per-second, durations, resolutions |
| `aetherwave_list_master_presets` | Enumerate the 12 mastering presets with target LUFS, tags, descriptions |
| `aetherwave_generate_image` | T2I or I2I across 8+ models. Default `grok-imagine-t2i` (5 cr, 6 outputs) |
| `aetherwave_generate_video` | T2V or I2V across 7+ model families. Default `grok-imagine-t2v` with KIE+fal fallback |
| `aetherwave_generate_music` | Suno V5.5 by default. Two tracks per submission, lyrics + instrumental |
| `aetherwave_edit_image` | I2I editing. Default `grok-imagine-i2i` (3 cr/image effective, 2 variations) |
| `aetherwave_upscale_image` | Topaz upscale 1x / 2x / 4x / 8x |
| `aetherwave_reframe_image` | Ideogram V3 Reframe to a new aspect ratio (outpaints edges) |
| `aetherwave_remove_background` | Recraft primary + fal BiRefNet v2 fallback (auto failover). Output auto-saved to gallery |
| `aetherwave_upscale_video` | Atlas Video Upscaler, 1080p or 2K |
| `aetherwave_remove_background_video` | Frame-by-frame bg removal via rembg u2netp. Transparent WebM or solid color output |
| `aetherwave_reframe_video` | Luma Ray 2 Flash reframe to new aspect ratio |
| `aetherwave_master_audio` | AI mastering across 12 genre/style presets. FREE during the holiday promo |
| `aetherwave_list_my_creations` | Paginated gallery read for chained workflows |

Every generation tool includes a model-selection rubric in its description. Your agent can pick the right model from prompt intent without round-tripping `list_image_models` or `list_video_models`.

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
| `prompt` | string | yes | — | Text description of the image |
| `model` | string | no | `grok-imagine-t2i` | Model ID. Use `list_image_models` for full list |
| `aspectRatio` | string | no | model default | e.g. `1:1`, `16:9`, `9:16` |
| `resolution` | string | no | model default | `1K`, `2K`, some accept `480p`/`720p` |
| `referenceImages` | string[] | no | — | URLs for I2I; required if model is I2I |
| `numImages` | int (1-8) | no | model default | For multi-output models |
| `negative_prompt` | string | no | — | Supported by some models |
| `seed` | int | no | — | Deterministic generation, supported by some |

**Selection signals (built into the tool description):** photoreal → `z-image-turbo` or `imagen-4`. Text-in-image → `ideogram-v3-t2i`. NSFW → `wan-2.5-spicy-t2i`. Premium → `grok-imagine-quality-t2i` or `imagen-4-ultra`. Cheapest → `z-image-turbo` (3 cr).

**Returns:** `{ taskId, state, images, autoSaved, creationIds }`

### `aetherwave_generate_video`

T2V or I2V. Submits, polls up to 8 min, returns final URL.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `prompt` | string | yes | — | Text description of the scene |
| `model` | string | no | `grok-imagine-t2v` | Model ID. Use `list_video_models` |
| `duration` | int (2-30) | no | model default | Seconds. Grok accepts 6-15 |
| `resolution` | enum | no | model default | `480p`, `720p`, `1080p`, `2K` |
| `aspectRatio` | string | no | model default | e.g. `16:9`, `9:16`, `1:1` |
| `imageUrl` | string | no | — | Required for I2V models |
| `endImageUrl` | string | no | — | Some I2V models support first+last frame |
| `mode` | enum | no | `normal` | Grok Imagine: `fun`, `normal`, `spicy` |

**Returns:** `{ taskId, state, videoUrl, fallbackProvider, autoSaved, creationId, kieTaskId }`

### `aetherwave_generate_music`

Suno music generation. Two tracks per submission.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `prompt` | string | yes | — | Style/mood/topic description |
| `instrumental` | boolean | no | `false` | If true, no vocals |
| `model` | enum | no | `V5_5` | `V3_5`, `V4`, `V4_5`, `V5`, `V5_5` |
| `title` | string | no | — | Optional title for the tracks |
| `lyrics` | string | no | — | Custom lyrics, omit to let Suno write them |

**Returns:** `{ taskId, status, tracks }`

### `aetherwave_edit_image`

I2I editing guided by a text prompt.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `prompt` | string | yes | — | Text description of the edit |
| `imageUrl` | string | yes | — | Public URL of source image |
| `model` | string | no | `grok-imagine-i2i` | 3 cr/image effective, 2 outputs |
| `aspectRatio` | string | no | source ratio | e.g. `1:1`, `16:9` |
| `resolution` | string | no | model default | Some models: `1K`, `2K`, `4K` |
| `quality` | enum | no | model default | `low`, `medium`, `high` (GPT Image) |
| `maxImages` | int (1-8) | no | — | For multi-output models |
| `renderingSpeed` | enum | no | model default | `turbo`, `balanced`, `quality` |
| `negative_prompt` | string | no | — | Supported by some models |

**Selection signals:** subtle edits / character consistency → `flux-kontext-pro`. NSFW → `wan-2.5-spicy-i2i`. Highest quality → `gpt-image-1.5-i2i` or `grok-imagine-quality-i2i`. Stylized → `midjourney-i2i`. Single-output / 4K → `seedream-v4-edit`.

**URL gotcha:** source URLs with spaces or parentheses may fail upstream. Prefer clean URLs without special characters.

**Returns:** `{ taskId, state, images, autoSaved, creationIds }`

### `aetherwave_upscale_image`

Topaz upscaler.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `imageUrl` | string | yes | — | Public URL of source image |
| `upscaleFactor` | enum | no | `2x` | `1x`, `2x`, `4x`, `8x`. Use 8x only on small sources |

Credit cost scales with source resolution × factor.

**Returns:** `{ taskId, state, images, autoSaved, creationIds }`

### `aetherwave_reframe_image`

Ideogram V3 Reframe. Outpaints edges to fit a new aspect ratio.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `imageUrl` | string | yes | — | Public URL of source image |
| `aspectRatio` | string | yes | — | Target ratio: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `21:9` |
| `speed` | enum | no | `balanced` | `turbo` (5 cr), `balanced` (10 cr), `quality` (14 cr) |

**Returns:** `{ taskId, state, images, autoSaved, creationIds }`

### `aetherwave_remove_background`

Recraft primary + fal.ai BiRefNet v2 fallback. ~5 cr per image.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `imageUrl` | string | yes | — | Public URL of source image |

**Returns:** `{ taskId, state, images }` (PNG with transparent alpha)

### `aetherwave_upscale_video`

Atlas Video Upscaler. Targets 1080p or 2K.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `videoUrl` | string | yes | — | Public URL of source video (MP4) |
| `targetResolution` | enum | no | `1080p` | `1080p` (7 cr/s, ≤53s) or `2k` (9 cr/s, ≤23s). Source must be ≤30fps |

**Returns:** `{ taskId, status, videoUrl, autoSaved, creationId }`

### `aetherwave_remove_background_video`

Frame-by-frame background removal via rembg u2netp on AetherWave's Python service. ~10 cr/sec.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `videoUrl` | string | yes | — | Public URL of source video (MP4) |
| `bgType` | enum | no | `transparent` | `transparent` = alpha WebM, `color` = solid replacement |
| `customColor` | string | no | `#00ff00` | Hex color for solid replacement when `bgType: "color"` |

**Returns:** `{ taskId, status, videoUrl, autoSaved, creationId }`

### `aetherwave_reframe_video`

Luma Ray 2 Flash reframe to a new aspect ratio. 17 cr/sec.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `videoUrl` | string | yes | — | Public URL of source video (MP4) |
| `reframeAspectRatio` | enum | yes | — | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9` |
| `reframePrompt` | string | no | — | Optional steering prompt for new edge content (e.g. "extend the sky with sunset clouds") |

**Returns:** `{ taskId, status, videoUrl, autoSaved, creationId }`

### `aetherwave_master_audio`

AI mastering via the AetherWave Python service. Synchronous response (route polls internally, expect 30s-5min). Currently FREE through the holiday promo window. Output auto-rehosted to Cloudflare R2.

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `audioUrl` | string | yes | — | Public URL to MP3 or WAV |
| `preset` | string | yes | — | One of 12 (see below) |
| `trackTitle` | string | no | — | Optional title for gallery row |

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

### `aetherwave_list_my_creations`

Paginated gallery read. Useful for chaining ("reframe my last 5 images to 9:16").

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `type` | enum | no | all | `image`, `video`, `audio` |
| `limit` | int (1-500) | no | 100 | Max items |
| `offset` | int | no | 0 | Pagination offset |
| `favoritesOnly` | boolean | no | `false` | Filter to favorites |

**Returns:** `{ items, total, offset, limit, hasMore }`. Each item: `{ id, type, title, prompt, model, createdAt, isFavorite, contentUrl, thumbnailUrl, visibility, rating, duration?, width?, height?, likeCount, totalPlays, metadata }`.

## Credits & pricing

AetherWave uses a single credit pool. Buy bundles starting at $4.99 / 500 credits (bundle credits never expire) or subscribe to Studio ($9.99/mo, 1,700 credits, 3-day free trial). Both work for API calls.

Typical costs:

- **Image gen** - 3 cr (Z-Image Turbo) to 22 cr (Grok Imagine Quality at 2K)
- **Image edit** - 3 cr/image (Grok Imagine I2I) to 22 cr (Grok Imagine Quality I2I at 2K)
- **Image utility** - 5 cr (background removal, reframe at turbo speed), 5-25+ cr (Topaz upscale, resolution-dependent)
- **Video** - 4-6 cr/sec (Grok Imagine) up to ~80 cr/sec (VEO 3.1)
- **Music** - 12 cr per generation (2 tracks)
- **Mastering** - FREE during holiday promo

See live pricing at https://aetherwavestudio.com/buy-credits or via `aetherwave_list_*_models`.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AETHERWAVE_API_KEY` | yes | — | Your API key. Get one at /profile -> Developer tab. Must start with `aw_live_`. |
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

**Soul Forge band generation**
Not exposed via MCP. Soul Forge remains a consumer feature on the web at https://aetherwavestudio.com/soul-forge.

## Versioning

This package follows semver. Tools that change behavior in a breaking way will bump the major version. New tools and additive parameters bump the minor version. Bug fixes bump the patch version.

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
