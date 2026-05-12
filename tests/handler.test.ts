import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kintoun } from '../src/handler.js'

vi.mock('openai', () => ({
  default: vi.fn(() => ({ chat: { completions: { create: mockOpenAICreate } } })),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: mockAnthropicCreate } })),
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContentStream: mockGeminiCreate,
    })),
  })),
}))

const mockOpenAICreate = vi.fn()
const mockAnthropicCreate = vi.fn()
const mockGeminiCreate = vi.fn()

async function* makeOpenAIStream(
  chunks: string[],
  usage = { prompt_tokens: 10, completion_tokens: 5 },
) {
  for (const content of chunks) yield { choices: [{ delta: { content } }], usage: null }
  yield { choices: [], usage }
}

async function* makeAnthropicStream(
  chunks: string[],
  inputTokens = 10,
  outputTokens = 5,
) {
  yield { type: 'message_start', message: { usage: { input_tokens: inputTokens } } }
  for (const text of chunks) {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
  }
  yield { type: 'message_delta', usage: { output_tokens: outputTokens } }
}

async function readStream(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value)
  }
  return out
}

function makeRequest(body: unknown): Request {
  return new Request('https://example.com/api/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('kintoun', () => {
  afterEach(() => vi.clearAllMocks())

  function makeGeminiStream(chunks: string[], promptTokens = 10, completionTokens = 5) {
    async function* stream() {
      for (const text of chunks) yield { text: () => text }
    }
    return Promise.resolve({
      stream: stream(),
      response: Promise.resolve({
        usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: completionTokens },
      }),
    })
  }

  // ─── before hook ──────────────────────────────────────────────────────────

  describe('before hook', () => {
    it('proceeds and returns context when before resolves', async () => {
      mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['ok']))
      let receivedContext: Record<string, unknown> = {}

      const handler = kintoun({
        provider: 'openai',
        model: 'gpt-4o',
        before: async () => ({ userId: 'abc' }),
        system: (ctx) => {
          receivedContext = ctx
          return 'sys'
        },
      })

      const res = await handler(makeRequest({ messages: [] }))
      expect(res.status).toBe(200)
      expect(receivedContext).toEqual({ userId: 'abc' })
    })

    it('returns 401 when before throws, makes no AI call', async () => {
      const handler = kintoun({
        provider: 'openai',
        model: 'gpt-4o',
        before: async () => { throw new Error('not allowed') },
      })

      const res = await handler(makeRequest({ messages: [] }))
      expect(res.status).toBe(401)
      expect(mockOpenAICreate).not.toHaveBeenCalled()
    })

    it('receives a cloned request (original body still readable)', async () => {
      mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['ok']))
      let beforeBody: unknown

      const handler = kintoun({
        provider: 'openai',
        model: 'gpt-4o',
        before: async (req) => {
          beforeBody = await req.json()
          return {}
        },
      })

      const req = makeRequest({ messages: [{ role: 'user', content: 'hi' }] })
      await handler(req)
      expect(beforeBody).toEqual({ messages: [{ role: 'user', content: 'hi' }] })
    })
  })

  // ─── system ───────────────────────────────────────────────────────────────

  it('passes system as a static string to the provider', async () => {
    mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['hi']))

    const handler = kintoun({ provider: 'openai', model: 'gpt-4o', system: 'You are helpful.' })
    const res = await handler(makeRequest({ messages: [] }))
    await readStream(res)

    expect(mockOpenAICreate).toHaveBeenCalledWith(
      expect.objectContaining({ messages: expect.arrayContaining([{ role: 'system', content: 'You are helpful.' }]) }),
    )
  })

  it('passes context from before to system function', async () => {
    mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['hi']))
    let systemArg: Record<string, unknown> = {}

    const handler = kintoun({
      provider: 'openai',
      model: 'gpt-4o',
      before: async () => ({ role: 'admin' }),
      system: (ctx) => { systemArg = ctx; return 'prompt' },
    })

    await handler(makeRequest({ messages: [] }))
    expect(systemArg).toEqual({ role: 'admin' })
  })

  // ─── userId resolution ────────────────────────────────────────────────────

  it('uses userId string directly', async () => {
    const onLog = vi.fn()
    mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['hi']))

    const handler = kintoun({ provider: 'openai', model: 'gpt-4o', userId: 'user-42', onLog })
    const res = await handler(makeRequest({ messages: [] }))
    await readStream(res)

    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-42' }))
  })

  it('calls userId callback with cloned request', async () => {
    const onLog = vi.fn()
    mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['hi']))

    const handler = kintoun({
      provider: 'openai',
      model: 'gpt-4o',
      userId: async () => 'user-from-callback',
      onLog,
    })
    const res = await handler(makeRequest({ messages: [] }))
    await readStream(res)

    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-from-callback' }))
  })

  it('sends undefined user_id when userId is absent', async () => {
    const onLog = vi.fn()
    mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['hi']))

    const handler = kintoun({ provider: 'openai', model: 'gpt-4o', onLog })
    const res = await handler(makeRequest({ messages: [] }))
    await readStream(res)

    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ user_id: undefined }))
  })

  // ─── token budget ─────────────────────────────────────────────────────────

  describe('token budget', () => {
    it('proceeds when used < max', async () => {
      mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['ok']))

      const handler = kintoun({
        provider: 'openai',
        model: 'gpt-4o',
        userId: 'u1',
        tokenBudget: { used: () => 50, max: 100, onSpend: vi.fn() },
      })

      const res = await handler(makeRequest({ messages: [] }))
      expect(res.status).toBe(200)
    })

    it('returns 429 when used >= max', async () => {
      const handler = kintoun({
        provider: 'openai',
        model: 'gpt-4o',
        userId: 'u1',
        tokenBudget: { used: () => 100, max: 100, onSpend: vi.fn() },
      })

      const res = await handler(makeRequest({ messages: [] }))
      expect(res.status).toBe(429)
      const body = await res.json()
      expect(body).toEqual({ error: 'Token budget exceeded' })
      expect(mockOpenAICreate).not.toHaveBeenCalled()
    })

    it('calls max as a callback with userId', async () => {
      mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['ok']))
      const maxFn = vi.fn().mockResolvedValue(1000)

      const handler = kintoun({
        provider: 'openai',
        model: 'gpt-4o',
        userId: 'u1',
        tokenBudget: { used: () => 0, max: maxFn, onSpend: vi.fn() },
      })

      await handler(makeRequest({ messages: [] }))
      expect(maxFn).toHaveBeenCalledWith('u1')
    })

    it('calls onSpend after stream ends', async () => {
      const onSpend = vi.fn()
      mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['ok'], { prompt_tokens: 5, completion_tokens: 3 }))

      const handler = kintoun({
        provider: 'openai',
        model: 'gpt-4o',
        userId: 'u1',
        tokenBudget: { used: () => 0, max: 1000, onSpend },
      })

      const res = await handler(makeRequest({ messages: [] }))
      await readStream(res)
      expect(onSpend).toHaveBeenCalledWith('u1', 8)
    })

    it('calls onSpend without userId when userId is not set', async () => {
      const onSpend = vi.fn()
      mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['ok'], { prompt_tokens: 2, completion_tokens: 1 }))

      const handler = kintoun({
        provider: 'openai',
        model: 'gpt-4o',
        tokenBudget: { onSpend },
      })

      const res = await handler(makeRequest({ messages: [] }))
      await readStream(res)
      expect(onSpend).toHaveBeenCalledWith(undefined, 3)
    })

    it('throws synchronously when used/max are set without userId', async () => {
      const handler = kintoun({
        provider: 'openai',
        model: 'gpt-4o',
        tokenBudget: { used: () => 0, max: 100 },
      })

      await expect(handler(makeRequest({ messages: [] }))).rejects.toThrow(
        'tokenBudget.used / tokenBudget.max require userId to be set',
      )
    })
  })

  // ─── body parsing ─────────────────────────────────────────────────────────

  it('returns 400 for invalid JSON body', async () => {
    const handler = kintoun({ provider: 'openai', model: 'gpt-4o' })
    const req = new Request('https://example.com/', { method: 'POST', body: 'not json' })
    const res = await handler(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when messages is not an array', async () => {
    const handler = kintoun({ provider: 'openai', model: 'gpt-4o' })
    const res = await handler(makeRequest({ messages: 'not-an-array' }))
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/messages must be an array/)
  })

  // ─── OpenAI streaming ─────────────────────────────────────────────────────

  describe('OpenAI streaming', () => {
    it('streams concatenated chunks with correct Content-Type', async () => {
      mockOpenAICreate.mockResolvedValue(makeOpenAIStream(['Hello', ', ', 'world']))

      const handler = kintoun({ provider: 'openai', model: 'gpt-4o' })
      const res = await handler(makeRequest({ messages: [] }))

      expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
      expect(await readStream(res)).toBe('Hello, world')
    })

    it('calls onLog with provider, correct token counts, status: success, and user_id', async () => {
      const onLog = vi.fn()
      mockOpenAICreate.mockResolvedValue(
        makeOpenAIStream(['hi'], { prompt_tokens: 12, completion_tokens: 7 }),
      )

      const handler = kintoun({ provider: 'openai', model: 'gpt-4o', userId: 'u1', onLog })
      const res = await handler(makeRequest({ messages: [] }))
      await readStream(res)

      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o',
          prompt_tokens: 12,
          completion_tokens: 7,
          status: 'success',
          user_id: 'u1',
        }),
      )
    })

    it('calls onLog with status: error when stream throws', async () => {
      const onLog = vi.fn()

      async function* failingStream() {
        yield { choices: [{ delta: { content: 'partial' } }], usage: null }
        throw new Error('stream failure')
      }

      mockOpenAICreate.mockResolvedValue(failingStream())

      const handler = kintoun({ provider: 'openai', model: 'gpt-4o', onLog })
      const res = await handler(makeRequest({ messages: [] }))

      try { await readStream(res) } catch { /* expected */ }

      expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
    })
  })

  // ─── Anthropic streaming ──────────────────────────────────────────────────

  describe('Anthropic streaming', () => {
    it('streams text from content_block_delta events', async () => {
      mockAnthropicCreate.mockResolvedValue(makeAnthropicStream(['Bonjour', ', ', 'monde']))

      const handler = kintoun({ provider: 'anthropic', model: 'claude-opus-4-6' })
      const res = await handler(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))

      expect(await readStream(res)).toBe('Bonjour, monde')
    })

    it('calls onLog with provider, input_tokens and output_tokens', async () => {
      const onLog = vi.fn()
      mockAnthropicCreate.mockResolvedValue(makeAnthropicStream(['hi'], 15, 8))

      const handler = kintoun({ provider: 'anthropic', model: 'claude-opus-4-6', onLog })
      const res = await handler(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))
      await readStream(res)

      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic', prompt_tokens: 15, completion_tokens: 8 }),
      )
    })

    it('calls onLog with status: error when stream throws', async () => {
      const onLog = vi.fn()

      async function* failingAnthropicStream() {
        yield { type: 'message_start', message: { usage: { input_tokens: 5 } } }
        throw new Error('anthropic stream failure')
      }

      mockAnthropicCreate.mockResolvedValue(failingAnthropicStream())

      const handler = kintoun({ provider: 'anthropic', model: 'claude-opus-4-6', onLog })
      const res = await handler(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))
      try { await readStream(res) } catch { /* expected */ }

      expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
    })
  })

  // ─── Gemini streaming ─────────────────────────────────────────────────────

  describe('Gemini streaming', () => {
    const originalKey = process.env['GOOGLE_API_KEY']
    beforeEach(() => { process.env['GOOGLE_API_KEY'] = 'test-key' })
    afterEach(() => {
      if (originalKey === undefined) delete process.env['GOOGLE_API_KEY']
      else process.env['GOOGLE_API_KEY'] = originalKey
    })

    it('throws when GOOGLE_API_KEY is missing', async () => {
      delete process.env['GOOGLE_API_KEY']
      const handler = kintoun({ provider: 'google', model: 'gemini-1.5-flash' })
      await expect(handler(makeRequest({ messages: [] }))).rejects.toThrow('Missing GOOGLE_API_KEY')
    })

    it('streams text chunks', async () => {
      mockGeminiCreate.mockResolvedValue(makeGeminiStream(['Hello', ', ', 'Gemini']))

      const handler = kintoun({ provider: 'google', model: 'gemini-1.5-flash' })
      const res = await handler(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))

      expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
      expect(await readStream(res)).toBe('Hello, Gemini')
    })

    it('calls onLog with provider and token counts from usageMetadata', async () => {
      const onLog = vi.fn()
      mockGeminiCreate.mockResolvedValue(makeGeminiStream(['hi'], 20, 10))

      const handler = kintoun({ provider: 'google', model: 'gemini-1.5-flash', onLog })
      const res = await handler(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))
      await readStream(res)

      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google', prompt_tokens: 20, completion_tokens: 10 }),
      )
    })

    it('maps assistant role to model role', async () => {
      let capturedContents: unknown

      mockGeminiCreate.mockImplementation((args: { contents: Array<{ role: string }> }) => {
        capturedContents = args.contents
        return makeGeminiStream(['ok'])
      })

      const handler = kintoun({ provider: 'google', model: 'gemini-1.5-flash' })
      const res = await handler(makeRequest({
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi there' },
          { role: 'user', content: 'thanks' },
        ],
      }))
      await readStream(res)

      expect(capturedContents).toEqual([
        { role: 'user', parts: [{ text: 'hello' }] },
        { role: 'model', parts: [{ text: 'hi there' }] },
        { role: 'user', parts: [{ text: 'thanks' }] },
      ])
    })

    it('calls onLog with status: error when stream throws', async () => {
      const onLog = vi.fn()

      async function* failingGeminiStream() {
        yield { text: () => 'partial' }
        throw new Error('gemini stream failure')
      }

      mockGeminiCreate.mockResolvedValue({
        stream: failingGeminiStream(),
        response: Promise.resolve({ usageMetadata: {} }),
      })

      const handler = kintoun({ provider: 'google', model: 'gemini-1.5-flash', onLog })
      const res = await handler(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))
      try { await readStream(res) } catch { /* expected */ }

      expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
    })
  })

  it('passes max_tokens: 4096 to Anthropic', async () => {
    mockAnthropicCreate.mockResolvedValue(makeAnthropicStream(['ok']))

    const handler = kintoun({ provider: 'anthropic', model: 'claude-opus-4-6' })
    const res = await handler(makeRequest({ messages: [{ role: 'user', content: 'hi' }] }))
    await readStream(res)

    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 4096 }),
    )
  })
})
