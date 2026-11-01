/**
 * UGC characters inside the generation tools: `character: "Amy"` on
 * generate_image / generate_video does what Image Studio's "UGC character"
 * reference button does. It looks the character up in the caller's own teams
 * (GET /api/ugc/teams), puts the character's approved reference pack first in
 * referenceImages and appends its identityBlock to the prompt verbatim.
 *
 * Characters are the caller's own (or their team's) recurring on-screen people,
 * not real third parties: a name that resolves here is one the member created.
 */
import type { AetherwaveClient } from "./api.js";

/** What a generation call needs from a character. */
export interface ResolvedCharacter {
  id: string;
  name: string;
  identityBlock: string | null;
  referenceImages: string[];
}

/** Model used when a character is attached and the caller picked none (accepts 16 references). */
export const CHARACTER_DEFAULT_IMAGE_MODEL = "gpt-image-2-t2i";

/**
 * Pick one character out of the /api/ugc/teams payload.
 * Exact name, handle or id wins; otherwise a unique substring match.
 * @param teams the `teams` array of GET /api/ugc/teams
 * @param query the name, handle or id the caller gave
 * @returns the character, or throws with the names the caller does have
 */
export function pickCharacter(teams: any[], query: string): ResolvedCharacter {
  const all = (teams ?? []).flatMap((t: any) => (Array.isArray(t?.characters) ? t.characters : []));
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const keys = (c: any) => [c?.name, c?.handle, c?.id].filter(Boolean).map((v: any) => String(v).toLowerCase().replace(/^@/, ""));
  let hits = all.filter((c: any) => keys(c).includes(q));
  if (!hits.length) hits = all.filter((c: any) => keys(c).some((k) => k.includes(q)));
  const names = all.map((c: any) => c?.name).filter(Boolean);
  if (!hits.length) {
    throw new Error(
      names.length
        ? `No UGC character matches "${query}". Your characters: ${names.join(", ")}.`
        : `No UGC character matches "${query}": this account has no UGC characters yet. Create one in UGC Studio first.`,
    );
  }
  if (hits.length > 1) {
    throw new Error(`"${query}" matches more than one character (${hits.map((c: any) => c.name).join(", ")}). Use the full name.`);
  }
  const c = hits[0];
  const refs = (Array.isArray(c?.referenceImages) ? c.referenceImages : []).filter((u: unknown) => typeof u === "string" && u);
  const anchors = refs.length ? refs : c?.heroImageUrl ? [String(c.heroImageUrl)] : [];
  if (!anchors.length) {
    throw new Error(`${c.name} has no approved reference pack or hero image yet. Finish the character in UGC Studio first.`);
  }
  return { id: String(c.id), name: String(c.name), identityBlock: c?.identityBlock ? String(c.identityBlock) : null, referenceImages: anchors };
}

/**
 * Look a character up for the calling account.
 * @param client the authenticated platform client
 * @param query  the name, handle or id
 */
export async function resolveCharacter(client: AetherwaveClient, query: string): Promise<ResolvedCharacter> {
  const data = await client.get<any>("/api/ugc/teams");
  return pickCharacter(data?.teams ?? [], query);
}

/**
 * Merge a character into a generation request.
 * Character references go first (identity anchors), the caller's own
 * references (a product, a garment, a location) after, duplicates dropped.
 * The identityBlock is appended once, verbatim.
 * @param prompt the caller's prompt
 * @param refs   the caller's own reference URLs, if any
 * @param ch     the resolved character
 */
export function applyCharacter(prompt: string, refs: string[] | undefined, ch: ResolvedCharacter): { prompt: string; referenceImages: string[] } {
  const referenceImages = [...new Set([...ch.referenceImages, ...(refs ?? [])])];
  const block = ch.identityBlock?.trim();
  const withBlock = block && !prompt.includes(block) ? `${prompt.trim()}\n\n${block}` : prompt;
  return { prompt: withBlock, referenceImages };
}
