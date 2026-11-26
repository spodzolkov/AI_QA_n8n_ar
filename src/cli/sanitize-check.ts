import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProjectRoot } from "../config/env.js";
import { getAllGeneratedRelativePaths } from "../harnesses/index.js";

export interface SanitizeViolation {
  file: string;
  line?: number;
  rule: string;
  detail: string;
}

const SAFE_PLACEHOLDER_KEYS = new Set([
  "your_n8n_api_key_here",
  "<key>",
  "<your_api_key>",
  "placeholder",
  "test_key",
  "dummy_key",
]);

const SAFE_EXAMPLE_DOMAINS = new Set([
  "https://example.app.n8n.cloud",
  "https://your-instance.app.n8n.cloud",
]);

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Перевіряє, чи шлях файлу є забороненим для публікації у чистому Git-репозиторії.
 */
export function checkForbiddenTrackedPath(rawRelPath: string): SanitizeViolation | null {
  const rel = normalizeRelPath(rawRelPath);
  const baseName = path.posix.basename(rel);
  const ext = path.posix.extname(rel).toLowerCase();

  // 1. Файли .env (дозволено лише .env.example)
  if ((baseName === ".env" || baseName.startsWith(".env.")) && baseName !== ".env.example") {
    return {
      file: rel,
      rule: "forbidden-env-file",
      detail: "Файли середовища .env містять секрети користувача і не можуть зберігатися в Git.",
    };
  }

  // 2. Користувацькі документи Word (.doc / .docx) будь-де в репо або файли в user-docs/
  if (rel.startsWith("user-docs/") && rel !== "user-docs/.gitkeep") {
    return {
      file: rel,
      rule: "forbidden-user-doc",
      detail: "Робочі документи з папки user-docs/ не повинні потрапляти у чистий репозиторій.",
    };
  }

  if (ext === ".docx" || ext === ".doc") {
    return {
      file: rel,
      rule: "forbidden-office-doc",
      detail: "Файли .doc/.docx розцінюються як користувацькі документи і заборонені в чистому шаблоні.",
    };
  }

  // 3. Дані локального n8n або експорти воркфлоу
  if (rel.startsWith("n8n_data/") || rel.startsWith("workflows-local/")) {
    return {
      file: rel,
      rule: "forbidden-local-n8n-state",
      detail: "Локальні дані інстансу n8n та робочі дампи воркфлоу не повинні комітитися в Git.",
    };
  }

  // 4. Згенеровані локальні конфіги харнесів
  const generatedSet = new Set(getAllGeneratedRelativePaths().map(normalizeRelPath));
  if (
    generatedSet.has(rel) ||
    rel.startsWith(".agents/plugins/") ||
    rel.startsWith(".codex/")
  ) {
    return {
      file: rel,
      rule: "forbidden-generated-harness-config",
      detail:
        "Згенеровані конфігурації харнесів містять локальні шляхи машини користувача і мають залишатися поза Git.",
    };
  }

  return null;
}

/**
 * Сканує текстовий вміст файлу на наявність реальних ключів API, JWT-токенів, приватних хмарних URL n8n
 * та локальних шляхів профілю користувача ОС.
 */
