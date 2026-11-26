import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanUserData } from "../src/cli/clean-user-data.js";
import { getProjectRoot } from "../src/config/env.js";
import { ALL_HARNESS_IDS, generateHarnessConfigs } from "../src/harnesses/index.js";

describe("Генератори конфігурацій для 4 харнесів та clean-user-data", () => {
  let tempWorkspace: string;
  const realRoot = getProjectRoot();

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "n8n-harness-test-"));

    // Копіюємо шаблони та стартові bootstrap-скіли init у тимчасовий воркспейс
    fs.cpSync(path.join(realRoot, "templates"), path.join(tempWorkspace, "templates"), {
      recursive: true,
    });

    const bootstrapFiles = [
      ".agents/skills/init/SKILL.md",
      ".claude/skills/init/SKILL.md",
      ".claude/commands/init.md",
      ".github/prompts/init.prompt.md",
      "user-docs/.gitkeep",
    ];

    for (const rel of bootstrapFiles) {
      const src = path.join(realRoot, rel);
      const dest = path.join(tempWorkspace, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  });

  afterEach(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it("генерує валідні конфігурації для Antigravity, Codex, Claude Code та VS Code Copilot без витоку секретів", () => {
    const fakeNode = "/usr/local/bin/node";
    const results = generateHarnessConfigs(ALL_HARNESS_IDS, tempWorkspace, fakeNode);
    expect(results).toHaveLength(4);

    // 1. Google Antigravity
    const agyMcp = JSON.parse(
      fs.readFileSync(
        path.join(tempWorkspace, ".agents/plugins/n8n-architect/mcp_config.json"),
        "utf8"
      )
    );
    expect(agyMcp.mcpServers["n8n-mcp"].command).toBe(fakeNode);
    expect(agyMcp.mcpServers["doc-ingest"].args[0]).toContain("doc-server.js");
    expect(JSON.stringify(agyMcp)).not.toContain("N8N_API_KEY");

    // 2. Claude Code
    const claudeMcp = JSON.parse(
      fs.readFileSync(path.join(tempWorkspace, ".mcp.json"), "utf8")
    );
    expect(claudeMcp.mcpServers["n8n-mcp"]).toBeDefined();
    expect(fs.existsSync(path.join(tempWorkspace, ".claude/commands/n8n-build.md"))).toBe(true);

    // 3. OpenAI Codex
    const codexToml = fs.readFileSync(path.join(tempWorkspace, ".codex/config.toml"), "utf8");
    expect(codexToml).toContain("[mcp_servers.n8n-mcp]");
    expect(codexToml).toContain("[mcp_servers.doc-ingest]");
    expect(fs.existsSync(path.join(tempWorkspace, "AGENTS.md"))).toBe(true);

    // 4. VS Code GitHub Copilot
    const vscodeMcp = JSON.parse(
      fs.readFileSync(path.join(tempWorkspace, ".vscode/mcp.json"), "utf8")
    );
    expect(vscodeMcp.servers["n8n-mcp"].type).toBe("stdio");
    expect(fs.existsSync(path.join(tempWorkspace, ".github/prompts/n8n-build.prompt.md"))).toBe(
      true
    );
  });

  it("cleanUserData видаляє всі згенеровані конфігурації, але зберігає стартові скіли init", () => {
    generateHarnessConfigs(ALL_HARNESS_IDS, tempWorkspace);
    fs.writeFileSync(path.join(tempWorkspace, ".env"), "N8N_API_" + "KEY=secret123\n", "utf8");
    fs.writeFileSync(path.join(tempWorkspace, "user-docs/my-spec.md"), "Secret spec", "utf8");

    const cleanRes = cleanUserData(tempWorkspace, { includeEnvAndDocs: true });
    expect(cleanRes.preservedInitSkills).toHaveLength(4);
    expect(fs.existsSync(path.join(tempWorkspace, ".mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(tempWorkspace, ".vscode/mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(tempWorkspace, ".codex/config.toml"))).toBe(false);
    expect(fs.existsSync(path.join(tempWorkspace, ".agents/plugins"))).toBe(false);
    expect(fs.existsSync(path.join(tempWorkspace, ".env"))).toBe(false);
    expect(fs.existsSync(path.join(tempWorkspace, "user-docs/my-spec.md"))).toBe(false);

    // Перевіряємо, що стартові скіли init та .gitkeep залишилися на місці
    expect(fs.existsSync(path.join(tempWorkspace, ".agents/skills/init/SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempWorkspace, ".claude/skills/init/SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempWorkspace, ".claude/commands/init.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempWorkspace, ".github/prompts/init.prompt.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempWorkspace, "user-docs/.gitkeep"))).toBe(true);
  });
});
