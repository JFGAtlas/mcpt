import type { Expectation } from './config.js';
import type { ToolCallResult } from './types.js';

/** Concatenated text of all text content blocks in a result. */
export function resultText(result: ToolCallResult): string {
  return result.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/** Evaluate an expectation against a tool result. Returns a list of
 * human-readable failure messages; empty means the test passed.
 * Snapshot expectations are handled by the runner, not here. */
export function evaluate(
  expect: Expectation,
  result: ToolCallResult,
  latencyMs: number,
): string[] {
  const failures: string[] = [];
  const text = resultText(result);

  const wantError = expect.error ?? false;
  const gotError = result.isError ?? false;
  if (wantError !== gotError) {
    failures.push(
      wantError
        ? `expected the tool to return an error, but it succeeded`
        : `tool returned an error: ${truncate(text || JSON.stringify(result.content))}`,
    );
    // an unexpected error makes content assertions noise, so stop here
    return failures;
  }

  if (expect.text !== undefined && text !== expect.text) {
    failures.push(`text mismatch\n    expected: ${truncate(expect.text)}\n    received: ${truncate(text)}`);
  }

  if (expect.contains !== undefined) {
    const needles = Array.isArray(expect.contains) ? expect.contains : [expect.contains];
    for (const needle of needles) {
      if (!text.includes(needle)) {
        failures.push(`text does not contain ${JSON.stringify(needle)}\n    received: ${truncate(text)}`);
      }
    }
  }

  if (expect.matches !== undefined && !new RegExp(expect.matches).test(text)) {
    failures.push(`text does not match /${expect.matches}/\n    received: ${truncate(text)}`);
  }

  if (expect.json !== undefined) {
    let actual: unknown = result.structuredContent;
    if (actual === undefined) {
      try {
        actual = JSON.parse(text);
      } catch {
        failures.push(`expect.json was set but the result is not valid JSON\n    received: ${truncate(text)}`);
        actual = undefined;
      }
    }
    if (actual !== undefined) {
      const diff = subsetDiff(expect.json, actual, '$');
      if (diff) failures.push(`json mismatch at ${diff.path}\n    expected: ${truncate(JSON.stringify(diff.expected))}\n    received: ${truncate(JSON.stringify(diff.actual))}`);
    }
  }

  if (expect.latency !== undefined && latencyMs > expect.latency) {
    failures.push(`latency ${Math.round(latencyMs)}ms exceeded budget of ${expect.latency}ms`);
  }

  return failures;
}

interface SubsetMismatch {
  path: string;
  expected: unknown;
  actual: unknown;
}

/** Deep subset check: every value present in `expected` must match `actual`.
 * Extra keys in `actual` are allowed. Arrays must match element-by-element. */
function subsetDiff(expected: unknown, actual: unknown, path: string): SubsetMismatch | null {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return { path, expected, actual };
    }
    for (let i = 0; i < expected.length; i++) {
      const diff = subsetDiff(expected[i], actual[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      return { path, expected, actual };
    }
    for (const [key, value] of Object.entries(expected)) {
      const diff = subsetDiff(value, (actual as Record<string, unknown>)[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  return Object.is(expected, actual) ? null : { path, expected, actual };
}

function truncate(text: string, max = 200): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}
