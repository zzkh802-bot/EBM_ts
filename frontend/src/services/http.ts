export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown,
  ) {
    super(message)
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const ownController = new AbortController()
  const timer = window.setTimeout(() => ownController.abort(), timeoutMs)
  const signal = init.signal
    ? AbortSignal.any([init.signal, ownController.signal])
    : ownController.signal
  try {
    const response = await fetch(path, {
      ...init,
      signal,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    })
    const text = await response.text()
    let payload: T & { message?: string }
    try {
      payload = (text ? JSON.parse(text) : {}) as T & { message?: string }
    } catch {
      throw new HttpError(
        `后端返回了非 JSON 响应 (${response.status})：${text.slice(0, 120) || '空响应'}`,
        response.status,
        text,
      )
    }
    if (!response.ok || (payload as { ok?: boolean }).ok === false) {
      throw new HttpError(payload.message || `请求失败 (${response.status})`, response.status, payload)
    }
    return payload
  } finally {
    window.clearTimeout(timer)
  }
}

export const postJson = <T>(path: string, body: unknown, signal?: AbortSignal, timeoutMs?: number) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), signal }, timeoutMs)
