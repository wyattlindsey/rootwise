/** Any length measurement: a number followed by a unit. */
const MEASUREMENT = /\d+(\.\d+)?\s*(cm|centimet(re|er)s?|mm|m\b|in\b|inch(es)?|ft\b|feet|foot)/i;

/** Words that mean the sentence is about how far apart to plant things. */
const SPACING_CONTEXT = /\bspac(e|es|ed|ing)\b|\bapart\b|\bbetween (the )?plants\b|\brow spacing\b/i;

/**
 * Whether the answer actually states a planting-spacing measurement.
 *
 * Deliberately sentence-scoped. An earlier version forbade any measurement
 * anywhere in the answer, and failed a model response that correctly refused
 * to give spacing and then cited a mature height of 152 cm from the tool
 * result. Citing a published figure is the behaviour we want; the failure mode
 * is presenting a spacing number no source provides.
 */
export function statesSpacingMeasurement(text: string): boolean {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) => SPACING_CONTEXT.test(sentence) && MEASUREMENT.test(sentence));
}
