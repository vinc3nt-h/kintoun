import type { LogPayload, Provider, TokenBudget } from './types.js'

export interface StreamParams {
  provider: Provider
  model: string
  start: number
  userId?: string
  budget?: TokenBudget
  onLog?: (log: LogPayload) => void
}

export interface ProviderStreamParams extends StreamParams {
  system?: string
  messages: Array<{ role: string; content: string }>
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

/**
 * Wraps a streaming AI call in a text/plain Response.
 * Handles logging and budget tracking after the stream ends — never in the critical path.
 */
export function createTextStream(
  params: StreamParams,
  run: (enqueue: (text: string) => void) => Promise<TokenUsage>,
): Response {
  const { provider, model, start, userId, budget, onLog } = params
  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      const enqueue = (text: string) => controller.enqueue(encoder.encode(text))
      let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 }

      const emit = (status: 'success' | 'error') =>
        onLog?.({
          provider,
          model,
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          latency_ms: Date.now() - start,
          status,
          user_id: userId,
        })

      try {
        usage = await run(enqueue)
        emit('success')
        if (budget?.onSpend) budget.onSpend(userId, usage.promptTokens + usage.completionTokens)
      } catch (err) {
        emit('error')
        controller.error(err)
        return
      }

      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
