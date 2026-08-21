import type Anthropic from '@anthropic-ai/sdk';

import { MODEL, type ModelClient, type TurnParams, type TurnStream } from './client';

export interface ScriptedToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface ScriptedTurn {
  /** Assistant prose, streamed as deltas. */
  text?: string;
  /** Tool calls this turn asks for; their presence sets stop_reason tool_use. */
  toolUses?: ScriptedToolUse[];
  usage?: { input: number; output: number };
  /** Makes the turn reject, so error handling is testable. */
  error?: Error;
}

export interface FakeModelClient extends ModelClient {
  /** Every set of params the loop passed in, for assertions. */
  readonly calls: TurnParams[];
}

/** Splits text into a few deltas so streaming behaviour is actually exercised. */
function toDeltas(text: string): string[] {
  const words = text.split(/(\s+)/).filter((part) => part !== '');
  return words.length === 0 ? [] : words;
}

function buildMessage(turn: ScriptedTurn): Anthropic.Beta.BetaMessage {
  const content: Anthropic.Beta.BetaContentBlock[] = [];

  if (turn.text !== undefined) {
    content.push({ type: 'text', text: turn.text, citations: null });
  }
  for (const toolUse of turn.toolUses ?? []) {
    content.push({
      type: 'tool_use',
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
    } as Anthropic.Beta.BetaToolUseBlock);
  }

  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content,
    stop_reason: (turn.toolUses?.length ?? 0) > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: turn.usage?.input ?? 0,
      output_tokens: turn.usage?.output ?? 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as unknown as Anthropic.Beta.BetaMessage;
}

/**
 * A scripted stand-in for the Anthropic client.
 *
 * This is what makes the UI and integration suites possible at all: without
 * it every render test would cost money, need a key, and vary run to run.
 * It replays a fixed sequence of turns, so a browser test asserting "the tool
 * trace shows companion_check" is exact rather than probabilistic.
 */
export function createFakeModelClient(script: ScriptedTurn[]): FakeModelClient {
  const calls: TurnParams[] = [];
  let cursor = 0;

  return {
    calls,

    streamTurn(params: TurnParams): TurnStream {
      const turn = script[cursor];
      if (turn === undefined) {
        // Silence here would look like a hung model. Fail where the bug is.
        throw new Error(
          `Fake model script exhausted: the loop asked for turn ${String(cursor + 1)} but only ` +
            `${String(script.length)} were scripted.`,
        );
      }

      cursor += 1;
      calls.push(params);

      const message = buildMessage(turn);

      return {
        async *[Symbol.asyncIterator](): AsyncIterator<Anthropic.Beta.BetaRawMessageStreamEvent> {
          if (turn.error !== undefined) {
            throw turn.error;
          }

          if (turn.text !== undefined) {
            yield {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '', citations: null },
            } as Anthropic.Beta.BetaRawMessageStreamEvent;

            for (const delta of toDeltas(turn.text)) {
              yield {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: delta },
              } as Anthropic.Beta.BetaRawMessageStreamEvent;
            }

            yield {
              type: 'content_block_stop',
              index: 0,
            } as Anthropic.Beta.BetaRawMessageStreamEvent;
          }
        },

        async finalMessage(): Promise<Anthropic.Beta.BetaMessage> {
          if (turn.error !== undefined) {
            throw turn.error;
          }
          return message;
        },
      };
    },
  };
}
