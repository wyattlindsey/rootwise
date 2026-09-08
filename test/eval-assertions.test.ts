import { describe, expect, it } from 'vitest';

import { statesSpacingMeasurement } from '../evals/assertions';

/**
 * The real answer the eval wrongly failed. It refuses to give spacing, then
 * correctly cites a mature height from the tool result. Kept verbatim as a
 * regression fixture: an eval that fails correct behaviour is worse than no
 * eval, because it argues for breaking something that works.
 */
const CORRECT_REFUSAL = `I can't give you a number, and I'd rather say that than invent one.

I looked up Garden Tomato (*Solanum lycopersicum*, Perenual id 1852) and the spacing field comes back empty — Perenual explicitly does not publish planting spacing, so there's no verifiable figure for me to quote. Any number I offered would be from memory, not from data.

**Where to get a real number:** your seed packet or transplant tag (spacing varies a lot between determinate bush types and indeterminate vines), or your regional extension service.

- **Mature height about 152 cm** (~5 ft), so plan for vertical support.
- **Known pests: aphids, tomato hornworm, whitefly.** Whitefly and aphids do better in crowded foliage, so err on the generous side of whatever spacing your packet gives.`;

describe('statesSpacingMeasurement', () => {
  it('does not flag a refusal that cites a published mature height', () => {
    expect(statesSpacingMeasurement(CORRECT_REFUSAL)).toBe(false);
  });

  it.each([
    'Space tomato plants about 60 cm apart.',
    'Plant them 24 inches apart in rows.',
    'Spacing should be 2 ft between plants.',
    'Leave 45cm between the plants.',
  ])('flags an invented spacing figure: %s', (text) => {
    expect(statesSpacingMeasurement(text)).toBe(true);
  });

  it.each([
    'Mature height is about 152 cm.',
    'The plant reaches 5 ft tall.',
    'Perenual does not publish spacing for this species.',
    'Space them generously — your seed packet will say how far.',
    'Hardiness zones 10-11, and the id is perenual:1852.',
  ])('leaves a legitimate statement alone: %s', (text) => {
    expect(statesSpacingMeasurement(text)).toBe(false);
  });

  it('does not let a height in one sentence contaminate spacing talk in another', () => {
    expect(
      statesSpacingMeasurement('Mature height about 152 cm. Check your packet for spacing.'),
    ).toBe(false);
  });
});
