import { describe, expect, it, vi } from 'vitest';

import { createBudget } from '@/lib/budget/budget';
import { MemoryBudgetStore } from '@/lib/budget/memory-store';
import { createBudgetStore } from '@/lib/budget/store';
import { UpstashBudgetStore } from '@/lib/budget/upstash-store';

function budgetAt(clock: { value: Date }, limits = {}) {
  return createBudget({
    store: new MemoryBudgetStore(() => clock.value.getTime()),
    limits: { requestsPerIpPerHour: 3, dailyCostCents: 100, ...limits },
    now: () => clock.value,
  });
}

describe('MemoryBudgetStore', () => {
  it('accumulates increments', async () => {
    const store = new MemoryBudgetStore(() => 0);

    expect(await store.incrementBy('k', 5, 60)).toBe(5);
    expect(await store.incrementBy('k', 3, 60)).toBe(8);
  });

  it('forgets a key once its window has passed', async () => {
    let now = 0;
    const store = new MemoryBudgetStore(() => now);
    await store.incrementBy('k', 5, 60);

    now = 61_000;

    expect(await store.get('k')).toBe(0);
  });

  it('reports zero for a key it has never seen', async () => {
    expect(await new MemoryBudgetStore(() => 0).get('missing')).toBe(0);
  });
});

