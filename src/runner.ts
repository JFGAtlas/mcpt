import { McpClient } from './client.js';
import { loadTestFile, type TestFile } from './config.js';
import { evaluate } from './matchers.js';
import { SnapshotStore } from './snapshot.js';

export interface TestResult {
  name: string;
  tool: string;
  status: 'pass' | 'fail';
  failures: string[];
  latencyMs: number;
  note?: string;
}

export interface FileResult {
  path: string;
  serverName?: string;
  results: TestResult[];
  setupError?: string;
}

export interface RunOptions {
  updateSnapshots?: boolean;
  timeoutOverride?: number;
}

export async function runFile(path: string, opts: RunOptions = {}): Promise<FileResult> {
  let file: TestFile;
  try {
    file = await loadTestFile(path);
  } catch (err) {
    return { path, results: [], setupError: (err as Error).message };
  }

  const timeout = opts.timeoutOverride ?? file.timeout;
  const client = new McpClient(file.server, timeout);
  const snapshots = new SnapshotStore(path, opts.updateSnapshots ?? false);
  const results: TestResult[] = [];

  try {
    await client.start();
  } catch (err) {
    await client.close();
    return { path, results: [], setupError: `could not start server: ${(err as Error).message}` };
  }

  try {
    if (file.expectTools.length > 0) {
      const available = new Set((await client.listTools()).map((t) => t.name));
      const missing = file.expectTools.filter((name) => !available.has(name));
      results.push({
        name: `server exposes tools: ${file.expectTools.join(', ')}`,
        tool: '(tools/list)',
        status: missing.length === 0 ? 'pass' : 'fail',
        failures:
          missing.length === 0
            ? []
            : [`missing tools: ${missing.join(', ')} (available: ${[...available].join(', ') || 'none'})`],
        latencyMs: 0,
      });
    }

    for (const test of file.tests) {
      const started = performance.now();
      try {
        const result = await client.callTool(test.tool, test.args, test.timeout ?? timeout);
        const latencyMs = performance.now() - started;
        const failures = evaluate(test.expect, result, latencyMs);
        let note: string | undefined;

        if (test.expect.snapshot) {
          const snap = await snapshots.check(test.name, result);
          if (snap.outcome === 'mismatch') {
            failures.push(`snapshot mismatch\n    ${snap.diff}\n    (run with --update-snapshots to accept)`);
          } else if (snap.outcome !== 'match') {
            note = `snapshot ${snap.outcome}`;
          }
        }

        results.push({
          name: test.name,
          tool: test.tool,
          status: failures.length === 0 ? 'pass' : 'fail',
          failures,
          latencyMs,
          note,
        });
      } catch (err) {
        results.push({
          name: test.name,
          tool: test.tool,
          status: 'fail',
          failures: [(err as Error).message],
          latencyMs: performance.now() - started,
        });
      }
    }
  } finally {
    await snapshots.save();
    await client.close();
  }

  return { path, serverName: client.serverInfo.name, results };
}
