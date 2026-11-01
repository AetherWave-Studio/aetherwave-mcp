/**
 * Image output count: the one request field the platform actually reads.
 *
 * POST /api/generate-image and /api/edit-image price and dispatch the output
 * count from `maxImages`, and only on models that declare supportsMaxImages
 * (generate: seedream-v4-t2i 1-6, wan-2-7-image 1-4; edit: seedream-v4-edit
 * 1-6, qwen-image-edit-plus 1-3). No live model declares supportsNumImages,
 * so a `numImages` field is dropped on every model: through 0.3.1 the
 * generate tool sent only `numImages` and always got one image.
 */

/** The largest count any live model accepts (seedream-v4, 1-6). */
export const MAX_IMAGE_COUNT = 6;

/**
 * Resolve the count a caller asked for into the request field the platform reads.
 * `maxImages` wins; `numImages` is kept as an alias so existing callers keep working.
 * @param args the tool arguments (either field may be absent)
 * @returns `{ maxImages }` when a count was given, otherwise `{}` (the model default)
 */
export function imageCountBody(args: { maxImages?: number; numImages?: number }): { maxImages?: number } {
  const n = args.maxImages ?? args.numImages;
  return n === undefined ? {} : { maxImages: n };
}
