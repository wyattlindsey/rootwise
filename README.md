# rootwise

An AI gardening advisor that answers free-form questions using real horticultural data — and tells you when the data doesn't exist.

**[Live demo →](https://rootwise-deploy.vercel.app)**

![rootwise answering a companion-planting question, showing its tool calls, sources, and caveats](public/poster/rootwise.png)

## Why this exists

Ask any chatbot when to plant tomatoes and you'll get a confident answer. Some of it is true. None of it is traceable, and the parts it invents look exactly like the parts it knows.

rootwise is built on [plant-intel-mcp](https://github.com/wyattlindsey/plant-intel-mcp), an MCP server designed so that gaps in the data stay visible. This app's job is to stop the model papering over them, and to show the reader it didn't:

- **Every tool call is on screen** — which tool ran, what it was asked, and the raw JSON it returned.
- **Every source is credited**, with its licence.
- **It refuses to invent.** No source behind these tools publishes plant spacing, days-to-maturity, or frost-hardiness class. Asked for one, it says so and points you at a seed packet.
- **Caveats survive.** When the frost model returns "these are 9 km gridded reanalysis values, not station data", that reaches the answer instead of being smoothed away.

In the screenshot above, `verdict: "bad"` and `mechanism: "shared-family"` are real output from the MCP server. So is the four-item caveat list. Only the prose is the model.

## How it works

```
Browser ──SSE──> /api/chat ──> tool loop ──> Claude (Opus 5)
                                   │
                                   └──> MCP client ──in-memory──> plant-intel-mcp server
                                                                        │
                                                        Perenual · Open-Meteo · Permapeople
```

The app **hosts the MCP server in its own process** and talks to it as a real MCP client over an in-memory transport — full handshake, `tools/list`, `tools/call`. It's a genuine protocol client that simply skips the pipe, which means no subprocess, no open port, and no credential leaving the process.

MCP advertises tools as JSON Schema and the Messages API accepts JSON Schema, so the bridge needs no translation layer.

A few decisions worth explaining:

**A hand-written tool loop, not the SDK's tool runner.** Three reasons the runner doesn't cover: tool calls and results must be emitted in strict order relative to streamed text because the UI renders that order; the loop needs a seam between iterations to stop on an abort or a spent budget; and stacking the beta runner on beta fallbacks is one beta dependency more than this needs.

**The model client is injected.** Exactly as the MCP server injects `fetch` and its cache. That's what makes the entire UI and integration suite deterministic, instant, and free — a scripted fake replaces Claude while the *real* MCP server still runs underneath, so the tool output under test is genuine.

**Refusals stream as SSE, not JSON.** The status code still says what happened, but the client keeps one way to read a response, so a budget refusal renders through the same path as any other error.

## Running it

```bash
npm install
npm run dev:demo     # scripted model + fixture data: no keys, no network
```

The MCP server it hosts is a published package — [`plant-intel-mcp`](https://www.npmjs.com/package/plant-intel-mcp) — so it installs like any other dependency, and can be used on its own with any MCP client.

For live answers you need two keys:

```bash
ANTHROPIC_API_KEY=…      # https://console.anthropic.com
PERENUAL_API_KEY=…       # https://perenual.com/docs/api (free: 100 requests/day)
npm run dev
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | live mode | The model. |
| `PERENUAL_API_KEY` | live mode | Species data. Free tier is 100 requests/day, species 1–3000, non-commercial. |
| `PERMAPEOPLE_KEY_ID` / `_SECRET` | no | Adds documented companion listings (CC BY-SA 4.0). |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | no | Shared spend cap across instances. Without it the cap only holds per-instance. |
| `PLANT_INTEL_CACHE_DIR` | no | Set to `/tmp/plant-intel` on serverless, where the filesystem is otherwise read-only. |
| `ROOTWISE_FAKE_MODEL` | no | `1` for demo mode. Self-contained — needs no other variable. |

## Guarding a public AI endpoint

A demo anyone can hit spends real money and is trivially abusable, so the budget layer is load-bearing rather than decorative:

- A per-IP hourly limit, so no one visitor monopolises the shared key.
- A daily token ceiling across all visitors that holds however traffic arrives.
- On exhaustion the UI offers to use the visitor's own key, so the demo degrades instead of going dark. That key is used for one request and is never logged, stored, or counted against the shared budget.

Counter keys carry their own window stamp, so a new hour is simply a new key. That removes the classic hazard: an expiry that silently fails leaves a counter with no TTL, and a counter that never resets locks a visitor out permanently.

## Testing

```bash
npm test          # 115 unit, integration, and component tests
npm run e2e       # 6 Playwright browser tests
npm run typecheck
npm run eval      # opt-in; spends real API credit
```

| Layer | Covers |
| --- | --- |
| Unit | Tool bridging, SSE codec, budget arithmetic, prompt assembly, state folding |
| Integration | `/api/chat` end to end, scripted model against the **real** in-process MCP server |
| Component | Streaming text, tool chips, sources, caveats, error and cap states |
| Browser | The full flow in Chromium, fully offline |
| Eval | Real Claude: asserts tool selection and refusal-to-invent |

The browser suite runs against demo mode — scripted model, fixture upstreams — so it is deterministic and free. The MCP server underneath is real and does its real mapping work, so what's asserted is genuine output. Without that, one e2e run would spend the entire daily Perenual budget.

### What the evals check

The eval suite inverts that: **real Claude, fixture upstreams.** The variable under test is what the model does, so holding the data constant makes a failure mean something — and it spends none of the Perenual budget.

It asserts behaviour rather than prose quality:

- A companion question **reaches for `companion_check`**, and the answer names the family behind the verdict.
- Asked point-blank for a spacing figure, the answer **contains no measurement at all** — any digit followed by a length unit fails the case — and says the figure isn't published.
- A timing question with no location **asks where the garden is** instead of calling `planting_window` on a guess.
- With a location, it calls `planting_window` and **passes through the ERA5 caveat** when asked how reliable the date is.
- A toxicity question is **looked up, not recalled**.

Assertions are deterministic rather than model-judged, because the behaviours worth pinning are the checkable ones: a tool was called or it wasn't; a measurement appeared or it didn't. A judge would add cost and a second source of flakiness for no extra signal.

## Licence

MIT. Data retrieved through the MCP server remains under its own sources' terms — see [plant-intel-mcp](https://github.com/wyattlindsey/plant-intel-mcp#sources-and-their-limits).
