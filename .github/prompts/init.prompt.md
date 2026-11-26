---
mode: 'agent'
description: 'Перший запуск проєкту: встановлення залежностей, вибір харнесу (Antigravity, Codex, Claude Code, VS Code Copilot) та підключення до n8n'
---

Проведіть користувача покроково через перший запуск проєкту **Multi-Harness n8n Flow Architect** українською мовою:

1. **Перевірка та встановлення залежностей**:
   - Перевірте у терміналі `node -v` (`>= 20`).
   - Якщо `node_modules/` ще не встановлено — запустіть `npm install`.
   - Виконайте `npm run build`, щоб скомпілювати MCP-сервери у `dist/mcp/`.
2. **Опитування користувача**:
   - Запитайте, який харнес (або декілька) згенерувати: `vscode-copilot`, `antigravity`, `codex`, `claude-code` або `all`.
   - Запитайте, чи підключатися до вже існуючого інстансу n8n (`N8N_API_URL` та `N8N_API_KEY` у файлі `.env`) чи розгорнути локальний сервер командою `docker compose up -d` (`http://localhost:5678`).
3. **Запуск конфігуратора**:
   - Виконайте `npm run init -- --harness <обрані_харнеси> --use-existing-env` (або з `--n8n-url` та `--n8n-key`, чи `--skip-n8n-check`).
4. **Завершення**:
   - Перевірте парсер командою `npm run parse-doc -- examples/lead-processing-spec.md`, підкажіть увімкнути/перезапустити MCP сервери у VS Code (`.vscode/mcp.json`) та запросіть передати документ інструкції у `/n8n-build`.
