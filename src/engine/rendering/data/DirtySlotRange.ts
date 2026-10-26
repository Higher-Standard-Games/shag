/** One allocation-free, half-open interval of changed logical slots. */
export class DirtySlotRange {
  first = Infinity;
  end = 0;

  mark(slot: number): void {
    this.first = Math.min(this.first, slot);
    this.end = Math.max(this.end, slot + 1);
  }

  clear(): void {
    this.first = Infinity;
    this.end = 0;
  }
}
