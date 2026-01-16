declare module 'sentencepiece-js' {
  export function cleanText(text: string): string;

  export class SentencePieceProcessor {
    load(path: string): Promise<void> | void;
    encodeIds(text: string): number[];
    encodePieces?(text: string): string[];
    decodeIds?(ids: number[]): string;
  }
}

