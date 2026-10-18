/** Read top-level definitions without treating stage directives as shader names. */
export function shaderSourceBlocks(source: string): { name: string; source: string }[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (value) => " ".repeat(value.length));
  const tokens = [...clean.matchAll(/"(?:\\.|[^"\\])*"|[{}]|[^\s{}]+/g)];
  const result: { name: string; source: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const name = tokens[i];
    if (tokens[i + 1]?.[0] !== "{") continue;
    const start = name.index;
    let depth = 0;
    let end = 0;
    for (i++; i < tokens.length; i++) {
      if (tokens[i][0] === "{") depth++;
      if (tokens[i][0] === "}" && --depth === 0) {
        end = tokens[i].index + 1;
        break;
      }
    }
    if (!end) throw new Error(`Unclosed shader ${name[0]}`);
    result.push({ name: name[0].replace(/^"|"$/g, ""), source: source.slice(start, end) });
  }
  return result;
}
