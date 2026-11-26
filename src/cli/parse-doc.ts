import { readInstructionDocument } from "../parsers/index.js";

async function run(): Promise<void> {
  const source = process.argv.slice(2).join(" ").trim();
  if (!source) {
    console.error("Використання: npm run parse-doc -- <шлях-до-файлу або URL Google Docs>");
    process.exit(1);
  }

  try {
    const doc = await readInstructionDocument(source);
    console.log(
      JSON.stringify(
        {
          source: doc.source,
          sourceType: doc.sourceType,
          resolvedLocation: doc.resolvedLocation,
          charCount: doc.charCount,
        },
        null,
        2
      )
    );
    console.log("\n--- ВМІСТ ДОКУМЕНТА ---\n");
    console.log(doc.content);
  } catch (error) {
    console.error(`Помилка: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

run();
