/**
 * The wire protocol between the chat route and the browser.
 *
 * Server-Sent Events, one JSON object per frame. Tool calls and results are
 * first-class events rather than prose the client has to parse back out --
 * that is what lets the UI show what the model actually reached for.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ChatEvent =
  /** An incremental slice of the assistant's answer. */
  | { type: 'text'; text: string }
  /** The model asked for a tool; arguments included so the UI can show them. */
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  /** That tool returned. `ok: false` means the tool itself reported a failure. */
  | { type: 'tool_result'; id: string; name: string; ok: boolean; result: unknown }
  /** The turn failed. `code` lets the UI react, e.g. offering a key entry. */
  | { type: 'error'; message: string; code?: string; remedy?: string }
  /** The turn finished cleanly. */
  | { type: 'done'; usage?: TokenUsage };

const FRAME_SEPARATOR = '\n\n';

/**
 * Encodes one event as an SSE frame. The payload is JSON on a single line, so
 * a newline inside the assistant's text can never be mistaken for the frame
 * boundary.
 */
export function encodeSseEvent(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}${FRAME_SEPARATOR}`;
}

function parseFrame(frame: string): ChatEvent | null {
  const payload = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('');

  if (payload === '') {
    return null;
  }

  try {
    return JSON.parse(payload) as ChatEvent;
  } catch {
    // A malformed frame is dropped rather than thrown: one bad frame must not
    // take down a stream that is still delivering a useful answer.
    return null;
  }
}

/**
 * Incremental SSE decoder. Bytes arrive on arbitrary boundaries, so a frame
 * split down the middle has to be held until the rest of it turns up.
 */
export class SseDecoder {
  #buffer = '';

  push(chunk: string): ChatEvent[] {
    this.#buffer += chunk;
    const events: ChatEvent[] = [];

    let boundary = this.#buffer.indexOf(FRAME_SEPARATOR);
    while (boundary !== -1) {
      const frame = this.#buffer.slice(0, boundary);
      this.#buffer = this.#buffer.slice(boundary + FRAME_SEPARATOR.length);

      const event = parseFrame(frame);
      if (event !== null) {
        events.push(event);
      }

      boundary = this.#buffer.indexOf(FRAME_SEPARATOR);
    }

    return events;
  }
}

/** Reads a byte stream as chat events. */
export async function* readChatEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatEvent> {
  const reader = stream.getReader();
  const textDecoder = new TextDecoder();
  const sse = new SseDecoder();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      // `stream: true` keeps a multi-byte character split across chunks intact.
      yield* sse.push(textDecoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}
