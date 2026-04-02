import { message } from 'antd'

// ── カスタムエラークラス ───────────────────────────────────────
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    msg?: string,
  ) {
    super(msg ?? detail)
    this.name = 'ApiError'
  }
}

// ── リクエストオプション ───────────────────────────────────────
interface RequestOptions {
  body?: unknown
  params?: Record<string, string | number | undefined>
  signal?: AbortSignal
  timeout?: number   // ms（デフォルト 60000）
}

// ── レスポンスエラーのパース ──────────────────────────────────
async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const json = await res.json()
    return (json?.detail as string) ?? res.statusText
  } catch {
    return res.statusText
  }
}

// ── 共通エラーハンドリング ────────────────────────────────────
function handleApiError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status === 422) {
      message.error('入力値に誤りがあります。')
    } else if (err.status === 404) {
      message.error('リソースが見つかりません。')
    } else if (err.status >= 500) {
      message.error(`サーバーエラーが発生しました: ${err.detail}`)
    } else {
      message.error(err.detail)
    }
  } else if (err instanceof DOMException && err.name === 'AbortError') {
    // isTimeout フラグがある場合のみタイムアウトメッセージを表示
    // （呼び出し元によるキャンセルは無視）
    if ((err as DOMException & { isTimeout?: boolean }).isTimeout) {
      message.error('接続がタイムアウトしました。')
    }
  }
  throw err
}

// ── メインリクエスト関数 ──────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, params, signal: outerSignal, timeout = 60_000 } = options

  // クエリパラメータ構築
  let url = `/api${path}`
  if (params) {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    if (query) url += `?${query}`
  }

  // タイムアウト用 AbortController
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => {
    const timeoutErr = new DOMException('Request timed out', 'AbortError') as DOMException & { isTimeout?: boolean }
    timeoutErr.isTimeout = true
    timeoutController.abort(timeoutErr)
  }, timeout)

  // 外部シグナルが abort されたら timeout controller も abort
  outerSignal?.addEventListener('abort', () => timeoutController.abort(outerSignal.reason))

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: timeoutController.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      const detail = await parseErrorDetail(res)
      throw new ApiError(res.status, detail)
    }

    // 204 No Content など body なしレスポンス対応
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as T
    }

    return (await res.json()) as T
  } catch (err) {
    clearTimeout(timeoutId)
    return handleApiError(err)
  }
}

// ── HTTP メソッドショートカット ───────────────────────────────
const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('GET', path, options),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...options, body }),

  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PUT', path, { ...options, body }),

  delete: <T = void>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('DELETE', path, options),
}

export default apiClient
