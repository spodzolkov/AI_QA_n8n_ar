import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
import {
  checkN8nConnection,
  getProjectRoot,
  loadEnvConfig,
  normalizeN8nBaseUrl,
  writeEnvConfig,
} from "../config/env.js";
import { ALL_HARNESS_IDS, HARNESS_ADAPTERS, generateHarnessConfigs } from "../harnesses/index.js";
import type { HarnessId } from "../harnesses/types.js";

interface InitCliOptions {
  harnesses?: HarnessId[];
  n8nUrl?: string;
  n8nKey?: string;
  useExistingEnv: boolean;
  startDocker: boolean;
  skipN8nCheck: boolean;
  skipBuild: boolean;
  nonInteractive: boolean;
}

function parseCliArgs(argv: string[]): InitCliOptions {
  const opts: InitCliOptions = {
    useExistingEnv: false,
    startDocker: false,
    skipN8nCheck: false,
    skipBuild: false,
    nonInteractive: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--harness" || arg === "-h") {
      const val = argv[++i] ?? "";
      const rawItems = val
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (rawItems.includes("all")) {
        opts.harnesses = [...ALL_HARNESS_IDS];
      } else {
        const parsed: HarnessId[] = [];
        for (const item of rawItems) {
          if (!ALL_HARNESS_IDS.includes(item as HarnessId)) {
            throw new Error(
              `Невідомий харнес "${item}". Доступні значення: ${ALL_HARNESS_IDS.join(", ")}, all`
            );
          }
          parsed.push(item as HarnessId);
        }
        opts.harnesses = parsed;
      }
      opts.nonInteractive = true;
    } else if (arg === "--n8n-url") {
      opts.n8nUrl = argv[++i] ?? "";
      opts.nonInteractive = true;
    } else if (arg === "--n8n-key") {
      opts.n8nKey = argv[++i] ?? "";
      opts.nonInteractive = true;
    } else if (arg === "--use-existing-env") {
      opts.useExistingEnv = true;
      opts.nonInteractive = true;
    } else if (arg === "--start-docker") {
      opts.startDocker = true;
    } else if (arg === "--skip-n8n-check") {
      opts.skipN8nCheck = true;
    } else if (arg === "--skip-build") {
      opts.skipBuild = true;
    } else if (arg === "--yes" || arg === "-y") {
      opts.nonInteractive = true;
    }
  }

  return opts;
}

function configureGitHooksIfRepoExists(projectRoot: string): void {
  const gitDir = path.join(projectRoot, ".git");
  const hooksDir = path.join(projectRoot, ".githooks");
  if (!fs.existsSync(gitDir) || !fs.existsSync(hooksDir)) {
    return;
  }
  try {
    execSync("git config core.hooksPath .githooks", {
      cwd: projectRoot,
      stdio: "ignore",
    });
    console.log("✔ Активовано локальні Git-хуки захисту чистого репозиторію (.githooks).");
  } catch {
    // Ігноруємо, якщо git недоступний у середовищі
  }
}

