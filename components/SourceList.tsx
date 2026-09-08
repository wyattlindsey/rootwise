import type { ToolTraceEntry } from '@/lib/chat/reducer';

interface SourceRef {
  name: string;
  url: string;
  license: string;
}

function isSource(value: unknown): value is SourceRef {
  const source = value as SourceRef | null;
  return (
    typeof source === 'object' &&
    source !== null &&
    typeof source.name === 'string' &&
    typeof source.url === 'string'
  );
}

/** Pulls `sources` out of whatever the tools returned, de-duplicated by name. */
export function collectSources(tools: ToolTraceEntry[]): SourceRef[] {
  const byName = new Map<string, SourceRef>();

  for (const tool of tools) {
    const sources = (tool.result as { sources?: unknown } | null)?.sources;
    if (!Array.isArray(sources)) {
      continue;
    }
    for (const source of sources.filter(isSource)) {
      byName.set(source.name, source);
    }
  }

  return [...byName.values()];
}

/** Pulls every `caveats` array out of the tool results. */
export function collectCaveats(tools: ToolTraceEntry[]): string[] {
  const seen = new Set<string>();

  for (const tool of tools) {
    const caveats = (tool.result as { caveats?: unknown } | null)?.caveats;
    if (Array.isArray(caveats)) {
      for (const caveat of caveats) {
        if (typeof caveat === 'string') {
          seen.add(caveat);
        }
      }
    }
  }

  return [...seen];
}

export function SourceList({ tools }: { tools: ToolTraceEntry[] }): React.JSX.Element | null {
  const sources = collectSources(tools);
  if (sources.length === 0) {
    return null;
  }

  return (
    <section aria-label="Sources" className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
      <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60">Sources</h3>
      <ul className="mt-1 space-y-1 text-xs">
        {sources.map((source) => (
          <li key={source.name}>
            <a
              className="underline underline-offset-2 hover:no-underline"
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {source.name}
            </a>
            {source.license === '' ? null : <span className="opacity-60"> — {source.license}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
