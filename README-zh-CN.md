# Cynos

> **语言：** [English](./README.md) · 简体中文

Cynos 是一个面向 [pi](https://github.com/earendil-works/pi-coding-agent) 编码代理的自主 AI 工程运行时。它让代理自由工作，然后通过**基于证据的检查点**验证完成情况——而不是轻信一句"做完了"。

[![npm 版本](https://img.shields.io/npm/v/@cynos-ai/engineer.svg)](https://www.npmjs.com/package/@cynos-ai/engineer)
[![GitHub 发布](https://img.shields.io/github/v/release/cynos-ai/engineer.svg)](https://github.com/cynos-ai/engineer/releases)

## 使用要求

- Node.js 22 或更高版本
- 已安装并可调用的 [pi](https://github.com/earendil-works/pi-coding-agent)
- Engineer 会捆绑 `@cynos-ai/tools`，提供共享的搜索、视觉和浏览器工具

---

## 为什么需要 Cynos

AI 代理很擅长写出令人信服的完成总结。难的是——你能不能信任它。

- "我修好了 bug"——但它先复现过吗？
- "测试通过"——它真的跑了测试套件，还是凭记忆总结的？
- "我更新了文档"——它真的写了文件吗？

Cynos 改变了信任模型。代理想怎么工作就怎么工作；但在它声称完成之前，Cynos 会把声明拿去和**捕获到的工具结果**核对——即会话里真实发生的 read、write、bash 命令、search/fetch 结果、子代理调用。没有捕获到证据，就没有完成。

```text
completionEvidence  →  说明代理声称发生了什么
capturedToolResults →  证明实际发生了什么
checkpoints         →  判定工作是否真正完成
```

## 快速开始

把 Cynos 安装到 pi（用户级，全局）：

```bash
pi install npm:@cynos-ai/engineer
```

或者项目级安装（写入 `.pi/settings.json`，可与团队共享）：

```bash
pi install npm:@cynos-ai/engineer -l
```

在任意项目里打开 pi，用自然语言描述工作即可：

```text
> 给 src/app.ts 加一个 multiply 函数，并验证它能用。
```

Cynos 会把请求路由到正确的实践（这里是 `develop`），让代理实现，然后运行 `cynos_check_completion`。如果某个检查点发现缺少真实证据，工作会保持激活状态并给出可操作的缺失原因——而不是一句假的"完成"。所有检查点通过后，工作归档到 `.cynos/archive/`。

升级或移除：

```bash
pi update --extensions       # 升级所有已安装的包
pi remove npm:@cynos-ai/engineer
```

## 核心模型

```text
practice = 方法论技能 + 完成检查点
work     = 目标 + 验收标准 + 状态 + 完成证据 + 捕获的工具结果
```

没有活动状态机，也没有逐步的繁文缛节。代理开始一项工作，正常地探索/编辑/测试，然后调用 `cynos_check_completion`。检查点失败则工作保持激活，附带可操作的缺失证据；检查点通过则工作归档到 `.cynos/archive/`。

## 实践（Practices）

Cynos 当前包含 12 个实践：

- **review** — 对现有代码、设计、PR、提交或文档做只读评估
- **docs** — 仅文档/报告类变更，不改变运行时行为
- **onboard** — 理解现有项目并创建/刷新持久化项目记忆
- **init** — 从零创建新项目
- **debug** — 复现、诊断、修复并验证 bug 或故障
- **test** — 通过实际运行来测试/验证现有行为，给出 PASS/FAIL/FLAKE/BLOCKED 裁决
- **develop** — 实现功能、运行时配置和一般变更
- **refactor** — 保持行为不变的结构调整，带基线/最终验证
- **ui-design** — 视觉 UI / 设计系统 / 样式工作，带浏览器证据
- **usability** — 前端易用性观察、修复、再验证
- **release** — push / tag / publish / deploy / CI-CD / 发布后验证
- **default** — 当没有具体实践适用时的窄兜底

用户可以自然描述工作，也可以用 slash 命令，例如 `/review`、`/test`、`/develop`、`/debug`、`/release`、`/onboard`。

## 工具

工作生命周期：

- `cynos_start_work` · `cynos_work_status` · `cynos_check_completion`
- `cynos_ask_user` · `cynos_resume_work` · `cynos_abandon_work`

能力工具：

- `cynos_subagent` · `cynos_search` · `cynos_fetch`

## 状态与配置

项目状态存放在目标项目中：

```text
.cynos/
  work.json
  last-outcome.json
  archive/
```

用户配置存放在：

```text
~/.pi/agent/cynos-config.json
```

`/cynos-config` 命令可编辑常用设置：语言、onboard 模式、子代理超时、工作感知的 compaction。搜索 API key、视觉模型、浏览器选项由 `@cynos-ai/tools` 提供——请用 `/cynos-tools-config` 编辑。

## 文档与维护

- [文档索引](./docs/README.md)
- [架构](./docs/architecture.md)
- [安装](./docs/installation.md)
- [开发](./docs/development.md)
- [测试](./docs/testing.md)
- [发布](./docs/release.md)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)
- [变更记录](./CHANGELOG.md)

## 许可证

Cynos Engineer 使用 [`MIT License`](./LICENSE)。

`skills/ui-design/` 中的上游内容保留其 MIT 归属信息；详见
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) 和
[`skills/ui-design/SOURCE.md`](./skills/ui-design/SOURCE.md)。
