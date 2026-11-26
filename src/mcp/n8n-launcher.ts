import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { getProjectRoot, loadEnvConfig } from "../config/env.js";

interface ResolvedN8nMcpPackage {
  pkgDir: string;
  entryPath: string;
  nodeDbPath: string;
}

/**
 * Безпечний локальний stdio-лаунчер для n8n-mcp:
 * 1) Зчитує N8N_API_URL та N8N_API_KEY із локального .env (без витоку секретів у конфіги харнесів і без виводу в stdout).
 * 2) Знаходить локально встановлений бінарник n8n-mcp та його базу data/nodes.db у node_modules.
 * 3) Вимикає зовнішню телеметрію/перевірку версій та вмикає підтримку localhost для локального Docker n8n.
 */
function resolveN8nMcpPackage(): ResolvedN8nMcpPackage {
  const require = createRequire(import.meta.url);
  let pkgJsonPath: string;

  try {
    pkgJsonPath = require.resolve("n8n-mcp/package.json");
  } catch {
    const fallbackPath = path.join(getProjectRoot(), "node_modules", "n8n-mcp", "package.json");
    if (!fs.existsSync(fallbackPath)) {
      throw new Error(
        "Пакет 'n8n-mcp' не знайдено у node_modules. Спочатку виконайте встановлення залежностей через скіл /init або команду 'npm install'."
      );
    }
    pkgJsonPath = fallbackPath;
  }

  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
    main?: string;
  };

  let relativeBin: string | undefined;
  if (typeof pkg.bin === "string") {
    relativeBin = pkg.bin;
  } else if (pkg.bin && typeof pkg.bin === "object") {
    relativeBin = pkg.bin["n8n-mcp"] ?? Object.values(pkg.bin)[0];
  }

  const entryRelative = relativeBin ?? pkg.main;
  if (!entryRelative) {
    throw new Error(`Не вдалося визначити точку входу у ${pkgJsonPath}`);
  }

  const entryPath = path.resolve(pkgDir, entryRelative);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Точка входу n8n-mcp не існує за шляхом: ${entryPath}`);
  }

  const nodeDbPath = path.join(pkgDir, "data", "nodes.db");
  return { pkgDir, entryPath, nodeDbPath };
}

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "host.docker.internal"
    );
  } catch {
    return false;
  }
}

function startLauncher(): void {
  const resolved = resolveN8nMcpPackage();
  const envCfg = loadEnvConfig();

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    MCP_MODE: "stdio",
    LOG_LEVEL: "error",
    DISABLE_CONSOLE_OUTPUT: "true",
    N8N_MCP_TELEMETRY_DISABLED: "true",
    N8N_MCP_VERSION_CHECK_DISABLED: "true",
  };

  if (fs.existsSync(resolved.nodeDbPath) && !childEnv.NODE_DB_PATH) {
    childEnv.NODE_DB_PATH = resolved.nodeDbPath;
  }

  if (envCfg.n8nApiUrl) {
    childEnv.N8N_API_URL = envCfg.n8nApiUrl;
    if (isLocalhostUrl(envCfg.n8nApiUrl) && !childEnv.WEBHOOK_SECURITY_MODE) {
      childEnv.WEBHOOK_SECURITY_MODE = "moderate";
    }
  }

  if (envCfg.n8nApiKey && envCfg.n8nApiKey !== "your_n8n_api_key_here") {
    childEnv.N8N_API_KEY = envCfg.n8nApiKey;
  }

  // Додаємо підвищений ліміт купи V8 (--max-old-space-size=4096), щоб запобігти нативному падінню
  // SQLite-аддона в Node.js 22/24 (RemoveEnvironmentCleanupHook / Assertion failed: env != nullptr)
  // під час збирання сміття при валідації великих воркфлоу.
  const nodeArgs = [
    "--max-old-space-size=4096",
    "--initial-old-space-size=512",
    resolved.entryPath,
    ...process.argv.slice(2),
  ];

  const child = spawn(process.execPath, nodeArgs, {
    cwd: resolved.pkgDir,
    stdio: "inherit",
    env: childEnv,
  });

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("error", (err) => {
    process.stderr.write(`[n8n-launcher] Failed to spawn n8n-mcp: ${err.message}\n`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

try {
  startLauncher();
} catch (error) {
  process.stderr.write(
    `[n8n-launcher] Initialization error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
