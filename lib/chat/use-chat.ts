'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { readChatEvents } from './events';
import { chatReducer, initialChatState, type ChatState } from './reducer';
import type { PromptLocation } from './system-prompt';

export interface UseChat {
  state: ChatState;
  location: PromptLocation | null;
  setLocation: (location: PromptLocation | null) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
}

export function useChat(): UseChat {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [location, setLocation] = useState<PromptLocation | null>(null);
  const [apiKey, setApiKey] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  // The reducer owns render state, but the request needs the history, key, and
  // location as they stand at send time. Mirroring them into refs keeps `send`
  // stable instead of re-created on every keystroke. Synced in an effect
  // rather than during render, which React forbids.
  const stateRef = useRef(state);
  const keyRef = useRef(apiKey);
  const locationRef = useRef(location);

  useEffect(() => {
    stateRef.current = state;
    keyRef.current = apiKey;
    locationRef.current = location;
  }, [state, apiKey, location]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed === '' || stateRef.current.status === 'streaming') {
      return;
    }

    const history = stateRef.current.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    dispatch({
      type: 'send',
      text: trimmed,
      id: crypto.randomUUID(),
      assistantId: crypto.randomUUID(),
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Sent per request and never persisted anywhere.
          ...(keyRef.current.trim() === '' ? {} : { 'x-anthropic-key': keyRef.current.trim() }),
        },
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: trimmed }],
          location: locationRef.current,
        }),
        signal: controller.signal,
      });

      if (response.body === null) {
        dispatch({ type: 'stream_failed', message: 'The server sent an empty response.' });
        return;
      }

      for await (const event of readChatEvents(response.body)) {
        dispatch({ type: 'event', event });
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      dispatch({
        type: 'stream_failed',
        message: error instanceof Error ? error.message : 'The connection dropped.',
      });
    } finally {
      abortRef.current = null;
    }
  }, []);

  return { state, location, setLocation, apiKey, setApiKey, send, stop };
}
