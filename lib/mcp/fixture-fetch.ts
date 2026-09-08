import type { FetchLike } from './host';

/**
 * Canned upstream responses for demo mode.
 *
 * Pairing this with the scripted model is what makes the browser suite fully
 * offline: the real MCP server still runs and still does its real mapping
 * work, it just talks to fixtures instead of the network. Without it, an e2e
 * run would spend Perenual's 100-request daily budget.
 */

const SPECIES: Record<string, unknown> = {
  '1852': {
    id: 1852,
    common_name: 'Garden Tomato',
    scientific_name: ['Solanum lycopersicum'],
    other_name: ['Love Apple'],
    family: 'Solanaceae',
    cycle: 'Annual',
    watering: 'Frequent',
    sunlight: ['full sun'],
    hardiness: { min: '10', max: '11' },
    dimensions: { type: 'Height', min_value: 3, max_value: 5, unit: 'feet' },
    pest_susceptibility: ['Aphids', 'Tomato Hornworm', 'Whitefly'],
    edible_fruit: true,
    edible_leaf: false,
    poisonous_to_humans: 1,
    poisonous_to_pets: 1,
    care_level: 'Medium',
    growth_rate: 'High',
    drought_tolerant: false,
    indoor: false,
    description: 'A warm-season fruiting crop grown as an annual in temperate gardens.',
  },
  '900': {
    id: 900,
    common_name: 'Potato',
    scientific_name: ['Solanum tuberosum'],
    other_name: [],
    family: 'Solanaceae',
    cycle: 'Annual',
    watering: 'Average',
    sunlight: ['full sun'],
    hardiness: { min: '3', max: '10' },
    dimensions: { type: 'Height', min_value: 1, max_value: 3, unit: 'feet' },
    pest_susceptibility: ['Colorado Potato Beetle', 'Aphids'],
    edible_fruit: false,
    edible_leaf: false,
    poisonous_to_humans: 1,
    poisonous_to_pets: 1,
    care_level: 'Medium',
    growth_rate: 'High',
    drought_tolerant: false,
    indoor: false,
    description: 'A cool-season tuber crop in the nightshade family.',
  },
};

const SEARCH = {
  data: [SPECIES['1852'], SPECIES['900']],
  current_page: 1,
  last_page: 1,
  total: 2,
};

/** Ten whole years of daily minima with a stable Minneapolis-like frost pattern. */
function archive(): unknown {
  const time: string[] = [];
  const temperature_2m_min: number[] = [];

  for (let year = 2015; year <= 2024; year += 1) {
    const end = Date.UTC(year, 11, 31);
    for (let ms = Date.UTC(year, 0, 1); ms <= end; ms += 86_400_000) {
      const iso = new Date(ms).toISOString().slice(0, 10);
      const monthDay = iso.slice(5);
      time.push(iso);
      // Frost through late April and from late October; deepest cold in January.
      const freezing = monthDay <= '04-28' || monthDay >= '10-28';
      temperature_2m_min.push(freezing ? (monthDay <= '01-31' ? -26 : -3) : 14);
    }
  }

  return { daily: { time, temperature_2m_min } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function createFixtureFetch(): FetchLike {
  const archived = archive();

  return async (url: string) => {
    const target = new URL(url);

    if (target.hostname.endsWith('open-meteo.com')) {
      return json(archived);
    }

    if (target.pathname.includes('/species-list')) {
      return json(SEARCH);
    }

    const id = /species\/details\/(\d+)/.exec(target.pathname)?.[1];
    if (id !== undefined) {
      return json(SPECIES[id] ?? {}, SPECIES[id] === undefined ? 404 : 200);
    }

    return json({}, 404);
  };
}
