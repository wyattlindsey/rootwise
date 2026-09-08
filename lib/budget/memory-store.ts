import type { BudgetStore } from './store';

interface Entry {
  value: number;
  expiresAt: number;
}

/** Process-local counters. Enough for development and CI; not shared across instances. */
export class MemoryBudgetStore implements BudgetStore {
  readonly #entries = new Map<string, Entry>();
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  async incrementBy(key: string, amount: number, ttlSeconds: number): Promise<number> {
    const live = this.#live(key);
    const value = (live?.value ?? 0) + amount;

    this.#entries.set(key, {
      value,
      // An existing window keeps its original expiry; a new one starts now.
      expiresAt: live?.expiresAt ?? this.#now() + ttlSeconds * 1000,
    });

    return value;
  }

  async get(key: string): Promise<number> {
    return this.#live(key)?.value ?? 0;
  }

  /** Exposed so tests can assert no credential ever reaches a key. */
  keys(): Iterable<string> {
    return this.#entries.keys();
  }

  #live(key: string): Entry | null {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return null;
    }
    return entry;
  }
}
