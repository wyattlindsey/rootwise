'use client';

import { useEffect, useRef, useState } from 'react';

import { useChat } from '@/lib/chat/use-chat';

import { LocationPicker } from './LocationPicker';
import { MessageBubble } from './MessageBubble';

const SUGGESTIONS = [
  'Can I plant tomatoes next to potatoes, and when should I start them?',
  'Is lavender toxic to cats?',
  'How long is my growing season?',
];

export function ChatView({ demoMode = false }: { demoMode?: boolean }): React.JSX.Element {
  const { state, location, setLocation, apiKey, setApiKey, send, stop } = useChat();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const streaming = state.status === 'streaming';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);

  async function submit(text: string): Promise<void> {
    setDraft('');
    await send(text);
  }

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col px-4">
      <header className="py-4">
        <h1 className="text-xl font-semibold">rootwise</h1>
        <p className="text-sm opacity-70">
          Gardening answers grounded in real horticultural data. Every tool call and source is
          shown, and it will tell you when the data does not exist.
        </p>
        {demoMode ? (
          <p
            role="status"
            className="mt-2 rounded-lg border border-sky-500/40 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-200"
          >
            <strong className="font-semibold">Demo mode.</strong> This deployment replays one
            recorded conversation against fixture data, so every question returns the same answer.
            The tool calls, sources, and caveats below are real output from the MCP server — only
            the model is scripted.
          </p>
        ) : null}

        <div className="mt-2">
          <LocationPicker location={location} onChange={setLocation} />
        </div>
      </header>

      <div
        className="flex-1 space-y-4 overflow-y-auto pb-4"
        aria-live="polite"
        aria-busy={streaming}
      >
        {state.messages.length === 0 ? (
          <div className="space-y-2 pt-8">
            <p className="text-sm opacity-70">Try one of these:</p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void submit(suggestion)}
                className="block w-full rounded-lg border border-black/10 px-3 py-2 text-left text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {state.messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            streaming={streaming && index === state.messages.length - 1}
          />
        ))}

        {state.blocked === null ? null : (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <p className="font-medium">{state.blocked.message}</p>
            {state.blocked.remedy === undefined ? null : <p>{state.blocked.remedy}</p>}
            <label className="block">
              <span className="sr-only">Your Anthropic API key</span>
              <input
                type="password"
                aria-label="Your Anthropic API key"
                placeholder="sk-ant-…"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                }}
                className="w-full rounded border border-amber-600/40 bg-white/70 px-2 py-1 font-mono text-xs dark:bg-black/30"
              />
            </label>
            <p className="text-xs opacity-70">
              Used for your requests only, kept in this tab, never stored or logged.
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        className="flex gap-2 border-t border-black/10 py-3 dark:border-white/10"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft);
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Ask about a plant</span>
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            placeholder="Ask about a plant…"
            aria-label="Ask about a plant"
            className="w-full rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
          />
        </label>

        {streaming ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-lg border border-black/15 px-4 py-2 text-sm dark:border-white/20"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={draft.trim() === ''}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Ask
          </button>
        )}
      </form>
    </div>
  );
}
