import { describe, expect, it } from 'vitest';

import type { SystemPromptOptions } from '@/lib/chat/system-prompt';
import { UNPUBLISHED_FIELDS, buildSystemPrompt } from '@/lib/chat/system-prompt';

const TOOLS = ['search_plants', 'plant_details', 'companion_check', 'planting_window'];

function prompt(overrides: Partial<SystemPromptOptions> = {}) {
  return buildSystemPrompt({ toolNames: TOOLS, ...overrides });
}

describe('buildSystemPrompt', () => {
  it('names every tool actually available, rather than a hardcoded list', () => {
    const text = buildSystemPrompt({ toolNames: ['search_plants', 'identify_plant'] });

    expect(text).toContain('search_plants');
    expect(text).toContain('identify_plant');
    expect(text).not.toContain('companion_check');
  });

  it('requires factual claims to come from tool results', () => {
    expect(prompt()).toMatch(/tool result/i);
  });

  it.each(UNPUBLISHED_FIELDS)('forbids inventing %s', (field) => {
    expect(prompt()).toContain(field);
  });

  it('explains why those fields are off limits, not just that they are', () => {
    expect(prompt()).toMatch(/no source|not published/i);
  });

  it('requires caveats and notes to be passed through, not smoothed away', () => {
    const text = prompt();

    expect(text).toMatch(/caveats/);
    expect(text).toMatch(/notes/);
  });

  it('requires saying so plainly when the tools cannot answer', () => {
    expect(prompt()).toMatch(/say so|cannot answer|do not know/i);
  });

  it('says no location is known and directs the model to ask for one', () => {
    const text = prompt();

    expect(text).toMatch(/has not shared a location/i);
    expect(text).toMatch(/ask for a city or coordinates/i);
  });

  it('refuses to answer timing questions without a location', () => {
    expect(prompt()).toMatch(/cannot be answered without one/i);
  });

  it('uses a supplied location instead of asking for one', () => {
    const text = prompt({ location: { latitude: 44.98, longitude: -93.27 } });

    expect(text).toContain('44.98');
    expect(text).toContain('-93.27');
    expect(text).not.toMatch(/has not shared a location/i);
  });

  it('states the date so seasonal advice is anchored', () => {
    expect(prompt({ today: new Date('2026-09-08T00:00:00Z') })).toContain('2026-09-08');
  });

  it('is stable, so a change to the contract is a deliberate diff', () => {
    expect(
      buildSystemPrompt({
        toolNames: TOOLS,
        location: { latitude: 44.98, longitude: -93.27 },
        today: new Date('2026-09-08T00:00:00Z'),
      }),
    ).toMatchSnapshot();
  });
});
