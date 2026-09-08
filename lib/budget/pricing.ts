/**
 * Claude Opus 5 list pricing, US dollars per million tokens.
 * Kept beside the budget so a model change forces a look at the cap.
 */
export const INPUT_USD_PER_MTOK = 5;
export const OUTPUT_USD_PER_MTOK = 25;

/** Cost of one turn in whole cents, rounded up so partial cents are never free. */
export function costCents(inputTokens: number, outputTokens: number): number {
  const dollars =
    (inputTokens / 1_000_000) * INPUT_USD_PER_MTOK +
    (outputTokens / 1_000_000) * OUTPUT_USD_PER_MTOK;
  return Math.ceil(dollars * 100);
}
