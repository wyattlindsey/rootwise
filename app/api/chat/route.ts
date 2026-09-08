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

/**
 * Demo mode supplies its own placeholder credential.
 *
 * The MCP server gates its tools on a Perenual key being present, so without
 * this the fixtures are never reached and every tool answers "PERENUAL_API_KEY
 * is not set" -- which is what a demo deployment configured with only
 * ROOTWISE_FAKE_MODEL actually did. Demo mode should need exactly one variable,
 * not two.
 */
const demoEnv = { ...process.env, PERENUAL_API_KEY: 'demo-fixture-key' };

/**
 * The shared key's daily ceiling, in cents. A turn that calls two tools costs
 * roughly 5-7 cents, so the default allows on the order of fifteen questions a
 * day before the demo asks visitors to bring their own key.
 */
const dailyCostCents = Number(process.env.ROOTWISE_DAILY_BUDGET_CENTS ?? '100');

const budget = createBudget({
  store: createBudgetStore(process.env),
  limits: Number.isFinite(dailyCostCents) ? { dailyCostCents } : {},
});

const deps: ChatDeps = {
  model: (apiKey?: string) =>
    isDemoMode
      ? createFakeModelClient(demoScript())
      : createAnthropicModelClient(apiKey === undefined ? {} : { apiKey }),
  host: () =>
    getMcpHost(isDemoMode ? { env: demoEnv, fetch: createFixtureFetch() } : {}),
  budget,
};

export async function POST(request: Request): Promise<Response> {
  return handleChatRequest(request, deps);
}
