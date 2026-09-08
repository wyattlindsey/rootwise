import type { UiMessage } from '@/lib/chat/reducer';

import { SourceList, collectCaveats } from './SourceList';
import { ToolTrace } from './ToolTrace';

export function MessageBubble({
  message,
  streaming,
}: {
  message: UiMessage;
  streaming: boolean;
}): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-2 text-white">
          {message.content}
        </p>
      </div>
    );
  }

  const caveats = collectCaveats(message.tools);

  return (
    <div className="max-w-[95%] space-y-2">
      {message.tools.length > 0 ? (
        <section className="space-y-1.5" aria-label="Tools used">
          {message.tools.map((tool) => (
            <ToolTrace key={tool.id} tool={tool} />
          ))}
        </section>
      ) : null}

      {message.content === '' && streaming && message.tools.length === 0 ? (
        <p className="text-sm opacity-60">Thinking…</p>
      ) : null}

      {message.content === '' ? null : (
        <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-black/5 px-4 py-3 dark:bg-white/10">
          {message.content}
          {streaming ? <span className="ml-0.5 animate-pulse" aria-hidden="true">▍</span> : null}
        </div>
      )}

      {caveats.length > 0 ? (
        <section
          aria-label="Caveats"
          className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <h3 className="font-semibold uppercase tracking-wide opacity-70">What to keep in mind</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {message.error === undefined ? null : (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200"
        >
          {message.error.message}
          {message.error.remedy === undefined ? null : (
            <span className="block opacity-80">{message.error.remedy}</span>
          )}
        </p>
      )}

      <SourceList tools={message.tools} />
    </div>
  );
}
