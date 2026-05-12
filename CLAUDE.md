# kintoun (SDK)

A drop-in SDK that lets developers add a working AI endpoint in one line, for any TypeScript runtime that supports the Web standard `Request`/`Response` API.

## What it does

- Provides `kintoun()` — a route handler factory
- Logging is fully local: no external calls, no API key required

## Public API

`kintoun(options)` returns `(req: Request) => Promise<Response>` — a streaming `text/plain` response.

```ts
kintoun({
  model: string                                              // required
  system?: string | ((ctx: Record<string, unknown>) => string)
  before?: (req: Request) => Promise<Record<string, unknown>>
  userId?: string | ((req: Request) => string | Promise<string>)
  tokenBudget?: {
    used?: (userId: string) => number | Promise<number>
    max?: number | ((userId: string) => number | Promise<number>)
    onSpend?: (userId: string | undefined, tokens: number) => void | Promise<void>
  }
  onLog?: (log: LogPayload) => void
})
```

The handler expects a `POST` body of `{ messages: Array<{ role: string; content: string }> }`.

Returns `429` when the token budget is exceeded, `401` when `before` throws, `400` for invalid body.

## Logging behavior

- Logging is fully local — no HTTP calls, no external platform
- `kintoun` accepts an optional `onLog` callback called after each AI call completes
- Developers own the log: store it, forward it, ignore it

## Providers

Provider is auto-detected from model name:

| Prefix                          | Provider      | Env var required    |
| ------------------------------- | ------------- | ------------------- |
| `gpt-*`, `o1-*`, `o3-*`, `o4-*` | OpenAI        | `OPENAI_API_KEY`    |
| `claude-*`                      | Anthropic     | `ANTHROPIC_API_KEY` |
| `gemini-*`                      | Google Gemini | `GOOGLE_API_KEY`    |

Passing an unknown model throws at call time with a clear error message.

## Stack

- TypeScript
- `openai` — official OpenAI SDK
- `@anthropic-ai/sdk` — official Anthropic SDK
- `@google/generative-ai` — official Google Gemini SDK
- Targets the Web standard `Request`/`Response` API — works in any runtime that supports it: Next.js App Router, Hono, Bun, Cloudflare Workers, Deno
- No framework-specific dependencies

## Future

- A Python package (`kintoun-py`) will follow the same contract: same env vars, same log payload shape, same `with_ai_log()` escape hatch pattern

## Structure

```
src/
  index.ts              # public exports: kintoun
  handler.ts            # kintoun() — orchestration only, no SDK imports
  stream.ts             # createTextStream() — shared streaming wrapper + onLog callback
  provider.ts           # detectProvider() — model prefix → provider name
  types.ts              # shared types
  providers/
    openai.ts           # streamOpenAI()
    anthropic.ts        # streamAnthropic()
    gemini.ts           # streamGemini()
```

## What it does NOT do

- No prompt storage
- No streaming UI helpers (use Vercel AI SDK useChat directly)
- No multi-provider routing
- No retries on the AI call
