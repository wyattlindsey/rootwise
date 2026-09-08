import { describe, expect, it } from 'vitest';

import { runChat } from '@/lib/chat/run';
import { buildSystemPrompt } from '@/lib/chat/system-prompt';
import { createFixtureFetch } from '@/lib/mcp/fixture-fetch';
import { createMcpHost, type McpHost } from '@/lib/mcp/host';
import { createAnthropicModelClient } from '@/lib/model/client';

import { EVAL_CASES, type EvalCase } from './cases';

/**
 * Behavioural evals against the real model.
 *
 * Run with `npm run eval`. Opt-in because it spends real API credit.
 *
 * The upstreams are fixtures on purpose. The variable under test is what the
 * model does -- which tool it reaches for, and whether it declines to invent a
 * figure -- so holding the data constant makes a failure mean something, and
 * spends none of Perenual's 100-request daily budget.
 *
 * Assertions are deterministic rather than model-judged. The behaviours worth
 * pinning here happen to be exactly the checkable ones: a tool was called or it
 * was not; a measurement appeared in the prose or it did not. A judge would add
 * cost and a second source of flakiness for no extra signal.
 */

const enabled = process.env.ROOTWISE_EVAL === '1';
const hasKey = (process.env.ANTHROPIC_API_KEY ?? '').trim() !== '';

interface Transcript {
  text: string;
  toolsCalled: string[];
}

async function ask(host: McpHost, testCase: EvalCase): Promise<Transcript> {
  const model = createAnthropicModelClient();
  const toolsCalled: string[] = [];
  let text = '';

  for await (const event of runChat({
    model,
    host,
    system: buildSystemPrompt({
      toolNames: host.tools.map((tool) => tool.name),
      location: testCase.location ?? null,
    }),
    messages: [{ role: 'user', content: testCase.question }],
  })) {
    if (event.type === 'text') {
      text += event.text;
    }
    if (event.type === 'tool_call') {
      toolsCalled.push(event.name);
    }
    if (event.type === 'error') {
      throw new Error(`Model turn failed: ${event.message}`);
    }
  }

  return { text, toolsCalled };
}

describe.runIf(enabled && hasKey)('behavioural evals', () => {
  it.each(EVAL_CASES)('$name', async (testCase) => {
    const host = await createMcpHost({
      env: { PERENUAL_API_KEY: 'eval-fixture-key', PLANT_INTEL_CACHE_DISABLED: '1' },
      fetch: createFixtureFetch(),
    });

    try {
      const { text, toolsCalled } = await ask(host, testCase);
      const context = `\n\nQuestion: ${testCase.question}\nTools: ${toolsCalled.join(', ') || '(none)'}\nAnswer:\n${text}`;

      for (const tool of testCase.mustCallTools ?? []) {
        expect(toolsCalled, `should have called ${tool}${context}`).toContain(tool);
      }
      for (const tool of testCase.mustNotCallTools ?? []) {
        expect(toolsCalled, `should not have called ${tool}${context}`).not.toContain(tool);
      }
      for (const check of testCase.mustMatch ?? []) {
        expect(text, `${check.label}${context}`).toMatch(check.pattern);
      }
      for (const check of testCase.mustNotMatch ?? []) {
        expect(text, `${check.label}${context}`).not.toMatch(check.pattern);
      }
      for (const check of testCase.mustNotSatisfy ?? []) {
        expect(check.test(text), `${check.label}${context}`).toBe(false);
      }
    } finally {
      await host.close();
    }
  }, 180_000);
});

describe.runIf(enabled && !hasKey)('behavioural evals', () => {
  it('needs a key', () => {
    throw new Error('ROOTWISE_EVAL=1 is set but ANTHROPIC_API_KEY is empty.');
  });
});
