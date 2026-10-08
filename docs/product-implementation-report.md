# TraceLens 标准产品阅读交付记录

日期：2026-10-08；环境：Windows 原生、Node 24.12.0、npm 11.6.2、Microsoft Edge 154.0.4258.53。

起始与结束 HEAD 均为 `816284390135bec96f1a87a02f2cd22a254f61e2`，实施分支 `codex/product-visibility`。开始时工作区干净，本轮代码、资产与文档仍为未提交改动；没有推送、合并或部署。

## 已完成的用户效果

1. 标准读取：PRODUCT 范围预览、独立显式启用与高级入口，固定 v1／v2 生产 Schema、严格 YAML、根级 AST、混合文件完整正文、逐项降级、冲突身份、来源角色与绝对行。需求页可按四种 scope 浏览，目标／模块、需求、设计及其余九类条目互查并回原文。
2. 规划与任务：独立单／多／无计划，原数组顺序、stage、安排状态、覆盖和依赖；真实 task_id、显示编号与 UI 身份分开；TaskBinding 正反查、多个任务及工作项、后加 repair、repairs 历史范围、尚未创建的 C 工作项。原 Current work／adopted-plan 步骤跳转继续可用。
3. 报告与来源：assessment 仅沿明确选择入口，目标错配和未知保持可见；报告对象、范围、当前／历史定义对齐、真实文件字节、pending_sources 分开显示。旧局部通过与新反馈并列；推断、已否定关联、discussion 原文、change 与未同步范围可达。六页导航与既有目录选择、候选盘点、records 开关和静态指南贯通。

快照读取缓存与预算覆盖普通导航、PRODUCT、精确来源及当前采用计划；失败读取的实际字节也计入预算。排除不能通过其他通路绕过；PRODUCT 来源不加入通用导航队列；浏览页面不补读磁盘。有效撤回退出当前定义，坏 manifest 不复用旧 PRODUCT 条目；整体失败保留整份旧快照与旧时间。

改动集中于 shared 产品类型／阅读辅助、server 解析／读取／索引及快照集成、web 需求／规划／关系／原文、配置与预览、产品样例与回归。已有 requirements、architecture、README 更新为当前边界；固定来源、提交与许可见 [product-assets.md](product-assets.md)。

## 实际验证

| 命令／核对 | 最终结果 |
|---|---|
| `npm ci` | 通过；实施初期重装既有锁定依赖。 |
| `npm run check` | 通过：类型检查、69 项 Vitest 测试、Vite 与 Node 生产构建。 |
| `npm run format:check` | 通过；一次中间失败为随后修改的测试脚本未格式化，已修正并重跑。 |
| `npm run test:browser` | 通过：既有生产服务回归及 PRODUCT 六页闭环，1440／1024／390 宽度。 |
| `TRACELENS_REAL_PROJECT=E:\coding\TermLink npm run test:real` | 通过：10 份真实文档的隔离只读副本、2 个历史任务、原文定位；原件和副本 SHA-256 均未变。 |
| 官方 offline-reader 对照 | 综合样例 12 条／9 类、完整 metadata／body／定位／需求定义摘要一致；无／多计划原工作项顺序一致。 |
| 固定资产字节核对 | 四份 Schema、离线比较器及 27 个上游样例文件与 `813d314` 一致；隐藏入口已纳入交付，Git 属性保留字节。 |
| `git diff --check` | 通过。 |

浏览器最终证据：[结果 JSON](../output/playwright/acceptance-HKIkoY/result.json)、[需求报告与新反馈](../output/playwright/acceptance-HKIkoY/product-1440-requirement-report-pending.png)、[E6 后加修复](../output/playwright/acceptance-HKIkoY/product-e6-added-repair-c-not-created.png)、[390 宽度规划](../output/playwright/acceptance-HKIkoY/product-390-planning.png)、[坏入口与旧选择失效](../output/playwright/acceptance-HKIkoY/product-broken-manifest-stale-selection.png)。无非预期浏览器错误或自动外部资源请求，测试 Codex 登记内容未变。证据位于被 Git 忽略的 `output/`，不是产品运行依赖。

真实副本证据：[result.json](../output/playwright/real-documents-2mRWaj/result.json)。239 条诊断保留了这份刻意收窄副本的缺失登记、引用范围和导航限制，未把读取数量解释为业务盘点完成。

## 限制与基线问题

本轮已完成方案范围内的用户闭环。新 PRODUCT 功能以明确标注的合成样例验证；TermLink 真实回归验证既有文档通路，不宣称已有真实 PRODUCT 项目验收。v1 只读结构已测试，不宣称所有历史文档变体兼容；Linux／macOS、Node 22 和其他浏览器未运行。单次读取没有跨文件事务或 Git 代码快照保证，摘要相同不认证当前代码适用性。预算外、不支持的来源和未知业务事实保留原因。

额外 `npm audit --json` 返回 2 项 critical 记录：基线已有 `concurrently@10.0.5` 与其 `shell-quote@1.9.0` 依赖，对应 [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)。开始时 `npm ci` 已报告同样数量，原锁文件确认相同版本；本轮没有引入这两项，也没有采用 audit 建议的跨主版本降级。Ajv 已是原锁文件的 `8.20.0`，本轮只将它显式列为直接依赖。该依赖审计问题仍待单独修复，不记为通过。

未修改外部被观察项目或上游仓库。测试只修改本仓库的隔离副本与临时目录，npm／Context7 使用正常工具缓存；没有安装另一套工作流、调用 Runtime、执行观察项目 helper 或联网抓取私人正文。测试服务和浏览器已关闭，用户项目登记未被本轮验收污染。
