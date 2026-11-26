import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export interface N8nEnvConfig {
  n8nApiUrl: string;
  n8nApiKey: string;
  envFilePath: string;
  hasEnvFile: boolean;
}

export interface N8nHealthCheckResult {
  ok: boolean;
  status?: number;
  baseUrl: string;
  n8nVersion?: string | null;
  workflowCountSample?: number;
  observedNodeTypeVersions?: Record<string, number>;
  message: string;
}

export function getProjectRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  // src/config/env.ts або dist/config/env.js -> 2 рівні вгору до кореня репозиторію
  return path.resolve(path.dirname(currentFile), "..", "..");
}

/**
 * Нормалізує базовий URL інстансу n8n (без завершального слеша та без дублювання /api/v1).
 */
export function normalizeN8nBaseUrl(rawUrl: string): string {
  let cleaned = rawUrl.trim().replace(/\/+$/, "");
  if (cleaned.toLowerCase().endsWith("/api/v1")) {
    cleaned = cleaned.slice(0, -"/api/v1".length).replace(/\/+$/, "");
  }
  return cleaned;
}

/**
 * Безпечно зчитує .env через dotenv.parse (гарантовано без виводу в stdout, щоб не ламати stdio MCP).
 */
export function loadEnvConfig(projectRoot = getProjectRoot()): N8nEnvConfig {
  const envFilePath = path.join(projectRoot, ".env");
  let fileVars: Record<string, string> = {};
  const hasEnvFile = fs.existsSync(envFilePath);

  if (hasEnvFile) {
    const raw = fs.readFileSync(envFilePath, "utf8");
    fileVars = dotenv.parse(raw);
  }

  const rawUrl = process.env.N8N_API_URL || fileVars.N8N_API_URL || "";
  const rawKey = process.env.N8N_API_KEY || fileVars.N8N_API_KEY || "";

  return {
    n8nApiUrl: rawUrl ? normalizeN8nBaseUrl(rawUrl) : "",
    n8nApiKey: rawKey.trim(),
    envFilePath,
    hasEnvFile,
  };
}

export function writeEnvConfig(
  n8nApiUrl: string,
  n8nApiKey: string,
  projectRoot = getProjectRoot()
): string {
  const envFilePath = path.join(projectRoot, ".env");
  const normalizedUrl = normalizeN8nBaseUrl(n8nApiUrl);
  const content = [
    "# Локальна конфігурація підключення до інстансу n8n (Автоматично створено скілом/CLI init)",
    "# УВАГА: Цей файл ігнорується Git (.gitignore). Не публікуйте його у відкритих репозиторіях.",
    `N8N_API_URL=${normalizedUrl}`,
    `N8N_API_KEY=${n8nApiKey.trim()}`,
    "",
  ].join("\n");

  fs.writeFileSync(envFilePath, content, "utf8");
  return envFilePath;
}

/**
 * Перевіряє доступність n8n Public REST API (/api/v1/workflows?limit=1) та валідність ключа.
 */
export async function checkN8nConnection(
  rawUrl?: string,
  rawApiKey?: string,
  timeoutMs = 8000
): Promise<N8nHealthCheckResult> {
  const env = loadEnvConfig();
  const baseUrl = normalizeN8nBaseUrl(rawUrl ?? env.n8nApiUrl);
  const apiKey = (rawApiKey ?? env.n8nApiKey).trim();

  if (!baseUrl) {
    return {
      ok: false,
      baseUrl: "",
      message:
        "Не задано N8N_API_URL у файлі .env. Виконайте ініціалізацію проєкту (/init або npm run init).",
    };
  }

  if (!apiKey || apiKey === "your_n8n_api_key_here") {
    return {
      ok: false,
      baseUrl,
      message:
        "Не задано дійсний N8N_API_KEY у файлі .env. Створіть API-ключ у n8n (Settings -> n8n API) та запустіть /init.",
    };
  }

  const endpoint = `${baseUrl}/api/v1/workflows?limit=5`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-N8N-API-KEY": apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyPreview = (await response.text().catch(() => "")).slice(0, 200);
      return {
        ok: false,
        status: response.status,
        baseUrl,
        message: `Сервер n8n відповів помилкою HTTP ${response.status} (${endpoint}). ${
          response.status === 401 || response.status === 403
            ? "Перевірте правильність N8N_API_KEY."
            : bodyPreview
        }`.trim(),
      };
    }

    const json = (await response.json()) as {
      data?: Array<{ nodes?: Array<{ type?: string; typeVersion?: number }> }>;
    };
    const workflows = Array.isArray(json?.data) ? json.data : [];
    const sampleCount = workflows.length;

    const observedNodeTypeVersions: Record<string, number> = {};
    for (const wf of workflows) {
      for (const n of wf.nodes ?? []) {
        if (n.type && typeof n.typeVersion === "number") {
          const prev = observedNodeTypeVersions[n.type];
          if (prev === undefined || n.typeVersion > prev) {
            observedNodeTypeVersions[n.type] = n.typeVersion;
          }
        }
      }
    }

    let n8nVersion: string | null = null;
    try {
      const settingsRes = await fetch(`${baseUrl}/rest/settings`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (settingsRes.ok) {
        const settingsJson = (await settingsRes.json()) as { data?: { versionCli?: string } };
        n8nVersion = settingsJson?.data?.versionCli ?? null;
      }
    } catch {
      // Опціональна перевірка версії інстансу
    }

    return {
      ok: true,
      status: response.status,
      baseUrl,
      n8nVersion,
      workflowCountSample: sampleCount,
      observedNodeTypeVersions,
      message: `З'єднання з n8n (${baseUrl}${n8nVersion ? `, v${n8nVersion}` : ""}) успішне! Public REST API активний.`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      baseUrl,
      message: `Не вдалося підключитися до n8n за адресою ${baseUrl}: ${errMsg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
