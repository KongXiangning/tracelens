# 2026-10-12 结构解释与分层需求云端交接

基线 `8680013c5dbb3ac75b68768a0aac4f5551bff938`，独立分支 `codex/structure-explanation-cloud-20261012`。保留已有概览决定，没有修改 App.tsx、overview-dashboard.css、解析器、Schema、Runtime 查询、Task reducer 或被观察项目。原取证阶段未提交、推送、发布、部署或升级 K-PC 真实副本；用户随后授权的 Git 收口及停止边界见下节。

## 最终停止边界（2026-10-12 12:41 UTC）

用户先要求“可以停止了，剩下的工作不用做了”，随后授权“把已完成的工作都提交并推送”。仅提交并推送已完成改动到本独立分支，不继续实施、浏览器或大测试，不合并主分支、不发布或部署、不改真实 K-PC 副本；Git 结果以实际仓库为准。

父线程报告 Windows Edge 155.0.4283.45 等待观察版 `cb7470da8114dbf65221a09f50805e66aa272bdf94f94fe5bb6aaddc60728544` 三输入 29/29、结构测试 9、输出保护 5 通过。当前正式脚本为 `d67388ae5a374b71d2ba15429a3756aebfb16048158881898a2d3611e190287c`，Cloud 当前三输入 29/29；Windows 独立比较副本应用完整差异后精确等于 d673，不等于在 Windows 重新执行 d673 取得 29/29。旧冻结入口首败、四条基线既有概览失败及原证据均保留。

联合验收仍有停止时未完成项：vNext 的 Windows 最后 file URL 测试重跑因 Codex 6.1 sol capacity 失败未完成；新 J4 独立 Agent 的先读、选择、helper 保存、回读及同值重试证据已产生，但父线程最终独立复核被用户停止。两者均不标通过，不能据此宣称全验收或全平台通过。原 J4 runner 的先行模型阅读时序不足已明确纠正，不能由页面检查替代。

最终原始范围见 [J1–J10 索引](https://chatgpt.com/api/library/files/libfile_d1a2bb57bcdc81919c9ef5d6aa183dda/download)和[联合原始证据](https://chatgpt.com/api/library/files/libfile_1fae23f5ccf48191851fe9448d628720/download)。下文保留各次取证时点和输入；不把阶段“待 K-PC”或旧失败改写成最终全通过。

## 已完成实现与阶段证据

需求主图复用 requirementHierarchy 的正式组成 DAG，默认高层入口，展开、搜索及缺口保留必要祖先。新增 productStructure 只解释已读取条目和已记录关系，保留候选、其他目标、非当前范围和引用问题；不解释扩展分类或自然语言来补边。候选入口复用 ProductRelationPanel 的虚线、理由与来源，异常关系不生成图端点。module 是分类而非评估对象，goal 使用自身范围；没有有效所选目标的 requirement 仍为尚未判定。

三组阶段浏览器证据保留在原交付 wrapper 的 `evidence/three-inputs/`，原目录 `/workspace/cloud-delivery/tracelens/browser/structure-4BvBEZ`。Linux、Node 24.19、Chromium 151.0.7922.173、1440×1080，共 29 项通过，无 pageerror。各输入保存读前/读后逐文件 SHA-256、实际快照、请求、截图与 DOM；该轮输入字节不变。后续资料补充另列，不覆盖这份阶段证据。

| 输入性质 | 根目标正式路径中的 current 需求 | 默认显示需求入口 | 已读候选（相关/全部） |
| --- | --- | --- | --- |
| 固定真实资料只读副本 before | 0 | 0 | 25/26 |
| helper 实际保存资料 after | 66 | 文档治理、服务端、Web、App | 25/26 |
| 独立安装资产后宿主保存的隔离增量 | 67 | 同上；合成细项按需展开 | 25/26 |

该阶段的 after 与隔离增量分别含 69/70 个 requirement、92/93 条正式结构关系；非 current 的 3 项仍能从未连入口进入原详情。增量 `REQ-SYNTHETIC-TERMINAL-LABEL` 经实际 App→App-Terminal 组成路径可达；没有临时解析分类字段或前端补线。该条不属于真实 TermLink 业务。生产判断、helper 写入、部分失败与重试的证明由配套 TermLink/vNext 宿主证据承担，本页面验证不替代它们。

当前最终补充以 `structure-bhL709` 单独验证 after / 隔离增量，共 22 项通过；未重跑 before 或业务。实际回读为 69/70 个 requirement、94/95 条正式结构关系、121/122 个可用条目。THREADS 与 MODEL 各保存一个身份，两个当前 declared part_of 父项均为 MVP / Android native；浏览器沿实际祖先展开嵌套父项，验证 THREADS 单身份及任一展开路径，MODEL 可独立阅读且仍尚未判定。Task 视图仍为原 38 closed / 2 paused，六步骤与 S1、paused 页面及非零滚动返回可用，两输入前后文件 SHA 相同。输入选择 JSON 与该轮证据在当前增量组合目录交接，当前 SOURCE_METADATA 为交付元数据，不是第二份产品定义。

真实 `REQ-20260318-ws-0001-docs-exp` 的 server/web 展开路径保留同一身份；关闭一父路径仍可达。`REQ-TERMLINK-PERMISSION-MODE` 沿 server→auth→原管理员需求展开，没有报告仍为尚未判定，没有复制父项 Task 或 PASS。四 Runtime 模块先逐字核对固定 TermLink 基线；增量 fresh 安装的同四模块也匹配这些字节，只在独立 Registry 显式信任。只读查询得到原 40 Task，38 closed、2 paused；原 Task `task-58bc12d9a46b8d84fb6e42888785b402` 的六 Step 与 S1 详情可读，原 `20260615-001` 保持 paused。样例不含 .git，历史提交不可核验提示保留，没有修复旧事实。

Task 与来源返回恢复目标、选中需求、候选面板和展开状态；实测非零滚动 before=16704/10843，after 与增量=18834/13375。早期检查发现条目导航 native details 的 open 状态丢失、页面高度变化导致滚动失败，已纳入既有 ViewState 并由最终检查通过。失败记录保留，不能计为通过。

有限展示夹具另存 `evidence/ui-only/` 和 `evidence/root-issues/`：共享 DAG、module 不评估、目标自身范围、缺口祖先、unknown 不算失败，以及缺失/错误根目标的节点与详情一致。这些合成关系只用于消费回归，不能证明宿主会从原材料生成正确结构。

正常 build（含 typecheck）和改动文件格式、diff 检查通过。完整 Vitest 的四条既有概览展开按钮断言在固定基线隔离目录同样失败；未修改概览或删除断言，日志保留在 metadata。Windows 专用检查按 Linux 平台跳过，当前 Windows 实机验收待 K-PC；本交接不宣称全平台验证。

J1/J3/J4/J5/J6/J7/J8/J9/J10 的消费与页面部分分别由正式路径、独立细项/增量、未连原因、共享身份、Task/Step、只读摘要及准确结论提供证据。J2 的原始业务范围去向、关系采用依据和 J10 的宿主重试不重复身份仍以生产方材料为准。结构存在与没有结论可以同时成立，不把浏览器通过解释成业务已完成。
