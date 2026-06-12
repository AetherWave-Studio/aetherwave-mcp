#!/usr/bin/env node
/**
 * @aetherwave/mcp — Model Context Protocol server for AetherWave Studio.
 *
 * Exposes the AetherWave creative-AI API surface as MCP tools so any compliant
 * agent (Claude Code, Cursor, Continue, Claude Desktop, custom MCP clients)
 * can generate music, images, videos, band identities, and more.
 *
 * Auth: requires AETHERWAVE_API_KEY in env. Get yours at
 * https://aetherwavestudio.com/profile (Developer tab).
 *
 * Transport: stdio (the standard for npx-launched MCP servers).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AetherwaveClient } from "./api.js";

const VERSION = "0.2.6";

function bootstrap(): AetherwaveClient {
  const apiKey = process.env.AETHERWAVE_API_KEY;
  if (!apiKey) {
    console.error(
      "AETHERWAVE_API_KEY environment variable is required.\n" +
        "Get a key at https://aetherwavestudio.com/profile (Developer tab),\n" +
        "then set AETHERWAVE_API_KEY in your MCP client's env config.",
    );
    process.exit(1);
  }
  if (!apiKey.startsWith("aw_")) {
    console.error(
      `AETHERWAVE_API_KEY looks malformed (got ${apiKey.slice(0, 10)}...). Keys start with "aw_live_".`,
    );
    process.exit(1);
  }
  return new AetherwaveClient({
    apiKey,
    baseUrl: process.env.AETHERWAVE_BASE_URL,
  });
}

function jsonResult(obj: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(obj, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Error: ${message}`,
      },
    ],
  };
}

async function main() {
  const client = bootstrap();

  const server = new McpServer({
    name: "aetherwave",
    version: VERSION,
  });

  // ─── balance ─────────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_balance",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "Check credit balance",
      description:
        "Returns the current AetherWave credit balance for the API key. Use this BEFORE a generation to confirm sufficient credits, especially for video which can cost 30-300+ credits depending on model/duration/resolution.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.get<any>("/api/quickstart/balance");
        return jsonResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── list image models ───────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_list_image_models",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "List available image models",
      description:
        "Returns every image-generation model AetherWave supports, with its credit cost, default aspect ratio, supported inputs (T2I vs I2I), and any model-specific options. Call this before generate_image when you don't know the right model ID. The model key (e.g. 'grok-imagine-t2i') is what you pass as `model` to generate_image.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.get<any>("/api/image/models", "public");
        return jsonResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── list master presets ─────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_list_master_presets",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "List available audio mastering presets",
      description:
        "Returns every AI mastering preset AetherWave supports, with target LUFS, tags, descriptions, and difficulty level. Call this before master_audio when you don't know which preset fits the track. 12 presets total covering streaming, hip hop, EDM, pop, rock, lo-fi, R&B, acoustic, cinematic, podcast, gentle, and loud-and-punchy mastering styles. Each preset has a target LUFS value (e.g. -14 for streaming, -9 for loud) so you can match the user's distribution target.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.get<any>("/api/master-presets", "public");
        return jsonResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── list video models ───────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_list_video_models",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "List available video models",
      description:
        "Returns every video-generation model AetherWave supports (Grok Imagine, Wan 2.7, Hailuo 02, Seedance Pro/Lite, Kling 2.6 with audio, VEO 3.1, Happy Horse, etc.) with per-second credit cost, supported durations, resolutions, aspect ratios, and whether the model needs an input image (I2V). Call this before generate_video when you don't know the right model ID.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.get<any>("/api/video/models", "public");
        return jsonResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── generate image (submit + poll + return URLs) ────────────────────────
  server.registerTool(
    "aetherwave_generate_image",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Generate image (Grok Imagine, GPT Image 2, Seedream V4, Wan, Imagen 4, Nano Banana, Ideogram V3, Z-Image Turbo)",
      description:
        `Generates one or more images from a text prompt (T2I) or a text prompt + reference image(s) (I2I). Submits the job, polls until terminal, and returns the final image URLs. Default model is 'grok-imagine-t2i' (fast, 6 images per generation, 5 credits). Use list_image_models to see the full lineup with pricing. For I2I, pass \`referenceImages\` as an array of public image URLs and pick a model with I2I support (e.g. 'grok-imagine-i2i', 'wan-2.5-spicy-i2i').

## Model selection guide (when the user does not specify a model)

Default: \`grok-imagine-t2i\` (5 cr, 6 outputs per call, fast, general purpose).

**Strong recommendation: when a single high-quality output is what's wanted** (most agent / one-shot workflows), prefer \`gpt-image-2-t2i\` (9 cr @ 1K / higher @ 2K, single deterministic image, best general quality across realism, illustration, typography, and composition; supports up to 2K resolution and most aspect ratios including auto). This is the front-runner for serious creative output where you don't need to pick from 6 variations.

Pick a different model when the prompt has these signals:

- "single best result" / "one image" / production / no time to pick from variations -> \`gpt-image-2-t2i\` (9 cr, 1 output, top general quality)
- "photoreal" / "photo of" / "realistic"     -> \`gpt-image-2-t2i\` (9 cr, best general realism) or \`imagen-4\` (12 cr, very high quality) or \`z-image-turbo\` (3 cr, fastest)
- "highest quality" / "premium" / no budget  -> \`gpt-image-2-t2i\` at 2K, or \`grok-imagine-quality-t2i\` (16 cr @ 1K, 22 cr @ 2K), or \`imagen-4-ultra\`
- Text inside the image (signs, posters, typography) -> \`ideogram-v3-t2i\` (best in class) or \`gpt-image-2-t2i\` (also strong)
- Artistic / painterly / stylized            -> \`midjourney-t2i\`
- Album art / cover art                      -> \`gpt-image-2-t2i\` for one strong image; \`grok-imagine-t2i\` for 6 variations to choose from; \`seedream-v4-t2i\` if 4K wanted
- Logo or design with embedded text          -> \`ideogram-v3-t2i\`
- NSFW / adult / explicit                    -> \`wan-2.5-spicy-t2i\` (auto-tags creation as 18+; routes to adult gallery)
- Cheapest possible / quick test             -> \`z-image-turbo\` (3 cr)
- Multiple variations to compare             -> keep \`grok-imagine-t2i\` (6 outputs default) or use \`numImages\` on a multi-output model

For I2I (reference image provided): prefer the dedicated \`aetherwave_edit_image\` tool for "change something in this image" intent. Use \`aetherwave_generate_image\` with I2I models only when you specifically want style transfer (\`midjourney-i2i\`), premium quality (\`grok-imagine-quality-i2i\`), or adult content (\`wan-2.5-spicy-i2i\`).

Always pass an explicit \`aspectRatio\` (e.g. "1:1" for square album art, "16:9" for video thumbnails, "9:16" for shorts/reels). Some upstream providers reject submissions with no aspect ratio.

Ask the user only when:
- The prompt contradicts itself (e.g., "highest quality but cheapest")
- The user requested "the best model" with no context, surface 2-3 options with tradeoffs
- A single generation would cost more than 20 credits and the user has not confirmed`,
      inputSchema: {
        prompt: z.string().describe("Text description of the image to generate."),
        model: z
          .string()
          .optional()
          .describe(
            "Model ID. Defaults to 'grok-imagine-t2i'. Use list_image_models for the full list.",
          ),
        aspectRatio: z
          .string()
          .optional()
          .describe("Aspect ratio (e.g. '1:1', '16:9', '9:16'). Pass this explicitly when possible; some upstream providers reject submissions without an aspect ratio. Default ratios vary by model."),
        resolution: z
          .string()
          .optional()
          .describe("Output resolution. Most models accept '1K' or '2K'; some accept '480p'/'720p'."),
        referenceImages: z
          .preprocess(
            (v) => {
              // Some MCP clients serialize arrays as JSON strings on the wire.
              // Accept both: real arrays, JSON-encoded arrays, and a single URL
              // string (which gets wrapped as a one-element array).
              if (typeof v === "string") {
                const trimmed = v.trim();
                if (trimmed.startsWith("[")) {
                  try { return JSON.parse(trimmed); } catch { /* fall through */ }
                }
                return [trimmed];
              }
              return v;
            },
            z.array(z.string().url()),
          )
          .optional()
          .describe(
            "Array of public image URLs for image-to-image generation. Required when using an I2I model. A single URL string is also accepted (wrapped as a one-element array).",
          ),
        numImages: z.coerce
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe("Number of images for models that support multiple outputs."),
        negative_prompt: z
          .string()
          .optional()
          .describe("What to avoid in the output (supported by some models)."),
        seed: z.coerce
          .number()
          .int()
          .optional()
          .describe("Seed for deterministic generation (supported by some models)."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/generate-image",
          submitBody: {
            prompt: args.prompt,
            model: args.model || "grok-imagine-t2i",
            aspectRatio: args.aspectRatio,
            resolution: args.resolution,
            referenceImages: args.referenceImages,
            numImages: args.numImages,
            negative_prompt: args.negative_prompt,
            seed: args.seed,
          },
          statusPath: (id) => `/api/generate-image/status/${id}`,
          timeoutMs: 6 * 60_000,
          pollIntervalMs: 2_500,
          successStates: ["success", "complete", "completed", "succeeded", "done"],
        });
        return jsonResult({
          taskId,
          state: status.state || status.status,
          images: status.images || [],
          autoSaved: status.autoSaved ?? null,
          creationIds: status.creationIds || [],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── edit image (I2I via Wan 2.5 Spicy, GPT Image 2, Seedream V4 Edit, Flux Kontext, etc.) ─
  server.registerTool(
    "aetherwave_edit_image",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Edit image with AI (I2I)",
      description:
        `Edits an existing image guided by a text prompt. Pass a public \`imageUrl\` plus a \`prompt\` describing the change ("add a moon to the sky", "swap the background for a neon city", "make it look like a comic panel"). Submits, polls, and returns the edited image URL(s). Default model is 'grok-imagine-i2i' (6 cr per call, returns 2 variations, ~30s, best cost-to-quality on standard edits). Other I2I-capable models: 'seedream-v4-edit', 'wan-2.5-spicy-i2i', 'flux-kontext-pro', 'qwen-image-edit', 'gpt-image-1.5-i2i' (slow, ~5min). Use list_image_models for full lineup. Note: source URLs with spaces or parentheses may fail upstream; prefer clean URLs.

## Model selection guide for edits

Default: \`grok-imagine-i2i\` (6 cr per call, returns 2 variations = 3 cr/image effective, fast ~30s, strong general-purpose edit quality).

Pick a different model when:

- Need a single deterministic output, or 4K resolution           -> \`seedream-v4-edit\` (7 cr per image, supports 1K/2K/4K, multi-image up to 6)
- Subtle edits / preserve composition / character consistency   -> \`flux-kontext-pro\` or \`flux-kontext-max\`
- NSFW edits                                                    -> \`wan-2.5-spicy-i2i\`
- Highest quality, time is not a concern (~5 min OK)            -> \`gpt-image-1.5-i2i\` or \`grok-imagine-quality-i2i\` (16 cr @ 1K, 22 cr @ 2K)
- Stylized / artistic transformation                            -> \`midjourney-i2i\`

If the user simply says "edit this image" with no other signal, default to \`grok-imagine-i2i\`.`,
      inputSchema: {
        prompt: z.string().describe("Text description of the edit (e.g. 'replace the sky with sunset clouds')."),
        imageUrl: z
          .string()
          .url()
          .describe("Public URL of the source image to edit. Must be a real, fetchable URL."),
        model: z
          .string()
          .optional()
          .describe(
            "Model ID. Defaults to 'grok-imagine-i2i' (3 cr/image effective, 2 outputs). Other options: 'seedream-v4-edit', 'wan-2.5-spicy-i2i', 'flux-kontext-pro', 'qwen-image-edit', 'gpt-image-1.5-i2i', 'grok-imagine-quality-i2i'. Use list_image_models for the full list.",
          ),
        aspectRatio: z
          .string()
          .optional()
          .describe("Output aspect ratio (e.g. '1:1', '16:9'). Defaults to the source ratio for most models."),
        resolution: z
          .string()
          .optional()
          .describe("Output resolution. Tiered-pricing models accept '1K' / '2K'."),
        quality: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("Quality preset for models that support it (e.g. GPT Image 2)."),
        maxImages: z.coerce
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe("Number of variations to return for multi-output models."),
        renderingSpeed: z
          .enum(["turbo", "balanced", "quality"])
          .optional()
          .describe("Rendering speed preset for models that support it."),
        negative_prompt: z
          .string()
          .optional()
          .describe("What to avoid in the output (supported by some models)."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/edit-image",
          submitBody: {
            prompt: args.prompt,
            imageUrl: args.imageUrl,
            model: args.model || "grok-imagine-i2i",
            aspectRatio: args.aspectRatio,
            resolution: args.resolution,
            quality: args.quality,
            maxImages: args.maxImages,
            renderingSpeed: args.renderingSpeed,
            negative_prompt: args.negative_prompt,
          },
          statusPath: (id) => `/api/generate-image/status/${id}`,
          timeoutMs: 10 * 60_000,
          pollIntervalMs: 2_500,
          successStates: ["success", "complete", "completed", "succeeded", "done"],
        });
        return jsonResult({
          taskId,
          state: status.state || status.status,
          images: status.images || [],
          autoSaved: status.autoSaved ?? null,
          creationIds: status.creationIds || [],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── upscale image (Topaz) ───────────────────────────────────────────────
  server.registerTool(
    "aetherwave_upscale_image",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Upscale image (Topaz)",
      description:
        "Upscales a source image using Topaz's high-fidelity upscaler. Pass a public `imageUrl` and an `upscaleFactor`. Credit cost depends on the source resolution × factor; small images cost less than large ones at the same factor. Returns the upscaled image URL.",
      inputSchema: {
        imageUrl: z
          .string()
          .url()
          .describe("Public URL of the source image."),
        upscaleFactor: z
          .enum(["1x", "2x", "4x", "8x"])
          .optional()
          .describe("Upscale multiplier. Defaults to '2x'. '8x' is heavy; use only on small sources."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/upscale-image",
          submitBody: {
            imageUrl: args.imageUrl,
            upscaleFactor: args.upscaleFactor || "2x",
          },
          statusPath: (id) => `/api/generate-image/status/${id}`,
          timeoutMs: 6 * 60_000,
          pollIntervalMs: 2_500,
          successStates: ["success", "complete", "completed", "succeeded", "done"],
        });
        return jsonResult({
          taskId,
          state: status.state || status.status,
          images: status.images || [],
          autoSaved: status.autoSaved ?? null,
          creationIds: status.creationIds || [],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── remove background (Recraft) ─────────────────────────────────────────
  server.registerTool(
    "aetherwave_remove_background",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Remove background from image (Recraft + fal.ai BiRefNet v2 fallback)",
      description:
        "Strips the background from an image, returning a PNG with transparent alpha. Pass a public `imageUrl`. Useful for product shots, character cutouts, logo isolation, or compositing onto a new background. ~5 credits per image. Recraft is the primary provider; on outage the tool auto-falls back to fal.ai BiRefNet v2 so single-image calls never silently fail. Works best on photographic subjects (people, products, animals); transparent-PNG inputs have no foreground to segment.",
      inputSchema: {
        imageUrl: z
          .string()
          .url()
          .describe("Public URL of the source image."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/remove-background",
          submitBody: {
            imageUrl: args.imageUrl,
          },
          statusPath: (id) => `/api/generate-image/status/${id}`,
          timeoutMs: 6 * 60_000,
          pollIntervalMs: 2_500,
          successStates: ["success", "complete", "completed", "succeeded", "done"],
        });
        return jsonResult({
          taskId,
          state: status.state || status.status,
          images: status.data?.images || status.images || [],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── reframe image (Ideogram V3) ─────────────────────────────────────────
  server.registerTool(
    "aetherwave_reframe_image",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Reframe image to a new aspect ratio (Ideogram V3 Reframe)",
      description:
        "Reframes an image to a new aspect ratio by intelligently outpainting the edges. Pass a public `imageUrl` and the target `aspectRatio` ('16:9', '9:16', '1:1', '4:3', '3:4', etc.). Three speed tiers: 'turbo' (5 cr, fast), 'balanced' (10 cr, default), 'quality' (14 cr, slowest, best edges). Returns the reframed image URL.",
      inputSchema: {
        imageUrl: z
          .string()
          .url()
          .describe("Public URL of the source image."),
        aspectRatio: z
          .string()
          .describe("Target aspect ratio (e.g. '16:9', '9:16', '1:1', '4:3', '3:4', '21:9')."),
        speed: z
          .enum(["turbo", "balanced", "quality"])
          .optional()
          .describe("Rendering speed. 'turbo'=5cr, 'balanced'=10cr (default), 'quality'=14cr."),
      },
    },
    async (args) => {
      try {
        // Ideogram V3 Reframe only accepts preset image_size names. Translate
        // human-readable aspect ratios into Ideogram's allowed presets so the
        // upstream call doesn't 422.
        const presetMap: Record<string, string> = {
          "1:1": "square_hd",
          "16:9": "landscape_16_9",
          "9:16": "portrait_16_9",
          "4:3": "landscape_4_3",
          "3:4": "portrait_4_3",
        };
        const imageSize = presetMap[args.aspectRatio] || args.aspectRatio;
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/reframe-image",
          submitBody: {
            imageUrl: args.imageUrl,
            image_size: imageSize,
            speed: (args.speed || "balanced").toUpperCase(),
          },
          statusPath: (id) => `/api/generate-image/status/${id}`,
          timeoutMs: 6 * 60_000,
          pollIntervalMs: 2_500,
          successStates: ["success", "complete", "completed", "succeeded", "done"],
        });
        return jsonResult({
          taskId,
          state: status.state || status.status,
          images: status.images || [],
          autoSaved: status.autoSaved ?? null,
          creationIds: status.creationIds || [],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── upscale video (Atlas) ───────────────────────────────────────────────
  server.registerTool(
    "aetherwave_upscale_video",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Upscale video (Atlas Video Upscaler)",
      description:
        "Upscales a source video to 1080p or 2K using Atlas. Pass a public `videoUrl` and the target resolution. Cost is per-second (7 cr/s @ 1080p, 9 cr/s @ 2K). Atlas-side limits: clips up to 53s at 1080p, 23s at 2K, source must be <=30fps. Returns the upscaled video URL (R2-hosted).",
      inputSchema: {
        videoUrl: z
          .string()
          .url()
          .describe("Public URL of the source video (MP4)."),
        targetResolution: z
          .enum(["1080p", "2k"])
          .optional()
          .describe("Target output resolution. Defaults to '1080p'. '2k' is more expensive and limited to ~23s clips."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/video/edit",
          submitBody: {
            tool: "upscale",
            videoUrl: args.videoUrl,
            targetResolution: args.targetResolution || "1080p",
          },
          statusPath: (id) => `/api/video/edit/status/${id}`,
          timeoutMs: 10 * 60_000,
          pollIntervalMs: 3_000,
          successStates: ["completed", "success", "complete", "succeeded", "done"],
        });
        return jsonResult({
          taskId,
          status: status.status,
          videoUrl: status.resultUrl || null,
          autoSaved: status.autoSaved ?? null,
          creationId: status.creationId || null,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── remove background video (Python service rembg u2netp) ───────────────
  server.registerTool(
    "aetherwave_remove_background_video",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Remove background from video",
      description:
        "Strips the background from a video frame-by-frame using rembg (u2netp) on AetherWave's Python service. Pass a public `videoUrl`. Choose `bgType: \"transparent\"` for an alpha-channel WebM output (compositing) or `bgType: \"color\"` with a `customColor` hex for a solid replacement. 2 credits per second. Slowest tool in the surface (per-frame processing); a 6s clip takes ~4 min, a 30s clip ~15-20 min. Works best on subjects with clear edges (people, products). Returns the processed video URL (R2-hosted).",
      inputSchema: {
        videoUrl: z
          .string()
          .url()
          .describe("Public URL of the source video (MP4)."),
        bgType: z
          .enum(["transparent", "color"])
          .optional()
          .describe("'transparent' = alpha WebM output (default). 'color' = solid replacement using customColor."),
        customColor: z
          .string()
          .optional()
          .describe("Hex color for solid background when bgType='color' (e.g. '#00ff00'). Default green."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/video/edit",
          submitBody: {
            tool: "background",
            videoUrl: args.videoUrl,
            bgType: args.bgType || "transparent",
            customColor: args.customColor || "#00ff00",
          },
          statusPath: (id) => `/api/video/edit/status/${id}`,
          timeoutMs: 15 * 60_000,
          pollIntervalMs: 3_000,
          successStates: ["completed", "success", "complete", "succeeded", "done"],
        });
        return jsonResult({
          taskId,
          status: status.status,
          videoUrl: status.resultUrl || null,
          autoSaved: status.autoSaved ?? null,
          creationId: status.creationId || null,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── reframe video (Luma Ray 2 Flash) ────────────────────────────────────
  server.registerTool(
    "aetherwave_reframe_video",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Reframe video to a new aspect ratio (Luma Ray 2 Flash)",
      description:
        "Reframes a video to a new aspect ratio by intelligently outpainting/cropping the edges. Pass a public `videoUrl` and target `reframeAspectRatio`. 17 credits per second. Optional `reframePrompt` lets you steer the new edge content (e.g. 'extend the sky with sunset clouds'). Returns the reframed video URL (R2-hosted).",
      inputSchema: {
        videoUrl: z
          .string()
          .url()
          .describe("Public URL of the source video (MP4)."),
        reframeAspectRatio: z
          .enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"])
          .describe("Target aspect ratio."),
        reframePrompt: z
          .string()
          .optional()
          .describe("Optional prompt to steer the new edge content."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/video/edit",
          submitBody: {
            tool: "reframe",
            videoUrl: args.videoUrl,
            reframeAspectRatio: args.reframeAspectRatio,
            reframePrompt: args.reframePrompt || "",
          },
          statusPath: (id) => `/api/video/edit/status/${id}`,
          timeoutMs: 15 * 60_000,
          pollIntervalMs: 3_000,
          successStates: ["completed", "success", "complete", "succeeded", "done"],
        });
        return jsonResult({
          taskId,
          status: status.status,
          videoUrl: status.resultUrl || null,
          autoSaved: status.autoSaved ?? null,
          creationId: status.creationId || null,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── generate video (submit + poll + return URL) ─────────────────────────
  server.registerTool(
    "aetherwave_generate_video",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Generate video (Grok Imagine, Wan 2.7, Hailuo 02, Seedance, Kling 2.6, VEO 3.1, Happy Horse)",
      description:
        `Generates a short-form video from a text prompt (T2V) or a text prompt + starting image (I2V). Submits, polls, and returns the final video URL. Default model is 'grok-imagine-t2v' (fast, 4-6 cr/s, with built-in KIE -> fal.ai fallback). Use list_video_models for the full lineup with credit cost per second. I2V models (e.g. 'grok-imagine-i2v', 'seedance-pro-i2v') require a public \`imageUrl\`. Video generation can take 30s to several minutes; this tool polls with up to an 8-minute budget.

## Model selection guide for videos (when the user does not specify a model)

Default: \`grok-imagine-t2v\` (4-6 cr/s, fast, has KIE -> fal.ai fallback for redundancy. Best general-purpose).

Pick a different model when the prompt has these signals:

- "highest quality" / "premium" / broadcast / commercial    -> \`veo3.1-quality\` or \`veo3-quality\` (Google's flagship, fixed 350-560 cr for 8s, 3-5 min)
- "fast premium" / quick high-quality                       -> \`veo3-fast\` or \`veo3.1-fast\` (84 cr fixed for 8s)
- Cinematic camera moves / dolly / pan                      -> \`seedance-pro-t2v\` (3-10 cr/s) or \`kling-3.0-pro-t2v\` (26 cr/s)
- Realistic human motion / faces                            -> \`hailuo-2.3-pro-i2v\` (I2V, supply imageUrl)
- Talking head / lip sync                                   -> \`kling-avatar-pro\` (23 cr/s) or \`infinitalk\` (5-17 cr/s)
- Anime / stylized / fantasy                                -> \`wan-2.7-t2v\`
- NSFW / adult                                              -> \`wan-22-nsfw-i2v\` (I2V only; auto-tags adult)
- Animate this exact image                                  -> any I2V variant (\`grok-imagine-i2v\`, \`seedance-pro-i2v\`, \`hailuo-2.3-pro-i2v\`)
- First + last frame interpolation                          -> \`seedance-pro-i2v\` with both \`imageUrl\` + \`endImageUrl\`
- Cheapest test                                             -> \`hailuo-2.0-standard\` @ 512p (3 cr/s, ~18 cr for 6s) or \`grok-imagine-t2v\` @ 480p (4 cr/s, ~24 cr for 6s)
- Clip 12-15s                                               -> \`grok-imagine-t2v\` (accepts up to 15s)
- True 4K                                                   -> \`kling-3.0-4k-t2v\` (94 cr/s, expensive but native 4K)

**Audio in generated video:** \`grok-imagine-t2v\`, \`seedance-pro-t2v\`, and the VEO 3.x family include audio at base cost (no surcharge). Kling 2.6 and Kling 3.0 are the outliers — they price audio as a +50-100% surcharge (Kling 2.6 doubles the cost, Kling 3.0 Pro adds ~46%). Default to Grok / Seedance / VEO when sound matters and you don't want to think about audio pricing.

**Cost framing:** resolution and duration drive cost more than model choice. A 6-second 480p Grok generation costs ~24 cr; the same prompt at 1080p Seedance 2 is ~858 cr (35x more). Pick the lowest acceptable resolution + duration first.

**For I2V models:** \`imageUrl\` is required. For first+last-frame models, pass \`endImageUrl\` too.

Ask the user only when:
- Single generation would cost more than 100 credits and they haven't confirmed
- They asked for "the best" with no other signal; surface 2-3 options with cost ranges`,
      inputSchema: {
        prompt: z.string().describe("Text description of the video scene."),
        model: z
          .string()
          .optional()
          .describe(
            "Model ID. Defaults to 'grok-imagine-t2v'. Use list_video_models for the full list.",
          ),
        duration: z.coerce
          .number()
          .int()
          .min(2)
          .max(30)
          .optional()
          .describe(
            "Duration in seconds. Grok Imagine accepts 6-15; other models have their own ranges (see list_video_models).",
          ),
        resolution: z
          .enum(["480p", "720p", "1080p", "2K"])
          .optional()
          .describe("Output resolution. Default depends on model."),
        aspectRatio: z
          .string()
          .optional()
          .describe("Aspect ratio (e.g. '16:9', '9:16', '1:1')."),
        imageUrl: z
          .string()
          .url()
          .optional()
          .describe("Public URL of starting image. Required for I2V models."),
        endImageUrl: z
          .string()
          .url()
          .optional()
          .describe("Public URL of ending image. Supported by some I2V models (first+last frame)."),
        mode: z
          .enum(["fun", "normal", "spicy"])
          .optional()
          .describe("Moderation mode for Grok Imagine. Defaults to 'normal'."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/generate-video",
          submitBody: {
            prompt: args.prompt,
            model: args.model || "grok-imagine-t2v",
            duration: args.duration,
            resolution: args.resolution,
            aspectRatio: args.aspectRatio,
            imageUrl: args.imageUrl,
            endImageUrl: args.endImageUrl,
            mode: args.mode,
          },
          statusPath: (id) => `/api/generate-video/status/${id}`,
          timeoutMs: 8 * 60_000,
          pollIntervalMs: 3_000,
          successStates: ["success", "complete", "completed", "succeeded", "done"],
        });
        const videoUrl =
          status?.data?.video?.url ||
          status?.video?.url ||
          status?.data?.video_url ||
          null;
        return jsonResult({
          taskId,
          state: status.state || status.status,
          videoUrl,
          fallbackProvider: status?.data?.fallbackProvider ?? null,
          autoSaved: status?.autoSaved ?? null,
          creationId: status?.creationId ?? null,
          kieTaskId: status?.kieTaskId ?? null,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── generate music (submit + poll + return tracks) ──────────────────────
  server.registerTool(
    "aetherwave_generate_music",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Generate music (Suno)",
      description:
        "Generates AI music via Suno. Returns two tracks per submission. Default model is V5.5 (newest, best quality). For instrumental output set `instrumental: true`. Music gen typically takes 30-90s - this tool polls with up to a 6-minute budget. Note: the `title` param is advisory for instrumentals - Suno often writes its own title from the prompt content for instrumental generations. Transient `GENERATE_AUDIO_FAILED` errors are common; retry once before degrading the model version.",
      inputSchema: {
        prompt: z
          .string()
          .describe(
            "Style/mood/topic description. E.g. 'Lo-fi ambient track, rain sounds, warm pads' or 'High-energy synthwave with driving bass'.",
          ),
        instrumental: z.coerce
          .boolean()
          .optional()
          .describe("If true, no vocals. Default false."),
        model: z
          .enum(["V3_5", "V4", "V4_5", "V5", "V5_5"])
          .optional()
          .describe("Suno model version. Defaults to V5_5 (current best)."),
        title: z
          .string()
          .optional()
          .describe("Optional title for the generated tracks."),
        lyrics: z
          .string()
          .optional()
          .describe(
            "Custom lyrics. If omitted, Suno will generate lyrics from the prompt (unless instrumental=true).",
          ),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/generate-music",
          submitBody: {
            prompt: args.prompt,
            instrumental: args.instrumental ?? false,
            model: args.model || "V5_5",
            title: args.title,
            lyrics: args.lyrics,
          },
          statusPath: (id) => `/api/music-status/${id}`,
          timeoutMs: 6 * 60_000,
          pollIntervalMs: 4_000,
          successStates: ["complete", "success", "completed", "succeeded", "done"],
        });
        return jsonResult({
          taskId,
          status: status.status || status.state,
          tracks: status.tracks || [],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── master audio ────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_master_audio",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Master an audio track (AI mastering)",
      description:
        "Submits an audio file for AI mastering and returns the mastered URL synchronously (route polls the Python service internally; expect 30s-5min). Useful as a final polish step after music generation. Cost: 20 credits per track. Producer, Mogul, and Ultimate plans get mastering free. Output is WAV (~50MB per 3-minute track, lossless for redistribution). Pick a `preset` to steer the mastering style; call `aetherwave_list_master_presets` for the full live list (12 presets including streaming, loud, gentle, hip_hop, edm, pop, rock, lofi, rnb, acoustic, cinematic, podcast). Each preset has a target LUFS value so you can match the distribution target.",
      inputSchema: {
        audioUrl: z
          .string()
          .url()
          .describe("Public URL to the source audio file (MP3 or WAV)."),
        preset: z
          .string()
          .describe(
            "Mastering preset name. Must be one of: 'streaming', 'loud', 'gentle', 'hip_hop', 'edm', 'pop', 'rock', 'lofi', 'rnb', 'acoustic', 'cinematic', 'podcast'. Call aetherwave_list_master_presets for full metadata (target LUFS, description, tags).",
          ),
        trackTitle: z
          .string()
          .optional()
          .describe("Optional title for the mastered output (used in gallery row label)."),
      },
    },
    async (args) => {
      try {
        const data = await client.post<any>("/api/master-audio", {
          audioUrl: args.audioUrl,
          preset: args.preset,
          trackTitle: args.trackTitle,
        });
        return jsonResult({
          success: data.success,
          masteredUrl: data.masteredUrl,
          preset: data.preset,
          trackTitle: data.trackTitle,
          creditsCharged: data.creditsCharged,
          isFree: data.isFree,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── list user creations (gallery read) ──────────────────────────────────
  server.registerTool(
    "aetherwave_list_my_creations",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "List my AetherWave gallery items",
      description:
        "Returns items from the authenticated user's gallery — images, videos, audio tracks they've generated on AetherWave. Useful for agent workflows like 'find my last 5 images and reframe them all to 9:16' or 'list my recent songs and master each one'. Supports pagination and type filtering. Each item includes id, type, prompt, model, contentUrl, thumbnailUrl, createdAt, isFavorite, visibility, rating, and type-specific fields (duration for audio/video, width/height for images).",
      inputSchema: {
        type: z
          .enum(["image", "video", "audio"])
          .optional()
          .describe("Filter to a single media type. Omit for all types."),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max items to return. Defaults to 100, max 500."),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Pagination offset. Defaults to 0."),
        favoritesOnly: z.coerce
          .boolean()
          .optional()
          .describe("If true, only return items marked as favorite."),
      },
    },
    async (args) => {
      try {
        const params = new URLSearchParams();
        if (args.type) params.set("type", args.type);
        if (args.limit) params.set("limit", String(args.limit));
        if (args.offset) params.set("offset", String(args.offset));
        if (args.favoritesOnly) params.set("favorites", "true");
        const qs = params.toString();
        const path = qs ? `/api/user/gallery?${qs}` : "/api/user/gallery";
        const data = await client.get<any>(path);
        return jsonResult({
          items: data.items || [],
          total: data.total,
          offset: data.offset,
          limit: data.limit,
          hasMore: data.hasMore,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now reads from stdin and writes to stdout. Lifetime is the parent
  // process; no explicit shutdown needed.
}

main().catch((err) => {
  console.error("Fatal error in @aetherwave/mcp:", err);
  process.exit(1);
});
