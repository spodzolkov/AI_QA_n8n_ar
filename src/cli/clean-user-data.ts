import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProjectRoot } from "../config/env.js";
import { getAllGeneratedRelativePaths } from "../harnesses/index.js";

export interface CleanResult {
  removedPaths: string[];
  preservedInitSkills: string[];
}

const PROTECTED_BOOTSTRAP_FILES = [
  ".agents/skills/init/SKILL.md",
  ".claude/skills/init/SKILL.md",
  ".claude/commands/init.md",
  ".github/prompts/init.prompt.md",
];

function removeEmptyDirIfPossible(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  try {
    const items = fs.readdirSync(dirPath);
    if (items.length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {
    // Ігноруємо некритичні помилки
  }
}

/**
 * Очищує всі згенеровані під конкретного користувача конфігурації харнесів,
 * гарантовано залишаючи стартовий bootstrap-скіл init недоторканим.
 * Якщо includeEnvAndDocs = true (--all), також видаляє .env та робочі файли в user-docs/.
 */
export function cleanUserData(
  projectRoot = getProjectRoot(),
  options: { includeEnvAndDocs?: boolean } = {}
): CleanResult {
  const removedPaths: string[] = [];

  for (const rel of getAllGeneratedRelativePaths()) {
    if (PROTECTED_BOOTSTRAP_FILES.includes(rel.replace(/\\/g, "/"))) {
      continue;
    }
    const target = path.join(projectRoot, rel);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      removedPaths.push(rel);
    }
  }

  const extraGeneratedDirs = [
    path.join(projectRoot, ".agents", "plugins"),
    path.join(projectRoot, ".agents", "skills", "n8n-flow-builder"),
    path.join(projectRoot, ".claude", "skills", "n8n-flow-builder"),
    path.join(projectRoot, ".codex"),
  ];

  for (const dir of extraGeneratedDirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removedPaths.push(path.relative(projectRoot, dir).replace(/\\/g, "/"));
    }
  }

  removeEmptyDirIfPossible(path.join(projectRoot, ".vscode"));

  if (options.includeEnvAndDocs) {
    const envPath = path.join(projectRoot, ".env");
    if (fs.existsSync(envPath)) {
      fs.rmSync(envPath, { force: true });
      removedPaths.push(".env");
    }

    const userDocsDir = path.join(projectRoot, "user-docs");
    if (fs.existsSync(userDocsDir)) {
      for (const entry of fs.readdirSync(userDocsDir)) {
        if (entry === ".gitkeep") continue;
        const full = path.join(userDocsDir, entry);
        fs.rmSync(full, { recursive: true, force: true });
        removedPaths.push(`user-docs/${entry}`);
      }
    }

    const localWorkflowsDir = path.join(projectRoot, "workflows-local");
    if (fs.existsSync(localWorkflowsDir)) {
      fs.rmSync(localWorkflowsDir, { recursive: true, force: true });
      removedPaths.push("workflows-local");
    }
  }

  const preservedInitSkills = PROTECTED_BOOTSTRAP_FILES.filter((rel) =>
    fs.existsSync(path.join(projectRoot, rel))
  );

  return {
    removedPaths,
    preservedInitSkills,
  };
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const includeAll = process.argv.includes("--all");
  const result = cleanUserData(getProjectRoot(), { includeEnvAndDocs: includeAll });

  console.log("🧹 Очищення локальних користувацьких конфігурацій виконано.");
  if (result.removedPaths.length > 0) {
    console.log("Видалені артефакти:");
    for (const p of result.removedPaths) {
      console.log(`  - ${p}`);
    }
  } else {
    console.log("Згенерованих конфігурацій харнесів не виявлено — робочий простір вже чистий.");
  }

  console.log(
    `Збережено стартових bootstrap-файлів init: ${result.preservedInitSkills.length}/${PROTECTED_BOOTSTRAP_FILES.length}`
  );
  if (!includeAll) {
    console.log("💡 Підказка: щоб додатково видалити .env та вміст user-docs/, додайте прапорець '-- --all'.");
  }
}
