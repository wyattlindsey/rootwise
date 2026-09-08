import { MemoryBudgetStore } from './memory-store';
import { UpstashBudgetStore } from './upstash-store';

/**
 * A counter with an expiry window. Small on purpose: both a process-local map
 * and Upstash's REST API can satisfy it, so the app needs no Redis client
 * dependency and no service at all in development.
 */
export interface BudgetStore {
  incrementBy(key: string, amount: number, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
}

export type BudgetEnv = Record<string, string | undefined>;

/**
 * Memory is a real fallback, not a stub -- but it only holds within one
 * process. On serverless, where instances come and go, a shared store is what
 * makes the daily ceiling mean anything.
 */
export function createBudgetStore(env: BudgetEnv): BudgetStore {
  // Vercel's Upstash marketplace integration injects KV_REST_API_* names,
  // while a database created directly at upstash.com gives UPSTASH_*. Accept
  // either so provisioning either way just works.
  const url = (env['UPSTASH_REDIS_REST_URL'] ?? env['KV_REST_API_URL'])?.trim();
  const token = (env['UPSTASH_REDIS_REST_TOKEN'] ?? env['KV_REST_API_TOKEN'])?.trim();

  return url !== undefined && url !== '' && token !== undefined && token !== ''
    ? new UpstashBudgetStore({ url, token })
    : new MemoryBudgetStore();
}
