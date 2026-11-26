import { extractTextPreservingOoxmlMath } from "./ooxml-math.js";

export interface GoogleDocIdentifier {
  documentId: string;
  exportMarkdownUrl: string;
  exportTextUrl: string;
  exportDocxUrl: string;
}

/**
 * Витягує ID документа з різних форматів URL Google Docs:
 * - https://docs.google.com/document/d/<ID>/edit?usp=sharing
 * - https://docs.google.com/document/u/0/d/<ID>/view
 * - https://drive.google.com/open?id=<ID>
 */
export function extractGoogleDocId(url: string): GoogleDocIdentifier | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host.includes("docs.google.com") && !host.includes("drive.google.com")) {
    return null;
  }

  const docMatch = parsed.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
  const idParam = parsed.searchParams.get("id");
  const documentId = docMatch?.[1] ?? idParam;

  if (!documentId) {
    return null;
  }

  return {
    documentId,
    exportMarkdownUrl: `https://docs.google.com/document/d/${documentId}/export?format=md`,
    exportTextUrl: `https://docs.google.com/document/d/${documentId}/export?format=txt`,
    exportDocxUrl: `https://docs.google.com/document/d/${documentId}/export?format=docx`,
  };
}

function looksLikeGoogleSignInPage(responseUrl: string, contentType: string, body: string): boolean {
  if (responseUrl.includes("accounts.google.com")) {
    return true;
  }
  if (contentType.includes("text/html") && (body.includes("accounts.google.com") || body.includes("<title>Google Docs"))) {
    return true;
  }
  return false;
}

/**
 * Завантажує вміст публічного (відкритого за посиланням) Google Doc у форматі Markdown (з фолбеком на plain text).
 */
export async function fetchPublicGoogleDoc(url: string, timeoutMs = 12000): Promise<{
  documentId: string;
  format: "markdown" | "text";
  content: string;
}> {
  const info = extractGoogleDocId(url);
  if (!info) {
    throw new Error(
      `Не вдалося розпізнати посилання Google Docs: "${url}". Очікується URL вигляду https://docs.google.com/document/d/<ID>/edit`
    );
  }

  const candidates: Array<{ format: "markdown" | "text"; exportUrl: string }> = [
    { format: "markdown", exportUrl: info.exportMarkdownUrl },
    { format: "text", exportUrl: info.exportTextUrl },
  ];

  let lastError = "";

  for (const candidate of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(candidate.exportUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "n8n-multi-harness-doc-ingest/1.0",
        },
        signal: controller.signal,
      });

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const body = (await response.text()).replace(/^\uFEFF/, "").trim();

      if (
        response.status === 401 ||
        response.status === 403 ||
        looksLikeGoogleSignInPage(response.url, contentType, body)
      ) {
        throw new Error(
          `Документ Google Docs (${info.documentId}) закритий для читання за посиланням. ` +
            `Відкрийте у Google Docs: "Поділитися" (Share) -> "Усі, хто має посилання" (Anyone with the link -> Viewer), або збережіть документ локально у папку user-docs/ (.docx або .md).`
        );
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status} при завантаженні ${candidate.format}`;
        continue;
      }

      if (body.length > 0) {
        // Якщо експорт містить сліди "з'їдених" формул Google Docs типу (('Node').first() без $,
        // пробуємо підвантажити .docx-експорт і відновити блоки <m:oMath>.
        if (/\(\(['"][^'"]+['"]\)\.(?:first|all|item)\b/.test(body)) {
          try {
            const docxRes = await fetch(info.exportDocxUrl, {
              method: "GET",
              redirect: "follow",
              headers: { "User-Agent": "n8n-multi-harness-doc-ingest/1.0" },
            });
            if (docxRes.ok) {
              const docxBuf = Buffer.from(await docxRes.arrayBuffer());
              const mathRestored = extractTextPreservingOoxmlMath(docxBuf);
              if (mathRestored && mathRestored.length > 0) {
                return {
                  documentId: info.documentId,
                  format: "text",
                  content: mathRestored,
                };
              }
            }
          } catch {
            // Залишаємо основний прочитаний вміст
          }
        }

        return {
          documentId: info.documentId,
          format: candidate.format,
          content: body,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("закритий для читання за посиланням")) {
        throw err;
      }
      lastError = msg;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Не вдалося завантажити Google Doc (${info.documentId}): ${lastError || "документ порожній або недоступний"}.`
  );
}
