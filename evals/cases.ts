import type { PromptLocation } from '@/lib/chat/system-prompt';

export interface PatternCheck {
  /** Why this matters, shown when the case fails. */
  label: string;
  pattern: RegExp;
}

export interface EvalCase {
  name: string;
  question: string;
  location?: PromptLocation | null;
  /** Tools the answer cannot be correct without. Extra calls are fine. */
  mustCallTools?: string[];
  mustNotCallTools?: string[];
  mustMatch?: PatternCheck[];
  mustNotMatch?: PatternCheck[];
}

const MINNEAPOLIS: PromptLocation = { latitude: 44.98, longitude: -93.27 };

/**
 * A measurement, not a number: any digit followed by a length unit. This is
 * what catches the failure the whole project exists to prevent -- a confident,
 * unsourced spacing figure. Kept narrow enough that "1852" or "zone 5b" or a
 * date do not trip it.
 */
const A_MEASUREMENT = /\d+(\.\d+)?\s*(cm|centimet(re|er)s?|mm|m\b|in\b|inch(es)?|ft\b|feet|foot)/i;

export const EVAL_CASES: EvalCase[] = [
  {
    name: 'companion question reaches for the companion tool',
    question: 'Can I plant tomatoes next to potatoes?',
    mustCallTools: ['companion_check'],
    mustMatch: [
      { label: 'names the botanical family behind the verdict', pattern: /solanaceae|same family|nightshade/i },
      { label: 'advises against the pairing', pattern: /apart|avoid|not.*together|separate|don't plant/i },
    ],
  },
  {
    name: 'refuses to invent spacing no source publishes',
    question: 'Exactly how far apart should I space my tomato plants? Give me a number.',
    mustNotMatch: [
      { label: 'states a spacing measurement anyway', pattern: A_MEASUREMENT },
    ],
    mustMatch: [
      { label: 'says the figure is unavailable rather than guessing', pattern: /not published|no source|do(es)? not (publish|have)|cannot (tell|say|give)|unable to/i },
    ],
  },
  {
    name: 'asks for a location instead of answering timing blind',
    question: 'When should I start my tomato seeds?',
    location: null,
    mustNotCallTools: ['planting_window'],
    mustMatch: [
      { label: 'asks where the garden is', pattern: /where|location|city|coordinates|which (region|zone|area)/i },
    ],
  },
  {
    name: 'uses the frost model once a location is known',
    question: 'When is my last frost, and when can tomatoes go outside?',
    location: MINNEAPOLIS,
    mustCallTools: ['planting_window'],
    mustMatch: [
      { label: 'gives a frost date', pattern: /april|may|\b0?4-\d{2}\b/i },
    ],
  },
  {
    name: 'passes through the caveat on where frost dates come from',
    question: 'How reliable is that frost date for my exact garden?',
    location: MINNEAPOLIS,
    mustCallTools: ['planting_window'],
    mustMatch: [
      { label: 'discloses the gridded-reanalysis limitation', pattern: /era5|grid|reanalysis|not.*(a )?(weather )?station|9 ?km/i },
    ],
  },
  {
    name: 'looks up toxicity rather than recalling it',
    question: 'Are tomato plants poisonous to cats?',
    mustCallTools: ['plant_details'],
    mustMatch: [
      { label: 'answers about pet toxicity', pattern: /toxic|poisonous|harmful/i },
    ],
  },
];
