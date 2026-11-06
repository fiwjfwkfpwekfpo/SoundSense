export interface HttpOptions { method?: 'GET' | 'POST'; body?: string; headers?: Readonly<Record<string, string>> }
export interface HttpClient { text(url: string, signal?: AbortSignal, options?: HttpOptions): Promise<string> }
export class HttpFailure extends Error {
  constructor(readonly status: number, readonly responseText: string, readonly retryAfter?: number) { super(`HTTP ${status}`); this.name = 'HttpFailure'; }
}
export async function getJson<T>(http: HttpClient, url: string, signal?: AbortSignal): Promise<T> { return JSON.parse(await http.text(url, signal)) as T; }
