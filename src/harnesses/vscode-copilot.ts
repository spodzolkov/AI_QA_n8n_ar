import fs from "node:fs";
import path from "node:path";
import type { HarnessAdapter, HarnessContext, HarnessGenerationResult } from "./types.js";

function writeFileEnsureDir(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export const vscodeCopilotAdapter: HarnessAdapter = {
  id: "vscode-copilot",
  displayName: "VS Code (GitHub Copilot Agent Mode)",
  description: "Конфігурація .vscode/mcp.json, .github/copilot-instructions.md та промпт /n8n-build",

  getGeneratedRelativePaths(): string[] {
    return [
      ".vscode/mcp.json",
      ".github/copilot-instructions.md",
      ".github/prompts/n8n-build.prompt.md",
    ];
  },

  generate(ctx: HarnessContext): HarnessGenerationResult {
    const vscodeMcpPath = path.join(ctx.projectRoot, ".vscode", "mcp.json");
    const copilotInstructionsPath = path.join(ctx.projectRoot, ".github", "copilot-instructions.md");
    const promptPath = path.join(ctx.projectRoot, ".github", "prompts", "n8n-build.prompt.md");

    writeFileEnsureDir(
      vscodeMcpPath,
      JSON.stringify(
        {
          servers: {
            "n8n-mcp": {
              type: "stdio",
              command: ctx.nodePath,
              args: [ctx.n8nLauncherScript],
              cwd: ctx.projectRoot,
            },
            "doc-ingest": {
              type: "stdio",
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

    writeFileEnsureDir(copilotInstructionsPath, `${ctx.rulesContent.trim()}\n`);

    writeFileEnsureDir(
      promptPath,
      [
        "---",
        "mode: 'agent'",
        "description: 'Створити або модифікувати n8n флоу на основі документа з інструкцією та поставити уточнюючі питання'",
        "---",
        "",
        ctx.flowSkillContent.trim(),
        "",
      ].join("\n")
    );

    return {
      harness: "vscode-copilot",
      displayName: this.displayName,
      generatedFiles: [vscodeMcpPath, copilotInstructionsPath, promptPath],
      postInitHint:
        "У VS Code відкрийте Copilot Chat у режимі Agent, підтвердьте запуск MCP серверів із .vscode/mcp.json та викличте /n8n-build із посиланням або шляхом до документа.",
    };
  },
};
