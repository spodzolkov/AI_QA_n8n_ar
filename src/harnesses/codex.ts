import fs from "node:fs";
import path from "node:path";
import type { HarnessAdapter, HarnessContext, HarnessGenerationResult } from "./types.js";

function writeFileEnsureDir(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  displayName: "OpenAI Codex",
  description: "Конфігурація .codex/config.toml, правила AGENTS.md та скіл у .agents/skills/",

  getGeneratedRelativePaths(): string[] {
    return [
      ".codex/config.toml",
      "AGENTS.md",
      ".agents/skills/n8n-flow-builder/SKILL.md",
    ];
  },

  generate(ctx: HarnessContext): HarnessGenerationResult {
    const codexTomlPath = path.join(ctx.projectRoot, ".codex", "config.toml");
    const agentsMdPath = path.join(ctx.projectRoot, "AGENTS.md");
    const skillPath = path.join(ctx.projectRoot, ".agents", "skills", "n8n-flow-builder", "SKILL.md");

    const tomlContent = [
      "# Автоматично згенеровано скілом/CLI init (файл ігнорується Git)",
      "",
      "[mcp_servers.n8n-mcp]",
      "enabled = true",
      `command = ${toTomlString(ctx.nodePath)}`,
      `args = [${toTomlString(ctx.n8nLauncherScript)}]`,
      `cwd = ${toTomlString(ctx.projectRoot)}`,
      "startup_timeout_sec = 30",
      "tool_timeout_sec = 60",
      "",
      "[mcp_servers.doc-ingest]",
      "enabled = true",
      `command = ${toTomlString(ctx.nodePath)}`,
      `args = [${toTomlString(ctx.docServerScript)}]`,
      `cwd = ${toTomlString(ctx.projectRoot)}`,
      "startup_timeout_sec = 15",
      "tool_timeout_sec = 60",
      "",
    ].join("\n");

    writeFileEnsureDir(codexTomlPath, tomlContent);
    writeFileEnsureDir(agentsMdPath, `${ctx.rulesContent.trim()}\n`);
    writeFileEnsureDir(
      skillPath,
      [
        "---",
        "name: n8n-flow-builder",
        "description: Створює або модифікує воркфлоу n8n за документом-інструкцією (Google Docs, .docx, .doc, .md, .txt) та проводить двоетапне уточнення вимог у чаті.",
        "---",
        "",
        ctx.flowSkillContent.trim(),
        "",
      ].join("\n")
    );

    return {
      harness: "codex",
      displayName: this.displayName,
      generatedFiles: [codexTomlPath, agentsMdPath, skillPath],
      postInitHint:
        "В OpenAI Codex переконайтеся, що проєкт позначено як trusted (щоб завантажився .codex/config.toml), перевірте підключення командою /mcp та передайте документ інструкції у чат.",
    };
  },
};
