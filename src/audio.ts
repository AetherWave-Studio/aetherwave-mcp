/**
 * Voiceover tools (0.5.0), on Fish Audio.
 *
 *  - aetherwave_generate_speech: POST /api/v1/audio/speech (platform server/fish-speech-routes.ts).
 *    SYNCHRONOUS on the platform (a 1,000-character line renders in seconds). Charged when the
 *    request is accepted, refunded automatically if no audio is delivered. No job id: a call that outlives our deadline is still finishing and lands in
 *    the gallery, exactly like master_audio. The price comes from POST /api/v1/audio/speech/estimate,
 *    the same function the route charges with, so `maxCredits` can refuse before anything is spent.
 *  - aetherwave_list_voices: GET /api/v1/audio/voices.
 *
 * Fish only (Andrew 2026-11-01): this file never calls /api/tts/generate or /api/v1/audio/sfx.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AetherwaveClient } from "./api.js";

/** Platform limit per call (fish-speech-core.ts FISH_SPEECH_MAX_CHARS). */
export const SPEECH_MAX_CHARS = 1000;

/**
 * How long one speech call may take before the tool answers "running". The platform's Fish call times out at 45 s
 * and the route then refunds and ANSWERS, so a deadline of exactly 45 s raced it: the tool gave up first and said
 * "still working, it will land in the gallery" for a call the route went on to refund. 49 s lets that definite
 * answer through and stays under the 50 s tool contract.
 */
export const SPEECH_DEADLINE_MS = 49_000;

/** A failure result the caller can read: state + whether the admission charge came back. */
function failureResult(obj: Record<string, unknown>) {
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

/**
 * The connection dropped with no answer from the route (a platform restart, a proxy error page): the request may
 * have reached the route, which charges at admission, so this is neither a success nor a definite failure.
 * @param err the error from the speech POST
 */
function lostConnection(err: any): boolean {
  if (err?.timedOut) return false;
  if (/^Request refused by the host's allowlist/.test(String(err?.message))) return false;
  if (err?.notJson) return true; // a proxy page instead of the route's JSON
  if (err?.status === undefined) return true; // fetch itself threw: reset, socket hang up, fetch failed
  return err.status >= 502 && (typeof err.body !== "object" || err.body === null);
}

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
        "Charged when the request is accepted, refunded automatically if no audio is delivered; saved to the gallery as audio. A failure returns state \"failed\" with refunded true or false; state \"unknown\" means the connection dropped mid-call and it may have been charged, so check the gallery before trying again. Punctuation steers pacing; [bracketed] directions such as [excited] or [whispering] are performed, not read.\n\n" +
        "Usually answers in a few seconds. This route has no job id, so if the result has state \"running\" the audio is still finishing and will be saved to the gallery: find it with aetherwave_list_my_creations type \"audio\" rather than resubmitting, which would generate and charge it again.",
      inputSchema: {
        text: z.string().min(1).max(SPEECH_MAX_CHARS).describe(`What to say, up to ${SPEECH_MAX_CHARS} characters.`),
        voice: z.string().optional().describe(`One of: ${SPEECH_VOICES.join(", ")}. Default sarah.`),
        maxCredits: z.coerce.number().int().min(1).optional().describe("Refuse (nothing charged) if the price would be higher than this, or if the platform returns no price."),
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
        const rawEstimate = est?.data?.estimatedCredits;
        const estimatedCredits = typeof rawEstimate === "number" && Number.isFinite(rawEstimate) ? rawEstimate : NaN;
        /* maxCredits fails CLOSED: with a cap set and no usable price, make no paid call. */
        if (args.maxCredits !== undefined && !Number.isFinite(estimatedCredits)) {
          throw new Error(`The platform did not return a price for this voiceover, so maxCredits ${args.maxCredits} cannot be checked. Nothing was charged; retry, or call without maxCredits.`);
        }
        if (args.maxCredits !== undefined && estimatedCredits > args.maxCredits) {
          throw new Error(`This would cost ${estimatedCredits} credits, over maxCredits ${args.maxCredits}. Nothing was charged.`);
        }
        let data: any;
        try {
          data = (
            await client.request<any>("POST", "/api/v1/audio/speech", body, {
              timeoutMs: args.wait ? 3 * 60_000 : SPEECH_DEADLINE_MS,
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
              next: "The voiceover is still finishing server-side; it was charged once when accepted (refunded automatically if no audio is delivered) and is saved to the gallery when done. Do NOT resubmit. Call aetherwave_list_my_creations with type \"audio\" (limit 5) in ~10 s and look for the newest item.",
            });
          }
          /* The route answered with a failure and says whether the admission charge came back. */
          if (err?.body && typeof err.body === "object" && typeof err.body.refunded === "boolean") {
            const refunded = err.body.refunded as boolean;
            return failureResult({
              state: "failed",
              error: String(err.body.error || "Voiceover failed"),
              refunded,
              next: refunded
                ? "Nothing was delivered and the credits were refunded. It is safe to try again."
                : "Nothing was delivered and the automatic refund did NOT go through. Do not retry; tell the user to contact contact@aetherwavestudio.com with the time of the request so the credits can be returned.",
            });
          }
          if (lostConnection(err)) {
            return failureResult({
              state: "unknown",
              taskId: null,
              kind: "speech",
              checkWith: "aetherwave_list_my_creations",
              error: String(err?.message || err).slice(0, 300),
              next: "The connection to AetherWave dropped before it answered, so this may or may not have been charged. Do NOT resubmit yet: in about a minute call aetherwave_list_my_creations with type \"audio\". If the voiceover is there, it worked. If it is not and credits were taken, tell the user to contact contact@aetherwavestudio.com.",
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
