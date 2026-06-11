import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export type SnapshotOutcome = 'match' | 'written' | 'updated' | 'mismatch';

/** Snapshots for one test file live in __snapshots__/<file>.snap.json
 * next to the test file, keyed by test name. */
export class SnapshotStore {
  private snapshots: Record<string, unknown> = {};
  private loaded = false;
  private dirty = false;
  readonly snapPath: string;

  constructor(testFilePath: string, private update: boolean) {
    this.snapPath = join(
      dirname(testFilePath),
      '__snapshots__',
      `${basename(testFilePath)}.snap.json`,
    );
  }

  async check(testName: string, actual: unknown): Promise<{ outcome: SnapshotOutcome; diff?: string }> {
    await this.load();
    const stored = this.snapshots[testName];
    const actualJson = stableStringify(actual);

    if (stored === undefined) {
      this.snapshots[testName] = actual;
      this.dirty = true;
      return { outcome: 'written' };
    }
    if (stableStringify(stored) === actualJson) {
      return { outcome: 'match' };
    }
    if (this.update) {
      this.snapshots[testName] = actual;
      this.dirty = true;
      return { outcome: 'updated' };
    }
    return {
      outcome: 'mismatch',
      diff: `stored:   ${truncate(stableStringify(stored))}\n    received: ${truncate(actualJson)}`,
    };
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(dirname(this.snapPath), { recursive: true });
    await writeFile(this.snapPath, JSON.stringify(this.snapshots, null, 2) + '\n');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.snapshots = JSON.parse(await readFile(this.snapPath, 'utf8'));
    } catch {
      this.snapshots = {};
    }
  }
}

/** JSON.stringify with sorted object keys, so snapshots are stable. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

function truncate(text: string, max = 200): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}
