import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from '../services/http'

afterEach(() => vi.unstubAllGlobals())

describe('HTTP error contract', () => {
  it('surfaces the backend nested error message to the user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      contract_version: 'xunyi-research/v1',
      error: { code: 'model_not_configured', message: 'DeepSeek 尚未在服务器配置中启用。' },
    }), { status: 422, headers: { 'Content-Type': 'application/json' } })))

    await expect(request('/ts-api/api/v1/agent-runs')).rejects.toMatchObject({
      status: 422,
      message: 'DeepSeek 尚未在服务器配置中启用。',
    })
  })
})
