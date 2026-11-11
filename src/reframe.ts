/**
 * Image reframe request shape.
 *
 * Since platform #1308 (2026-11-11) POST /api/reframe-image runs on fal Bria Expand at a FLAT
 * 12 credits. fal removed the previous model (Luma Photon) without notice; before that it was
 * Ideogram V3 with turbo / balanced / quality tiers priced 5 / 10 / 14. Neither the tiers nor the
 * Ideogram size keys mean anything now: the route takes a plain ratio string, and a `speed` field
 * is read only for logging and never changes the price.
 *
 * Through 0.5.4 this tool translated ratios into Ideogram keys ("16:9" -> "landscape_16_9") and
 * sent a speed. The route still maps those keys back, so it worked, but it advertised prices the
 * platform no longer charges.
 */

/**
 * Every shape reframe delivers exactly: Bria's nine native ratios plus 21:9 and 9:21, which the
 * route builds with an explicit canvas (server/reframe-input.ts REFRAME_RATIOS).
 */
export const REFRAME_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"] as const;

/** Credits one image reframe costs (reframeImagePrice in server/generation-pricing.ts). */
export const REFRAME_IMAGE_CREDITS = 12;

/**
 * Build the POST /api/reframe-image body. The ratio goes out as the route's own `aspectRatio`
 * field, verbatim; no speed is sent because the route ignores it.
 * @param args the tool arguments
 * @returns the request body
 */
export function reframeImageBody(args: { imageUrl: string; aspectRatio: string }): { imageUrl: string; aspectRatio: string } {
  return { imageUrl: args.imageUrl, aspectRatio: args.aspectRatio };
}
