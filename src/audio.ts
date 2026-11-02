/**
 * Voiceover tools (0.5.0), on Fish Audio.
 *
 *  - aetherwave_generate_speech: POST /api/v1/audio/speech (platform server/fish-speech-routes.ts).
 *    SYNCHRONOUS on the platform (a 1,000-character line renders in seconds), charged after the
 *    audio is on R2. No job id: a call that outlives our deadline is still finishing and lands in
 *    the gallery, exactly like master_audio. The price comes from POST /api/v1/audio/speech/estimate,
 *    the same function the route charges with, so `maxCredits` can refuse before anything is spent.
 *  - aetherwave_list_voices: GET /api/v1/audio/voices.
 *
 * Why Fish and only Fish (Andrew 2026-11-01): ElevenLabs' Prohibited Use Policy 9(c)/9(n) rules out
 * reselling its output to MCP users, and the platform's resale registry marks OpenAI TTS restricted.
 * So this file never calls /api/tts/generate (OpenAI + ElevenLabs) or /api/v1/audio/sfx (ElevenLabs).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_SOFT_DEADLINE_MS, type AetherwaveClient } from "./api.js";

/** Platform limit per call (fish-speech-core.ts FISH_SPEECH_MAX_CHARS). */
export const SPEECH_MAX_CHARS = 1000;

/** The stock voice names, as the platform offers them. Kept here for the schema description only; the platform validates. */
export const SPEECH_VOICES = ["jessica", "laura", "katie", "sarah", "liam", "eric", "roger", "brian", "bill"] as const;

function jsonResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

/**
 * Register the voiceover tools.
 * @param server the MCP server
 * @param client the authenticated platform client
 */
export function registerAudioTools(server: McpServer, client: AetherwaveClient) {
  server.registerTool(
    "aetherwave_generate_speech",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      title: "Generate speech / voiceover (Fish Audio)",
      description:
        "Turns text into a spoken voiceover MP3: narration, an ad read, a podcast intro, a character line. " +
        `Voices: ${SPEECH_VOICES.join(", ")} (default sarah); aetherwave_list_voices describes each. ` +
        "Cost: 5 credits per 1,000 characters, minimum 2 (a 200-character line costs 2, 1,000 characters cost 5). Plain English is one byte per character; accented and non-Latin text is billed per byte, so it costs up to 3x. " +
        `Up to ${SPEECH_MAX_CHARS} characters (about a minute of speech) per call: split longer scripts at sentence ends and make one call per part. ` +
        "The price is read from the platform before anything is spent and returned as estimatedCredits; pass maxCredits to refuse anything dearer. An unknown voice is an error that lists the voices, and nothing is charged. " +
        "Charged when the audio is delivered; saved to the gallery as audio. Punctuation steers pacing; [bracketed] directions such as [excited] or [whispering] are performed, not read.\n\n" +
        "Usually answers in a few seconds. This route has no job id, so if the result has state \"running\" the audio is still finishing and will be saved to the gallery: find it with aetherwave_list_my_creations type \"audio\" rather than resubmitting, which would generate and charge it again.",
      inputSchema: {
        text: z.string().min(1).max(SPEECH_MAX_CHARS).describe(`What to say, up to ${SPEECH_MAX_CHARS} characters.`),
        voice: z.string().optional().describe(`One of: ${SPEECH_VOICES.join(", ")}. Default sarah.`),
        maxCredits: z.coerce.number().int().min(1).optional().describe("Refuse (nothing charged) if the price would be higher than this."),
        wait: z
          .boolean()
          .optional()
          .describe("Wait up to 3 minutes instead of ~45 s. ONLY if your MCP client permits tool calls longer than 60 s."),
      },
    },
    async (args) => {
      try {
        const body = { text: args.text, voice: args.voice || "sarah" };
        /* Quote first: it validates the voice and length for free, and gives the exact charge. */
        const est = await client.post<any>("/api/v1/audio/speech/estimate", body);
        const estimatedCredits = Number(est?.data?.estimatedCredits);
        if (args.maxCredits && Number.isFinite(estimatedCredits) && estimatedCredits > args.maxCredits) {
          throw new Error(`This would cost ${estimatedCredits} credits, over maxCredits ${args.maxCredits}. Nothing was charged.`);
        }
        let data: any;
        try {
          data = (
            await client.request<any>("POST", "/api/v1/audio/speech", body, {
              timeoutMs: args.wait ? 3 * 60_000 : DEFAULT_SOFT_DEADLINE_MS,
            })
          ).data;
        } catch (err: any) {
          if (err?.timedOut) {
            return jsonResult({
              state: "running",
              taskId: null,
              kind: "speech",
              checkWith: "aetherwave_list_my_creations",
              pollEverySeconds: 10,
              estimatedCredits: Number.isFinite(estimatedCredits) ? estimatedCredits : null,
              next: "The voiceover is still finishing server-side; it is charged once and saved to the gallery when done. Do NOT resubmit. Call aetherwave_list_my_creations with type \"audio\" (limit 5) in ~10 s and look for the newest item.",
            });
          }
          throw err;
        }
        return jsonResult({
          success: data?.success ?? true,
          audioUrl: data?.data?.audioUrl ?? null,
          voice: data?.data?.voice ?? body.voice,
          durationSec: data?.data?.durationSec ?? null,
          creationId: data?.data?.creationId ?? null,
          creditsUsed: data?.creditsUsed ?? null,
          creditsRemaining: data?.creditsRemaining ?? null,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "aetherwave_list_voices",
    {
      annotations: { readOnlyHint: true, openWorldHint: true },
      title: "List voiceover voices and the price",
      description:
        "Free. Every voice aetherwave_generate_speech accepts, with a short description (gender, age, accent, manner), the default voice, the price per 1,000 characters and the per-call limit. Call it when the user asks which voices exist or which suits a script.",
      inputSchema: {},
    },
    async () => {
      try {
        const res = await client.get<any>("/api/v1/audio/voices", "public");
        return jsonResult(res?.data ?? res);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
