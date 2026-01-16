export interface GeminiCountTokensParams {
  /** Gemini model id, e.g. `gemini-2.0-flash` */
  model: string;
  /** Gemini API key. If omitted, uses process.env.GEMINI_API_KEY */
  apiKey?: string;
  /** Text-only helper; converted into a basic `contents` payload. */
  text?: string;
  /** Full `contents` payload (wins over `text` when provided). */
  contents?: unknown;
  /** Override API base URL (default: https://generativelanguage.googleapis.com) */
  baseUrl?: string;
  /** Optional fetch implementation. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

function getFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  const f = fetchImpl ?? globalThis.fetch;
  if (!f) {
    throw new Error('globalThis.fetch is not available; pass fetch in GeminiCountTokensParams');
  }
  return f;
}

type StatusError = Error & { status: number };

function withStatus(message: string, status: number): StatusError {
  const err = new Error(message) as StatusError;
  err.status = status;
  return err;
}

function getApiKey(explicit: string | undefined): string {
  const key = explicit ?? (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined);
  if (!key) throw withStatus('Gemini API key missing (set GEMINI_API_KEY or pass apiKey)', 401);
  return key;
}

function toContents(text: string): unknown {
  return [{ role: 'user', parts: [{ text }] }];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function countGeminiTokens(params: GeminiCountTokensParams): Promise<number> {
  const fetchImpl = getFetch(params.fetch);
  const apiKey = getApiKey(params.apiKey);
  const baseUrl = (params.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');

  const contents =
    params.contents ??
    (typeof params.text === 'string'
      ? toContents(params.text)
      : null);
  if (!contents) {
    throw new Error('Gemini token counting requires either `contents` or `text`');
  }

  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(params.model)}:countTokens?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents }),
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  const dataObj = asRecord(data);
  if (!response.ok) {
    const errorObj = asRecord(dataObj?.error);
    const msg =
      typeof errorObj?.message === 'string'
        ? errorObj.message
        : typeof dataObj?.message === 'string'
          ? dataObj.message
          : `HTTP ${response.status}`;
    throw withStatus(`Gemini countTokens failed: ${msg}`, response.status);
  }

  const totalTokens = dataObj?.totalTokens ?? dataObj?.total_tokens ?? dataObj?.total_tokens_count;
  if (typeof totalTokens !== 'number' || !Number.isFinite(totalTokens) || totalTokens < 0) {
    throw new Error('Gemini countTokens returned invalid totalTokens');
  }
  return totalTokens;
}
