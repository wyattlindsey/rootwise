import { costCents } from './pricing';
import type { BudgetStore } from './store';

export interface BudgetLimits {
  /** Questions one visitor may ask per hour on the shared key. */
  requestsPerIpPerHour: number;
  /**
   * What the shared key may spend per UTC day, in cents.
   *
   * Denominated in money rather than tokens because a turn that calls two
   * tools sends their JSON results back as input on the next request, so input
   * is usually the larger half of the bill. A token cap that counted only
   * output would leave most of the spend unmetered.
   */
  dailyCostCents: number;
};

export const DEFAULT_LIMITS: BudgetLimits = {
  requestsPerIpPerHour: 10,
  // A deliberately small default: this is a portfolio demo, not a service.
  dailyCostCents: 100,
};

export interface BudgetRequest {
  ip: string;
  /** True when the visitor supplied their own API key. */
  hasOwnKey?: boolean;
}

export interface BudgetDecision {
  allowed: boolean;
  code?: 'rate_limited' | 'budget_exhausted';
  message?: string;
  remedy?: string;
}

export interface Budget {
  check(request: BudgetRequest): Promise<BudgetDecision>;
  recordUsage(usage: { inputTokens: number; outputTokens: number }): Promise<void>;
  /** Cents spent so far today, for diagnostics. */
  spentToday(): Promise<number>;
}

export interface CreateBudgetOptions {
  store: BudgetStore;
  limits?: Partial<BudgetLimits>;
  now?: () => Date;
}

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86_400;

/**
 * Keys carry the window they belong to, so a new hour or day is simply a new
 * key. Expiry then only reclaims space, and no counter can outlive its window
 * and lock someone out.
 */
function hourKey(ip: string, at: Date): string {
  return `ip:${ip}:${at.toISOString().slice(0, 13)}`;
}

function dayKey(at: Date): string {
  return `cost:${at.toISOString().slice(0, 10)}`;
}

/**
 * Guards a public AI endpoint two ways: no one visitor may monopolise it, and
 * the shared key has a daily ceiling that cannot be exceeded no matter how the
 * traffic arrives.
 *
 * Exhaustion is not the end of the demo. A visitor can supply their own key and
 * continue, which is why `check` reports a remedy rather than a bare refusal.
 */
export function createBudget(options: CreateBudgetOptions): Budget {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const now = options.now ?? (() => new Date());
  const { store } = options;

  return {
    async check(request) {
      // Their key, their spend. Nothing is counted and nothing is refused --
      // and the key itself never becomes part of a store key.
      if (request.hasOwnKey === true) {
        return { allowed: true };
      }

      const at = now();

      const spent = await store.get(dayKey(at));
      if (spent >= limits.dailyCostCents) {
        return {
          allowed: false,
          code: 'budget_exhausted',
          message: "Today's shared demo budget is spent.",
          remedy:
            'It resets at 00:00 UTC. To keep going now, add your own Anthropic API key -- it is ' +
            'used for your requests only and is never stored.',
        };
      }

      const asked = await store.incrementBy(hourKey(request.ip, at), 1, HOUR_SECONDS);
      if (asked > limits.requestsPerIpPerHour) {
        return {
          allowed: false,
          code: 'rate_limited',
          message: `That is ${String(limits.requestsPerIpPerHour)} questions this hour, which is the limit on the shared key.`,
          remedy:
            'Try again next hour, or add your own Anthropic API key to continue immediately.',
        };
      }

      return { allowed: true };
    },

    async recordUsage(usage) {
      const cents = costCents(usage.inputTokens, usage.outputTokens);
      if (cents > 0) {
        await store.incrementBy(dayKey(now()), cents, DAY_SECONDS);
      }
    },

    async spentToday() {
      return store.get(dayKey(now()));
    },
  };
}
