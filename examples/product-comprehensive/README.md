# TraceLens 标准文档展示样例

这是可复制到独立目录的合成项目输入。所有业务、时间、决定、报告与历史任务来源都是示例；没有真实 task 操作或前端集成。格式与展示交接见[指南](../../../../guides/tracelens-product-documents.md)。

## 文件与读取

入口为 `.workflow-system/PRODUCT.yaml`，当前九类条目合并在 `docs/product/PROJECT.md`。历史需求、报告和讨论原文只在 source_paths 中，不扫描为当前定义。复制时包含隐藏的 `.workflow-system` 目录和 `.gitattributes`，不仅复制 Markdown。样例 attributes 只固定讨论原文的 LF 换行，使 Git 检出不改变其登记摘要。

从源码仓库根使用现有独立解析器：

```powershell
node runtime/vnext/support/product-maintenance/offline-reader.js docs/product/project-maintenance/examples/tracelens
```

交给独立消费者时，将该解析器复制为 `offline-reader.mjs`；样例目录保持结构，执行 `node <交接目录>/offline-reader.mjs <样例根>`。无需 vNext、Bun、npm 模块或模型。

## 预期可解析结果

| 项目 | 预期 |
|---|---|
| project_id | example-tracelens-import |
| status | available |
| 当前规范文件 | 1 份，12 个 usable 条目，9 类 type |
| requirement | 4 项：current／planned／candidate／retired 各 1 项 |
| 计划 | 1 份 proposed；工作项顺序 W-CHECK、W-BASE、W-DUAL |
| 工作项绑定 | W-BASE 关联 REQ-IMPORT 中的 B-BASE；task_id 为 null，按来源展示历史身份未知 |
| assessment | partial-reported 与 pass-reported 并存，仅旧单设备范围；subject 和定义对齐未知 |
| 待核对 | AS-BASE.pending_sources 含新增异常反馈 |
| discussion | inferred 的 discusses→REQ-STREAM，不表示观点采纳 |
| coverage.complete | true，仅指这一份登记当前文档的枚举和字节读取 |
| inventory.state | partial，与读取完整性无关 |

预期诊断为 `TASK_ID_UNCONFIRMED`、`DEFINITION_UNKNOWN`、`PENDING_SOURCES`。它们是刻意保留的业务／关联未知，不能清理成“无缺口”。独立离线解析器不会读取或核对来源文件内容；如需验证原文摘要，使用 helper 的只读 `resolve_sources` 或独立文件摘要核对。

`DISC-STREAM.raw_ref.sha256` 对应 `stream.txt` 的实际 UTF-8＋LF 字节。Git／编辑器转换换行后需按实际字节重新核对，不能用变化后的原文冒充原摘要。历史定义未登记 requirement definition 摘要，明确保留 null；这一空值与讨论原文摘要规则不同。

## 应能看见的内容

目标与模块支持关系、需求归属、设计提案、四种需求范围和三项工作安排均可独立显示。旧报告通过、新反馈待核对、当前版本未知同时存在；候选和退出需求仍可见，没有未来任务也不隐藏后续范围。

源码中的关系与安排是展示输入，最终页面行为需在 TraceLens 项目验证。无 plan 和多 plan 的补充输入沿用[规划消费样例](../planning-consumption.md)。

## 本次实际验证

2026-10-08：现有离线解析器与 helper 均读出 12 个合法条目、九类 type、零坏条目和上述三个预期诊断；helper 可定位全部文件来源，讨论原文核对为 `same-bytes`。样例及解析器复制到独立 OS 临时目录，以 `.mjs` 执行通过，核对了四种 scope、工作项顺序、未知任务关联及完整正文定位。交接指南和本说明的 18 个本地链接均存在，`git diff --check` 通过。

这些检查只验证格式、来源定位和离线消费，没有运行真实产品代码、模型判断或 TraceLens 页面。
