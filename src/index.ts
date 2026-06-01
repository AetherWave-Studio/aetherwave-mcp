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

const VERSION = "0.1.0";

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

  // ─── list video models ───────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_list_video_models",
    {
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
      title: "Generate image (Grok Imagine, GPT Image 2, Seedream V4, Wan, Imagen 4, Nano Banana, Ideogram V3, Z-Image Turbo)",
      description:
        "Generates one or more images from a text prompt (T2I) or a text prompt + reference image(s) (I2I). Submits the job, polls until terminal, and returns the final image URLs. Default model is 'grok-imagine-t2i' (fast, 6 images per generation, 5 credits). Use list_image_models to see the full lineup with pricing. For I2I, pass `referenceImages` as an array of public image URLs and pick a model with I2I support (e.g. 'grok-imagine-i2i', 'wan-2.5-spicy-i2i').",
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
          .describe("Aspect ratio (e.g. '1:1', '16:9', '9:16'). Default depends on the model."),
        resolution: z
          .string()
          .optional()
          .describe("Output resolution. Most models accept '1K' or '2K'; some accept '480p'/'720p'."),
        referenceImages: z
          .array(z.string().url())
          .optional()
          .describe(
            "Array of public image URLs for image-to-image generation. Required when using an I2I model.",
          ),
        numImages: z
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
        seed: z
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
      title: "Edit image with AI (I2I)",
      description:
        "Edits an existing image guided by a text prompt. Pass a public `imageUrl` plus a `prompt` describing the change (\"add a moon to the sky\", \"swap the background for a neon city\", \"make it look like a comic panel\"). Submits, polls, and returns the edited image URL(s). Default model is 'gpt-image-1' (high fidelity, multi-edit). Use list_image_models to see all I2I-capable models — Wan 2.5 Spicy, Seedream V4 Edit, Flux Kontext Pro/Flex, Qwen Edit, Grok Imagine I2I.",
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
            "Model ID. Defaults to 'gpt-image-1'. Common options: 'wan-2.5-spicy-i2i', 'seedream-v4-edit', 'flux-kontext-pro', 'qwen-edit', 'grok-imagine-i2i'. Use list_image_models for the full list.",
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
        maxImages: z
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
            model: args.model || "gpt-image-1",
            aspectRatio: args.aspectRatio,
            resolution: args.resolution,
            quality: args.quality,
            maxImages: args.maxImages,
            renderingSpeed: args.renderingSpeed,
            negative_prompt: args.negative_prompt,
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

  // ─── upscale image (Topaz) ───────────────────────────────────────────────
  server.registerTool(
    "aetherwave_upscale_image",
    {
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
          .describe("Upscale multiplier. Defaults to '2x'. '8x' is heavy — use only on small sources."),
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

  // ─── reframe image (Ideogram V3) ─────────────────────────────────────────
  server.registerTool(
    "aetherwave_reframe_image",
    {
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
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/reframe-image",
          submitBody: {
            imageUrl: args.imageUrl,
            aspectRatio: args.aspectRatio,
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

  // ─── generate video (submit + poll + return URL) ─────────────────────────
  server.registerTool(
    "aetherwave_generate_video",
    {
      title: "Generate video (Grok Imagine, Wan 2.7, Hailuo 02, Seedance, Kling 2.6, VEO 3.1, Happy Horse)",
      description:
        "Generates a short-form video from a text prompt (T2V) or a text prompt + starting image (I2V). Submits, polls, and returns the final video URL. Default model is 'grok-imagine-t2v' (fast, 4-6 cr/s, with built-in KIE -> fal.ai fallback). Use list_video_models for the full lineup with credit cost per second. I2V models (e.g. 'grok-imagine-i2v', 'seedance-pro-i2v') require a public `imageUrl`. Video generation can take 30s to several minutes - this tool polls with up to an 8-minute budget.",
      inputSchema: {
        prompt: z.string().describe("Text description of the video scene."),
        model: z
          .string()
          .optional()
          .describe(
            "Model ID. Defaults to 'grok-imagine-t2v'. Use list_video_models for the full list.",
          ),
        duration: z
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
      title: "Generate music (Suno)",
      description:
        "Generates AI music via Suno. Returns two tracks per submission. Default model is V5.5 (newest, best quality). For instrumental output set `instrumental: true`. Music gen typically takes 30-90s - this tool polls with up to a 6-minute budget.",
      inputSchema: {
        prompt: z
          .string()
          .describe(
            "Style/mood/topic description. E.g. 'Lo-fi ambient track, rain sounds, warm pads' or 'High-energy synthwave with driving bass'.",
          ),
        instrumental: z
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

  // ─── band generation (Soul Forge) ────────────────────────────────────────
  server.registerTool(
    "aetherwave_generate_band",
    {
      title: "Generate band identity from a track (Soul Forge)",
      description:
        "Soul Forge: upload a track URL and get back a complete band identity - name, origin story, member roster, genre tags, and a collectible trading card with portrait. Single tool call, single round-trip. 50 credits. Great for AI-music-channel pipelines that need a 'band' persona attached to each track.",
      inputSchema: {
        audioUrl: z
          .string()
          .url()
          .describe("Public URL to the audio file (MP3 or WAV)."),
        genre: z
          .string()
          .optional()
          .describe("Optional genre hint to steer the band identity."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/band-generation",
          submitBody: {
            audioUrl: args.audioUrl,
            genre: args.genre,
          },
          statusPath: (id) => `/api/band-generation/status/${id}`,
          timeoutMs: 6 * 60_000,
          pollIntervalMs: 4_000,
        });
        return jsonResult({ taskId, ...status });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── master audio ────────────────────────────────────────────────────────
  server.registerTool(
    "aetherwave_master_audio",
    {
      title: "Master an audio track (AI mastering)",
      description:
        "Submits an audio file for AI mastering and returns the mastered version. Useful as a final polish step after music generation.",
      inputSchema: {
        audioUrl: z
          .string()
          .url()
          .describe("Public URL to the source audio file."),
        intensity: z
          .enum(["light", "medium", "heavy"])
          .optional()
          .describe("Mastering intensity. Default 'medium'."),
      },
    },
    async (args) => {
      try {
        const { status, taskId } = await client.submitAndPoll<any>({
          submitPath: "/api/master-audio",
          submitBody: {
            audioUrl: args.audioUrl,
            intensity: args.intensity || "medium",
          },
          statusPath: (id) => `/api/master-audio/status/${id}`,
          timeoutMs: 8 * 60_000,
          pollIntervalMs: 4_000,
        });
        return jsonResult({ taskId, ...status });
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
