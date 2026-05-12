import { streamOpenAI } from './providers/openai.js'
import { streamAnthropic } from './providers/anthropic.js'
import { streamGemini } from './providers/gemini.js'
import type { HandlerOptions } from './types.js'

const BUDGET_EXCEEDED = JSON.stringify({ error: 'Token budget exceeded' })

export function kintoun(options: HandlerOptions): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    let context: Record<string, unknown> = {}

    if (options.before) {
      try {
        context = await options.before(req.clone())
      } catch {
        return new Response('Unauthorized', { status: 401 })
      }
    }

    const userId = await resolveUserId(options.userId, req)

    if (options.tokenBudget && (options.tokenBudget.used || options.tokenBudget.max)) {
      if (!userId) throw new Error('tokenBudget.used / tokenBudget.max require userId to be set')
      const { used, max } = options.tokenBudget
      const usedCount = used ? await used(userId) : 0
      const maxCount = max ? (typeof max === 'function' ? await max(userId) : max) : Infinity
      if (usedCount >= maxCount) {
        return new Response(BUDGET_EXCEEDED, {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    let messages: Array<{ role: string; content: string }>
    try {
      const body = await req.json() as { messages: unknown }
      if (!Array.isArray(body?.messages)) {
        return new Response('Invalid request body: messages must be an array', { status: 400 })
      }
      messages = body.messages as Array<{ role: string; content: string }>
    } catch {
      return new Response('Invalid JSON body', { status: 400 })
    }

    const system = typeof options.system === 'function' ? options.system(context) : options.system
    const start = Date.now()
    const { provider } = options
    const commonParams = { provider, model: options.model, system, messages, start, userId, budget: options.tokenBudget, onLog: options.onLog }

    if (provider === 'openai') return streamOpenAI(commonParams)
    if (provider === 'anthropic') return streamAnthropic(commonParams)
    return streamGemini(commonParams) // google
  }
}

async function resolveUserId(
  userId: HandlerOptions['userId'],
  req: Request,
): Promise<string | undefined> {
  if (!userId) return undefined
  if (typeof userId === 'string') return userId
  return userId(req.clone())
}
