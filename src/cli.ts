#!/usr/bin/env node
import { access, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { McpClient } from './client.js';
import { generateTestFile } from './init.js';
import { printFileResult, printSummary, bold, dim, red, yellow } from './report.js';
import { runFile, type FileResult } from './runner.js';

const HELP = `mcpt — test any MCP server with plain YAML
       用纯 YAML 测试任何 MCP 服务器

Quickstart | 快速上手:
  npx -y mcpt-runner init -- npx -y @modelcontextprotocol/server-filesystem /tmp
  npx -y mcpt-runner run

Usage:
  mcpt init [-o <file>] -- <command to start server>
      Connect to a server, discover its tools, and generate a test file.
      连接服务器，自动发现工具并生成测试文件。
      e.g.  mcpt init -- npx -y @modelcontextprotocol/server-filesystem /tmp

  mcpt run [files...] [options]
      Run test files. With no arguments, runs mcpt.yaml and *.mcpt.yaml
      from the current directory.
      运行测试文件；不带参数时自动查找当前目录的 mcpt.yaml 和 *.mcpt.yaml。

  mcpt list -- <command to start server>
      Start a server and print the tools it exposes.
      启动服务器并列出它暴露的工具。

Options:
  -u, --update-snapshots   Accept changed snapshots | 接受快照变更
      --timeout <ms>       Override the per-test timeout | 覆盖单测试超时
  -o, --out <file>         Output path for init (default: mcpt.yaml)
  -h, --help               Show this help
  -v, --version            Show version

Docs: https://github.com/JFGAtlas/mcpt`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === '-h' || command === '--help') {
    console.log(HELP);
    return 0;
  }
  if (command === '-v' || command === '--version') {
    const { createRequire } = await import('node:module');
    console.log(createRequire(import.meta.url)('../package.json').version);
    return 0;
  }

  switch (command) {
    case 'run':
      return cmdRun(argv.slice(1));
    case 'init':
      return cmdInit(argv.slice(1));
    case 'list':
      return cmdList(argv.slice(1));
    default:
      console.error(`unknown command "${command}" — try mcpt --help`);
      return 2;
  }
}

async function cmdRun(args: string[]): Promise<number> {
  let updateSnapshots = false;
  let timeoutOverride: number | undefined;
  const files: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-u' || arg === '--update-snapshots') updateSnapshots = true;
    else if (arg === '--timeout') timeoutOverride = Number(args[++i]);
    else if (arg.startsWith('-')) {
      console.error(`unknown option "${arg}"`);
      return 2;
    } else files.push(arg);
  }

  if (files.length === 0) {
    files.push(...(await discoverTestFiles()));
    if (files.length === 0) {
      console.error(
        [
          `No test files found — looked for mcpt.yaml and *.mcpt.yaml in the current directory.`,
          `没有找到测试文件 —— 已在当前目录查找 mcpt.yaml 和 *.mcpt.yaml。`,
          ``,
          `Generate one automatically from a running server | 从运行中的服务器自动生成一个：`,
          ``,
          `  ${bold('mcpt init -- <command to start your server>')}`,
          ``,
          `No server of your own yet? Try the official filesystem server | 还没有自己的服务器？先用官方文件系统服务器体验：`,
          ``,
          `  ${bold('npx -y mcpt-runner init -- npx -y @modelcontextprotocol/server-filesystem /tmp')}`,
          `  ${bold('npx -y mcpt-runner run')}`,
        ].join('\n'),
      );
      return 2;
    }
  }

  const started = performance.now();
  const results: FileResult[] = [];
  for (const file of files) {
    const result = await runFile(file, { updateSnapshots, timeoutOverride });
    printFileResult(result);
    results.push(result);
  }
  const ok = printSummary(results, performance.now() - started);
  return ok ? 0 : 1;
}

