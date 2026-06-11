<div align="center">

# mcpt

**用纯 YAML 测试任何 MCP 服务器。**

不需要 SDK，没有样板代码，任何语言写的服务器都能测。

[![CI](https://github.com/JFGAtlas/mcpt/actions/workflows/ci.yml/badge.svg)](https://github.com/JFGAtlas/mcpt/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcpt-cli)](https://www.npmjs.com/package/mcpt-cli)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

[English](./README.md) | 简体中文

</div>

---

每天都有大量 [Model Context Protocol](https://modelcontextprotocol.io) 服务器发布，但几乎没有一个带测试。官方 Inspector 适合手动调试，却没有一种标准方式来声明 *"我的服务器必须保持这些行为"* 并在每次提交时自动校验。

`mcpt` 补上了这块缺口：一个直接讲 MCP 协议的轻量测试运行器。把它指向任何服务器 —— Python、TypeScript、Go、Rust，只要走 stdio 都行 —— 它会启动服务器、调用工具、并按你在 YAML 里写的期望逐条断言。

```
$ mcpt run

mcpt.yaml (my-weather-server)
  ✓ server exposes tools: get_weather, get_forecast
  ✓ returns celsius for Tokyo 12ms
  ✓ rejects an empty city name 4ms
  ✓ forecast output stays stable over time 18ms

tests: 4 passed (0.21s)
```

## 快速上手

第一个测试文件都不用自己写。`mcpt init` 会连上你的服务器，自动发现它的工具并生成测试：

```bash
# 1. 从运行中的服务器自动生成测试（任何 MCP 服务器都可以）
npx mcpt-cli init -- node ./my-server.js
#    └─ 生成 mcpt.yaml，每个发现的工具一条测试

# 2. 录制快照，之后每次运行都是回归测试
npx mcpt-cli run
```

> npm 包名为 **`mcpt-cli`**（裸名与已有的包过于相似，被 npm 防误植规则拦截）。全局安装 `npm i -g mcpt-cli` 后，得到的命令就是文档中通篇使用的 `mcpt`。

整个流程就这么多。第一次运行会把每个工具的输出录成快照，之后任何一次输出漂移都会让测试失败。

手边没有自己的服务器？克隆本仓库直接体验内置示例：

```bash
git clone https://github.com/JFGAtlas/mcpt && cd mcpt/examples
npx mcpt-cli run
```

## 应用场景

**1. 开发自己的 MCP 服务器。** 这是最核心的日常循环。现在想确认一次改动没把工具改坏，只能重启 Inspector 手动把每个工具点一遍；用 mcpt 整个检查就是一条命令 —— 改完代码跑 `mcpt run`，一秒内看到全绿或者一个精确到字段的差异报告。

**2. CI 里的回归把关。** 工具的输出是一份契约：下游的 Agent 和提示词依赖它的确切格式。快照测试把这份契约冻结下来，任何改变了工具输出的 Pull Request 都会带着差异报告挂在 CI 上 —— 赶在它悄悄弄坏所有依赖你的客户端*之前*。

**3. 筛选和升级第三方服务器。** 你把社区的 MCP 服务器接进了产品，然后它发布了 v2.1 —— 你依赖的行为变了没有？为你真正用到的行为写一次验收测试（`mcpt init` 帮你完成 90%），以后每次升级版本都重跑一遍。用证据升级，而不是靠运气。

**4. 守住安全边界。** MCP 最重要的测试往往是反向用例：文件系统服务器必须*持续拒绝*沙箱外的路径，数据库服务器必须*持续拒绝*裸 SQL。`expect: { error: true }` 把这些"必须拒绝"钉死，任何重构都无法悄悄放宽工具接受的输入：

```yaml
- name: 拒绝读取沙箱外的文件
  tool: read_file
  args: { path: /etc/passwd }
  expect: { error: true }
```

**5. 性能预算。** 一个要跑 8 秒的工具会卡住整段 Agent 对话。`latency: 500` 让"变慢"直接成为测试失败，而不是用户模糊的抱怨，意外引入的 N+1 查询在 PR 阶段就会被抓住。

**6. AI 辅助开发。** 现在大量 MCP 服务器本身就是编程 Agent 写的。mcpt 把这个循环闭合起来：Agent 改代码、跑 `mcpt run`、读失败差异 —— 全程不需要人类手动点击。纯 YAML 的测试对 LLM 来说既好生成又好审查，"补上测试"从此变成一句话的指令。

## 编写测试

测试文件先声明怎么启动服务器，再列出工具调用和期望结果：

```yaml
server:
  command: npx
  args: [-y, "@modelcontextprotocol/server-filesystem", /tmp]

# 服务器一旦不再暴露这些工具，立即报错
expectTools: [read_file, write_file, list_directory]

tests:
  - name: 列出临时目录
    tool: list_directory
    args: { path: /tmp }
    expect:
      contains: "[DIR]"
      latency: 500

  - name: 拒绝访问沙箱外的路径
    tool: read_file
    args: { path: /etc/passwd }
    expect:
      error: true

  - name: 目录列表格式保持稳定
    tool: list_directory
    args: { path: /tmp }
    expect:
      snapshot: true
```

### 断言参考

可以任意组合，全部通过测试才算通过。

| 键 | 含义 |
|---|---|
| `text` | 与结果文本内容完全相等 |
| `contains` | 包含子串（也可以是列表 —— 必须全部出现） |
| `matches` | 对文本内容做正则匹配 |
| `json` | 深度**子集**匹配 —— 把结果按 JSON 解析（服务器提供 `structuredContent` 时优先使用）；实际输出多出来的字段不算错 |
| `error` | 期望工具返回 `isError: true`（适合写反向用例） |
| `latency` | 单次调用的延迟预算（毫秒） |
| `snapshot` | 首次运行录制完整结果；之后结果一变就失败。用 `mcpt run -u` 接受变更 |

其他选项：顶层 `timeout`（毫秒，默认 10000）和单测试 `timeout`；`expectTools` 对 `tools/list` 做断言；`server.env` / `server.cwd` 控制被测进程。

## 命令

| 命令 | 作用 |
|---|---|
| `mcpt init -- <cmd>` | 启动服务器、发现工具、生成测试文件，参数样例自动取自每个工具 JSON Schema 的 `default` / `examples` / `enum` |
| `mcpt run [files...]` | 运行测试文件（默认找当前目录的 `mcpt.yaml` 和 `*.mcpt.yaml`）。任何失败退出码为 1，可直接接入 CI |
| `mcpt run -u` | 重新录制已变化的快照 |
| `mcpt list -- <cmd>` | 打印服务器暴露的工具及其签名 |

## 持续集成

`mcpt` 是单条命令 + 标准退出码，接 CI 只要两行：

```yaml
# .github/workflows/test.yml
- run: npm ci
- run: npx mcpt-cli run
```

把生成的 `__snapshots__/` 目录提交进版本库，回归就能在 Pull Request 里被拦下来。

## 为什么不直接用 Inspector？

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) 是交互式调试器 —— 手动探索服务器很好用，但做不了回归测试。`mcpt` 是缺失的另一半：可重复、声明式、退出码驱动。两个一起用。

|  | Inspector | mcpt |
|---|---|---|
| 交互式探索服务器 | ✅ | — |
| 每次提交自动断言行为 | — | ✅ |
| 跑在 CI 里 | — | ✅ |
| 快照回归 | — | ✅ |

## 设计原则

- **语言无关。** mcpt 讲协议，不讲框架。Claude 能用的服务器，mcpt 就能测。
- **接近零依赖。** 运行时只依赖 `yaml` 一个包。安装快，审计干净。
- **朴素的 YAML。** 测试文件就是数据：不懂代码的人能读，LLM 能写，也不需要编译。
- **CI 优先。** 确定性输出、真实退出码、快照进版本库。

## 路线图

- [ ] Streamable HTTP / SSE 传输（当前为 stdio）
- [ ] 测试 prompts 和 resources，不止 tools
- [ ] `--watch` 模式
- [ ] JUnit XML 输出，对接 CI 看板
- [ ] 可选的 LLM 评审断言（`judge: "回答里提到了天气"`）

欢迎贡献 —— 代码全部加起来约 700 行 TypeScript，一口气就能读完。大改动请先开 issue 讨论。

## 许可证

[MIT](./LICENSE)

---

## 作者与支持

- X（推特）：[@JFGAi](https://x.com/JFGAi)
- Telegram：[t.me/jfgae](https://t.me/jfgae)
- GitHub：[JFGAtlas](https://github.com/JFGAtlas)

> **mcpt 是一个公益开源项目** —— 无广告，免费使用，长期维护更新。

如果 mcpt 帮你省了时间，欢迎捐赠支持项目持续发展：

| 网络 | 地址 |
|---|---|
| EVM | `0x3EE918603d5a1c0f983BEC5B5d8C301F8ed58A2C` |
| Solana | `2LEDYj19kormPezoiFgZAguyCVsfaM3HExsYe2NWpNqk` |
| Bitcoin | `bc1qs2nwumk24fjtk574f0awaxnh7jl9v7shrd5yw7` |

