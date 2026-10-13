# 需求实施关联与进度聚焦：TraceLens 消费与验证

日期：2026-10-13 UTC（方案日期 2026-10-14）。BINDING-PROGRESS-v2；TraceLens 固定基线 `74a545e2b87d887ffbe8c164a14233660e600171`。

## 1. 本轮交付

T0/T1/T2 在原摘要、缓存、筛选和导航链路上增量实现：

- 固定生产 v4/v5 Schema；v4/v5 Goal、Requirement、Assessment 使用已知范围语义，v5 继承 Roadmap。
- 服务端纯只读 Roadmap 比较，覆盖 selector、成员、定义/上下文、arrangement、working_copy、来源、exceptions/stale exceptions。缺完整身份/来源读取时 unknown，已保存安排仍可浏览。
- 派生缓存版本更新，旧解析缓存失效；无变化刷新稳定，来源补读及贡献变化进入摘要 revision。
- 直接/支撑/旧未分类/冲突分别显示；保留 owner、role、coverage、reason、sources、身份与来源局限。关系数与唯一 Task 身份分开，分组重叠、null 身份、inferred 与共享后代可解释。
- 四区首页：真实当前工作、最近确认的范围成果、真实 Roadmap 保存安排、完整需求范围。需求登记顺序不再叫实施规划。
- 实际执行只从同批 Task/Step、采用计划与执行引用解释；active/direct/closed 都不等于需求开始或完成。分页外当前身份及无绑定工作仍可见。
- 当前成果额外检查报告适用性，显示 scope/subject 和核对时间；跨时区按实际时间排序，未知时间不冒充最近完成。
- 多份 Roadmap 不按时间选择唯一计划，current 不表示完成或就绪；未知/非法结构提供原文与诊断，不从登记顺序或第一个无 Task 项推算下一步。

生产从不执行被观察项目的 product-maintenance helper，不写业务文档，不加入模型分类器、Task 操作或新 Runtime gate。

