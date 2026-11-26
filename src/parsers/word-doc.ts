import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { extractTextPreservingOoxmlMath } from "./ooxml-math.js";

/**
 * Зчитує документи Microsoft Word (.docx та legacy .doc).
 * Для .docx спочатку перевіряє наявність OOXML-формул (<m:oMath>), щоб не втратити вирази n8n із символами $,
 * далі використовує mammoth (конвертація у структурований Markdown) з фолбеком на word-extractor.
 */
export async function parseWordDocument(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".docx") {
    try {
      const zipBuf = fs.readFileSync(filePath);
      const mathPreservedText = extractTextPreservingOoxmlMath(zipBuf);
      if (mathPreservedText && mathPreservedText.length > 0) {
        return mathPreservedText;
      }
    } catch {
      // Переходимо до стандартного парсингу через mammoth
    }

    try {
      // mammoth має convertToMarkdown у рантаймі (навіть якщо частина типів декларує лише convertToHtml/extractRawText)
      const mammothAny = mammoth as unknown as {
        convertToMarkdown?: (input: { path: string }) => Promise<{ value: string }>;
        extractRawText: (input: { path: string }) => Promise<{ value: string }>;
      };

      if (typeof mammothAny.convertToMarkdown === "function") {
        const mdResult = await mammothAny.convertToMarkdown({ path: filePath });
        if (mdResult.value && mdResult.value.trim().length > 0) {
          return mdResult.value.trim();
        }
      }

      const rawResult = await mammothAny.extractRawText({ path: filePath });
      if (rawResult.value && rawResult.value.trim().length > 0) {
        return rawResult.value.trim();
      }
    } catch {
      // Фолбек на word-extractor нижче
    }
  }

  const extractor = new WordExtractor();
  const doc = await extractor.extract(filePath);
  const parts = [
    doc.getHeaders({ includeFooters: false })?.trim(),
    doc.getBody()?.trim(),
    doc.getFootnotes()?.trim(),
  ].filter((part): part is string => Boolean(part && part.length > 0));

  return parts.join("\n\n").trim();
}
