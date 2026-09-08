import type { ScriptedTurn } from './fake';

/**
 * The conversation demo mode replays.
 *
 * It is deliberately the question the whole project is built to answer well:
 * two tools called in parallel, a verdict with a stated mechanism, and an
 * explicit refusal to invent days-to-maturity. That makes the browser suite
 * assert on the behaviour that actually matters, and gives the README poster
 * something worth recording.
 */
export function demoScript(): ScriptedTurn[] {
  return [
    {
      toolUses: [
        {
          id: 'tu_companion',
          name: 'companion_check',
          input: { plant_a: 'perenual:1852', plant_b: 'perenual:900' },
        },
        {
          id: 'tu_window',
          name: 'planting_window',
          input: { plant: 'perenual:1852', latitude: 44.98, longitude: -93.27 },
        },
      ],
    },
    {
      text:
        'Keep them apart. Tomato and potato are both Solanaceae, so they share soilborne ' +
        'diseases and compete for the same rotation slot — planting them together concentrates ' +
        'the risk, and they also share aphids.\n\n' +
        'For Minneapolis (44.98, -93.27), the median last spring frost is 28 April and the ' +
        'first autumn frost is 28 October, giving about a 183-day season. Tomatoes are tender, ' +
        'so late April is the earliest safe transplant.\n\n' +
        'One thing I cannot tell you: how many days your variety needs to mature. None of the ' +
        'sources behind these tools publish days-to-maturity, so a number here would be a guess. ' +
        'Check your seed packet — it will say — and I can work the sowing date back from it.\n\n' +
        'Frost dates come from ERA5 reanalysis on a roughly 9 km grid rather than a nearby ' +
        'station, so treat them as within a week or two.',
      usage: { input: 4200, output: 260 },
    },
  ];
}
