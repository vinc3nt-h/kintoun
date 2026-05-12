import Anthropic from '@anthropic-ai/sdk'
import { createTextStream } from '../stream.js'
import type { ProviderStreamParams } from '../stream.js'

export async function streamAnthropic(params: ProviderStreamParams): Promise<Response> {
  const { provider, model, system, messages, start, userId, budget, onLog } = params
  const client = new Anthropic()

  const stream = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: messages as Anthropic.MessageParam[],
    stream: true,
  })

  return createTextStream({ provider, model, start, userId, budget, onLog }, async (enqueue) => {
    let promptTokens = 0
    let completionTokens = 0

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        enqueue(event.delta.text)
      }
      if (event.type === 'message_start') promptTokens = event.message.usage.input_tokens
      if (event.type === 'message_delta') completionTokens = event.usage.output_tokens
    }

    return { promptTokens, completionTokens }
  })
}
