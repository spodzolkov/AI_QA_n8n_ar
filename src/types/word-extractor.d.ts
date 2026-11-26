declare module "word-extractor" {
  export interface ExtractedWordDocument {
    getBody(): string;
    getHeaders(options?: { includeFooters?: boolean }): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getAnnotation(): string;
  }

  export default class WordExtractor {
    extract(input: string | Buffer): Promise<ExtractedWordDocument>;
  }
}
