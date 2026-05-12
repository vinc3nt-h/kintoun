export interface TokenBudget {
  used?: (userId: string) => number | Promise<number>
  max?: number | ((userId: string) => number | Promise<number>)
  onSpend?: (userId: string | undefined, tokens: number) => void | Promise<void>
}

export interface HandlerOptions {
  provider: Provider
  model: string
  /** Static string or a function that receives the context returned by `before` */
  system?: string | ((context: Record<string, unknown>) => string)
  /** Runs before the AI call. Return context to inject into `system`. Throw to return 401. */
  before?: (req: Request) => Promise<Record<string, unknown>>
  /** User identifier — constant or extracted from the request */
  userId?: string | ((req: Request) => string | Promise<string>)
  /** Per-user token budget enforcement */
  tokenBudget?: TokenBudget
  /** Called after each AI call completes — use it to store or forward the log */
  onLog?: (log: LogPayload) => void
}

export interface LogPayload {
  provider: Provider
  model: string
  prompt_tokens: number
  completion_tokens: number
  latency_ms: number
  status: 'success' | 'error'
  user_id?: string
}

export type Provider = 'openai' | 'anthropic' | 'google'
