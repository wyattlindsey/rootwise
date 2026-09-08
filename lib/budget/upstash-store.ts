import type { BudgetStore } from './store';

export interface UpstashConfig {
  url: string;
  token: string;
}

/**
 * Upstash over its REST API using plain fetch.
 *
 * A Redis client would work too, but this needs two commands and the REST API
 * is a URL and a bearer token -- not worth a dependency in a serverless bundle.
 */
export class UpstashBudgetStore implements BudgetStore {
  readonly #config: UpstashConfig;
  readonly #fetch: typeof fetch;

  constructor(config: UpstashConfig, fetchFn: typeof fetch = fetch) {
    this.#config = { ...config, url: config.url.replace(/\/+$/, '') };
    this.#fetch = fetchFn;
  }

  async incrementBy(key: string, amount: number, ttlSeconds: number): Promise<number> {
    const value = await this.#command(`incrby/${encodeURIComponent(key)}/${String(amount)}`);
    // Keys carry their own window stamp (see budget.ts), so a fresh window is
    // a fresh key and the expiry is only housekeeping. That removes the usual
    // hazard here: a conditional expiry that silently fails would leave a key
    // with no TTL, and a counter that never resets locks a visitor out for good.
    await this.#command(`expire/${encodeURIComponent(key)}/${String(ttlSeconds)}`);
    return value ?? 0;
  }

  async get(key: string): Promise<number> {
    return (await this.#command(`get/${encodeURIComponent(key)}`)) ?? 0;
  }

  async #command(path: string): Promise<number | null> {
    try {
      const response = await this.#fetch(`${this.#config.url}/${path}`, {
        headers: { Authorization: `Bearer ${this.#config.token}` },
      });

      if (!response.ok) {
        return null;
      }

      const body = (await response.json()) as { result?: unknown };
      const value = Number(body.result);
      return Number.isFinite(value) ? value : null;
    } catch {
      // A budget store that cannot be reached must not take the site down. It
      // fails open, which is the deliberate trade: a brief window of
      // unmetered traffic beats a demo that is simply broken.
      return null;
    }
  }
}