生产源码已固定为 [0.24.10 / 1c56bf5](https://github.com/KongXiangning/vibe-coding-workflow-system/commit/1c56bf5fbde5003a7a9aca314ad04bb6794f1b6d)；远端 main 及 tree 已核验。没有 npm 发布或部署。

生产定义来源、Schema hash 与 test-only oracle 见 [PROVENANCE](../../src/server/product-assets/PROVENANCE.md)。最终 oracle 与 vNext 0.24.10 的 offline reader 字节相同（仅改 `.mjs` 扩展名），SHA-256：`4fd4f5538f19dcc1417dbd9f6940f1ebe86b8df9172a36a276769104d42f69c2`。

## 2. 已执行检查

| 检查 | 结果 |
|---|---|
| 全量 `npm test` | 32 文件通过，322 passed / 3 skipped |
| `npm run build`（含 typecheck） | 通过；保留现有 bundle chunk size 提示 |
| `npm run format:check` | 通过 |
| 贡献/焦点、v4/v5、Roadmap oracle、增量读取独立复跑 | 49/49 通过 |
| 最终同源 Roadmap oracle | 26 项通过，使用最终生产 hash |
| 新聚焦浏览器脚本 `node --check` | 语法通过 |
| `TRACELENS_PREPARE_ONLY=1 npm run test:browser:focus` | API/夹具准备通过；browser=not-run |
| 实际宿主保存输出的 parser/index/overview 消费 | 通过，423 文件/链接记录前后相同 |

3 个 skipped 保持仓库测试原有跳过状态，不计作通过。未运行的浏览器 UI 不包含在上述通过数里。日志在 [证据目录](binding-progress-evidence/)。

## 3. 对实际保存宿主输出的消费

`tests/host-contribution-consumer.mjs` 使用真实 `buildSnapshot → PRODUCT parser/index → buildOverviewData` 链路读取本轮实际 Agent 保存的隔离项目。原输入及管理操作证据保存在生产仓库 `docs/ops/binding-progress-evidence/`；这是合成业务案例，不是用户真实项目。

实际观察：

- 混合 v3/v5 全部条目可用；旧解析 Task 已 closed，PARSE 两条 direct（实施/验证）与 BATCH supporting 分开
- 新验证 Task 只有 prepare/adopt，step=not-started，execution/test 空；不猜它已执行
- Runtime 使用明确标记的 `file-snapshot / stale-or-unknown` 降级，**未执行被观察 helper，也未冒充实时查询**
- current=null 原样保留，不从 active 列表抢选焦点；其他有焦点、无绑定、分页外身份场景由定向测试覆盖
- 归档 null 身份/缺分类保留，字号 dismissed 不计当前有效关系
- 唯一进入范围成果的是 `REQ-PARSE / PARSE-BASE`；依据旧两项真实测试与明确源码版本，排除新三类未执行验证
- 无 Roadmap 时不生成近期安排或下一项
- 423 项文件/符号链接的前后总摘要相同：`fc8fde069e223d1355d4f593a172461dcd58b938c98cfa2ee2bb6a1097f27171`

[实际消费结果](binding-progress-evidence/result.json) 与 [轻量总览输出](binding-progress-evidence/overview.json) 保留范围、数据来源及局限。

## 4. 浏览器边界与重跑入口

**浏览器 UI 本轮未验，不能称 PASS。**

1. 本机 `/usr/bin/chromium` 在页面断言前因 `socket() failed: Operation not permitted` / `process_singleton_posix` 启动失败。更正临时 HOME 后仍存在此限制。
2. 工具提供的既有云浏览器可用，但无法访问执行环境已监听的 `127.0.0.1:4325`，返回 `ERR_CONNECTION_REFUSED`。
3. 没有修改网络/安全设置，没有切换到用户电脑。API 初始化和静态渲染不替代浏览器行为证明。

在可运行浏览器的获授权环境，先 `npm run build`，然后：

```sh
TRACELENS_BROWSER_EXECUTABLE=/path/to/chromium npm run test:browser:focus
TRACELENS_BROWSER_EXECUTABLE=/path/to/chromium npm run test:browser:overview
```

focus 脚本覆盖四区、贡献、详情/图谱、返回、切项目、筛选、请求及原文件只读；其 Runtime 焦点样本明确标为合成。脚本已完成语法与 API prepare-only 校验，但这些交互断言仍未运行。

旧 `product-browser.mjs` 本轮明确受影响的标题/路线图选择器已调整，但其余历史 startup 断言没有完整迁移/验证，不把它声称为本轮已通过的完整浏览器回归。

## 5. QA 证据分组

| 方案范围 | 已有证据 | 本轮未证实的部分 |
|---|---|---|
| QA-01/03/22–26/35/41–44/49 | Schema、新旧混合、owner/DAG/去重/贡献冲突与摘要测试 | 真实业务全量关系语义 |
| QA-05/07–12/29–32/37/40/51 | 状态分离、精确活动、适用成果、无绑定/分页场景测试及实际宿主消费 | 真实浏览器可见性/布局与全部交互 |
| QA-27/28/42/45–47/50 | 生产同源 oracle：范围/来源/身份覆盖/延期/字节变化与诚实 unknown | 真实业务安排合理性与执行前提 |
| QA-36/48/49/52 | 未支持版本、缓存升版、增量补读、无变化 revision、轻摘要回归 | 浏览器返回/切项目/滚动恢复的实测 |
| QA-02/04/06/13–21/33/34/38/39 | 生产仓库的实际隔离宿主、写入/历史/幂等与原 Task 管理回归 | 真实项目 J1、所有模型/平台适用性 |

不是 QA-01～52 全部通过的声明。未读取或修改 LawAgent、TermLink 或其他真实业务项目；没有真实项目 J1 授权。没有发布 npm 或部署。需求判定由有来源的宿主维护完成，TraceLens 不以 Task 数量推算需求满足。
