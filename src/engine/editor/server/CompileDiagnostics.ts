import { appendFileSync } from "node:fs";

export interface CompileDiagnostics {
  warnings: number;
  errors: number;
  missingAssets: number;
  /** Bare native noshader can label generated bevels; BSP draw usage must be checked. */
  compilerPlaceholders?: number;
  leak: boolean;
  phase: string | null;
  samples: Array<{ kind: "warning" | "error" | "missing-asset"; message: string }>;
}

export const emptyDiagnostics = (): CompileDiagnostics => ({
  warnings: 0,
  errors: 0,
  missingAssets: 0,
  leak: false,
  phase: null,
  samples: [],
});

/** Keep the raw transcript intact; interpret complete lines independently of pipe chunk boundaries. */
export class CompileTranscript {
  private pending = "";
  constructor(
    private readonly file: string,
    readonly diagnostics: CompileDiagnostics,
    private readonly tail: string[],
  ) {}

  append(text: string): void {
    appendFileSync(this.file, text, "utf8");
    const lines = (this.pending + text).split(/\r\n|\r|\n/);
    this.pending = lines.pop() ?? "";
    for (const line of lines) this.line(line);
    // Native progress sometimes never terminates a line. Bound parser memory,
    // while retaining every byte in the on-disk transcript.
    while (this.pending.length > 16_384) {
      this.line(this.pending.slice(0, 16_384));
      this.pending = this.pending.slice(16_384);
    }
  }

  flush(): void {
    if (this.pending) this.line(this.pending);
    this.pending = "";
  }

  private line(raw: string): void {
    const text = raw.trim();
    if (!text) return;
    this.tail.push(text.slice(0, 2_000));
    if (this.tail.length > 100) this.tail.shift();
    const d = this.diagnostics;
    if (/\bLEAKED\b/i.test(text)) d.leak = true;
    const phase = /^---\s*(.*?)\s*---/.exec(text);
    if (phase) d.phase = phase[1].slice(0, 160);
    const warning = /\bWARNING\b/i.test(text);
    const error = /(?:^|\s)(?:ERROR|FATAL)(?:\s|:)/i.test(text);
    // Restrict fatal asset detection to explicit load failures, not ordinary
    // compiler statistics or optional sidecar/cache probes.
    const placeholder = /^WARNING:\s*Missing image for material:\s*noshader\s*$/i.test(text);
    if (placeholder) d.compilerPlaceholders = (d.compilerPlaceholders ?? 0) + 1;
    const asset =
      !placeholder &&
      /(?:could(?:n't| not)|unable to|failed to|cannot|can't)\s+(?:find|load|open).*\b(?:model|image|texture|shader|\.ase|\.md3|\.obj|\.tga|\.png|\.jpg)\b|(?:model|image|texture|shader)\b.*(?:not found|is missing)|(?:missing|unresolved)\s+(?:model|image|texture|shader)\b|(?:no|0) shader files (?:found|parsed)/i.test(
        text,
      );
    if (warning) d.warnings++;
    if (error) d.errors++;
    if (asset) d.missingAssets++;
    const kind = asset ? "missing-asset" : error ? "error" : warning ? "warning" : null;
    if (kind && d.samples.length < 50) d.samples.push({ kind, message: text.slice(0, 2_000) });
  }
}