function ensureBuildArtifacts(projectRoot: string, skipBuild: boolean): void {
  const distLauncher = path.join(projectRoot, "dist", "mcp", "n8n-launcher.js");
  const distDocServer = path.join(projectRoot, "dist", "mcp", "doc-server.js");

  if (skipBuild && fs.existsSync(distLauncher) && fs.existsSync(distDocServer)) {
    return;
  }

  console.log("⚙ Компіляція TypeScript MCP-серверів та лаунчерів (npm run build)...");
  execSync("npm run build", {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

async function waitForLocalN8nReady(baseUrl: string, maxWaitMs = 35000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return true;
    } catch {
      // Сервер ще піднімається
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function startLocalDockerN8n(projectRoot: string): Promise<string> {
  console.log("🐳 Запуск локального інстансу n8n через Docker Compose...");
  execSync("docker compose up -d", {
    cwd: projectRoot,
    stdio: "inherit",
  });
  const localUrl = "http://localhost:5678";
  console.log(`⏳ Очікування готовності сервера n8n на ${localUrl}...`);
  const ready = await waitForLocalN8nReady(localUrl);
  if (ready) {
    console.log(`✔ Локальний сервер n8n успішно запущено: ${localUrl}`);
  } else {
    console.log(
      `⚠ Контейнер запущено, але ${localUrl}/healthz ще ініціалізується. Перевірте статус командою 'docker compose logs -f'.`
    );
  }
  return localUrl;
}

async function runInit(): Promise<void> {
  const projectRoot = getProjectRoot();
  const opts = parseCliArgs(process.argv.slice(2));

  console.log("\n==========================================================");
  console.log(" 🚀 Ініціалізація Multi-Harness n8n Flow Architect");
  console.log("==========================================================\n");

  // 1. Компіляція проєкту та активація Git-хуків
  ensureBuildArtifacts(projectRoot, opts.skipBuild);
  configureGitHooksIfRepoExists(projectRoot);

  // 2. Визначення цільових харнесів
  let selectedHarnesses = opts.harnesses;
  if (!selectedHarnesses || selectedHarnesses.length === 0) {
    if (opts.nonInteractive) {
      throw new Error(
        "У неінтерактивному режимі необхідно передати --harness <antigravity|codex|claude-code|vscode-copilot|all>."
      );
    }

    selectedHarnesses = await checkbox<HarnessId>({
      message: "Оберіть агентський харнес (один або декілька, Пробіл — вибір, Enter — підтвердження):",
      choices: ALL_HARNESS_IDS.map((id) => ({
        name: `${HARNESS_ADAPTERS[id].displayName} — ${HARNESS_ADAPTERS[id].description}`,
        value: id,
        checked: id === "antigravity",
      })),
      required: true,
    });
  }

  // 3. Налаштування інстансу n8n та .env
  const existingEnv = loadEnvConfig(projectRoot);
  let targetUrl = opts.n8nUrl ? normalizeN8nBaseUrl(opts.n8nUrl) : "";
  let targetKey = opts.n8nKey ? opts.n8nKey.trim() : "";

  if (opts.startDocker) {
    targetUrl = await startLocalDockerN8n(projectRoot);
  }

  if (opts.useExistingEnv) {
    targetUrl = targetUrl || existingEnv.n8nApiUrl;
    targetKey = targetKey || existingEnv.n8nApiKey;
  }

  if (!opts.nonInteractive) {
    const mode = await select<"existing" | "docker" | "keep-env" | "later">({
      message: "Як налаштувати підключення до сервера n8n?",
      choices: [
        ...(existingEnv.hasEnvFile && existingEnv.n8nApiUrl && existingEnv.n8nApiKey !== "your_n8n_api_key_here"
          ? [
              {
                name: `Використати поточні налаштування з .env (${existingEnv.n8nApiUrl})`,
                value: "keep-env" as const,
              },
            ]
          : []),
        {
          name: "Підключитися до існуючого сервера n8n (ввести URL та API Key)",
          value: "existing" as const,
        },
        {
          name: "Розгорнути локальний n8n у Docker (docker compose up -d на http://localhost:5678)",
          value: "docker" as const,
        },
        {
          name: "Налаштувати .env пізніше вручну (згенерувати лише конфігурації харнесу)",
          value: "later" as const,
        },
      ],
    });

    if (mode === "keep-env") {
      targetUrl = existingEnv.n8nApiUrl;
      targetKey = existingEnv.n8nApiKey;
    } else if (mode === "docker") {
      targetUrl = await startLocalDockerN8n(projectRoot);
      console.log(
        "\n📌 Відкрийте http://localhost:5678 у браузері, створіть обліковий запис (якщо перший запуск),\n" +
          "   перейдіть у Settings -> n8n API -> Create an API key та вставте ключ нижче.\n"
      );
      targetKey = await password({
        message: "Введіть створений N8N_API_KEY (або залиште порожнім, щоб вписати у .env пізніше):",
        mask: "*",
      });
      if (!targetKey.trim()) {
        opts.skipN8nCheck = true;
      }
    } else if (mode === "existing") {
      const rawUrl = await input({
        message: "Введіть URL вашого сервера n8n:",
        default: existingEnv.n8nApiUrl || "http://localhost:5678",
      });
      targetUrl = normalizeN8nBaseUrl(rawUrl);
      targetKey = await password({
        message: "Введіть N8N_API_KEY (Settings -> n8n API):",
        mask: "*",
      });
    } else {
      opts.skipN8nCheck = true;
      if (!existingEnv.hasEnvFile) {
        fs.copyFileSync(path.join(projectRoot, ".env.example"), path.join(projectRoot, ".env"));
        console.log("✔ Створено шаблонний файл .env (не забудьте заповнити N8N_API_URL та N8N_API_KEY).");
      }
    }
  }

  if (targetUrl || targetKey) {
    const finalUrl = targetUrl || existingEnv.n8nApiUrl || "http://localhost:5678";
    const finalKey = targetKey || existingEnv.n8nApiKey || "your_n8n_api_key_here";
    const writtenPath = writeEnvConfig(finalUrl, finalKey, projectRoot);
    console.log(`✔ Локальні параметри збережено у ${path.relative(projectRoot, writtenPath)} (файл поза Git).`);
  } else if (!fs.existsSync(path.join(projectRoot, ".env"))) {
    fs.copyFileSync(path.join(projectRoot, ".env.example"), path.join(projectRoot, ".env"));
    console.log("✔ Створено локальний файл .env із шаблону .env.example.");
  }

  // 4. Жива перевірка підключення до n8n REST API
  if (!opts.skipN8nCheck) {
    const check = await checkN8nConnection(targetUrl || undefined, targetKey || undefined);
    if (check.ok) {
      console.log(`✔ ${check.message}`);
    } else {
      console.warn(`⚠ Попередження перевірки n8n API: ${check.message}`);
      if (!opts.nonInteractive) {
        const proceedAnyway = await confirm({
          message: "Продовжити генерацію конфігурацій харнесу попри помилку зв'язку з n8n?",
          default: true,
        });
        if (!proceedAnyway) {
          console.log("Ініціалізацію скасовано користувачем.");
          process.exit(1);
        }
      }
    }
  }

  // 5. Генерація конфігурацій для обраних харнесів
  const results = generateHarnessConfigs(selectedHarnesses, projectRoot);

  console.log("\n==========================================================");
  console.log(" ✅ Конфігурації харнесів успішно згенеровано!");
  console.log("==========================================================");

  for (const res of results) {
    console.log(`\n🔹 ${res.displayName}:`);
    for (const file of res.generatedFiles) {
      console.log(`   - ${path.relative(projectRoot, file)}`);
    }
    console.log(`   💡 ${res.postInitHint}`);
  }

  console.log("\n📄 Готово до роботи! Покладіть документ ТЗ у папку user-docs/ або передайте посилання на Google Doc у чат агента.\n");
}

runInit().catch((error) => {
  console.error(`\n❌ Помилка ініціалізації: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
