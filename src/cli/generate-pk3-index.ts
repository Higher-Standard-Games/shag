import { resolve } from "node:path";
import { generatePk3Index } from "./pk3-index-build";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let directory = resolve("public/data");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(
        "Usage: npm run tools:pk3-index -- [--data-dir <directory>]\nWrites pk3_manifest.json and pk3_index.json using the runtime indexer.",
      );
      return;
    }
    if (args[i] === "--data-dir" && args[i + 1]) directory = resolve(args[++i]);
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  const report = await generatePk3Index(directory);
  console.log(`[pk3-index] ${JSON.stringify(report)}`);
}

main().catch((error) => {
  console.error(`[pk3-index] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
