<div align="center">
  <img src="assets/kintoun.png" width="180" alt="kintoun" />

  <h1>kintoun</h1>

  <p><strong>Drop-in AI route handler for any TypeScript runtime — one line, any provider.</strong></p>

  [![npm version](https://img.shields.io/npm/v/kintoun)](https://www.npmjs.com/package/kintoun)
  [![last commit](https://img.shields.io/github/last-commit/vincentherreros/kintoun)](https://github.com/vincentherreros/kintoun)
  [![license](https://img.shields.io/github/license/vincentherreros/kintoun)](https://github.com/vincentherreros/kintoun/blob/main/LICENSE)
</div>

---

## Install

```bash
npm install kintoun
# or
pnpm add kintoun
```

Set the env var for your provider:

```bash
OPENAI_API_KEY=...        # gpt-*, o1-*, o3-*, o4-*
ANTHROPIC_API_KEY=...     # claude-*
GOOGLE_API_KEY=...        # gemini-*
```

---

## Usage

```ts
import { kintoun } from 'kintoun'

// Next.js App Router
export const POST = kintoun({ model: 'gpt-4o' })

// Hono
app.post('/chat', kintoun({ model: 'claude-opus-4-6' }))

// Bun / Cloudflare Workers / Deno
export default { fetch: kintoun({ model: 'gemini-1.5-flash' }) }
```

`kintoun()` returns a `(req: Request) => Promise<Response>` — a streaming `text/plain` response. It reads a JSON body:

```json
{ "messages": [{ "role": "user", "content": "Hello" }] }
```

Provider is auto-detected from the model name. No extra config needed.

---

## API

```ts
kintoun(options: HandlerOptions): (req: Request) => Promise<Response>
```

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `model` | `string` | Yes | Model name — determines the provider |
| `system` | `string \| (ctx) => string` | No | System prompt, static or dynamic |
| `before` | `(req) => Promise<Record<string, unknown>>` | No | Runs before the AI call. Return context for `system`. Throw to return `401` |
| `userId` | `string \| (req) => string \| Promise<string>` | No | User identifier — required for `tokenBudget.used` / `.max` |
| `tokenBudget` | `TokenBudget` | No | Per-user token budget enforcement |
| `onLog` | `(log: LogPayload) => void` | No | Called after each AI call — store, forward, or ignore |

### `tokenBudget`

| Field | Type | Description |
|---|---|---|
| `used` | `(userId) => number \| Promise<number>` | How many tokens this user has spent |
| `max` | `number \| (userId) => number \| Promise<number>` | Token cap — static or per-user |
| `onSpend` | `(userId, tokens) => void \| Promise<void>` | Called after each call to persist the spend |

Returns `429 { error: 'Token budget exceeded' }` before making any AI call when the budget is exhausted.

### `LogPayload`

```ts
{
  model: string               // e.g. 'gpt-4o'
  prompt_tokens: number
  completion_tokens: number
  latency_ms: number
  status: 'success' | 'error'
  user_id?: string            // undefined if userId was not set
}
```

---

## Providers

| Model prefix | Provider | Env var |
|---|---|---|
| `gpt-*`, `o1-*`, `o3-*`, `o4-*` | OpenAI | `OPENAI_API_KEY` |
| `claude-*` | Anthropic | `ANTHROPIC_API_KEY` |
| `gemini-*` | Google Gemini | `GOOGLE_API_KEY` |

Passing an unknown model prefix throws at call time with a clear error message.

---

## Examples

### Auth + dynamic system prompt

```ts
export const POST = kintoun({
  model: 'gpt-4o',

  before: async (req) => {
    const user = await authenticate(req.headers.get('Authorization'))
    if (!user) throw new Error()
    return { name: user.name, plan: user.plan }
  },

  system: (ctx) =>
    `You are a helpful assistant. The user is ${ctx.name} on the ${ctx.plan} plan.`,
})
```

### Per-user token budget

```ts
export const POST = kintoun({
  model: 'claude-opus-4-6',
  userId: async (req) => getUserId(req),
  tokenBudget: {
    used: (id) => db.tokensUsed(id),
    max: 100_000,
    onSpend: (id, n) => db.addTokens(id, n),
  },
})
```

### Log every call

```ts
export const POST = kintoun({
  model: 'gemini-1.5-flash',
  onLog: (log) => logger.info('ai-call', log),
})
```

### Full setup

```ts
import { kintoun } from 'kintoun'

export const POST = kintoun({
  model: 'claude-opus-4-6',

  before: async (req) => {
    const user = await authenticate(req.headers.get('Authorization'))
    if (!user) throw new Error()
    return { name: user.name, plan: user.plan }
  },

  system: (ctx) =>
    `You are a helpful assistant. The user's name is ${ctx.name} and they are on the ${ctx.plan} plan.`,

  userId: async (req) => (await authenticate(req.headers.get('Authorization'))).id,

  tokenBudget: {
    used: (id) => db.tokensUsed(id),
    max: 50_000,
    onSpend: (id, n) => db.addTokens(id, n),
  },

  onLog: (log) => logger.info('ai-call', log),
})
```

---

## FAQ

**Does this send any data externally?**
No. `onLog` is a local callback — no HTTP calls, no external platform. You own the log entirely.

**What happens if I pass an unknown model?**
It throws at call time with a clear error message listing supported prefixes.

**What if I don't need auth or token budgets?**
`before`, `userId`, and `tokenBudget` are all optional. The minimal setup is just a model name.

**TypeScript support?**
Full — types for `HandlerOptions`, `TokenBudget`, and `LogPayload` are exported from the package.

---

## License

MIT
