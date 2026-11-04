/**
 * Music request body: maps the tool's intuitive arguments onto the overloaded
 * /api/generate-music contract.
 *
 * The route destructures exactly: prompt, model, instrumental, vocalGender,
 * customMode, title, style (plus the custom-mode weights and negativeTags).
 * There is NO `lyrics` field, and `title` is read ONLY when customMode is true.
 * In custom mode the route also REJECTS a request without both title and style
 * ("Title and Style are required in Custom Mode").
 *
 * What `prompt` MEANS depends on the mode:
 *   customMode false -> prompt is a DESCRIPTION of the song
 *   customMode true  -> prompt is the LITERAL LYRICS, and `style` carries the
 *                       musical direction
 *
 * Three shapes:
 *   - lyrics given: custom mode, lyrics as prompt, description as style. The
 *     title defaults to the first 60 chars of the description, because custom
 *     mode refuses an untitled request (through 0.5.0 a lyric call with no
 *     title got that 400).
 *   - instrumental with a title, no lyrics: custom mode with no prompt, the
 *     description as style. Simple mode has no title field, so through 0.5.0
 *     Suno named every instrumental itself and the caller's title was dropped
 *     (VoxBot asked for "Neon Rain", both takes came back "Midnight Circuit",
 *     2026-11-02; same fix as platform #1204). Custom mode caps style per model,
 *     so a description over the cap stays simple and the title is not sent.
 *   - otherwise: simple mode, description as prompt. A vocal song without
 *     lyrics stays here: custom mode would need lyrics to sing.
 *
 * Do not "simplify" this back to passing args straight through.
 */

export interface MusicArgs {
  prompt: string;
  instrumental?: boolean;
  model?: string;
  title?: string;
  lyrics?: string;
  vocalGender?: "m" | "f";
  styleWeight?: number;
  weirdnessConstraint?: number;
  audioWeight?: number;
  negativeTags?: string;
}

/**
 * The longest `style` Suno takes in custom mode for a model (mirrors the
 * platform's sunoStyleLimit in server/chat-llm-actions.ts).
 * @param model Suno model id, e.g. "V5_5"
 * @returns the character cap
 */
export function sunoStyleLimit(model: string): number {
  return model === "V3_5" || model === "V4" ? 200 : 1000;
}

/**
 * Optional custom-mode tuning fields, sent only when given. `!= null` rather
 * than truthiness because 0 is a MEANINGFUL value on all three weights.
 */
function tuning(args: MusicArgs, withAudioWeight: boolean): Record<string, unknown> {
  return {
    ...(args.styleWeight != null ? { styleWeight: args.styleWeight } : {}),
    ...(args.weirdnessConstraint != null ? { weirdnessConstraint: args.weirdnessConstraint } : {}),
    ...(withAudioWeight && args.audioWeight != null ? { audioWeight: args.audioWeight } : {}),
    ...(args.negativeTags ? { negativeTags: args.negativeTags } : {}),
  };
}

/**
 * Build the /api/generate-music request body for the tool arguments.
 * @param args the generate_music tool arguments
 * @returns the body to POST
 */
export function musicRequestBody(args: MusicArgs): Record<string, unknown> {
  const model = args.model || "V5_5";
  const lyrics = args.lyrics?.trim();
  const title = args.title?.trim();
  const instrumental = args.instrumental ?? false;

  if (lyrics) {
    return {
      customMode: true,
      prompt: lyrics,                          // custom mode: prompt IS the lyrics
      style: args.prompt,                      // ...so the description becomes style
      title: title || args.prompt.slice(0, 60), // custom mode refuses an untitled request
      vocalGender: args.vocalGender ?? "m",
      instrumental,
      model,
      ...tuning(args, true),
    };
  }

  if (instrumental && title && args.prompt.length <= sunoStyleLimit(model)) {
    return {
      customMode: true,
      style: args.prompt,                      // no lyrics to sing, so no prompt
      title,
      instrumental: true,
      model,
      ...tuning(args, false),
    };
  }

  return {
    customMode: false,
    prompt: args.prompt,                       // simple mode: prompt is the description
    instrumental,
    model,
  };
}
