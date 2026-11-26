import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../config/env.js";
import { getCandidateRepoFiles, runSanitizeAudit } from "./sanitize-check.js";

interface PublishArgs {
  dryRun: boolean;
  remoteUrl?: string;
  repoName?: string;
  visibility: "public" | "private";
  commitMessage: string;
}

function parsePublishArgs(argv: string[]): PublishArgs {
  const opts: PublishArgs = {
    dryRun: false,
    visibility: "private",
    commitMessage: "chore: initial clean multi-harness n8n project template",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--remote") {
      opts.remoteUrl = argv[++i];
    } else if (arg === "--repo") {
      opts.repoName = argv[++i];
    } else if (arg === "--public") {
      opts.visibility = "public";
    } else if (arg === "--private") {
      opts.visibility = "private";
    } else if (arg === "--message" || arg === "-m") {
      opts.commitMessage = argv[++i] ?? opts.commitMessage;
    }
  }

  return opts;
}

function ensureGitRepoAndHooks(projectRoot: string): void {
  const gitDir = path.join(projectRoot, ".git");
  if (!fs.existsSync(gitDir)) {
    console.log("📦 Ініціалізація чистого Git-репозиторію (гілка main)...");
    execSync("git init -b main", { cwd: projectRoot, stdio: "inherit" });
  }
  execSync("git config core.hooksPath .githooks", { cwd: projectRoot, stdio: "ignore" });
}

function main(): void {
  const projectRoot = getProjectRoot();
  const opts = parsePublishArgs(process.argv.slice(2));

  console.log("\n==========================================================");
  console.log(" 🛡️ Перевірка та публікація чистого проєкту на GitHub");
  console.log("==========================================================\n");

  if (!opts.dryRun) {
    ensureGitRepoAndHooks(projectRoot);
  }

  const audit = runSanitizeAudit(projectRoot);
  if (!audit.clean) {
    console.error("❌ Публікацію зупинено! Виявлено потенційний витік користувацьких даних:");
    for (const v of audit.violations) {
      const loc = v.line ? `${v.file}:${v.line}` : v.file;
      console.error(`  - [${v.rule}] ${loc}: ${v.detail}`);
    }
    process.exit(1);
  }

  const trackedCandidates = getCandidateRepoFiles(projectRoot);
  console.log(`✅ Сканування чистоти успішне (${trackedCandidates.length} чистих файлів шаблону, 0 витоків).`);

  if (opts.dryRun) {
    console.log("\n📋 Список файлів, дозволених до публікації на GitHub (--dry-run):");
    for (const f of trackedCandidates) {
      console.log(`  - ${f}`);
    }
    console.log("\nРежим --dry-run завершено без змін у Git.\n");
    return;
  }

  execSync("git add -A", { cwd: projectRoot, stdio: "inherit" });

  // Повторний аудит після git add -A, щоб переконатися на 100%, що індекс стерильно чистий
  const postAddAudit = runSanitizeAudit(projectRoot);
  if (!postAddAudit.clean) {
    execSync("git reset", { cwd: projectRoot, stdio: "ignore" });
    console.error("❌ Після індексації виявлено небажані файли. Індекс скинуто.");
    process.exit(1);
  }

  const statusOut = execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" }).trim();
  if (statusOut.length > 0) {
    execFileSync("git", ["commit", "-m", opts.commitMessage], { cwd: projectRoot, stdio: "inherit" });
    console.log("✔ Створено чистий Git-коміт без користувацьких даних.");
  } else {
    console.log("ℹ Немає нових змін для коміту — поточна гілка вже актуальна.");
  }

  if (opts.remoteUrl) {
    const remotes = execSync("git remote", { cwd: projectRoot, encoding: "utf8" }).split(/\r?\n/);
    if (remotes.includes("origin")) {
      execFileSync("git", ["remote", "set-url", "origin", opts.remoteUrl], {
        cwd: projectRoot,
        stdio: "inherit",
      });
    } else {
      execFileSync("git", ["remote", "add", "origin", opts.remoteUrl], {
        cwd: projectRoot,
        stdio: "inherit",
      });
    }
    execSync("git push -u origin main", { cwd: projectRoot, stdio: "inherit" });
    console.log(`\n🎉 Чистий проєкт успішно опубліковано у ${opts.remoteUrl}!\n`);
    return;
  }

  if (opts.repoName) {
    const visFlag = opts.visibility === "public" ? "--public" : "--private";
    execFileSync(
      "gh",
      ["repo", "create", opts.repoName, visFlag, "--source=.", "--remote=origin", "--push"],
      { cwd: projectRoot, stdio: "inherit" }
    );
    console.log(`\n🎉 Створено та опубліковано чистий репозиторій на GitHub: ${opts.repoName}!\n`);
    return;
  }

  console.log(
    "\n📌 Локальний чистий Git-репозиторій підготовлено та захищено хуками!\n" +
      "Щоб відправити його на GitHub, виконайте один із варіантів:\n" +
      "  1) З існуючим URL репозиторію:\n" +
      "     npm run github:publish -- --remote https://github.com/<org>/<repo>.git\n" +
      "  2) Автоматичне створення нового репозиторію через GitHub CLI (gh):\n" +
      "     npm run github:publish -- --repo <repo-name> --private   (або --public)\n"
  );
}

main();
