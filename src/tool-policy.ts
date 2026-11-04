/**
 * TOOL POLICY: what each tool does to the caller's account, for anything that
 * embeds this server (VoxBot Chat on the platform imports it).
 *
 * MCP annotations say read-only or not; an embedder that spends a member's
 * credits needs more than that. Every registered tool MUST have a row here:
 * test/tool-policy.test.mjs builds the server in every mode and fails on a
 * tool with no row, so a new tool cannot ship unclassified. An embedder must
 * FAIL CLOSED: a tool with no row, or a row it does not understand, is not offered.
 *
 * charge
 *   "none"     never spends credits.
 *   "credits"  can spend credits. The embedder must quote and get the member's
 *              explicit confirmation before the call (VoxBot: confirm card + token).
 *              `quote` names how the price is known before the call.
 * effect
 *   "read"         changes nothing.
 *   "create"       adds something to the account (a creation, a draft, a gallery item).
 *   "destructive"  replaces or deletes something the member already has. Confirm
 *                  even when free.
 * embed
 *   false  never offer outside a local, owner-run server (needs the operator's own
 *          tokens, or acts on AetherWave's store, not the member's account).
 */

export type ToolCharge = "none" | "credits";
export type ToolEffect = "read" | "create" | "destructive";

export interface ToolPolicy {
  charge: ToolCharge;
  effect: ToolEffect;
  /** Safe to offer inside a platform-hosted assistant acting for a signed-in member. */
  embed: boolean;
  /** For charge "credits": how the price is known before the call. */
  quote?: string;
}

const READ: ToolPolicy = { charge: "none", effect: "read", embed: true };

export const TOOL_POLICY: Readonly<Record<string, ToolPolicy>> = Object.freeze({
  // reads
  aetherwave_balance: READ,
  aetherwave_list_characters: READ,
  aetherwave_list_image_models: READ,
  aetherwave_list_video_models: READ,
  aetherwave_list_master_presets: READ,
  aetherwave_list_my_creations: READ,
  aetherwave_get_job: READ,
  aetherwave_comic_estimate: READ,
  aetherwave_comic_status: READ,
  aetherwave_merch_garments: READ,
  aetherwave_merch_mockup_status: READ,
  // Reads a manual; the local server can also save a PDF to the caller's disk (embedders pass saveTo "none").
  aetherwave_get_user_manual: READ,
  aetherwave_list_voices: READ,

  // image
  aetherwave_generate_image: { charge: "credits", effect: "create", embed: true, quote: "platform image pricing (POST /api/generate-image), per image" },
  aetherwave_edit_image: { charge: "credits", effect: "create", embed: true, quote: "platform image pricing (POST /api/edit-image)" },
  aetherwave_upscale_image: { charge: "credits", effect: "create", embed: true, quote: "platform image pricing (POST /api/upscale-image)" },
  aetherwave_remove_background: { charge: "credits", effect: "create", embed: true, quote: "platform image pricing (POST /api/remove-background)" },
  aetherwave_reframe_image: { charge: "credits", effect: "create", embed: true, quote: "platform image pricing (POST /api/reframe-image)" },

  // video
  aetherwave_generate_video: { charge: "credits", effect: "create", embed: true, quote: "platform video pricing (POST /api/generate-video), model x duration x resolution" },
  aetherwave_upscale_video: { charge: "credits", effect: "create", embed: true, quote: "video edit pricing (POST /api/video/edit, tool upscale), per second of source" },
  aetherwave_remove_background_video: { charge: "credits", effect: "create", embed: true, quote: "video edit pricing (POST /api/video/edit, tool removeBackground), per second of source" },
  aetherwave_reframe_video: { charge: "credits", effect: "create", embed: true, quote: "video edit pricing (POST /api/video/edit, tool reframe), per second of source" },

  // audio
  aetherwave_generate_music: { charge: "credits", effect: "create", embed: true, quote: "calculateMusicCredits (POST /api/generate-music)" },
  aetherwave_master_audio: { charge: "credits", effect: "create", embed: true, quote: "mastering price (POST /api/master-audio); 0 on plans that include it" },
  aetherwave_generate_speech: { charge: "credits", effect: "create", embed: true, quote: "POST /api/v1/audio/speech/estimate (fishSpeechCredits: 5 per 1,000 UTF-8 bytes, minimum 2)" },

  // comics
  aetherwave_comic_create: { charge: "none", effect: "create", embed: true },
  aetherwave_comic_character_reference: { charge: "credits", effect: "create", embed: true, quote: "action 'generate' 6 credits per image; 'approve' is free" },
  aetherwave_comic_write_script: { charge: "credits", effect: "destructive", embed: true, quote: "aetherwave_comic_estimate scriptCredits (charged on actual use, can be lower); replaceExisting deletes drawn panels" },
  aetherwave_comic_draw: { charge: "credits", effect: "create", embed: true, quote: "aetherwave_comic_status creditsToFinishDrawing; cap with maxCredits; charged per panel on success" },
  aetherwave_comic_redraw_panel: { charge: "credits", effect: "destructive", embed: true, quote: "one panel at the book's panel rate (9 credits); replaces the panel" },
  aetherwave_comic_assemble: { charge: "none", effect: "create", embed: true },
  aetherwave_comic_export: { charge: "none", effect: "create", embed: true },

  // merch
  aetherwave_merch_prepare_design: { charge: "credits", effect: "create", embed: true, quote: "1 credit (POST /api/merch/design)" },
  aetherwave_merch_mockup: { charge: "credits", effect: "create", embed: true, quote: "3 credits per mockup (POST /api/merch/mockup)" },

  // gallery
  aetherwave_upload_to_gallery: { charge: "none", effect: "create", embed: true },

  // operator-only (local server with the operator's own tokens)
  aetherwave_printful_list_products: { charge: "none", effect: "read", embed: false },
  aetherwave_printful_create_product: { charge: "none", effect: "create", embed: false },
  aetherwave_shop_create_listing: { charge: "none", effect: "create", embed: false },
});

/**
 * The policy for a tool, or null when it has none (an embedder must then not offer it).
 * @param name the registered tool name
 */
export function toolPolicy(name: string): ToolPolicy | null {
  return Object.prototype.hasOwnProperty.call(TOOL_POLICY, name) ? TOOL_POLICY[name] : null;
}

/**
 * True when a platform-hosted assistant may run the tool without asking the member first:
 * embeddable, spends nothing, destroys nothing.
 * @param name the registered tool name
 */
export function runsWithoutConfirm(name: string): boolean {
  const p = toolPolicy(name);
  return !!p && p.embed && p.charge === "none" && p.effect !== "destructive";
}
