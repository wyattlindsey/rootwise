import type Anthropic from '@anthropic-ai/sdk';

import type { McpHost } from '@/lib/mcp/host';
import type { ModelClient } from '@/lib/model/client';

import type { ChatEvent, TokenUsage } from './events';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunChatOptions {
  model: ModelClient;
  host: McpHost;
  messages: ChatMessage[];
  system?: string;
  signal?: AbortSignal;
  /** Guards against a model that keeps calling tools forever. */
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 8;

/**
 * Read through a function so control-flow analysis cannot narrow the result
 * of an earlier check -- the flag genuinely changes across the awaits between
 * one check and the next.
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** MCP advertises JSON Schema; the Messages API takes JSON Schema. No translation. */
function toAnthropicTools(host: McpHost): Anthropic.Beta.BetaTool[] {
  return host.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool['input_schema'],
  }));
}

function toolResultText(outcome: { ok: boolean; result: unknown }): string {
  return typeof outcome.result === 'string'
    ? outcome.result
    : JSON.stringify(outcome.result ?? null);
}

/**
 * Runs one user turn to completion, yielding events as they happen.
 *
 * This is a hand-written loop rather than the SDK's tool runner, for three
 * reasons the runner does not cover: tool calls and results must be emitted in
 * strict order relative to the streamed text, because the UI renders that
 * order; the caller needs a seam between iterations to stop on an abort or a
 * spent budget; and stacking the beta runner on top of beta fallbacks is one
 * beta dependency more than this needs.
 *
 * Nothing thrown escapes. A failure becomes an `error` event, because the
 * client is a stream that has already started -- there is no status code left
 * to set.
 */
export async function* runChat(options: RunChatOptions): AsyncGenerator<ChatEvent> {
  const { model, host, signal } = options;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const messages: Anthropic.Beta.BetaMessageParam[] = options.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const tools = toAnthropicTools(host);

  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let iterations = 0;

  try {
    while (iterations < maxIterations) {
      if (isAborted(signal)) {
        return;
      }

      iterations += 1;

      const stream = model.streamTurn({
        system: options.system ?? '',
        messages,
        tools,
        ...(signal === undefined ? {} : { signal }),
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }

      const message = await stream.finalMessage();
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;

      messages.push({ role: 'assistant', content: message.content });

      if (message.stop_reason === 'refusal') {
        yield {
          type: 'error',
          code: 'refusal',
          message: 'The model declined to answer this one.',
          remedy: 'Try rephrasing the question.',
        };
        return;
      }

      // A server-side tool paused the turn; resend to let it continue.
      if (message.stop_reason === 'pause_turn') {
        continue;
      }

      const toolUses = message.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
      );

      if (toolUses.length === 0) {
        yield { type: 'done', usage };
        return;
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        yield { type: 'tool_call', id: toolUse.id, name: toolUse.name, input: toolUse.input };

        const outcome = await host.callTool(toolUse.name, toolUse.input);

        yield {
          type: 'tool_result',
          id: toolUse.id,
          name: toolUse.name,
          ok: outcome.ok,
          result: outcome.result,
        };

        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolResultText(outcome),
          // A failed tool is reported as a failure so the model can react,
          // rather than being dropped and looking like an empty answer.
          ...(outcome.ok ? {} : { is_error: true }),
        });
      }

      if (isAborted(signal)) {
        return;
      }

      // All results go back in one user message; splitting them teaches the
      // model to stop making parallel calls.
      messages.push({ role: 'user', content: results });
    }

    yield {
      type: 'error',
      code: 'iteration_limit',
      message: `Stopped after ${String(maxIterations)} tool rounds without a final answer.`,
      remedy: 'Try a narrower question.',
    };
  } catch (error: unknown) {
    if (isAborted(signal)) {
      return;
    }
    yield {
      type: 'error',
      code: 'model_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
