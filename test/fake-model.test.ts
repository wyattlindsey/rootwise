import { describe, expect, it } from 'vitest';

import { createFakeModelClient } from '@/lib/model/fake';

const EMPTY = { system: 's', messages: [], tools: [] };

describe('createFakeModelClient', () => {
  it('streams the scripted text as deltas', async () => {
    const model = createFakeModelClient([{ text: 'Tomatoes and potatoes clash.' }]);

    const stream = model.streamTurn(EMPTY);
    let streamed = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        streamed += event.delta.text;
      }
    }

    expect(streamed).toBe('Tomatoes and potatoes clash.');
  });

  it('delivers the same text in the final message', async () => {
    const model = createFakeModelClient([{ text: 'hello' }]);
    const stream = model.streamTurn(EMPTY);
    for await (const _event of stream) {
      /* drain */
    }

    const message = await stream.finalMessage();

    expect(message.content).toEqual([{ type: 'text', text: 'hello', citations: null }]);
    expect(message.stop_reason).toBe('end_turn');
  });

  it('emits tool_use blocks and reports stop_reason tool_use', async () => {
    const model = createFakeModelClient([
      { toolUses: [{ id: 'tu_1', name: 'companion_check', input: { plant_a: 'tomato' } }] },
    ]);

    const message = await model.streamTurn(EMPTY).finalMessage();

    expect(message.stop_reason).toBe('tool_use');
    expect(message.content).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'companion_check', input: { plant_a: 'tomato' } },
    ]);
  });

  it('advances through the script one turn per call', async () => {
    const model = createFakeModelClient([
      { toolUses: [{ id: 'tu_1', name: 'plant_details', input: {} }] },
      { text: 'done' },
    ]);

    const first = await model.streamTurn(EMPTY).finalMessage();
    const second = await model.streamTurn(EMPTY).finalMessage();

    expect(first.stop_reason).toBe('tool_use');
    expect(second.stop_reason).toBe('end_turn');
  });

  it('records the params it was called with, so tests can assert on the prompt', async () => {
    const model = createFakeModelClient([{ text: 'ok' }]);
    await model
      .streamTurn({ system: 'be honest', messages: [{ role: 'user', content: 'hi' }], tools: [] })
      .finalMessage();

    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.system).toBe('be honest');
  });

  it('fails loudly when the script runs out, rather than hanging a test', async () => {
    const model = createFakeModelClient([{ text: 'only one' }]);
    await model.streamTurn(EMPTY).finalMessage();

    expect(() => model.streamTurn(EMPTY)).toThrow(/script/i);
  });

  it('can be scripted to fail, so error paths are testable', async () => {
    const model = createFakeModelClient([{ error: new Error('overloaded') }]);

    await expect(model.streamTurn(EMPTY).finalMessage()).rejects.toThrow('overloaded');
  });

  it('reports usage so budget accounting can be exercised', async () => {
    const model = createFakeModelClient([{ text: 'ok', usage: { input: 11, output: 22 } }]);

    const message = await model.streamTurn(EMPTY).finalMessage();

    expect(message.usage.input_tokens).toBe(11);
    expect(message.usage.output_tokens).toBe(22);
  });
});
