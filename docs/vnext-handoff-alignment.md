# vNext 标准解析交接验收（2026-10-10）

依据 vNext 的 `docs/guides/tracelens-product-documents.md`、
`docs/product/project-maintenance/document-contract.md` 和生产 v1／v2 Schema。
读取本地源码和项目资料，没有修改 vNext 或 TermLink 文档，没有执行它们的 helper／Runtime。
具体源码快照及许可见 [解析资产出处](../src/server/product-assets/PROVENANCE.md)。

修正内容：

- YAML 问题按条目范围降级；根级错误阻止整份文档解释。坏项保留原文和定位，正常相邻项继续读取。
- 隐含安全排除保留 `IMPLICIT_PATH_EXCLUDED` 与 omitted；只有显式排除范围移出覆盖声明。
  当前定义与 capture_paths 重叠单独报告，不按目录名称推断当前权威性。
- `part_of` 仅允许需求／模块到模块，不能用于需求到需求拆分。设计、讨论、需求范围各自显示语义。
- 未知真实任务身份单独待确认；B、A、C 重排保持原数组、独立绑定及原历史报告，未绑定工作项仍然保留。
- SourceRef 的已登记代码／无扩展名 UTF-8 来源支持读取、定位和摘要核对，默认显示原文，
  不提取任务／状态；拒绝二进制、路径越界和预算超限。

验证结果：

| 检查 | 结果 |
|---|---|
| `npm run check` | 207 项测试、类型检查、生产构建通过 |
| `npm run format:check` | 通过；独立 oracle 保留原始字节，不格式化 |
| 当前独立解析器差分 | 五组完整样例；metadata、正文、行号、定义摘要、反向关系、工作绑定与覆盖一致 |
| 当前 vNext 生产资产 | 四份 Schema 一致；28 份模板／示例、九类条目可解析 |
| TermLink 全量规范文档 | 447 份 Markdown／YAML 全部读取，原始 SHA-256 一致，解析失败 0 |
| TermLink 产品定义 | 7 份托管文件，72 个可用条目，26 项需求，读取完整且结构正常 |
| 浏览器 | 常规页面和产品场景通过；1440／1024／390 布局无横向溢出，无运行错误 |

证据：

- [完整资料与模板回归](../output/playwright/vnext-corpus-0dP1F5/result.json)
- [产品浏览器回归](../output/playwright/product-acceptance-cRmNVI/result.json)
- [常规浏览器回归](../output/playwright/acceptance-8NY4s7/result.json)

TermLink 的七份事件原件实际缺失，继续保留来源缺口；业务待核对和一个普通文档重复
`last_updated` 也保留，不因此宣称需求完成或产品结构失败。本次完整性仅覆盖所验证的
规范文件和已登记托管范围，不表示所有未来版本、任意格式或实时任务状态均已验证。
