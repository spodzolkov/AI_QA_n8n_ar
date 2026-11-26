import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../config/env.js";
import { extractGoogleDocId, fetchPublicGoogleDoc } from "./google-doc.js";
import { parseTextDocument } from "./text-doc.js";
import { parseWordDocument } from "./word-doc.js";

export interface ParsedInstructionDocument {
  source: string;
  resolvedLocation: string;
  sourceType: "google-doc" | "docx" | "doc" | "markdown" | "text" | "url";
  content: string;
  charCount: number;
}

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".docx", ".doc"]);

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

/**
 * Універсальне зчитування документа з інструкцією побудови/модифікації n8n флоу:
 * підтримує посилання на Google Docs, прямі текстові URL, а також локальні файли .md, .txt, .docx, .doc.
 */
export async function readInstructionDocument(
  rawSource: string,
  baseDir = getProjectRoot()
): Promise<ParsedInstructionDocument> {
  const source = rawSource.trim();
  if (!source) {
    throw new Error("Джерело документа порожнє. Вкажіть URL Google Docs або шлях до файлу (.md, .txt, .docx, .doc).");
  }

  if (isHttpUrl(source)) {
    if (extractGoogleDocId(source)) {
      const gdoc = await fetchPublicGoogleDoc(source);
      return {
        source,
        resolvedLocation: `google-doc:${gdoc.documentId} (${gdoc.format})`,
        sourceType: "google-doc",
        content: gdoc.content,
        charCount: gdoc.content.length,
      };
    }

    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Не вдалося завантажити документ за URL "${source}" (HTTP ${response.status}).`);
    }
    const text = (await response.text()).trim();
    return {
      source,
      resolvedLocation: source,
      sourceType: "url",
      content: text,
      charCount: text.length,
    };
  }

  // Перевіряємо як абсолютний або відносний шлях (включно з автоматичним пошуком у user-docs/)
  const candidates = path.isAbsolute(source)
    ? [source]
    : [path.resolve(baseDir, source), path.resolve(baseDir, "user-docs", source)];

  const resolvedPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolvedPath) {
    throw new Error(
      `Файл інструкції не знайдено: "${source}". Перевірено шляхи:\n- ${candidates.join("\n- ")}`
    );
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Непідтримуваний формат файлу "${ext}". Підтримуються: .md, .txt, .docx, .doc або посилання на Google Docs.`
    );
  }

  let content: string;
  let sourceType: ParsedInstructionDocument["sourceType"];

  if (ext === ".docx") {
    content = await parseWordDocument(resolvedPath);
    sourceType = "docx";
  } else if (ext === ".doc") {
    content = await parseWordDocument(resolvedPath);
    sourceType = "doc";
  } else if (ext === ".md" || ext === ".markdown") {
    content = await parseTextDocument(resolvedPath);
    sourceType = "markdown";
  } else {
    content = await parseTextDocument(resolvedPath);
    sourceType = "text";
  }

  if (!content) {
    throw new Error(`Файл "${resolvedPath}" порожній або не містить читабельного тексту.`);
  }

  return {
    source,
    resolvedLocation: resolvedPath,
    sourceType,
    content,
    charCount: content.length,
  };
}
