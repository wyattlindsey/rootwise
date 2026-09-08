import { describe, expect, it } from 'vitest';

import type { ChatAction, ChatState } from '@/lib/chat/reducer';
import { chatReducer, initialChatState } from '@/lib/chat/reducer';

function apply(state: ChatState, ...actions: ChatAction[]): ChatState {
  return actions.reduce(chatReducer, state);
}

const send: ChatAction = { type: 'send', text: 'Tomatoes?', id: 'u1', assistantId: 'a1' };

describe('chatReducer', () => {
  it('adds the question and an empty answer to stream into', () => {
    const state = apply(initialChatState, send);

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: 'user', content: 'Tomatoes?' });
    expect(state.messages[1]).toMatchObject({ role: 'assistant', content: '' });
    expect(state.status).toBe('streaming');
  });

  it('accumulates text fragments into one answer', () => {
    const state = apply(
      initialChatState,
      send,
      { type: 'event', event: { type: 'text', text: 'Keep ' } },
      { type: 'event', event: { type: 'text', text: 'them apart.' } },
    );

    expect(state.messages[1]?.content).toBe('Keep them apart.');
  });

  it('shows a tool as running before its result arrives', () => {
    const state = apply(initialChatState, send, {
      type: 'event',
      event: { type: 'tool_call', id: 't1', name: 'companion_check', input: { a: 1 } },
    });

    expect(state.messages[1]?.tools).toEqual([
      { id: 't1', name: 'companion_check', input: { a: 1 }, status: 'running' },
    ]);
  });

  it('resolves the matching tool when its result arrives', () => {
    const state = apply(
      initialChatState,
      send,
      { type: 'event', event: { type: 'tool_call', id: 't1', name: 'companion_check', input: {} } },
      { type: 'event', event: { type: 'tool_call', id: 't2', name: 'planting_window', input: {} } },
      {
        type: 'event',
        event: { type: 'tool_result', id: 't2', name: 'planting_window', ok: true, result: { z: 1 } },
      },
    );

    expect(state.messages[1]?.tools[0]?.status).toBe('running');
    expect(state.messages[1]?.tools[1]).toMatchObject({ status: 'ok', result: { z: 1 } });
  });

  it('marks a failed tool as failed rather than dropping it', () => {
    const state = apply(
      initialChatState,
      send,
      { type: 'event', event: { type: 'tool_call', id: 't1', name: 'plant_details', input: {} } },
      {
        type: 'event',
        event: { type: 'tool_result', id: 't1', name: 'plant_details', ok: false, result: 'boom' },
      },
    );

    expect(state.messages[1]?.tools[0]).toMatchObject({ status: 'failed', result: 'boom' });
  });

  it('returns to idle when the turn is done', () => {
    const state = apply(initialChatState, send, { type: 'event', event: { type: 'done' } });

    expect(state.status).toBe('idle');
  });

  it('attaches an ordinary failure to the answer it belongs to', () => {
    const state = apply(initialChatState, send, {
      type: 'event',
      event: { type: 'error', code: 'model_error', message: 'overloaded' },
    });

    expect(state.messages[1]?.error).toMatchObject({ message: 'overloaded' });
    expect(state.blocked).toBeNull();
    expect(state.status).toBe('idle');
  });

  it.each(['budget_exhausted', 'rate_limited'])(
    'hoists a %s refusal so the UI can offer a way to continue',
    (code) => {
      const state = apply(initialChatState, send, {
        type: 'event',
        event: { type: 'error', code, message: 'no more', remedy: 'add your own key' },
      });

      expect(state.blocked).toMatchObject({ code, remedy: 'add your own key' });
    },
  );

  it('drops the empty answer bubble when the request was refused outright', () => {
    const state = apply(initialChatState, send, {
      type: 'event',
      event: { type: 'error', code: 'rate_limited', message: 'slow down' },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.role).toBe('user');
  });

  it('keeps a partial answer when the refusal arrives mid-stream', () => {
    const state = apply(
      initialChatState,
      send,
      { type: 'event', event: { type: 'text', text: 'partial' } },
      { type: 'event', event: { type: 'error', code: 'rate_limited', message: 'slow down' } },
    );

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.content).toBe('partial');
  });

  it('clears a previous block when a new question is asked', () => {
    const blocked = apply(initialChatState, send, {
      type: 'event',
      event: { type: 'error', code: 'rate_limited', message: 'slow down' },
    });

    expect(chatReducer(blocked, { ...send, id: 'u2', assistantId: 'a2' }).blocked).toBeNull();
  });

  it('surfaces a dropped connection as an error on the answer', () => {
    const state = apply(initialChatState, send, {
      type: 'stream_failed',
      message: 'connection lost',
    });

    expect(state.messages[1]?.error?.message).toBe('connection lost');
    expect(state.status).toBe('idle');
  });
});
