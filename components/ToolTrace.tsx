'use client';

import { useState } from 'react';

import type { ToolTraceEntry } from '@/lib/chat/reducer';

const STATUS_LABEL: Record<ToolTraceEntry['status'], string> = {
  running: 'running',
  ok: 'returned',
  failed: 'failed',
};

const STATUS_STYLE: Record<ToolTraceEntry['status'], string> = {
  running: 'border-amber-400/60 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  ok: 'border-emerald-500/50 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  failed: 'border-red-500/50 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200',
};

/**
 * One tool call, shown as it happens.
 *
 * This is the component that separates the app from a chat wrapper: the
 * visitor sees which tool ran, what it was asked, and exactly what came back.
 */
export function ToolTrace({ tool }: { tool: ToolTraceEntry }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const hasResult = tool.status !== 'running';

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${STATUS_STYLE[tool.status]}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left font-mono text-xs"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        disabled={!hasResult}
      >
        <span aria-hidden="true">{hasResult ? (open ? '▾' : '▸') : '⋯'}</span>
        <span className="font-semibold">{tool.name}</span>
        <span className="opacity-70">{STATUS_LABEL[tool.status]}</span>
      </button>

      <p className="mt-1 truncate font-mono text-xs opacity-70" title={JSON.stringify(tool.input)}>
        {JSON.stringify(tool.input)}
      </p>

      {open && hasResult ? (
        <pre className="mt-2 max-h-72 overflow-auto rounded bg-black/5 p-2 font-mono text-[11px] leading-relaxed dark:bg-black/30">
          {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
