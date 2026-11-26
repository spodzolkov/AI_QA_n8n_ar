import { describe, expect, it } from "vitest";
import {
  checkForbiddenTrackedPath,
  runSanitizeAudit,
  scanContentForSensitiveData,
} from "../src/cli/sanitize-check.js";

describe("Захист чистого репозиторію (sanitize-check)", () => {
  it("блокує заборонені користувацькі файли та дозволяє файли чистого шаблону", () => {
    expect(checkForbiddenTrackedPath(".env")).not.toBeNull();
    expect(checkForbiddenTrackedPath(".env.production")).not.toBeNull();
    expect(checkForbiddenTrackedPath("user-docs/client-brief.md")).not.toBeNull();
    expect(checkForbiddenTrackedPath("docs/spec.docx")).not.toBeNull();
    expect(checkForbiddenTrackedPath(".mcp.json")).not.toBeNull();
    expect(checkForbiddenTrackedPath(".vscode/mcp.json")).not.toBeNull();
    expect(checkForbiddenTrackedPath(".codex/config.toml")).not.toBeNull();
    expect(checkForbiddenTrackedPath(".agents/plugins/n8n-architect/plugin.json")).not.toBeNull();

    // Чисті файли шаблону дозволені:
    expect(checkForbiddenTrackedPath(".env.example")).toBeNull();
    expect(checkForbiddenTrackedPath("user-docs/.gitkeep")).toBeNull();
    expect(checkForbiddenTrackedPath(".agents/skills/init/SKILL.md")).toBeNull();
    expect(checkForbiddenTrackedPath(".claude/commands/init.md")).toBeNull();
    expect(checkForbiddenTrackedPath(".github/prompts/init.prompt.md")).toBeNull();
    expect(checkForbiddenTrackedPath("examples/lead-processing-spec.md")).toBeNull();
  });

  it("виявляє реальні ключі, JWT-токени, приватні хмари n8n та шляхи користувача ОС", () => {
    const leakedKey = "N8N_API_" + "KEY=n8n_live_987654321secret";
    expect(scanContentForSensitiveData(leakedKey, "README.md")).toHaveLength(1);

    const safeExample = "N8N_API_KEY=your_n8n_api_key_here";
    expect(scanContentForSensitiveData(safeExample, ".env.example")).toHaveLength(0);

    const fakeJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ." +
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(scanContentForSensitiveData(fakeJwt, "notes.md")[0]?.rule).toBe("leaked-jwt-token");

    const privateCloud = "https://" + "acme-corp-prod" + ".app.n8n.cloud";
    expect(scanContentForSensitiveData(privateCloud, "notes.md")[0]?.rule).toBe(
      "leaked-private-n8n-url"
    );

    const winPath = "C:" + "\\Users\\" + "alex_dev\\AppData\\Local";
    expect(scanContentForSensitiveData(winPath, "config.json")[0]?.rule).toBe(
      "leaked-local-user-path"
    );
  });

  it("підтверджує, що поточний робочий простір репозиторію стерильно чистий", () => {
    const audit = runSanitizeAudit();
    expect(audit.violations).toEqual([]);
    expect(audit.clean).toBe(true);
  });
});