export function scanContentForSensitiveData(content: string, rawRelPath: string): SanitizeViolation[] {
  const rel = normalizeRelPath(rawRelPath);
  const violations: SanitizeViolation[] = [];
  const lines = content.split(/\r?\n/);

  const jwtRegex = /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/;
  const n8nKeyAssignRegex = /(?<![.\w])N8N_API_KEY\s*=\s*["']?([^\s"'#;]+)["']?/;
  const n8nCloudRegex = /https?:\/\/[a-z0-9-]+\.app\.n8n\.cloud\b/gi;
  // Локальні домашні директорії користувачів (ігноруємо шаблонні плейсхолдери типу <user> або username)
  const winUserPathRegex = /\b[A-Za-z]:(?:\\|\/)Users(?:\\|\/)(?![<>{}*]|username\b|user\b|Public\b)([A-Za-z0-9_.-]{2,})/i;
  const unixUserPathRegex = /(?:^|[\s"'`=])\/(?:Users|home)\/(?![<>{}*]|username\b|user\b|node\b)([A-Za-z0-9_.-]{2,})/;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNo = idx + 1;

    const keyMatch = line.match(n8nKeyAssignRegex);
    if (keyMatch) {
      const val = keyMatch[1].trim();
      const lowerVal = val.toLowerCase();
      if (
        val.length > 0 &&
        !SAFE_PLACEHOLDER_KEYS.has(lowerVal) &&
        !val.startsWith("$") &&
        !val.startsWith("<")
      ) {
        violations.push({
          file: rel,
          line: lineNo,
          rule: "leaked-n8n-api-key",
          detail: "Виявлено непорожнє значення N8N_API_KEY у відстежуваному файлі.",
        });
      }
    }

    if (jwtRegex.test(line)) {
      violations.push({
        file: rel,
        line: lineNo,
        rule: "leaked-jwt-token",
        detail: "Виявлено рядок, схожий на JWT / API токен (eyJ...).",
      });
    }

    const cloudMatches = line.match(n8nCloudRegex);
    if (cloudMatches) {
      for (const matchedUrl of cloudMatches) {
        if (!SAFE_EXAMPLE_DOMAINS.has(matchedUrl.toLowerCase())) {
          violations.push({
            file: rel,
            line: lineNo,
            rule: "leaked-private-n8n-url",
            detail: `Виявлено приватний домен інстансу n8n Cloud (${matchedUrl}).`,
          });
        }
      }
    }

    const winMatch = line.match(winUserPathRegex);
    if (winMatch) {
      violations.push({
        file: rel,
        line: lineNo,
        rule: "leaked-local-user-path",
        detail: `Виявлено персональний локальний шлях профілю Windows (Users/${winMatch[1]}).`,
      });
    }

    const unixMatch = line.match(unixUserPathRegex);
    if (unixMatch) {
      violations.push({
        file: rel,
        line: lineNo,
        rule: "leaked-local-user-path",
        detail: `Виявлено персональний локальний шлях домашньої директорії (${unixMatch[1]}).`,
      });
    }
  }

  return violations;
}

function walkWorkspaceFallback(rootDir: string): string[] {
  const skippedDirs = new Set([
    ".git",
    "node_modules",
    "dist",
    "n8n_data",
    "workflows-local",
    ".codex",
  ]);
  const generatedRelSet = new Set(getAllGeneratedRelativePaths().map(normalizeRelPath));
  const results: string[] = [];

  function walk(currentDir: string): void {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      const rel = normalizeRelPath(path.relative(rootDir, fullPath));

      if (entry.isDirectory()) {
        if (skippedDirs.has(entry.name) || rel === ".agents/plugins") continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name === ".env" || (entry.name.startsWith(".env.") && entry.name !== ".env.example")) {
          continue;
        }
        if (rel.startsWith("user-docs/") && rel !== "user-docs/.gitkeep") {
          continue;
        }
        if (generatedRelSet.has(rel)) {
          continue;
        }
        results.push(rel);
      }
    }
  }

  walk(rootDir);
  return results;
}

export function getCandidateRepoFiles(projectRoot = getProjectRoot()): string[] {
  const gitDir = path.join(projectRoot, ".git");
  if (fs.existsSync(gitDir)) {
    try {
      const output = execSync("git ls-files --cached --others --exclude-standard", {
        cwd: projectRoot,
        encoding: "utf8",
      });
      return output
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(normalizeRelPath);
    } catch {
      // Фолбек на обхід дерева
    }
  }
  return walkWorkspaceFallback(projectRoot);
}

const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".db"]);

export function runSanitizeAudit(projectRoot = getProjectRoot()): {
  clean: boolean;
  scannedFiles: number;
  violations: SanitizeViolation[];
} {
  const files = getCandidateRepoFiles(projectRoot);
  const violations: SanitizeViolation[] = [];

  for (const rel of files) {
    const pathViolation = checkForbiddenTrackedPath(rel);
    if (pathViolation) {
      violations.push(pathViolation);
      continue;
    }

    const fullPath = path.join(projectRoot, rel);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }

    const ext = path.extname(rel).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf8");
    violations.push(...scanContentForSensitiveData(content, rel));
  }

  return {
    clean: violations.length === 0,
    scannedFiles: files.length,
    violations,
  };
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const audit = runSanitizeAudit();
  if (audit.clean) {
    console.log(
      `✅ Перевірка чистоти пройдена успішно! Проскановано файлів шаблону: ${audit.scannedFiles}. Користувацьких даних чи секретів не виявлено.`
    );
    process.exit(0);
  } else {
    console.error("\n❌ ВИЯВЛЕНО КОРИСТУВАЦЬКІ ДАНІ АБО СЕКРЕТИ (публікацію в Git заблоковано):");
    for (const v of audit.violations) {
      const loc = v.line ? `${v.file}:${v.line}` : v.file;
      console.error(`  - [${v.rule}] ${loc} -> ${v.detail}`);
    }
    console.error("\nВиконайте 'npm run clean:user-data' або приберіть вказані дані перед комітом.\n");
    process.exit(1);
  }
}
