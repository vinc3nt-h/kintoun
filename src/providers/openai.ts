import OpenAI from 'openai'
import { createTextStream } from '../stream.js'
import type { ProviderStreamParams } from '../stream.js'

export async function streamOpenAI(params: ProviderStreamParams): Promise<Response> {
  const { provider, model, system, messages, start, userId, budget, onLog } = params
  const client = new OpenAI()

  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = system
    ? [{ role: 'system', content: system }]
    : []

  const stream = await client.chat.completions.create({
    model,
    messages: [...systemMessages, ...(messages as OpenAI.Chat.ChatCompletionMessageParam[])],
    stream: true,
    stream_options: { include_usage: true },
  })

  return createTextStream({ provider, model, start, userId, budget, onLog }, async (enqueue) => {
    let promptTokens = 0
    let completionTokens = 0

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) enqueue(content)
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens
        completionTokens = chunk.usage.completion_tokens
      }
    }

    return { promptTokens, completionTokens }
  })
}
