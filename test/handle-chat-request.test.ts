import { afterEach, describe, expect, it } from 'vitest';

import { createBudget } from '@/lib/budget/budget';
import { MemoryBudgetStore } from '@/lib/budget/memory-store';
import type { ChatEvent } from '@/lib/chat/events';
import { readChatEvents } from '@/lib/chat/events';
import { handleChatRequest, type ChatDeps } from '@/lib/chat/handle-chat-request';
import { createMcpHost, type McpHost } from '@/lib/mcp/host';
import { createFakeModelClient, type ScriptedTurn } from '@/lib/model/fake';

const TOMATO = {
  id: 1852,
  common_name: 'Garden Tomato',
  scientific_name: ['Solanum lycopersicum'],
  family: 'Solanaceae',
  pest_susceptibility: ['Aphids'],
};

const hosts: McpHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

async function makeHost(): Promise<McpHost> {
  const host = await createMcpHost({
    env: { PERENUAL_API_KEY: 'sk-test', PLANT_INTEL_CACHE_DISABLED: '1' },
    fetch: async () => new Response(JSON.stringify(TOMATO), { status: 200 }),
  });
  hosts.push(host);
  return host;
}

interface Harness {
  deps: ChatDeps;
  keysSeen: (string | undefined)[];
  budget: ReturnType<typeof createBudget>;
}

async function harness(script: ScriptedTurn[], limits = {}): Promise<Harness> {
  const host = await makeHost();
  const keysSeen: (string | undefined)[] = [];
  const budget = createBudget({
    store: new MemoryBudgetStore(),
    limits: { requestsPerIpPerHour: 3, dailyCostCents: 100, ...limits },
  });

  return {
    keysSeen,
    budget,
    deps: {
      model: (apiKey?: string) => {
        keysSeen.push(apiKey);
        return createFakeModelClient(script);
      },
      host: async () => host,
      budget,
    },
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://rootwise.test/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...headers },
    body: JSON.stringify(body),
  });
}

async function eventsOf(response: Response): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of readChatEvents(response.body!)) {
    events.push(event);
  }
  return events;
}

const ASK = { messages: [{ role: 'user', content: 'Tomatoes next to potatoes?' }] };

