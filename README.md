# @aetherwave-studio/mcp

Model Context Protocol server for [AetherWave Studio](https://aetherwavestudio.com). Drop it into any MCP-compatible client (Claude Code, Cursor, Continue, Claude Desktop, custom agents) and your LLM can generate music, images, videos, and complete band identities through a single tool surface.

One API key, one credit pool, every flagship creative-AI model:

- **Music** - Suno V5.5
- **Image** - Grok Imagine, GPT Image 2, Seedream V4, Wan 2.7, Imagen 4, Nano Banana, Ideogram V3, Z-Image Turbo
- **Video** - Grok Imagine (with KIE+fal fallback), Wan 2.7, Hailuo 02, Seedance Pro/Lite, Kling 2.6 (audio), VEO 3.1, Happy Horse
- **Soul Forge** - turn a track into a complete band identity (name, story, member roster, trading card portrait)
- **Audio mastering**

## Quick start

```bash
# 1. Get a key at https://aetherwavestudio.com/profile (Developer tab)
# 2. Add to your MCP client config below
```

### Claude Code

Add to `~/.claude/mcp.json` (or per-project `.claude/mcp.json`):

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

Restart Claude Code. The agent will now have eight new tools available: `aetherwave_balance`, `aetherwave_list_image_models`, `aetherwave_list_video_models`, `aetherwave_generate_image`, `aetherwave_generate_video`, `aetherwave_generate_music`, `aetherwave_generate_band`, `aetherwave_master_audio`.

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

This is a standard stdio MCP server. Any client that speaks JSON-RPC 2.0 over stdio per the [MCP spec](https://spec.modelcontextprotocol.io/) can connect. Launch with:

```bash
AETHERWAVE_API_KEY=aw_live_... npx -y @aetherwave-studio/mcp
```

## Tools

Every generation tool submits the job, polls until terminal state, and returns the final URLs. The agent gets a single round-trip - no manual polling loop.

| Tool | Description |
|------|-------------|
| `aetherwave_balance` | Returns current credit balance. Call before a generation to confirm sufficient credits. |
| `aetherwave_list_image_models` | Returns every image model with credit cost, supported inputs, and options. |
| `aetherwave_list_video_models` | Returns every video model with per-second credit cost, supported durations, resolutions, aspect ratios. |
| `aetherwave_generate_image` | T2I or I2I across 8+ models. Default `grok-imagine-t2i` (5 cr, 6 images). |
| `aetherwave_generate_video` | T2V or I2V across 7+ model families. Default `grok-imagine-t2v` (4-6 cr/s, built-in KIE+fal fallback). |
| `aetherwave_generate_music` | Suno V5.5 by default. Two tracks per submission. Custom lyrics + instrumental toggle. |
| `aetherwave_generate_band` | Soul Forge: track URL in, complete band identity out (name, story, members, trading card portrait). 50 cr. |
| `aetherwave_master_audio` | AI mastering with light / medium / heavy intensity. |

Run `aetherwave_list_image_models` or `aetherwave_list_video_models` to see the canonical model IDs you can pass to the generate tools.

## Credits & pricing

AetherWave uses a single credit pool. Buy bundles starting at $4.99 / 500 credits (bundle credits never expire) or subscribe to Studio ($9.99/mo, 1,700 credits, 3-day free trial). Both work for API calls.

Typical costs:
- **Image** - 3 cr (Z-Image Turbo) to 22 cr (Grok Imagine Quality at 2K)
- **Video** - 4-6 cr/sec (Grok Imagine) up to ~80 cr/sec (VEO 3.1)
- **Music** - 12 cr per generation (2 tracks)
- **Soul Forge** - 50 cr per band

See live pricing at https://aetherwavestudio.com/buy-credits or via `aetherwave_list_*_models`.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AETHERWAVE_API_KEY` | yes | — | Your API key. Get one at /profile -> Developer tab. Must start with `aw_live_`. |
| `AETHERWAVE_BASE_URL` | no | `https://aetherwavestudio.com` | Override the API base URL (useful for staging or self-hosted instances). |

## Troubleshooting

**"AETHERWAVE_API_KEY environment variable is required"**
Your MCP client isn't passing the env var. Make sure the `env` block in your client config has `AETHERWAVE_API_KEY` set. After editing config, fully restart the client.

**"AetherWave API ... failed: 401 - Invalid API key"**
The key has been revoked or regenerated. Visit https://aetherwavestudio.com/profile -> Developer tab and copy a fresh key.

**"AetherWave API ... failed: 402 - Insufficient credits"**
Your balance is too low for the requested operation. Call `aetherwave_balance` to confirm, then top up at https://aetherwavestudio.com/buy-credits.

**"AetherWave generation timed out after Xs"**
The provider is queueing. The job may still complete server-side - check the AetherWave gallery at https://aetherwavestudio.com/gallery.html. If timeouts persist for a particular model, try a different one (e.g. switch from `grok-imagine-t2v` to `wan-2-7-t2v`).

## Versioning

This package follows semver. Tools that change behavior in a breaking way will bump the major version. New tools and additive parameters bump the minor version. Bug fixes bump the patch version.

The MCP protocol version itself (currently `2024-11-05`) is negotiated at handshake time by the SDK; no client config needed.

## Links

- AetherWave Studio: https://aetherwavestudio.com
- Developer docs: https://aetherwavestudio.com/developers
- Get an API key: https://aetherwavestudio.com/profile (Developer tab)
- Buy credits: https://aetherwavestudio.com/buy-credits
- GitHub: https://github.com/AetherWave-Studio/aetherwave-mcp
- Harness Engineering (open-source patterns): https://github.com/AetherWave-Studio/harness-engineering

## License

MIT. See LICENSE.
