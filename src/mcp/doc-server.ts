import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkN8nConnection, getProjectRoot, loadEnvConfig } from "../config/env.js";
import { readInstructionDocument } from "../parsers/index.js";

const server = new McpServer({
  name: "doc-ingest-mcp",
  version: "1.0.0",
});

server.tool(
  "read_instruction_document",
  "Зчитує документ з інструкцією/ТЗ для створення або модифікації n8n флоу. Підтримує посилання на відкриті Google Docs (https://docs.google.com/document/d/...), а також локальні файли .md, .txt, .docx та .doc (абсолютні шляхи або відносні до кореня проєкту чи папки user-docs/).",
  {
    source: z
      .string()
      .min(1)
      .describe("URL документа Google Docs або шлях до локального файлу (.md, .txt, .docx, .doc)"),
  },
  async ({ source }) => {
    try {
      const parsed = await readInstructionDocument(source);
      const header = [
        `Джерело: ${parsed.source}`,
        `Тип документа: ${parsed.sourceType}`,
        `Розташування: ${parsed.resolvedLocation}`,
        `Обсяг тексту: ${parsed.charCount} символів`,
        "--- ПОЧАТОК ДОКУМЕНТА ---",
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: `${header}\n\n${parsed.content}\n\n--- КІНЕЦЬ ДОКУМЕНТА ---`,
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Помилка зчитування документа: ${errMsg}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "list_local_instruction_files",
  "Повертає список доступних локальних файлів інструкцій у папках user-docs/ та examples/ проєкту.",
  {},
  async () => {
    const root = getProjectRoot();
    const folders = ["user-docs", "examples"];
    const found: string[] = [];

    for (const folder of folders) {
      const dirPath = path.join(root, folder);
      if (!fs.existsSync(dirPath)) continue;
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name === ".gitkeep") continue;
        const ext = path.extname(entry.name).toLowerCase();
        if ([".md", ".markdown", ".txt", ".docx", ".doc"].includes(ext)) {
          found.push(`${folder}/${entry.name}`);
        }
      }
    }

    return {
      content: [
        {
          type: "text",
          text:
            found.length > 0
              ? `Знайдені локальні документи інструкцій:\n${found.map((f) => `- ${f}`).join("\n")}`
              : "У папках user-docs/ та examples/ наразі немає документів (.md, .txt, .docx, .doc).",
        },
      ],
    };
  }
);

server.tool(
  "check_n8n_health",
  "Перевіряє наявність локального .env та активне з'єднання з сервером n8n через Public REST API (/api/v1/workflows?limit=1).",
  {},
  async () => {
    const env = loadEnvConfig();
    const result = await checkN8nConnection(env.n8nApiUrl, env.n8nApiKey);
    return {
      isError: !result.ok,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: result.ok,
              baseUrl: result.baseUrl || "(не налаштовано)",
              hasEnvFile: env.hasEnvFile,
              status: result.status ?? null,
              message: result.message,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`[doc-ingest-mcp] Fatal error: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
