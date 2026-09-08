import type { Budget } from '@/lib/budget/budget';
import type { McpHost } from '@/lib/mcp/host';
import type { ModelClient } from '@/lib/model/client';

import { encodeSseEvent, type ChatEvent } from './events';
import { runChat, type ChatMessage } from './run';
import { buildSystemPrompt, type PromptLocation } from './system-prompt';

export interface ChatDeps {
  /** Given a visitor key, returns the client to run this turn on. */
  model: (apiKey?: string) => ModelClient;
  host: () => Promise<McpHost>;
  budget: Budget;
  now?: () => Date;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  location?: PromptLocation | null;
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  connection: 'keep-alive',
};

function isMessage(value: unknown): value is ChatMessage {
  const message = value as ChatMessage | null;
  return (
    typeof message === 'object' &&
    message !== null &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string'
  );
}

function isLocation(value: unknown): value is PromptLocation {
  const location = value as PromptLocation | null;
  return (
    typeof location === 'object' &&
    location !== null &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude)
  );
}

async function parseBody(request: Request): Promise<ChatRequestBody | null> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return null;
  }

  const body = raw as { messages?: unknown; location?: unknown };
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return null;
  }
  if (!body.messages.every(isMessage)) {
    return null;
  }

  return {
    messages: body.messages,
    location: isLocation(body.location) ? body.location : null,
  };
}

/** The first forwarded address is the client; the rest are proxies. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown';
}

function streamOf(events: AsyncIterable<ChatEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        }
      } finally {
        controller.close();
      }
    },
  });
}

function singleEventResponse(event: ChatEvent, status: number): Response {
  return new Response(encodeSseEvent(event), { status, headers: SSE_HEADERS });
}

/**
 * Handles one chat turn.
 *
 * Split out of the route file so it can be driven directly in tests with a
 * scripted model and the real in-process MCP server -- a Next.js route export
 * has nowhere to inject dependencies.
 *
 * Refusals answer with an SSE body too, not JSON. The status still says what
 * happened, but the client keeps exactly one way to read a response, and a
 * budget refusal arrives on the same path as any other error the UI renders.
 */
export async function handleChatRequest(request: Request, deps: ChatDeps): Promise<Response> {
  const body = await parseBody(request);
  if (body === null) {
    return singleEventResponse(
      {
        type: 'error',
        code: 'bad_request',
        message: 'Expected a JSON body with a non-empty `messages` array.',
      },
      400,
    );
  }

  // Read once, pass straight to the client, never log or store it.
  const visitorKey = request.headers.get('x-anthropic-key')?.trim() ?? '';
  const hasOwnKey = visitorKey !== '';

  const decision = await deps.budget.check({ ip: clientIp(request), hasOwnKey });
  if (!decision.allowed) {
    return singleEventResponse(
      {
        type: 'error',
        code: decision.code ?? 'refused',
        message: decision.message ?? 'This request was refused.',
        ...(decision.remedy === undefined ? {} : { remedy: decision.remedy }),
      },
      429,
    );
  }

  const host = await deps.host();
  const model = deps.model(hasOwnKey ? visitorKey : undefined);

  const system = buildSystemPrompt({
    toolNames: host.tools.map((tool) => tool.name),
    location: body.location ?? null,
    ...(deps.now === undefined ? {} : { today: deps.now() }),
  });

  async function* run(): AsyncGenerator<ChatEvent> {
    for await (const event of runChat({
      model,
      host,
      system,
      messages: body!.messages,
      signal: request.signal,
    })) {
      // Only the shared key is metered; a visitor on their own key spends
      // their own budget.
      if (event.type === 'done' && !hasOwnKey && event.usage !== undefined) {
        await deps.budget.recordUsage(event.usage.outputTokens);
      }
      yield event;
    }
  }

  return new Response(streamOf(run()), { status: 200, headers: SSE_HEADERS });
}
