import fs from "node:fs/promises";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import path from "node:path";
const args = process.argv.slice(2),
  option = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
const source = path.resolve(option("--source-dir", "archive/media/map-renames"));
const output = path.resolve(option("--output-dir", ".cache/map-renames"));
const renames = { wdm2: "washoidm2", wfdm5: "washoidm5", wfdm11: "washoidm11" };
const hash = (b) => createHash("sha256").update(b).digest("hex");
const report = [];
await fs.mkdir(output, { recursive: true });
for (const [oldName, newName] of Object.entries(renames)) {
  const original = await JSZip.loadAsync(await fs.readFile(path.join(source, "map_" + oldName + ".pk3")), {
    checkCRC32: true,
  });
  const zip = new JSZip(),
    files = [];
  for (const f of Object.values(original.files)) {
    if (f.dir) continue;
    const name = f.name.replace(new RegExp("(^|/)" + oldName + "(?=\\.)", "g"), "$1" + newName);
    const bytes = await f.async("nodebuffer");
    zip.file(name, bytes, { date: new Date("1980-01-01T00:00:00Z"), createFolders: false });
    files.push({ original: f.name, renamed: name, sha256: hash(bytes), bytes: bytes.length });
  }
  if (!zip.file("maps/" + newName + ".bsp")) throw new Error("Expected BSP not found: " + oldName);
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  const check = await JSZip.loadAsync(bytes, { checkCRC32: true });
  for (const f of files)
    if (hash(await check.file(f.renamed).async("nodebuffer")) !== f.sha256) throw new Error("Content changed");
  await fs.writeFile(path.join(output, "map_" + newName + ".pk3"), bytes);
  report.push({ oldName, newName, files, packageBytes: bytes.length });
}
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.map((r) => ({ map: r.newName, entries: r.files.map((f) => f.renamed) }))));
