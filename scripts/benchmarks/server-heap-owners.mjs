/** Reachable allocation inventory, not a dominator/retained-size calculation. */
import fs from "node:fs";
const files = process.argv.slice(2);
if (!files.length) throw new Error("Usage: node scripts/benchmarks/server-heap-owners.mjs <Node heap snapshot> [...]");
for (const file of files) {
  const heap = JSON.parse(fs.readFileSync(file, "utf8"));
  const nf = heap.snapshot.meta.node_fields, ef = heap.snapshot.meta.edge_fields;
  const ns = nf.length, es = ef.length;
  const ni = Object.fromEntries(nf.map((key, i) => [key, i]));
  const ei = Object.fromEntries(ef.map((key, i) => [key, i]));
  const starts = new Uint32Array(heap.nodes.length / ns);
  let cursor = 0;
  for (let n = 0; n < starts.length; n++) {
    starts[n] = cursor; cursor += heap.nodes[n * ns + ni.edge_count] * es;
  }
  const name = (n) => heap.strings[heap.nodes[n * ns + ni.name]];
  function edges(n) {
    const result = [];
    const end = starts[n] + heap.nodes[n * ns + ni.edge_count] * es;
    for (let e = starts[n]; e < end; e += es) {
      const type = heap.snapshot.meta.edge_types[0][heap.edges[e + ei.type]];
      const raw = heap.edges[e + ei.name_or_index];
      result.push({ type, name: type === "element" ? String(raw) : heap.strings[raw], to: heap.edges[e + ei.to_node] / ns });
    }
    return result;
  }
  function inventory(root) {
    const seen = new Set(), pending = [root]; let bytes = 0;
    while (pending.length) {
      const n = pending.pop(); if (seen.has(n)) continue;
      seen.add(n); bytes += heap.nodes[n * ns + ni.self_size];
      for (const edge of edges(n)) {
        if (edge.type === "element" || (edge.type === "property" && edge.name !== "__proto__") ||
          (edge.type === "internal" && ["elements", "buffer", "backing_store"].includes(edge.name))) pending.push(edge.to);
      }
    }
    return { reachableNodes: seen.size, reachableShallowBytes: bytes };
  }
  const owners = [];
  for (let n = 0; n < starts.length; n++) {
    if (!name(n).endsWith("SweepCollisionBackend") || heap.snapshot.meta.node_types[0][heap.nodes[n * ns + ni.type]] !== "object") continue;
    const bsp = edges(n).find((edge) => edge.name === "bsp"); if (!bsp) continue;
    owners.push(Object.fromEntries(edges(bsp.to).filter((edge) => edge.type === "property" && edge.name !== "__proto__")
      .map((edge) => [edge.name, inventory(edge.to)])));
  }
  console.log(JSON.stringify({ file, owners,
    limitation: "Traverses property/element and selected backing-storage edges; shared allocations can appear under several owners. Do not sum columns or call these retained/dominator sizes." }));
}
