import fs from "node:fs";
import path from "node:path";
import type { HarnessAdapter, HarnessContext, HarnessGenerationResult } from "./types.js";

function writeFileEnsureDir(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export const claudeCodeAdapter: HarnessAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  description: "Конфігурація .mcp.json, CLAUDE.md, скіл та slash-команда /n8n-build",

  getGeneratedRelativePaths(): string[] {
    return [
      ".mcp.json",
      "CLAUDE.md",
      ".claude/skills/n8n-flow-builder/SKILL.md",
      ".claude/commands/n8n-build.md",
    ];
  },

  generate(ctx: HarnessContext): HarnessGenerationResult {
    const mcpPath = path.join(ctx.projectRoot, ".mcp.json");
    const claudeMdPath = path.join(ctx.projectRoot, "CLAUDE.md");
    const skillPath = path.join(ctx.projectRoot, ".claude", "skills", "n8n-flow-builder", "SKILL.md");
    const commandPath = path.join(ctx.projectRoot, ".claude", "commands", "n8n-build.md");

    writeFileEnsureDir(
      mcpPath,
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

    writeFileEnsureDir(claudeMdPath, `${ctx.rulesContent.trim()}\n`);

    writeFileEnsureDir(
      skillPath,
      [
        "---",
        "name: n8n-flow-builder",
        "description: Створює або модифікує воркфлоу n8n за документом-інструкцією (Google Docs, .docx, .doc, .md, .txt) та ставить уточнюючі питання в чаті.",
        "---",
        "",
        ctx.flowSkillContent.trim(),
        "",
      ].join("\n")
    );

    writeFileEnsureDir(
      commandPath,
      [
        "---",
        "description: Створити або модифікувати n8n флоу на основі документа з інструкцією та узгодити відкриті питання",
        "---",
        "",
        "Вхідний запит / джерело інструкції від користувача: $ARGUMENTS",
        "",
        ctx.flowSkillContent.trim(),
        "",
      ].join("\n")
    );

    return {
      harness: "claude-code",
      displayName: this.displayName,
      generatedFiles: [mcpPath, claudeMdPath, skillPath, commandPath],
      postInitHint:
        "У Claude Code перезапустіть сесію (або виконайте /mcp для підтвердження доступу до серверів n8n-mcp та doc-ingest) і скористайтеся командою /n8n-build <шлях-або-URL>.",
    };
  },
};
