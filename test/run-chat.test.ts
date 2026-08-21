import { afterEach, describe, expect, it } from 'vitest';

import type { ChatEvent } from '@/lib/chat/events';
import { runChat } from '@/lib/chat/run';
import { createMcpHost, type McpHost } from '@/lib/mcp/host';
import { createFakeModelClient } from '@/lib/model/fake';

const TOMATO = {
  id: 1852,
  common_name: 'Garden Tomato',
  scientific_name: ['Solanum lycopersicum'],
  family: 'Solanaceae',
  pest_susceptibility: ['Aphids'],
};

const hosts: McpHost[] = [];

async function realHost(body: unknown = TOMATO, status = 200): Promise<McpHost> {
  const host = await createMcpHost({
    env: { PERENUAL_API_KEY: 'sk-test', PLANT_INTEL_CACHE_DISABLED: '1' },
    fetch: async () => new Response(JSON.stringify(body), { status }),
  });
  hosts.push(host);
  return host;
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

async function collect(iterable: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

const ask = 'Can I plant tomatoes next to potatoes?';

describe('runChat', () => {
  it('streams the answer as text events', async () => {
    const model = createFakeModelClient([{ text: 'They should be kept apart.' }]);
    const events = await collect(
      runChat({ model, host: await realHost(), messages: [{ role: 'user', content: ask }] }),
    );

    const text = events
      .filter((event): event is Extract<ChatEvent, { type: 'text' }> => event.type === 'text')
      .map((event) => event.text)
      .join('');

    expect(text).toBe('They should be kept apart.');
  });

  it('ends with a done event carrying accumulated usage', async () => {
    const model = createFakeModelClient([{ text: 'ok', usage: { input: 100, output: 30 } }]);
    const events = await collect(
      runChat({ model, host: await realHost(), messages: [{ role: 'user', content: ask }] }),
    );

    expect(events.at(-1)).toEqual({
      type: 'done',
      usage: { inputTokens: 100, outputTokens: 30 },
    });
  });

  it('emits a tool call, then its result, then the follow-up answer in order', async () => {
    const model = createFakeModelClient([
      { toolUses: [{ id: 'tu_1', name: 'plant_details', input: { plant: 'perenual:1852' } }] },
      { text: 'Solanaceae.' },
    ]);

    const events = await collect(
      runChat({ model, host: await realHost(), messages: [{ role: 'user', content: ask }] }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'tool_call',
      'tool_result',
      'text',
      'done',
    ]);
  });

  it('reports the tool name and arguments so the UI can show them', async () => {
    const model = createFakeModelClient([
      { toolUses: [{ id: 'tu_1', name: 'plant_details', input: { plant: 'perenual:1852' } }] },
      { text: 'done' },
    ]);

    const events = await collect(
      runChat({ model, host: await realHost(), messages: [{ role: 'user', content: ask }] }),
    );

    expect(events[0]).toEqual({
      type: 'tool_call',
      id: 'tu_1',
      name: 'plant_details',
      input: { plant: 'perenual:1852' },
    });
  });

  it('carries the real MCP result through, not a stub', async () => {
    const model = createFakeModelClient([
      { toolUses: [{ id: 'tu_1', name: 'plant_details', input: { plant: 'perenual:1852' } }] },
      { text: 'done' },
    ]);

    const events = await collect(
      runChat({ model, host: await realHost(), messages: [{ role: 'user', content: ask }] }),
    );
    const result = events[1] as Extract<ChatEvent, { type: 'tool_result' }>;

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ commonName: 'Garden Tomato', family: 'Solanaceae' });
  });

  it('feeds the tool result back to the model', async () => {
    const model = createFakeModelClient([
      { toolUses: [{ id: 'tu_1', name: 'plant_details', input: { plant: 'perenual:1852' } }] },
      { text: 'done' },
    ]);

    await collect(
      runChat({ model, host: await realHost(), messages: [{ role: 'user', content: ask }] }),
    );

    const second = model.calls[1]!;
    const last = second.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(JSON.stringify(last.content)).toContain('tool_result');
    expect(JSON.stringify(last.content)).toContain('Garden Tomato');
  });

  it('keeps going when a tool fails, surfacing the failure as an event', async () => {
    const model = createFakeModelClient([
      { toolUses: [{ id: 'tu_1', name: 'plant_details', input: { plant: 'perenual:1852' } }] },
      { text: 'I could not look that up.' },
    ]);

    const events = await collect(
      runChat({
        model,
        host: await realHost({}, 503),
        messages: [{ role: 'user', content: ask }],
      }),
    );

    const result = events.find(
      (event): event is Extract<ChatEvent, { type: 'tool_result' }> =>
        event.type === 'tool_result',
    );
    expect(result?.ok).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('turns a model failure into an error event rather than throwing', async () => {
    const model = createFakeModelClient([{ error: new Error('overloaded') }]);

    const events = await collect(
      runChat({ model, host: await realHost(), messages: [{ role: 'user', content: ask }] }),
    );

    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/overloaded/) });
  });

  it('passes the system prompt and every MCP tool to the model', async () => {
    const model = createFakeModelClient([{ text: 'ok' }]);
    const host = await realHost();

    await collect(
      runChat({
        model,
        host,
        system: 'be honest',
        messages: [{ role: 'user', content: ask }],
      }),
    );

    expect(model.calls[0]?.system).toBe('be honest');
    expect(model.calls[0]?.tools.map((tool) => tool.name).sort()).toEqual(
      host.tools.map((tool) => tool.name).sort(),
    );
  });

  it('stops at the iteration cap instead of looping forever', async () => {
    const model = createFakeModelClient(
      Array.from({ length: 10 }, () => ({
        toolUses: [{ id: 'tu', name: 'plant_details', input: { plant: 'perenual:1852' } }],
      })),
    );

    const events = await collect(
      runChat({
        model,
        host: await realHost(),
        messages: [{ role: 'user', content: ask }],
        maxIterations: 3,
      }),
    );

    expect(model.calls).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'iteration_limit' });
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const model = createFakeModelClient([
      { toolUses: [{ id: 'tu_1', name: 'plant_details', input: { plant: 'perenual:1852' } }] },
      { text: 'never reached' },
    ]);

    const events: ChatEvent[] = [];
    for await (const event of runChat({
      model,
      host: await realHost(),
      messages: [{ role: 'user', content: ask }],
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === 'tool_result') {
        controller.abort();
      }
    }

    expect(model.calls).toHaveLength(1);
    expect(events.at(-1)?.type).not.toBe('text');
  });

  it('carries prior conversation turns into the request', async () => {
    const model = createFakeModelClient([{ text: 'ok' }]);

    await collect(
      runChat({
        model,
        host: await realHost(),
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ],
      }),
    );

    expect(model.calls[0]?.messages).toHaveLength(3);
    expect(model.calls[0]?.messages[1]?.role).toBe('assistant');
  });
});
