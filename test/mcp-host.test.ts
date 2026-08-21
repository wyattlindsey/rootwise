import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpHost, getMcpHost, resetMcpHost } from '@/lib/mcp/host';

const TOMATO = {
  id: 1852,
  common_name: 'Garden Tomato',
  scientific_name: ['Solanum lycopersicum'],
  family: 'Solanaceae',
  hardiness: { min: '10', max: '11' },
  pest_susceptibility: ['Aphids'],
};

function fakeFetch(body: unknown = TOMATO, status = 200) {
  return vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
}

const env = { PERENUAL_API_KEY: 'sk-test', PLANT_INTEL_CACHE_DISABLED: '1' };

afterEach(async () => {
  await resetMcpHost();
});

describe('createMcpHost', () => {
  it('discovers the MCP server tools over a real protocol handshake', async () => {
    const host = await createMcpHost({ env, fetch: fakeFetch() });

    expect(host.tools.map((tool) => tool.name).sort()).toEqual([
      'companion_check',
      'plant_details',
      'planting_window',
      'search_plants',
    ]);
    await host.close();
  });

  it('carries each tool description and JSON Schema through for the model', async () => {
    const host = await createMcpHost({ env, fetch: fakeFetch() });
    const details = host.tools.find((tool) => tool.name === 'plant_details');

    expect(details?.description).toMatch(/care profile/i);
    expect(details?.inputSchema).toMatchObject({ type: 'object' });
    expect(Object.keys((details?.inputSchema as { properties: object }).properties)).toContain(
      'plant',
    );
    await host.close();
  });

  it('routes a tool call through to the real server and parses its JSON', async () => {
    const host = await createMcpHost({ env, fetch: fakeFetch() });

    const outcome = await host.callTool('plant_details', { plant: 'perenual:1852' });

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({
      id: 'perenual:1852',
      commonName: 'Garden Tomato',
      family: 'Solanaceae',
    });
    await host.close();
  });

  it('reports a tool failure as data instead of throwing', async () => {
    const host = await createMcpHost({ env, fetch: fakeFetch({}, 503) });

    const outcome = await host.callTool('plant_details', { plant: 'perenual:1852' });

    expect(outcome.ok).toBe(false);
    expect(String(outcome.result)).toMatch(/Perenual/);
    await host.close();
  });

  it('reports an unknown tool name as a failed call, not a crash', async () => {
    const host = await createMcpHost({ env, fetch: fakeFetch() });

    const outcome = await host.callTool('no_such_tool', {});

    expect(outcome.ok).toBe(false);
    await host.close();
  });

  it('keeps the MCP server off the real filesystem and real network', async () => {
    const fetchFn = fakeFetch();
    const host = await createMcpHost({ env, fetch: fetchFn });

    await host.callTool('plant_details', { plant: 'perenual:1852' });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(new URL(fetchFn.mock.calls[0]![0]).hostname).toBe('perenual.com');
    await host.close();
  });
});

describe('getMcpHost', () => {
  it('builds the host once and reuses it, so a warm instance keeps its cache', async () => {
    const fetchFn = fakeFetch();
    const first = await getMcpHost({ env, fetch: fetchFn });
    const second = await getMcpHost({ env, fetch: fetchFn });

    expect(second).toBe(first);
  });

  it('does not build it twice under concurrent first calls', async () => {
    const fetchFn = fakeFetch();
    const [a, b] = await Promise.all([
      getMcpHost({ env, fetch: fetchFn }),
      getMcpHost({ env, fetch: fetchFn }),
    ]);

    expect(a).toBe(b);
  });
});