describe('createBudget', () => {
  it('allows a request under both limits', async () => {
    const clock = { value: new Date('2026-09-08T10:00:00Z') };

    await expect(budgetAt(clock).check({ ip: '1.2.3.4' })).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('blocks an IP past its hourly allowance', async () => {
    const clock = { value: new Date('2026-09-08T10:00:00Z') };
    const budget = budgetAt(clock);

    await budget.check({ ip: '1.2.3.4' });
    await budget.check({ ip: '1.2.3.4' });
    await budget.check({ ip: '1.2.3.4' });

    await expect(budget.check({ ip: '1.2.3.4' })).resolves.toMatchObject({
      allowed: false,
      code: 'rate_limited',
    });
  });

  it('counts each visitor separately', async () => {
    const clock = { value: new Date('2026-09-08T10:00:00Z') };
    const budget = budgetAt(clock);

    await budget.check({ ip: '1.1.1.1' });
    await budget.check({ ip: '1.1.1.1' });
    await budget.check({ ip: '1.1.1.1' });

    await expect(budget.check({ ip: '2.2.2.2' })).resolves.toMatchObject({ allowed: true });
  });

  it('blocks everyone once the shared daily spend ceiling is reached', async () => {
    const clock = { value: new Date('2026-09-08T10:00:00Z') };
    const budget = budgetAt(clock);

    await budget.recordUsage({ inputTokens: 0, outputTokens: 8_000_000 });

    const decision = await budget.check({ ip: '9.9.9.9' });
    expect(decision).toMatchObject({ allowed: false, code: 'budget_exhausted' });
    expect(decision.remedy).toMatch(/own .*key/i);
  });

  it('releases the daily ceiling on the next UTC day', async () => {
    const clock = { value: new Date('2026-09-08T23:00:00Z') };
    const budget = budgetAt(clock);
    await budget.recordUsage({ inputTokens: 0, outputTokens: 8_000_000 });

    expect(await budget.check({ ip: '9.9.9.9' })).toMatchObject({ allowed: false });

    clock.value = new Date('2026-09-09T00:05:00Z');

    expect(await budget.check({ ip: '9.9.9.9' })).toMatchObject({ allowed: true });
  });

  it('lets a visitor with their own key past both limits', async () => {
    const clock = { value: new Date('2026-09-08T10:00:00Z') };
    const budget = budgetAt(clock);
    await budget.recordUsage({ inputTokens: 0, outputTokens: 8_000_000 });

    await expect(
      budget.check({ ip: '9.9.9.9', hasOwnKey: true }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('does not spend the shared budget on a visitor using their own key', async () => {
    const clock = { value: new Date('2026-09-08T10:00:00Z') };
    const budget = budgetAt(clock);

    await budget.check({ ip: '1.2.3.4', hasOwnKey: true });
    await budget.check({ ip: '1.2.3.4', hasOwnKey: true });
    await budget.check({ ip: '1.2.3.4', hasOwnKey: true });
    await budget.check({ ip: '1.2.3.4', hasOwnKey: true });

    await expect(budget.check({ ip: '1.2.3.4' })).resolves.toMatchObject({ allowed: true });
  });

  it('never puts the visitor key itself into a store key', async () => {
    const clock = { value: new Date('2026-09-08T10:00:00Z') };
    const store = new MemoryBudgetStore(() => clock.value.getTime());
    const budget = createBudget({ store, limits: { requestsPerIpPerHour: 3 }, now: () => clock.value });

    await budget.check({ ip: '1.2.3.4', hasOwnKey: true });

    expect(JSON.stringify([...store.keys()])).not.toContain('sk-');
  });
});

describe('UpstashBudgetStore', () => {
  it('increments through the REST API and sets the window', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ result: 7 }), { status: 200 }),
    );
    const store = new UpstashBudgetStore(
      { url: 'https://db.upstash.io', token: 'tok' },
      fetchFn as unknown as typeof fetch,
    );

    await expect(store.incrementBy('ip:1.2.3.4', 1, 3600)).resolves.toBe(7);

    const [incrUrl, incrInit] = fetchFn.mock.calls[0]!;
    expect(incrUrl).toContain('/incrby/ip%3A1.2.3.4/1');
    expect((incrInit?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(fetchFn.mock.calls[1]![0]).toContain('/expire/ip%3A1.2.3.4/3600');
  });

  it('treats an unreachable store as zero rather than failing the request', async () => {
    const store = new UpstashBudgetStore(
      { url: 'https://db.upstash.io', token: 'tok' },
      (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    );

    await expect(store.get('k')).resolves.toBe(0);
  });
});

describe('createBudgetStore', () => {
  it('uses memory when Upstash is not configured, so local dev needs no service', () => {
    expect(createBudgetStore({})).toBeInstanceOf(MemoryBudgetStore);
  });

  it('uses Upstash when both variables are present', () => {
    expect(
      createBudgetStore({
        UPSTASH_REDIS_REST_URL: 'https://db.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'tok',
      }),
    ).toBeInstanceOf(UpstashBudgetStore);
  });

  it('falls back to memory when only half the credential is set', () => {
    expect(createBudgetStore({ UPSTASH_REDIS_REST_URL: 'https://db.upstash.io' })).toBeInstanceOf(
      MemoryBudgetStore,
    );
  });
});

describe('cost accounting', () => {
  it('charges for input as well as output', async () => {
    const { costCents } = await import('@/lib/budget/pricing');

    // A tool-heavy turn is mostly input: 40k in, 800 out.
    expect(costCents(40_000, 800)).toBeGreaterThan(costCents(0, 800));
  });

  it('prices input as the dominant half of a tool-heavy turn', async () => {
    const { costCents } = await import('@/lib/budget/pricing');

    // 40k in / 800 out is 20 cents of input against 2 of output. Metering
    // output alone would have missed roughly nine tenths of the bill.
    expect(costCents(40_000, 0)).toBe(20);
    expect(costCents(0, 800)).toBe(2);
    expect(costCents(40_000, 800)).toBe(22);
  });

  it('never rounds a real cost down to free', async () => {
    const { costCents } = await import('@/lib/budget/pricing');

    expect(costCents(1, 1)).toBe(1);
    expect(costCents(0, 0)).toBe(0);
  });

  it('counts input toward the daily ceiling', async () => {
    const clock = { value: new Date('2026-09-08T10:00:00Z') };
    const budget = budgetAt(clock, { dailyCostCents: 5 });

    // 2M input tokens is $10 -- far past a 5-cent ceiling, with zero output.
    await budget.recordUsage({ inputTokens: 2_000_000, outputTokens: 0 });

    await expect(budget.check({ ip: '1.2.3.4' })).resolves.toMatchObject({
      allowed: false,
      code: 'budget_exhausted',
    });
  });
});

describe('createBudgetStore naming', () => {
  it('accepts the KV_REST_API_* names that Vercel injects', () => {
    expect(
      createBudgetStore({ KV_REST_API_URL: 'https://db.upstash.io', KV_REST_API_TOKEN: 'tok' }),
    ).toBeInstanceOf(UpstashBudgetStore);
  });
});
