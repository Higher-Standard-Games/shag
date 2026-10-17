import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import ts from "typescript";
const index = JSON.parse(await fs.readFile("public/data/pk3_index.json", "utf8"));
const args = process.argv.slice(2),
  arg = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
const sourceDirectory = arg("--source-dir", "public/data"),
  output = arg("--output", ".cache/nonfree-audit.json");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  norm = (s) =>
    s
      .replaceAll("\\", "/")
      .replace(/^\/?data\//, "")
      .replace(/^\//, "")
      .toLowerCase(),
  stem = (s) => norm(s).replace(/\.(wav|ogg|mp3|flac)$/, "");
const zips = new Map();
async function zip(owner) {
  if (!zips.has(owner))
    zips.set(
      owner,
      await JSZip.loadAsync(await fs.readFile("public/data/" + index.packages.find((p) => p.pk3 === owner).path)),
    );
  return zips.get(owner);
}
const literals = [],
  patterns = [];
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules" || e.name === "docs" || e.name.startsWith(".")) continue;
    const name = path.join(dir, e.name);
    if (e.isDirectory()) await walk(name);
    else if (/\.(ts|json)$/.test(name) && !name.endsWith(".test.ts")) {
      const text = await fs.readFile(name, "utf8");
      if (name.endsWith(".json")) {
        for (const m of text.matchAll(/"([^"\r\n]+)"/g))
          literals.push({ value: norm(m[1]), source: name.replaceAll("\\", "/") });
        continue;
      }
      const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
      const visit = (node) => {
        if (ts.isStringLiteralLike(node)) literals.push({ value: norm(node.text), source: name.replaceAll("\\", "/") });
        if (ts.isTemplateExpression(node)) {
          const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].map(norm);
          if (parts.some((s) => s.includes("sounds/"))) {
            const expression = "^" + parts.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$";
            patterns.push({ pattern: new RegExp(expression), source: name.replaceAll("\\", "/") });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  }
}
await walk("src");
await walk("config");
const results = [];
for (const filename of (await fs.readdir(sourceDirectory))
  .filter((name) => name.includes("nonfree") && name.endsWith(".pk3"))
  .sort()) {
  const pkg = { pk3: filename };
  const z = await JSZip.loadAsync(await fs.readFile(path.join(sourceDirectory, filename)));
  for (const f of Object.values(z.files).filter((f) => !f.dir)) {
    const name = norm(f.name),
      bytes = await f.async("nodebuffer"),
      sha256 = hash(bytes),
      owner = index.files[name];
    const winner = owner ? await (await zip(owner)).file(name)?.async("nodebuffer") : null;
    const exact = literals.filter((l) => stem(l.value) === stem(name));
    const dynamic = patterns.filter((p) => p.pattern.test(name) || p.pattern.test(stem(name))).map((p) => p.source);
    results.push({
      name,
      originalPackage: pkg.pk3,
      bytes: bytes.length,
      sha256,
      currentOwner: owner,
      identicalToCurrent: winner ? hash(winner) === sha256 : false,
      staticReferences: [...new Set(exact.map((l) => l.source))],
      dynamicReferences: [...new Set(dynamic)],
    });
  }
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(results, null, 2) + "\n");
console.log({
  entries: results.length,
  distinct: new Set(results.map((a) => a.name)).size,
  static: results.filter((a) => a.staticReferences.length).length,
  dynamicOnly: results.filter((a) => !a.staticReferences.length && a.dynamicReferences.length).length,
  winningOriginal: results.filter((a) => a.originalPackage === a.currentOwner).length,
  identicalCopies: results.filter((a) => a.identicalToCurrent && a.originalPackage !== a.currentOwner).length,
});
console.log(
  results
    .filter((a) => a.staticReferences.length || a.dynamicReferences.length)
    .map((a) => ({ name: a.name, owner: a.currentOwner, static: a.staticReferences, dynamic: a.dynamicReferences })),
);