async function cmdInit(args: string[]): Promise<number> {
  let out = 'mcpt.yaml';
  const split = args.indexOf('--');
  const flags = split >= 0 ? args.slice(0, split) : args;
  const serverArgs = split >= 0 ? args.slice(split + 1) : [];

  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '-o' || flags[i] === '--out') out = flags[++i];
    else {
      console.error(`unknown option "${flags[i]}" — server command goes after "--"`);
      return 2;
    }
  }
  if (serverArgs.length === 0) {
    console.error(
      [
        `mcpt init needs to know how to start your MCP server.`,
        `mcpt init 需要知道如何启动你的 MCP 服务器。`,
        ``,
        `Put the server's start command after "--" | 把启动命令写在 "--" 之后：`,
        ``,
        `  ${bold('mcpt init -- node ./my-server.js')}`,
        `  ${bold('mcpt init -- python ./server.py')}`,
        ``,
        `No server of your own yet? Try the official filesystem server | 还没有自己的服务器？先用官方文件系统服务器体验：`,
        ``,
        `  ${bold('npx -y mcpt-runner init -- npx -y @modelcontextprotocol/server-filesystem /tmp')}`,
        `  ${bold('npx -y mcpt-runner run')}`,
      ].join('\n'),
    );
    return 2;
  }

  if (await exists(out)) {
    console.error(`${out} already exists — use -o to pick another name`);
    return 2;
  }

  console.log(dim(`starting ${serverArgs.join(' ')} ...`));
  const yaml = await generateTestFile({ command: serverArgs[0], args: serverArgs.slice(1) });
  await writeFile(out, yaml);
  const testCount = (yaml.match(/^  - name:/gm) ?? []).length;
  console.log(`${bold(out)} written with ${testCount} test(s).`);
  console.log(`已生成 ${bold(out)}，包含 ${testCount} 条测试。`);
  console.log(`\nNext steps | 下一步:`);
  console.log(`  1. ${yellow(`edit ${out}`)} — replace TODO argument values with realistic ones`);
  console.log(`     编辑 ${out}，把 TODO 参数换成真实值`);
  console.log(`  2. ${yellow('mcpt run')} — first run records snapshots, later runs catch regressions`);
  console.log(`     第一次运行录制快照，之后每次运行都是回归测试`);
  return 0;
}

async function cmdList(args: string[]): Promise<number> {
  const split = args.indexOf('--');
  const serverArgs = split >= 0 ? args.slice(split + 1) : args;
  if (serverArgs.length === 0) {
    console.error(
      [
        `mcpt list needs to know how to start your MCP server.`,
        `mcpt list 需要知道如何启动你的 MCP 服务器。`,
        ``,
        `Put the server's start command after "--" | 把启动命令写在 "--" 之后：`,
        ``,
        `  ${bold('mcpt list -- node ./my-server.js')}`,
      ].join('\n'),
    );
    return 2;
  }

  const client = new McpClient({ command: serverArgs[0], args: serverArgs.slice(1) });
  try {
    await client.start();
    const tools = await client.listTools();
    const name = client.serverInfo.name ?? serverArgs.join(' ');
    console.log(`\n${bold(name)} exposes ${tools.length} tool(s):\n`);
    for (const tool of tools) {
      const required = tool.inputSchema?.required ?? [];
      const params = Object.keys(tool.inputSchema?.properties ?? {})
        .map((p) => (required.includes(p) ? p : `${p}?`))
        .join(', ');
      console.log(`  ${bold(tool.name)}(${dim(params)})`);
      if (tool.description) console.log(`      ${dim(firstLine(tool.description))}`);
    }
    console.log();
    return 0;
  } catch (err) {
    console.error(red((err as Error).message));
    return 1;
  } finally {
    await client.close();
  }
}

async function discoverTestFiles(): Promise<string[]> {
  const entries = await readdir('.');
  return entries
    .filter((name) => name === 'mcpt.yaml' || name === 'mcpt.yml' || /\.mcpt\.ya?ml$/.test(name))
    .sort();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function firstLine(text: string): string {
  const line = text.split('\n')[0];
  return line.length > 100 ? line.slice(0, 97) + '…' : line;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(red((err as Error).stack ?? String(err)));
    process.exit(1);
  },
);
