import fs from "node:fs";
import path from "node:path";
import { antigravityAdapter } from "./antigravity.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import type { HarnessAdapter, HarnessContext, HarnessGenerationResult, HarnessId } from "./types.js";
import { vscodeCopilotAdapter } from "./vscode-copilot.js";

export const HARNESS_ADAPTERS: Record<HarnessId, HarnessAdapter> = {
  antigravity: antigravityAdapter,
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
  "vscode-copilot": vscodeCopilotAdapter,
};

export const ALL_HARNESS_IDS: HarnessId[] = [
  "antigravity",
  "codex",
  "claude-code",
  "vscode-copilot",
];

export function buildHarnessContext(projectRoot: string, nodePath = process.execPath): HarnessContext {
  const rulesPath = path.join(projectRoot, "templates", "rules-core.md");
  const skillPath = path.join(projectRoot, "templates", "skill-flow-builder.md");

  const rulesContent = fs.readFileSync(rulesPath, "utf8");
  const flowSkillContent = fs.readFileSync(skillPath, "utf8");

  return {
    projectRoot,
    nodePath,
    docServerScript: path.join(projectRoot, "dist", "mcp", "doc-server.js"),
    n8nLauncherScript: path.join(projectRoot, "dist", "mcp", "n8n-launcher.js"),
    rulesContent,
    flowSkillContent,
  };
}

export function generateHarnessConfigs(
  harnessIds: HarnessId[],
  projectRoot: string,
  nodePath = process.execPath
): HarnessGenerationResult[] {
  const ctx = buildHarnessContext(projectRoot, nodePath);
  return harnessIds.map((id) => {
    const adapter = HARNESS_ADAPTERS[id];
    if (!adapter) {
      throw new Error(`Невідомий харнес "${id}". Доступні: ${ALL_HARNESS_IDS.join(", ")}`);
    }
    return adapter.generate(ctx);
  });
}

export function getAllGeneratedRelativePaths(): string[] {
  const unique = new Set<string>();
  for (const adapter of Object.values(HARNESS_ADAPTERS)) {
    for (const rel of adapter.getGeneratedRelativePaths()) {
      unique.add(rel);
    }
  }
  return [...unique];
}
