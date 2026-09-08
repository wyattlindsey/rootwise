/**
 * Manual smoke check against the real Upstash database.
 *
 * Asserts the property that matters on serverless: two independently
 * constructed stores must see each other's writes. A memory fallback would
 * pass every single-instance check and still fail this one -- which is exactly
 * how a spend cap silently stops capping.
 */
import { readFileSync } from 'node:fs';

import { createBudget } from '../lib/budget/budget.ts';
import { createBudgetStore } from '../lib/budget/store.ts';

const env: Record<string, string> = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)="?([^"]*)"?$/.exec(line.trim());
  if (match?.[1] !== undefined) env[match[1]] = match[2] ?? '';
}

// Two stores, as two serverless instances would be.
const instanceA = createBudgetStore(env);
const instanceB = createBudgetStore(env);

const probe = `rootwise:smoke:${Date.now()}`;
await instanceA.incrementBy(probe, 7, 60);
const seenByB = await instanceB.get(probe);

console.log('instance A wrote 7, instance B reads:', seenByB);
console.log(seenByB === 7 ? 'SHARED ✓ — the cap will actually hold' : 'NOT SHARED ✗ — still on memory');

await instanceB.incrementBy(probe, 5, 60);
console.log('after B adds 5, A reads:', await instanceA.get(probe), '(expect 12)');
console.log('unknown key:', await instanceA.get(`${probe}:missing`), '(expect 0)');

const budget = createBudget({ store: instanceA, limits: { dailyCostCents: 100 } });
console.log('spent today:', await budget.spentToday(), 'cents');
console.log('check:', JSON.stringify(await budget.check({ ip: 'smoke-test' })));
