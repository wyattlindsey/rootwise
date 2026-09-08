# Working in this repo

An AI gardening advisor that hosts the [plant-intel-mcp](https://github.com/wyattlindsey/plant-intel-mcp) server in-process and bridges it into Claude tool use. Read `README.md` for what it does; this file is about how to change it.

## Layout

```
app/
  page.tsx                   server component; reads demo flag, renders ChatView
  api/chat/route.ts          thin wrapper — real deps only
lib/
  chat/events.ts             ChatEvent union + SSE codec
  chat/handle-chat-request.ts the actual handler, dependency-injected
  chat/run.ts                the tool loop
  chat/reducer.ts            pure state folding for the UI
  chat/system-prompt.ts      the honesty contract
  chat/use-chat.ts           thin hook over the reducer
  mcp/host.ts                in-process MCP client + tool descriptors
  mcp/fixture-fetch.ts       canned upstreams for demo mode
  model/client.ts            ModelClient interface + real Anthropic impl
  model/fake.ts              scripted double
  budget/                    rate limit + daily cap, Upstash or memory
components/                  presentational; state comes from the reducer
```

## The rules that matter

**Everything with logic in it must be injectable.** The route file exists only to supply real dependencies to `handleChatRequest`. A Next.js route export has nowhere to inject anything, so logic in `route.ts` is logic that cannot be tested. Keep it thin.

**Never import the Anthropic client directly outside `model/client.ts`.** The whole test strategy rests on `ModelClient` being swappable. The moment a component or handler reaches for the SDK, that layer stops being testable without a key and a network.

**Keep the MCP server real in tests.** Fake the model, never the MCP. Tests inject a fixture `fetch` into the host so the server does its actual mapping work — tier sanitization, unit conversion, companion mechanisms — against canned upstreams. A stubbed MCP would test nothing.

**Never add a `NEXT_PUBLIC_` variable for anything secret.** That prefix is the only thing Next.js inlines into client JS. Secrets are read server-side in the Node runtime route and must stay there.

**State folding belongs in `reducer.ts`, not the hook.** Text arriving in fragments, a tool moving from running to resolved, a refusal being hoisted out of the transcript — all of it is testable without rendering. Keep the hook thin enough to stay boring.

**Demo mode must need exactly one variable.** `ROOTWISE_FAKE_MODEL=1` supplies its own placeholder Perenual key. A demo that needs two variables to work is a demo that ships broken — that regression already happened once, in production.

## Conventions

- TypeScript strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Build conditional objects with `...(x === undefined ? {} : { x })`.
- Never mutate a ref during render; sync in an effect. The linter enforces it.
- Conventional commits, one focused change each. Every commit leaves `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` green.
- `npm audit --omit=dev` is the audit that matters — the dev tree masks production advisories.

## Testing

Component tests opt into jsdom with a `// @vitest-environment jsdom` docblock; everything else runs in node. RTL cleanup is registered explicitly in `test/setup.ts` because it does not auto-register with Vitest globals off — without it the DOM leaks between tests and queries match earlier markup.

`e2e/poster.spec.ts` is an asset build rather than a test: it captures the README poster. It uses a tall viewport instead of `fullPage`, because the transcript scrolls inside its own container.

When you touch the tool loop or the reducer, add the awkward case — a failed tool mid-turn, a refusal arriving after partial text — rather than another happy path.
