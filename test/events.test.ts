import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@/lib/chat/events';
import { SseDecoder, encodeSseEvent, readChatEvents } from '@/lib/chat/events';

const SAMPLES: ChatEvent[] = [
  { type: 'text', text: 'Tomatoes and potatoes ' },
  { type: 'tool_call', id: 'tu_1', name: 'companion_check', input: { plant_a: 'tomato', plant_b: 'potato' } },
  { type: 'tool_result', id: 'tu_1', name: 'companion_check', ok: true, result: { verdict: 'bad' } },
  { type: 'error', code: 'budget_exhausted', message: 'Daily budget spent.', remedy: 'Use your own key.' },
  { type: 'done', usage: { inputTokens: 10, outputTokens: 20 } },
];

function decodeAll(chunks: string[]): ChatEvent[] {
  const decoder = new SseDecoder();
  return chunks.flatMap((chunk) => decoder.push(chunk));
}

describe('encodeSseEvent / SseDecoder', () => {
  it.each(SAMPLES)('round-trips a $type event', (event) => {
    expect(decodeAll([encodeSseEvent(event)])).toEqual([event]);
  });

  it('decodes several events arriving in one chunk', () => {
    const wire = SAMPLES.map(encodeSseEvent).join('');

    expect(decodeAll([wire])).toEqual(SAMPLES);
  });

  it('holds a partial event until the rest arrives', () => {
    const wire = encodeSseEvent({ type: 'text', text: 'hello world' });
    const split = Math.floor(wire.length / 2);
    const decoder = new SseDecoder();

    expect(decoder.push(wire.slice(0, split))).toEqual([]);
    expect(decoder.push(wire.slice(split))).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('reassembles an event split at every possible byte boundary', () => {
    const wire = encodeSseEvent({ type: 'text', text: 'streamed' });

    for (let cut = 1; cut < wire.length; cut += 1) {
      expect(decodeAll([wire.slice(0, cut), wire.slice(cut)])).toEqual([
        { type: 'text', text: 'streamed' },
      ]);
    }
  });

  it('survives text containing newlines, which would otherwise break framing', () => {
    const event: ChatEvent = { type: 'text', text: 'line one\n\nline two' };

    expect(decodeAll([encodeSseEvent(event)])).toEqual([event]);
  });

  it('ignores keepalive comments', () => {
    expect(decodeAll([': keepalive\n\n', encodeSseEvent({ type: 'text', text: 'a' })])).toEqual([
      { type: 'text', text: 'a' },
    ]);
  });

  it('skips an unparseable frame rather than throwing mid-stream', () => {
    const events = decodeAll(['data: {not json\n\n', encodeSseEvent({ type: 'text', text: 'ok' })]);

    expect(events).toEqual([{ type: 'text', text: 'ok' }]);
  });
});

describe('readChatEvents', () => {
  it('yields events from a ReadableStream of bytes', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of SAMPLES) {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        }
        controller.close();
      },
    });

    const received: ChatEvent[] = [];
    for await (const event of readChatEvents(stream)) {
      received.push(event);
    }

    expect(received).toEqual(SAMPLES);
  });

  it('yields events split across byte chunks', async () => {
    const encoder = new TextEncoder();
    const wire = encodeSseEvent({ type: 'text', text: 'chunked' });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(wire.slice(0, 4)));
        controller.enqueue(encoder.encode(wire.slice(4)));
        controller.close();
      },
    });

    const received: ChatEvent[] = [];
    for await (const event of readChatEvents(stream)) {
      received.push(event);
    }

    expect(received).toEqual([{ type: 'text', text: 'chunked' }]);
  });
});
