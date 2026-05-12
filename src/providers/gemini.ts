import { GoogleGenerativeAI } from '@google/generative-ai'
import { createTextStream } from '../stream.js'
import type { ProviderStreamParams } from '../stream.js'

export async function streamGemini(params: ProviderStreamParams): Promise<Response> {
  const { provider, model, system, messages, start, userId, budget, onLog } = params
  const apiKey = process.env['GOOGLE_API_KEY']
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY environment variable')
  const client = new GoogleGenerativeAI(apiKey)

  const generativeModel = client.getGenerativeModel({
    model,
    systemInstruction: system,
  })

  // Gemini uses 'model' instead of 'assistant' for the assistant role
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const result = await generativeModel.generateContentStream({ contents })

  return createTextStream({ provider, model, start, userId, budget, onLog }, async (enqueue) => {
    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) enqueue(text)
    }

    const response = await result.response
    const usage = response.usageMetadata

    return {
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
    }
  })
}
