import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeN8nBaseUrl } from "../src/config/env.js";
import { extractGoogleDocId } from "../src/parsers/google-doc.js";
import { readInstructionDocument } from "../src/parsers/index.js";

/**
 * Генерує мінімальний валідний ZIP-архів (метод Store = 0) у пам'яті для створення тестового .docx у tmp-папці
 * без зберігання жодних бінарних .docx фікстур у репозиторії.
 */
function buildMinimalZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const dataBuf = Buffer.from(entry.content, "utf8");
    const crc = crc32(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function createSampleDocxBuffer(paragraphText: string): Buffer {
  return buildMinimalZip([
    {
      name: "[Content_Types].xml",
      content:
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      content:
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "word/document.xml",
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body><w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p></w:body>` +
        `</w:document>`,
    },
  ]);
}

describe("Парсери документів та нормалізація URL", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "n8n-doc-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("нормалізує N8N_API_URL без зайвих слешів та /api/v1", () => {
    expect(normalizeN8nBaseUrl("http://localhost:5678/")).toBe("http://localhost:5678");
    expect(normalizeN8nBaseUrl("https://example.app.n8n.cloud/api/v1/")).toBe(
      "https://example.app.n8n.cloud"
    );
  });

  it("розпізнає ID документа з різних посилань Google Docs", () => {
    const standard = extractGoogleDocId(
      "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_12345/edit?usp=sharing"
    );
    expect(standard?.documentId).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz_12345");
    expect(standard?.exportMarkdownUrl).toContain("/export?format=md");

    const multiUser = extractGoogleDocId(
      "https://docs.google.com/document/u/1/d/Doc_998877/view"
    );
    expect(multiUser?.documentId).toBe("Doc_998877");

    expect(extractGoogleDocId("https://example.com/not-a-google-doc")).toBeNull();
  });

  it("зчитує демонстраційний Markdown-файл інструкції", async () => {
    const result = await readInstructionDocument("examples/lead-processing-spec.md");
    expect(result.sourceType).toBe("markdown");
    expect(result.content).toContain("Webhook");
    expect(result.charCount).toBeGreaterThan(100);
  });

  it("зчитує текстовий .txt файл та .docx документ через mammoth", async () => {
    const txtPath = path.join(tmpDir, "spec.txt");
    fs.writeFileSync(txtPath, "Крок 1: Отримати лист з Gmail\nКрок 2: Створити задачу в Jira", "utf8");

    const txtParsed = await readInstructionDocument(txtPath);
    expect(txtParsed.sourceType).toBe("text");
    expect(txtParsed.content).toContain("Jira");

    const docxPath = path.join(tmpDir, "spec.docx");
    fs.writeFileSync(docxPath, createSampleDocxBuffer("Автоматизація рахунків через Telegram Bot та n8n"));

    const docxParsed = await readInstructionDocument(docxPath);
    expect(docxParsed.sourceType).toBe("docx");
    expect(docxParsed.content).toContain("Telegram Bot");
  });
});
