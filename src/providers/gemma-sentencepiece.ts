export interface GemmaSentencePieceCountTokensParams {
  /** Filesystem path to a SentencePiece model file (e.g. Gemma `tokenizer.model`). */
  modelPath: string;
  text: string;
}

type SentencePieceModule = {
  SentencePieceProcessor?: new () => {
    load: (path: string) => Promise<void> | void;
    encodeIds: (text: string) => number[];
  };
  cleanText?: (text: string) => string;
  default?: unknown;
};

async function loadSentencePiece(): Promise<SentencePieceModule> {
  try {
    const mod = (await import('sentencepiece-js')) as unknown as SentencePieceModule;
    // Some builds export through `default`.
    if (mod.SentencePieceProcessor || mod.cleanText) return mod;
    if (
      mod.default &&
      typeof mod.default === 'object' &&
      (mod.default as Record<string, unknown>).SentencePieceProcessor
    ) {
      return mod.default as SentencePieceModule;
    }
    return mod;
  } catch {
    throw new Error(
      'Local Gemma SentencePiece tokenization requires the optional dependency `sentencepiece-js`. Install it and try again.'
    );
  }
}

export async function countGemmaSentencePieceTokens(params: GemmaSentencePieceCountTokensParams): Promise<number> {
  const sp = await loadSentencePiece();
  const defaults = (sp.default && typeof sp.default === 'object' ? (sp.default as Record<string, unknown>) : null) ?? {};
  const SentencePieceProcessor =
    sp.SentencePieceProcessor ?? (defaults.SentencePieceProcessor as SentencePieceModule['SentencePieceProcessor'] | undefined);
  const cleanText =
    sp.cleanText ?? (defaults.cleanText as SentencePieceModule['cleanText'] | undefined);

  if (!SentencePieceProcessor || typeof SentencePieceProcessor !== 'function') {
    throw new Error('sentencepiece-js did not export SentencePieceProcessor as expected');
  }

  const processor = new SentencePieceProcessor();
  const loaded = processor.load(params.modelPath);
  if (loaded instanceof Promise) await loaded;

  const cleaned = typeof cleanText === 'function' ? cleanText(params.text) : params.text;
  const ids = processor.encodeIds(cleaned);
  if (!Array.isArray(ids)) {
    throw new Error('sentencepiece-js returned invalid ids from encodeIds');
  }
  return ids.length;
}
