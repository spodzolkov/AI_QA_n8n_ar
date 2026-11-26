import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { getProjectRoot } from "../src/config/env.js";

describe("Інтеграційний JSON-RPC smoke-тест обох MCP-серверів", () => {
  const root = getProjectRoot();

  it("doc-ingest-mcp успішно піднімається по stdio та зчитує Markdown-інструкцію", async () => {
    const docServerScript = path.join(root, "dist", "mcp", "doc-server.js");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [docServerScript],
      cwd: root,
    });

    const client = new Client({ name: "smoke-test-client", version: "1.0.0" });
    await client.connect(transport);

    try {
      const toolsRes = await client.listTools();
      const toolNames = toolsRes.tools.map((t) => t.name);
      expect(toolNames).toContain("read_instruction_document");
      expect(toolNames).toContain("list_local_instruction_files");
      expect(toolNames).toContain("check_n8n_health");

      const readRes = await client.callTool({
        name: "read_instruction_document",
        arguments: { source: "examples/lead-processing-spec.md" },
      });

      const textBlock = (readRes.content as Array<{ type: string; text?: string }>)[0];
      expect(textBlock?.text).toContain("ПОЧАТОК ДОКУМЕНТА");
      expect(textBlock?.text).toContain("incoming-lead");
    } finally {
      await client.close();
    }
  }, 20000);

  it("n8n-launcher успішно піднімає локальний n8n-mcp по stdio та віддає інструменти роботи з n8n", async () => {
    const launcherScript = path.join(root, "dist", "mcp", "n8n-launcher.js");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [launcherScript],
      cwd: root,
      env: {
        ...(process.env as Record<string, string>),
        N8N_API_URL: "http://localhost:5678",
        N8N_API_KEY: "smoke_test_dummy_token",
      },
    });

    const client = new Client({ name: "smoke-test-n8n-client", version: "1.0.0" });
    await client.connect(transport);

    try {
      const toolsRes = await client.listTools();
      const toolNames = toolsRes.tools.map((t) => t.name);
      expect(toolNames.length).toBeGreaterThan(5);
      // Перевіряємо наявність як інструментів документації нод, так і управління воркфлоу n8n API
      expect(toolNames.some((n) => n.includes("node"))).toBe(true);
      expect(toolNames.some((n) => n.includes("workflow"))).toBe(true);
    } finally {
      await client.close();
    }
  }, 30000);
});
