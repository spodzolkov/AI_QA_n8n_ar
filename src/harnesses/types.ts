export type HarnessId = "antigravity" | "claude-code" | "codex" | "vscode-copilot";

export interface HarnessContext {
  projectRoot: string;
  nodePath: string;
  docServerScript: string;
  n8nLauncherScript: string;
  rulesContent: string;
  flowSkillContent: string;
}

export interface HarnessGenerationResult {
  harness: HarnessId;
  displayName: string;
  generatedFiles: string[];
  postInitHint: string;
}

export interface HarnessAdapter {
  id: HarnessId;
  displayName: string;
  description: string;
  generate(ctx: HarnessContext): HarnessGenerationResult;
  getGeneratedRelativePaths(): string[];
}
