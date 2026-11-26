import fs from "node:fs/promises";

export async function parseTextDocument(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, "utf8");
  return raw.replace(/^\uFEFF/, "").trim();
}