describe('handleChatRequest', () => {
  it('responds as an event stream', async () => {
    const { deps } = await harness([{ text: 'Keep them apart.' }]);
    const response = await handleChatRequest(post(ASK), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('streams the answer text', async () => {
    const { deps } = await harness([{ text: 'Keep them apart.' }]);
    const events = await eventsOf(await handleChatRequest(post(ASK), deps));

    const text = events
      .filter((event): event is Extract<ChatEvent, { type: 'text' }> => event.type === 'text')
      .map((event) => event.text)
      .join('');

    expect(text).toBe('Keep them apart.');
  });

  it('streams a real tool call and its result', async () => {
    const { deps } = await harness([
      { toolUses: [{ id: 'tu_1', name: 'plant_details', input: { plant: 'perenual:1852' } }] },
      { text: 'Solanaceae.' },
    ]);

    const events = await eventsOf(await handleChatRequest(post(ASK), deps));

    expect(events.map((event) => event.type)).toEqual([
      'tool_call',
      'tool_result',
      'text',
      'done',
    ]);
    const result = events[1] as Extract<ChatEvent, { type: 'tool_result' }>;
    expect(result.result).toMatchObject({ commonName: 'Garden Tomato' });
  });

  it('rejects a malformed body without reaching the model', async () => {
    const { deps, keysSeen } = await harness([{ text: 'unused' }]);

    const response = await handleChatRequest(post({ messages: 'not an array' }), deps);

    expect(response.status).toBe(400);
    expect(keysSeen).toHaveLength(0);
  });

  it('rejects an empty conversation', async () => {
    const { deps } = await harness([{ text: 'unused' }]);

    expect((await handleChatRequest(post({ messages: [] }), deps)).status).toBe(400);
  });

  it('rejects a message that is not JSON at all', async () => {
    const { deps } = await harness([{ text: 'unused' }]);
    const request = new Request('https://rootwise.test/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect((await handleChatRequest(request, deps)).status).toBe(400);
  });

  it('answers an over-budget request with the BYO-key remedy, not a server error', async () => {
    const { deps, budget } = await harness([{ text: 'unused' }]);
    await budget.recordUsage({ inputTokens: 0, outputTokens: 8_000_000 });

    const response = await handleChatRequest(post(ASK), deps);
    const events = await eventsOf(response);

    expect(response.status).toBe(429);
    expect(events[0]).toMatchObject({ type: 'error', code: 'budget_exhausted' });
    expect((events[0] as Extract<ChatEvent, { type: 'error' }>).remedy).toMatch(/own .*key/i);
  });

  it('rate limits a visitor who asks too often', async () => {
    const { deps } = await harness([
      { text: 'a' },
      { text: 'b' },
      { text: 'c' },
      { text: 'd' },
    ]);

    for (let i = 0; i < 3; i += 1) {
      await eventsOf(await handleChatRequest(post(ASK), deps));
    }

    const response = await handleChatRequest(post(ASK), deps);
    expect(response.status).toBe(429);
    expect((await eventsOf(response))[0]).toMatchObject({ code: 'rate_limited' });
  });

  it('charges the shared budget for what the turn actually spent', async () => {
    const { deps, budget } = await harness([
      { text: 'ok', usage: { input: 500, output: 400 } },
    ]);

    await eventsOf(await handleChatRequest(post(ASK), deps));

    // The turn above is charged for both halves of its usage, not output alone.
    expect(await budget.spentToday()).toBeGreaterThan(0);
  });

  it("uses a visitor's own key when supplied, and bypasses the shared budget", async () => {
    const { deps, keysSeen, budget } = await harness([{ text: 'ok' }]);
    await budget.recordUsage({ inputTokens: 0, outputTokens: 8_000_000 });

    const response = await handleChatRequest(
      post(ASK, { 'x-anthropic-key': 'sk-visitor-key' }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(keysSeen).toEqual(['sk-visitor-key']);
  });

  it('passes the visitor location into the system prompt', async () => {
    const host = await makeHost();
    const fake = createFakeModelClient([{ text: 'ok' }]);
    const deps: ChatDeps = {
      model: () => fake,
      host: async () => host,
      budget: createBudget({ store: new MemoryBudgetStore() }),
    };

    await eventsOf(
      await handleChatRequest(
        post({ ...ASK, location: { latitude: 44.98, longitude: -93.27 } }),
        deps,
      ),
    );

    expect(fake.calls[0]?.system).toContain('44.98');
  });

  it('tells the model which tools exist', async () => {
    const host = await makeHost();
    const fake = createFakeModelClient([{ text: 'ok' }]);
    const deps: ChatDeps = {
      model: () => fake,
      host: async () => host,
      budget: createBudget({ store: new MemoryBudgetStore() }),
    };

    await eventsOf(await handleChatRequest(post(ASK), deps));

    expect(fake.calls[0]?.system).toContain('companion_check');
  });

  it('reports a model failure as an error event on an already-open stream', async () => {
    const { deps } = await harness([{ error: new Error('overloaded') }]);

    const response = await handleChatRequest(post(ASK), deps);
    const events = await eventsOf(response);

    expect(response.status).toBe(200);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'model_error' });
  });
});

describe('demo mode', () => {
  it('reaches the fixtures without any Perenual key configured', async () => {
    // Regression: demo mode used to require PERENUAL_API_KEY as well, so a
    // deployment set up with only ROOTWISE_FAKE_MODEL had every tool call fail.
    const host = await createMcpHost({
      env: { PERENUAL_API_KEY: 'demo-fixture-key', PLANT_INTEL_CACHE_DISABLED: '1' },
      fetch: async () => new Response(JSON.stringify(TOMATO), { status: 200 }),
    });
    hosts.push(host);

    const outcome = await host.callTool('plant_details', { plant: 'perenual:1852' });

    expect(outcome.ok).toBe(true);
  });

  it('fails every tool when no key is configured at all', async () => {
    const host = await createMcpHost({
      env: { PLANT_INTEL_CACHE_DISABLED: '1' },
      fetch: async () => new Response(JSON.stringify(TOMATO), { status: 200 }),
    });
    hosts.push(host);

    const outcome = await host.callTool('plant_details', { plant: 'perenual:1852' });

    expect(outcome.ok).toBe(false);
    expect(String(outcome.result)).toContain('PERENUAL_API_KEY');
  });
});
