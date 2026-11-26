import zlib from "node:zlib";

/**
 * Витягує сирий XML файлу word/document.xml із буфера .docx (ZIP-архіву) за допомогою вбудованого node:zlib.
 * Підтримує методи стиснення Store (0) та Deflate (8).
 */
export function readDocumentXmlFromDocxBuffer(zipBuffer: Buffer): string | null {
  // Пошук End of Central Directory (EOCD = 0x06054b50) з кінця буфера
  const minEocdSize = 22;
  const maxSearch = Math.min(zipBuffer.length, 65557);
  let eocdOffset = -1;

  for (let i = zipBuffer.length - minEocdSize; i >= zipBuffer.length - maxSearch; i--) {
    if (i >= 0 && zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return null;
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let ptr = centralDirOffset;
  for (let idx = 0; idx < totalEntries && ptr + 46 <= zipBuffer.length; idx++) {
    if (zipBuffer.readUInt32LE(ptr) !== 0x02014b50) {
      break;
    }

    const compressionMethod = zipBuffer.readUInt16LE(ptr + 10);
    const compressedSize = zipBuffer.readUInt32LE(ptr + 20);
    const fileNameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(ptr + 42);

    const entryName = zipBuffer.subarray(ptr + 46, ptr + 46 + fileNameLen).toString("utf8");
    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (entryName !== "word/document.xml") {
      continue;
    }

    if (localHeaderOffset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      return null;
    }

    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = zipBuffer.subarray(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) {
      return rawSlice.toString("utf8");
    }
    if (compressionMethod === 8) {
      return zlib.inflateRawSync(rawSlice).toString("utf8");
    }
    return null;
  }

  return null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Перевіряє, чи містить word/document.xml математичні блоки OOXML (<m:oMath>),
 * у які Google Docs / MS Word часто перетворює вирази n8n із парними знаками $ (наприклад, $('NodeA')...$('NodeB')),
 * та повертає відновлений текст документа зі збереженням символів $ і вмісту формул.
 */
export function extractTextPreservingOoxmlMath(zipBuffer: Buffer): string | null {
  let xml: string | null;
  try {
    xml = readDocumentXmlFromDocxBuffer(zipBuffer);
  } catch {
    return null;
  }

  if (!xml || !/<m:oMath\b/.test(xml)) {
    return null;
  }

  // Google Docs перетворює текст між двома символами $...$ на <m:oMath>...</m:oMath>, з'їдаючи самі знаки $.
  // Обгортання <m:oMath> назад у $...$ відновлює вихідні вирази n8n типу $('Node 1') ... $('Node 2').
  const withRestoredMath = xml.replace(/<m:oMath\b[^>]*>([\s\S]*?)<\/m:oMath>/g, (_full, inner: string) => {
    const mathText = Array.from(inner.matchAll(/<m:t\b[^>]*>([\s\S]*?)<\/m:t>/g))
      .map((m) => decodeXmlEntities(m[1]))
      .join("");
    return mathText ? `$${mathText}$` : "";
  });

  const plain = withRestoredMath
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeXmlEntities(plain)
    .replace(/\t+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
