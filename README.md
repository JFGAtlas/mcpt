<div align="center">

# mcpt

**Test any MCP server with plain YAML.**

No SDK. No boilerplate. Works with servers written in any language.

[![CI](https://github.com/JFGAtlas/mcpt/actions/workflows/ci.yml/badge.svg)](https://github.com/JFGAtlas/mcpt/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcpt-runner)](https://www.npmjs.com/package/mcpt-runner)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

English | [简体中文](./README.zh-CN.md)

</div>

---

Thousands of [Model Context Protocol](https://modelcontextprotocol.io) servers are being published, and almost none of them have tests. The official Inspector is great for poking at a server by hand — but there has been no standard way to say *"these are the behaviors my server must keep"* and enforce it on every commit.

`mcpt` is that missing piece: a tiny test runner that speaks the MCP wire protocol directly. Point it at any server — Python, TypeScript, Go, Rust, anything that talks stdio — and it starts the server, calls its tools, and checks the results against expectations you write in YAML.

```
$ mcpt run

mcpt.yaml (my-weather-server)
  ✓ server exposes tools: get_weather, get_forecast
  ✓ returns celsius for Tokyo 12ms
  ✓ rejects an empty city name 4ms
  ✓ forecast output stays stable over time 18ms

tests: 4 passed (0.21s)
```

## Quickstart

You don't even have to write the first test file yourself. `mcpt init` connects to your server, discovers its tools, and generates one:

```bash
# 1. Generate tests from a live server (any MCP server works)
npx mcpt-runner init -- node ./my-server.js
#    └─ writes mcpt.yaml with one test per discovered tool

# 2. Record snapshots, then catch regressions forever
npx mcpt-runner run
```

> The npm package is **`mcpt-runner`** (the bare name was too close to an existing package). Installing it globally with `npm i -g mcpt-runner` gives you the `mcpt` command used throughout these docs.

That's the whole loop. The first run records each tool's output as a snapshot; every run after that fails if the output drifts.

Want to try it without a server of your own? Clone this repo and run the bundled demo:

```bash
git clone https://github.com/JFGAtlas/mcpt && cd mcpt/examples
npx mcpt-runner run
```

## When would I use this?

**1. Building your own MCP server.** The core dev loop. Today, checking that a code change didn't break a tool means restarting the Inspector and clicking through every tool by hand. With mcpt the whole check is one command — change code, `mcpt run`, see green or a precise diff in under a second.

**2. Regression gating in CI.** Tool output is a contract: agents and prompts downstream depend on its exact shape. Snapshot tests freeze that contract, and a pull request that changes any tool's output fails CI with a diff — *before* it silently breaks every client that depends on you.

**3. Vetting and upgrading third-party servers.** You wire a community MCP server into your product, then `v2.1` ships. Did anything you rely on change? Write acceptance tests once for the behaviors you actually use (`mcpt init` gets you 90% of the way), and re-run them on every version bump. Adopt upgrades with evidence instead of hope.

**4. Guarding security boundaries.** The most important MCP tests are negative ones: the filesystem server must keep *refusing* paths outside its sandbox, the database server must keep *rejecting* raw SQL. `expect: { error: true }` pins those refusals down so a refactor can never quietly widen what a tool accepts:

```yaml
- name: refuses to read outside the sandbox
  tool: read_file
  args: { path: /etc/passwd }
  expect: { error: true }
```

**5. Performance budgets.** A tool that takes 8 seconds stalls the whole agent conversation. `latency: 500` makes slowness a test failure instead of a vague user complaint, and catches the accidental N+1 query at PR time.

**6. AI-assisted development.** A lot of MCP servers are now written *by* coding agents. mcpt closes that loop: the agent edits code, runs `mcpt run`, and reads the failure diff — no human clicking required. Plain-YAML tests are also trivial for an LLM to write and review, so "add tests" becomes a one-sentence instruction.

## Writing tests

A test file names the server command, then lists tool calls and what to expect:

```yaml
server:
  command: npx
  args: [-y, "@modelcontextprotocol/server-filesystem", /tmp]

# fail fast if the server stops exposing these tools
expectTools: [read_file, write_file, list_directory]

tests:
  - name: lists the temp directory
    tool: list_directory
    args: { path: /tmp }
    expect:
      contains: "[DIR]"
      latency: 500

  - name: refuses paths outside the sandbox
    tool: read_file
    args: { path: /etc/passwd }
    expect:
      error: true

  - name: directory listing format stays stable
    tool: list_directory
    args: { path: /tmp }
    expect:
      snapshot: true
```

### Expectation reference

Combine as many as you like; all of them must pass.

| Key | Meaning |
|---|---|
| `text` | Exact match against the result's text content |
| `contains` | Substring (or list of substrings — all must appear) |
| `matches` | Regular expression against the text content |
| `json` | Deep **subset** match — parses the result as JSON (uses `structuredContent` when present); extra fields in the actual output are fine |
| `error` | Expect the tool to return `isError: true` (great for negative tests) |
| `latency` | Per-call latency budget in milliseconds |
| `snapshot` | Record the full result on first run; fail when it changes. Accept changes with `mcpt run -u` |

Other knobs: top-level `timeout` (ms, default 10000) and per-test `timeout`; `expectTools` asserts on `tools/list`; `server.env` / `server.cwd` control the spawned process.

## Commands

| Command | What it does |
|---|---|
| `mcpt init -- <cmd>` | Start a server, discover its tools, generate a test file with plausible arguments pulled from each tool's JSON Schema (`default` / `examples` / `enum`) |
| `mcpt run [files...]` | Run test files (defaults to `mcpt.yaml` and `*.mcpt.yaml` in the current directory). Exit code 1 on any failure — CI-ready |
| `mcpt run -u` | Re-record snapshots that changed |
| `mcpt list -- <cmd>` | Print the tools a server exposes, with their signatures |

## CI

`mcpt` is a single command with proper exit codes, so CI is two lines:

```yaml
# .github/workflows/test.yml
- run: npm ci
- run: npx mcpt-runner run
```

Commit the generated `__snapshots__/` directory so regressions are caught in pull requests.

## Why not just use the Inspector?

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is an interactive debugger — perfect for exploring a server by hand, useless for regression testing. `mcpt` is the other half: repeatable, declarative, exit-code-driven. Use both.

|  | Inspector | mcpt |
|---|---|---|
| Explore a server interactively | ✅ | — |
| Assert behavior on every commit | — | ✅ |
| Runs in CI | — | ✅ |
| Snapshot regressions | — | ✅ |

## Design principles

- **Language-agnostic.** mcpt talks the protocol, not your framework. If Claude can use your server, mcpt can test it.
- **Nearly zero dependencies.** One runtime dependency (`yaml`). Installs fast, audits clean.
- **Boring YAML.** Test files are data, so non-experts can read them, LLMs can write them, and nothing needs compiling.
- **CI-first.** Deterministic output, real exit codes, snapshots in version control.

## Roadmap

- [ ] Streamable HTTP / SSE transports (currently stdio)
- [ ] Testing prompts and resources, not just tools
- [ ] `--watch` mode
- [ ] JUnit XML output for CI dashboards
- [ ] Optional LLM-as-judge assertions (`judge: "the answer mentions the weather"`)

Contributions welcome — the codebase is ~700 lines of TypeScript and reads top to bottom in one sitting. Open an issue before large changes.

## License

[MIT](./LICENSE)

---

## Author & Support

- X (Twitter): [@JFGAi](https://x.com/JFGAi)
- Telegram: [t.me/jfgae](https://t.me/jfgae)
- GitHub: [JFGAtlas](https://github.com/JFGAtlas)

> **mcpt is a charity open-source project** — no ads, free to use, and maintained for the long term.

If mcpt saves you time, donations help keep it going:

| Network | Address |
|---|---|
| EVM | `0x3EE918603d5a1c0f983BEC5B5d8C301F8ed58A2C` |
| Solana | `2LEDYj19kormPezoiFgZAguyCVsfaM3HExsYe2NWpNqk` |
| Bitcoin | `bc1qs2nwumk24fjtk574f0awaxnh7jl9v7shrd5yw7` |

