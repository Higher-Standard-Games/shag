import fs from "node:fs";
import { openBrowser, sleep } from "../../.claude/skills/browser-probe/scripts/cdp.mjs";
const backend = process.argv[2] ?? "webgl2",
  port = Number(process.argv[3] ?? 3124);
if (!["webgl2", "webgpu"].includes(backend) || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("usage: pooled-candidates.mjs [webgl2|webgpu] [port]");
const b = await openBrowser({ width: 256, height: 256 });
try {
  await b.send("Page.navigate", { url: `http://127.0.0.1:${port}/engine.json` });
  await sleep(300);
  const result = await b.ev(
    `import('/src/engine/rendering/__qa__/PooledCandidatesFixture.ts').then(m=>m.runPooledCandidatesFixture(${JSON.stringify(backend)}))`,
  );
  const record = { backend, result, logs: b.logs, failed: b.failed };
  fs.mkdirSync(".cache/renderer-groundwork", { recursive: true });
  fs.writeFileSync(`.cache/renderer-groundwork/pooled-${backend}.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  if (
    result?.passed !== true ||
    b.failed.length ||
    b.logs.some((line) => /error:|EXCEPTION|GPUValidationError/.test(line))
  )
    process.exitCode = 1;
} finally {
  await b.close();
}
process.exit(process.exitCode ?? 0);
