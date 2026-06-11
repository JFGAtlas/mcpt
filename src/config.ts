import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { ServerSpec } from './client.js';

export interface Expectation {
  /** Exact match against the concatenated text content. */
  text?: string;
  /** Substring match against the text content. May be a list (all must match). */
  contains?: string | string[];
  /** Regular expression match against the text content. */
  matches?: string;
  /** Parse the result as JSON and require this value to be a deep subset of it.
   * Uses structuredContent when the server provides it. */
  json?: unknown;
  /** Expected value of the result's isError flag. Defaults to false. */
  error?: boolean;
  /** Latency budget in milliseconds. */
  latency?: number;
  /** Compare the full result against a stored snapshot. */
  snapshot?: boolean;
}

export interface TestCase {
  name: string;
  tool: string;
  args: Record<string, unknown>;
  expect: Expectation;
  timeout?: number;
}

export interface TestFile {
  path: string;
  server: ServerSpec;
  timeout: number;
  expectTools: string[];
  tests: TestCase[];
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function loadTestFile(path: string): Promise<TestFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`);
  }

  let doc: Record<string, unknown>;
  try {
    doc = parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`${path}: invalid YAML: ${(err as Error).message}`);
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error(`${path}: file is empty or not a YAML mapping`);
  }

  const server = doc.server as ServerSpec | undefined;
  if (!server || typeof server.command !== 'string') {
    throw new Error(`${path}: missing "server.command" — mcpt needs to know how to start the server`);
  }
  if (server.args !== undefined && !Array.isArray(server.args)) {
    throw new Error(`${path}: "server.args" must be a list`);
  }

  const rawTests = doc.tests;
  if (!Array.isArray(rawTests) || rawTests.length === 0) {
    throw new Error(`${path}: no tests found — add a "tests:" list`);
  }

  const tests: TestCase[] = rawTests.map((t, i) => {
    const test = t as Record<string, unknown>;
    if (typeof test.tool !== 'string') {
      throw new Error(`${path}: tests[${i}] is missing "tool"`);
    }
    const expect = (test.expect ?? {}) as Expectation;
    validateExpectation(path, i, expect);
    return {
      name: typeof test.name === 'string' ? test.name : `${test.tool} #${i + 1}`,
      tool: test.tool,
      args: (test.args ?? {}) as Record<string, unknown>,
      expect,
      timeout: typeof test.timeout === 'number' ? test.timeout : undefined,
    };
  });

  return {
    path,
    server,
    timeout: typeof doc.timeout === 'number' ? doc.timeout : DEFAULT_TIMEOUT_MS,
    expectTools: Array.isArray(doc.expectTools) ? (doc.expectTools as string[]) : [],
    tests,
  };
}

const KNOWN_EXPECT_KEYS = new Set([
  'text',
  'contains',
  'matches',
  'json',
  'error',
  'latency',
  'snapshot',
]);

function validateExpectation(path: string, index: number, expect: Expectation): void {
  for (const key of Object.keys(expect)) {
    if (!KNOWN_EXPECT_KEYS.has(key)) {
      throw new Error(
        `${path}: tests[${index}].expect has unknown key "${key}" ` +
          `(known: ${[...KNOWN_EXPECT_KEYS].join(', ')})`,
      );
    }
  }
  if (expect.matches !== undefined) {
    try {
      new RegExp(expect.matches);
    } catch (err) {
      throw new Error(`${path}: tests[${index}].expect.matches: ${(err as Error).message}`);
    }
  }
}
