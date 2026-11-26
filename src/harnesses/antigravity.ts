import fs from "node:fs";
import path from "node:path";
import type { HarnessAdapter, HarnessContext, HarnessGenerationResult } from "./types.js";

function writeFileEnsureDir(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export const antigravityAdapter: HarnessAdapter = {
  id: "antigravity",
  displayName: "Google Antigravity",
  description: "Локальний плагін воркспейсу (.agents/plugins/n8n-architect/) з MCP, правилами та скілом",

  getGeneratedRelativePaths(): string[] {
    return [
      ".agents/plugins/n8n-architect/plugin.json",
      ".agents/plugins/n8n-architect/mcp_config.json",
      ".agents/plugins/n8n-architect/rules/AGENTS.md",
      ".agents/plugins/n8n-architect/skills/n8n-flow-builder/SKILL.md",
    ];
  },

  generate(ctx: HarnessContext): HarnessGenerationResult {
    const pluginRoot = path.join(ctx.projectRoot, ".agents", "plugins", "n8n-architect");

    const pluginManifestPath = path.join(pluginRoot, "plugin.json");
    const mcpConfigPath = path.join(pluginRoot, "mcp_config.json");
    const rulesPath = path.join(pluginRoot, "rules", "AGENTS.md");
    const skillPath = path.join(pluginRoot, "skills", "n8n-flow-builder", "SKILL.md");

    writeFileEnsureDir(
      pluginManifestPath,
      JSON.stringify(
        {
          name: "n8n-architect",
          displayName: "n8n Flow Architect",
          version: "1.0.0",
          description:
            "Підключення до n8n через MCP, читання документів-інструкцій та інтерактивне проєктування воркфлоу.",
        },
        null,
        2
      ) + "\n"
    );

    writeFileEnsureDir(
      mcpConfigPath,
      JSON.stringify(
        {
          mcpServers: {
            "n8n-mcp": {
              command: ctx.nodePath,
              args: [ctx.n8nLauncherScript],
              cwd: ctx.projectRoot,
            },
            "doc-ingest": {
              command: ctx.nodePath,
              args: [ctx.docServerScript],
              cwd: ctx.projectRoot,
            },
          },
        },
        null,
        2
      ) + "\n"
    );

    writeFileEnsureDir(
      rulesPath,
      `---\ntrigger: always_on\n---\n\n${ctx.rulesContent.trim()}\n`
    );

    writeFileEnsureDir(
      skillPath,
      [
        "---",
        "name: n8n-flow-builder",
        "description: Створює або модифікує воркфлоу n8n на основі документа з інструкцією (Google Docs, .docx, .doc, .md, .txt) та проводить двоетапне уточнення вимог у чаті.",
        "---",
        "",
        ctx.flowSkillContent.trim(),
        "",
      ].join("\n")
    );

    return {
      harness: "antigravity",
      displayName: this.displayName,
      generatedFiles: [pluginManifestPath, mcpConfigPath, rulesPath, skillPath],
      postInitHint:
        "Google Antigravity автоматично виявить плагін у .agents/plugins/n8n-architect/. Перевірте вкладку MCP Servers у налаштуваннях або перезапустіть сесію чату, щоб інструменти з'явилися в контексті.",
    };
  },
};
