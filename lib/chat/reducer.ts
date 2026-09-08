import type { ChatEvent } from './events';

export interface ToolTraceEntry {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'ok' | 'failed';
  result?: unknown;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools: ToolTraceEntry[];
  error?: { code?: string; message: string; remedy?: string };
}

export interface ChatState {
  messages: UiMessage[];
  status: 'idle' | 'streaming';
  /** Set when the server refused; the UI offers a key so the visitor can continue. */
  blocked: { code?: string; message: string; remedy?: string } | null;
}

export const initialChatState: ChatState = { messages: [], status: 'idle', blocked: null };

export type ChatAction =
  | { type: 'send'; text: string; id: string; assistantId: string }
  | { type: 'event'; event: ChatEvent }
  | { type: 'stream_failed'; message: string }
  | { type: 'dismiss_block' };

function mapLast(state: ChatState, update: (message: UiMessage) => UiMessage): ChatState {
  const index = state.messages.length - 1;
  const last = state.messages[index];
  if (last === undefined || last.role !== 'assistant') {
    return state;
  }

  const messages = [...state.messages];
  messages[index] = update(last);
  return { ...state, messages };
}

/**
 * Folds streamed events into what the screen shows.
 *
 * Pure and separate from the hook on purpose: the interesting behaviour is the
 * folding -- text arriving in fragments, a tool going from running to resolved,
 * a refusal that should offer a way forward -- and all of it is testable here
 * without rendering anything.
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send':
      return {
        ...state,
        status: 'streaming',
        blocked: null,
        messages: [
          ...state.messages,
          { id: action.id, role: 'user', content: action.text, tools: [] },
          { id: action.assistantId, role: 'assistant', content: '', tools: [] },
        ],
      };

    case 'event': {
      const { event } = action;

      switch (event.type) {
        case 'text':
          return mapLast(state, (message) => ({
            ...message,
            content: message.content + event.text,
          }));

        case 'tool_call':
          return mapLast(state, (message) => ({
            ...message,
            tools: [
              ...message.tools,
              { id: event.id, name: event.name, input: event.input, status: 'running' },
            ],
          }));

        case 'tool_result':
          return mapLast(state, (message) => ({
            ...message,
            tools: message.tools.map((tool) =>
              tool.id === event.id
                ? { ...tool, status: event.ok ? 'ok' : 'failed', result: event.result }
                : tool,
            ),
          }));

        case 'error': {
          // A refusal is the server declining, not the answer failing. It gets
          // hoisted so the UI can offer a way to continue, and the empty
          // assistant turn is dropped rather than left as a blank bubble.
          const refused = event.code === 'budget_exhausted' || event.code === 'rate_limited';
          if (refused) {
            const messages = [...state.messages];
            const last = messages.at(-1);
            if (last?.role === 'assistant' && last.content === '' && last.tools.length === 0) {
              messages.pop();
            }
            return {
              ...state,
              status: 'idle',
              messages,
              blocked: {
                message: event.message,
                ...(event.code === undefined ? {} : { code: event.code }),
                ...(event.remedy === undefined ? {} : { remedy: event.remedy }),
              },
            };
          }

          return {
            ...mapLast(state, (message) => ({
              ...message,
              error: {
                message: event.message,
                ...(event.code === undefined ? {} : { code: event.code }),
                ...(event.remedy === undefined ? {} : { remedy: event.remedy }),
              },
            })),
            status: 'idle',
          };
        }

        case 'done':
          return { ...state, status: 'idle' };

        default:
          return state;
      }
    }

    case 'stream_failed':
      return {
        ...mapLast(state, (message) => ({ ...message, error: { message: action.message } })),
        status: 'idle',
      };

    case 'dismiss_block':
      return { ...state, blocked: null };

    default:
      return state;
  }
}
