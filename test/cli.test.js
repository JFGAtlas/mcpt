import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'dist', 'cli.js');
const examplesDir = join(root, 'examples');

async function runCli(args, opts = {}) {
  try {
    const { stdout, stderr } = await exec('node', [cli, ...args], opts);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('run: example suite passes against the demo server', async () => {
  const { code, stdout } = await runCli(['run', 'mcpt.yaml'], { cwd: examplesDir });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /6 passed/);
  assert.match(stdout, /add returns the sum/);
});

test('run: failing expectations exit 1 with a diff', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcpt-'));
  const file = join(dir, 'fail.mcpt.yaml');
  await writeFile(
    file,
    [
      'server:',
      '  command: node',
      `  args: [${JSON.stringify(join(examplesDir, 'demo-server', 'server.js'))}]`,
      'tests:',
      '  - name: wrong sum',
      '    tool: add',
      '    args: { a: 2, b: 2 }',
      '    expect: { text: "5" }',
    ].join('\n'),
  );
  const { code, stdout } = await runCli(['run', file]);
  await rm(dir, { recursive: true, force: true });
  assert.equal(code, 1);
  assert.match(stdout, /text mismatch/);
  assert.match(stdout, /expected: 5/);
  assert.match(stdout, /received: 4/);
});

test('run: expectTools reports missing tools', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcpt-'));
  const file = join(dir, 'tools.mcpt.yaml');
  await writeFile(
    file,
    [
      'server:',
      '  command: node',
      `  args: [${JSON.stringify(join(examplesDir, 'demo-server', 'server.js'))}]`,
      'expectTools: [add, does_not_exist]',
      'tests:',
      '  - tool: add',
      '    args: { a: 1, b: 1 }',
      '    expect: { text: "2" }',
    ].join('\n'),
  );
  const { code, stdout } = await runCli(['run', file]);
  await rm(dir, { recursive: true, force: true });
  assert.equal(code, 1);
  assert.match(stdout, /missing tools: does_not_exist/);
});

test('run: snapshots are written on first run and matched on the second', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcpt-'));
  const file = join(dir, 'snap.mcpt.yaml');
  await writeFile(
    file,
    [
      'server:',
      '  command: node',
      `  args: [${JSON.stringify(join(examplesDir, 'demo-server', 'server.js'))}]`,
      'tests:',
      '  - name: stable echo',
      '    tool: echo',
      '    args: { message: hi }',
      '    expect: { snapshot: true }',
    ].join('\n'),
  );
  const first = await runCli(['run', file]);
  assert.equal(first.code, 0, first.stdout);
  assert.match(first.stdout, /snapshot written/);

  const stored = JSON.parse(await readFile(join(dir, '__snapshots__', 'snap.mcpt.yaml.snap.json'), 'utf8'));
  assert.equal(stored['stable echo'].content[0].text, 'hi');

  const second = await runCli(['run', file]);
  await rm(dir, { recursive: true, force: true });
  assert.equal(second.code, 0);
  assert.doesNotMatch(second.stdout, /snapshot written/);
});

test('run: bad server command reports a setup error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcpt-'));
  const file = join(dir, 'bad.mcpt.yaml');
  await writeFile(
    file,
    ['server:', '  command: definitely-not-a-real-binary-12345', 'tests:', '  - tool: x', '    expect: {}'].join('\n'),
  );
  const { code, stdout } = await runCli(['run', file]);
  await rm(dir, { recursive: true, force: true });
  assert.equal(code, 1);
  assert.match(stdout, /setup failed/);
});

test('list: prints discovered tools with signatures', async () => {
  const { code, stdout } = await runCli(
    ['list', '--', 'node', join(examplesDir, 'demo-server', 'server.js')],
  );
  assert.equal(code, 0);
  assert.match(stdout, /mcpt-demo-server exposes 3 tool\(s\)/);
  assert.match(stdout, /add\(a, b\)/);
  assert.match(stdout, /echo\(message, uppercase\?\)/);
});

test('init: generates a runnable test file from a live server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcpt-'));
  const out = join(dir, 'generated.yaml');
  const initRes = await runCli([
    'init', '-o', out, '--', 'node', join(examplesDir, 'demo-server', 'server.js'),
  ]);
  assert.equal(initRes.code, 0, initRes.stderr);

  const yaml = await readFile(out, 'utf8');
  assert.match(yaml, /tool: add/);
  assert.match(yaml, /tool: echo/);
  assert.match(yaml, /message: hello world/); // picked up from schema examples

  // the generated file must actually run green
  const runRes = await runCli(['run', out]);
  await rm(dir, { recursive: true, force: true });
  assert.equal(runRes.code, 0, runRes.stdout);
  assert.match(runRes.stdout, /4 passed/); // 3 tools + expectTools check
});

test('matchers: subset matching, regex, and error semantics', async () => {
  const { evaluate } = await import(pathToFileURL(join(root, 'dist', 'matchers.js')).href);
  const result = {
    content: [{ type: 'text', text: '{"a":1,"b":{"c":[1,2]}}' }],
    isError: false,
  };
  assert.deepEqual(evaluate({ json: { b: { c: [1, 2] } } }, result, 0), []);
  assert.equal(evaluate({ json: { b: { c: [1, 3] } } }, result, 0).length, 1);
  assert.deepEqual(evaluate({ matches: '"a":1' }, result, 0), []);
  assert.equal(evaluate({ latency: 10 }, result, 50).length, 1);
  assert.equal(evaluate({ error: true }, result, 0).length, 1);
});
