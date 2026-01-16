export interface AnthropicCountTokensParams {
  /** Claude model id, e.g. `claude-sonnet-4-5` */
  model: string;
  /** Anthropic API key. If omitted, uses process.env.ANTHROPIC_API_KEY */
  apiKey?: string;
  /** Text-only helper; converted into a single user message. */
  text?: string;
  /** Optional system prompt. */
  system?: string;
  /** Full messages payload (wins over `text` when provided). */
  messages?: unknown;
  /** Override API base URL (default: https://api.anthropic.com) */
  baseUrl?: string;
  /** Override Anthropic version header (default: 2023-06-01) */
  version?: string;
  /** Optional fetch implementation. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

function getFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  const f = fetchImpl ?? globalThis.fetch;
  if (!f) {
    throw new Error('globalThis.fetch is not available; pass fetch in AnthropicCountTokensParams');
  }
  return f;
}

function getApiKey(explicit: string | undefined): string {
  const key = explicit ?? (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : undefined);
  if (!key) throw new Error('Anthropic API key missing (set ANTHROPIC_API_KEY or pass apiKey)');
  return key;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function countAnthropicInputTokens(params: AnthropicCountTokensParams): Promise<number> {
  const fetchImpl = getFetch(params.fetch);
  const apiKey = getApiKey(params.apiKey);
  const baseUrl = (params.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const version = params.version ?? '2023-06-01';

  const messages =
    params.messages ??
    (typeof params.text === 'string'
      ? [{ role: 'user', content: params.text }]
      : null);
  if (!messages) {
    throw new Error('Anthropic token counting requires either `messages` or `text`');
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages,
  };
  if (typeof params.system === 'string' && params.system.trim()) {
    body.system = params.system;
  }

  const response = await fetchImpl(`${baseUrl}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': version,
    },
    body: JSON.stringify(body),
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
    throw new Error(`Anthropic count_tokens failed: ${msg}`);
  }

  const inputTokens = dataObj?.input_tokens;
  if (typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) || inputTokens < 0) {
    throw new Error('Anthropic count_tokens returned invalid input_tokens');
  }
  return inputTokens;
}
