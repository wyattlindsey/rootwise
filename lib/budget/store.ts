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
  const url = env['UPSTASH_REDIS_REST_URL']?.trim();
  const token = env['UPSTASH_REDIS_REST_TOKEN']?.trim();

  return url !== undefined && url !== '' && token !== undefined && token !== ''
    ? new UpstashBudgetStore({ url, token })
    : new MemoryBudgetStore();
}
