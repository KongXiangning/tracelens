import type { InputFile } from "./scanner.js";
import { documentPathKey } from "./config.js";

export interface IndexedFile {
  input: Omit<InputFile, "kind">;
  parsed: Record<string, unknown>;
}

/** A project/config-scoped cache. Disk metadata is checked on every new scan. */
export class FileIndex {
  readonly files = new Map<string, IndexedFile>();
  readonly stats = { read: 0, reused: 0, parsed: 0, reusedParses: 0 };
  private touched = new Set<string>();
  constructor(entries: IndexedFile[] = []) {
    for (const entry of entries)
      this.files.set(documentPathKey(entry.input.path), entry);
  }
  begin(): void {
    this.touched.clear();
    Object.assign(this.stats, {
      read: 0,
      reused: 0,
      parsed: 0,
      reusedParses: 0,
    });
  }
  get(relative: string): Omit<InputFile, "kind"> | undefined {
    this.touched.add(documentPathKey(relative));
    return this.files.get(documentPathKey(relative))?.input;
  }
  set(input: Omit<InputFile, "kind">): void {
    const key = documentPathKey(input.path);
    this.touched.add(key);
    const old = this.files.get(key);
    this.files.set(key, {
      input,
      parsed: old?.input.digest === input.digest ? old.parsed : {},
    });
  }
  forget(relative: string): void {
    this.files.delete(documentPathKey(relative));
  }
  memo<T>(input: InputFile, key: string, parse: () => T): T {
    const entry = this.files.get(documentPathKey(input.path));
    if (entry && entry.input.digest === input.digest && key in entry.parsed) {
      this.stats.reusedParses++;
      return structuredClone(entry.parsed[key]) as T;
    }
    this.stats.parsed++;
    const value = parse();
    if (entry) entry.parsed[key] = structuredClone(value);
    return value;
  }
  entries(prune = false): IndexedFile[] {
    if (prune)
      for (const key of this.files.keys())
        if (!this.touched.has(key)) this.files.delete(key);
    return [...this.files.values()];
  }
}
