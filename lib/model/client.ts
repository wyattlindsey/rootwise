import Anthropic from '@anthropic-ai/sdk';

/** The model this app runs on. */
export const MODEL = 'claude-opus-5';

/**
 * Effort trades answer quality against latency. `high` is the right default
 * for a question that drives real tool calls; drop to `medium` if measured
 * p95 latency starts crowding the platform's request ceiling.
 */
export const EFFORT = 'high' as const;

const MAX_TOKENS = 16_000;

export interface TurnParams {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
  signal?: AbortSignal;
}

/**
 * One streamed assistant turn: iterate for deltas as they arrive, then await
 * `finalMessage()` for the assembled turn including any tool_use blocks.
 */
export interface TurnStream extends AsyncIterable<Anthropic.Beta.BetaRawMessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Beta.BetaMessage>;
}

/**
 * The narrow slice of the Anthropic SDK this app uses.
 *
 * Injected rather than imported directly, for the same reason the MCP server
 * injects `fetch` and its cache: it makes the tool loop, the API route, and
 * every UI test drivable by a scripted double instead of a paid,
 * non-deterministic network call.
 */
export interface ModelClient {
  streamTurn(params: TurnParams): TurnStream;
}

export interface ModelClientOptions {
  /** A visitor-supplied key. Held for one request; never logged or persisted. */
  apiKey?: string;
}

export function createAnthropicModelClient(options: ModelClientOptions = {}): ModelClient {
  const client = new Anthropic(options.apiKey === undefined ? {} : { apiKey: options.apiKey });

  return {
    streamTurn({ system, messages, tools, signal }) {
      return client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          // Tools render before system, so one breakpoint here caches the
          // whole stable prefix -- roughly 3.5k tokens of tool schemas and
          // instructions that are otherwise resent on every iteration of the
          // tool loop, and again on every follow-up question.
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages,
          tools,
          thinking: { type: 'adaptive' },
          output_config: { effort: EFFORT },
          // A policy decline would otherwise just stop the turn. Routing by
          // refusal category keeps the answer coming without maintaining a
          // model list.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        signal === undefined ? {} : { signal },
      );
    },
  };
}
