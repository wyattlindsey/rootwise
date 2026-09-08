import { createBudget } from '@/lib/budget/budget';
import { createBudgetStore } from '@/lib/budget/store';
import { handleChatRequest, type ChatDeps } from '@/lib/chat/handle-chat-request';
import { createFixtureFetch } from '@/lib/mcp/fixture-fetch';
import { getMcpHost } from '@/lib/mcp/host';
import { createAnthropicModelClient } from '@/lib/model/client';
import { demoScript } from '@/lib/model/demo-script';
import { createFakeModelClient } from '@/lib/model/fake';

// The MCP server and its cache need Node APIs, not the edge runtime.
export const runtime = 'nodejs';

// A turn with two tool calls and adaptive thinking is not fast. Streaming keeps
// the visitor informed, but the function still needs room to finish.
export const maxDuration = 60;

/** Demo mode: scripted model, fixture upstreams, no key and no network. */
const isDemoMode = process.env.ROOTWISE_FAKE_MODEL === '1';

const budget = createBudget({ store: createBudgetStore(process.env) });

const deps: ChatDeps = {
  model: (apiKey?: string) =>
    isDemoMode
      ? createFakeModelClient(demoScript())
      : createAnthropicModelClient(apiKey === undefined ? {} : { apiKey }),
  host: () => getMcpHost(isDemoMode ? { fetch: createFixtureFetch() } : {}),
  budget,
};

export async function POST(request: Request): Promise<Response> {
  return handleChatRequest(request, deps);
}
