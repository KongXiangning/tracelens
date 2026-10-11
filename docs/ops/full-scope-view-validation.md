# 完整当前需求展示：云端验收

基线 master `74841188a415ec2486d1a250379f66b602541bf1`，独立分支 `codex/full-scope-views-20261011`。源码未提交推送。父线程最终独立复核全部通过，无剩余必要 finding：C 包完整源码、116 项实际安装字节、追加 18＋5 组页面报告已核对；5 份生产核心文件及最终 src 与已审查包相同。其独立 typecheck/build 和 67 项检查通过（含 5 项有限探针），其审查环境浏览器 socket 受限，未独立重跑页面；本宿主的实际交互证据另列。最终仅更新交接结论和真实 Task 状态，未改已审产品源码。

正常 API 收口并回读：`TASK-001`（`task-b5d10cc679790f732b2029003c1320ee`）lifecycle=closed，C/D 均 finished，current_task_id=null；事实 recorded=true、association=applied、投影 updated。关闭 ref：`.workflow-system/records/events/key-691c50736e913a83329f5ff69e44ab6803c99fe3af323181525b0c99db81614d.json`。vNext 本次 Task 同样 closed，其原历史显示漂移保留；没有手改 CURRENT_TASK。关闭不表示真实业务全面验证或 qualification PASS。

复用固定 v1/v2/v3 读取契约和现有范围化报告选择。新增 product-hierarchy 仅派生 current、declared、active、resolved 的 requirement part_of。默认父项入口，展开显示子项；共享子项任一父路径展开即可达，单身份和项目相对顺序保留。没有可展示父项的子项仍为入口；搜索／缺口保留命中项和祖先；状态在页面返回时保留。

父需求 Task 汇总只取自身和有效当前组成后代的 active 关联，不沿依赖、支撑或历史，不写传播。真实 Task ID 去重、null 逐条保留，每条角色／覆盖／来源和已否定自身关联可查。同一 Task 的可信 Runtime 状态和导航不被另一关联冲突替换，另列“关联待核对”。目标节点按自身范围读报告；关键章节是 AST 原文片段和来源行，不是 AI 摘要。定义／未决材料链接回原项目和计划。

已执行 typecheck/build、4 份聚焦测试 28 项；新增浏览器 6 组（折叠共享子项、Task／来源返回、独立目标报告、搜索保留、失败刷新恢复、缺口祖先），既有 P2 5 组（范围隔离、坏报告、分页旧响应隔离等）。新增测试只保护 DAG 可达性、真实身份和准确报告范围，不逐字段补矩阵。实际 Chromium 位于 /usr/bin/chromium；被观察合成项目前后字节摘要相同。Windows 和真实业务没有验证。

新增脚本 `test:browser:full-scope` 需 `TRACELENS_FULL_SCOPE_ROOT` 指向真实 helper 保存的合成项目，Linux 可传 `TRACELENS_BROWSER_EXECUTABLE`。旧 scoped 脚本同样支持显式浏览器；setup 对新分发需提供实际核对的 `TRACELENS_TEST_DISTRIBUTION_DIGEST`，仍逐项核对安装资产，缺省保留旧固定候选摘要。安装中的符号链接只核对链接本身，不越界跟随。旧 scoped 18 组及额外降级 5 组实际浏览器回归已通过，包含分页、单详情／来源失败、非零滚动返回、独立副本、无 Runtime、旧快照、历史原件未迁移和查询分页变化等；这里只声明所跑的四份浏览器脚本范围，没有跑所有历史 UI 脚本。

宿主输入与观察是假定的有限样本，Task 通过正常 Runtime 操作取得 paused／closed 等事实；closed 保留未执行步骤。satisfied 只属于明确 supplied synthetic evidence 的固定范围，不证明现实业务完成。原有任务、产品定义、报告和来源继续分别说明自己的状态，不建立完成率、新 schema、自动评估或 Task 门禁。
