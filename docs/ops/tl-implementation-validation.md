# TL-01～TL-05 实施与联合验证

状态：最终验收通过。父线程已完成 r4 云端独立复核及 INT-01 统一核定，接受 TL-01～TL-05 和 INT-01 本轮限定范围；此前已报 P2 全部闭环。基线 master@4dda68ebd64bd09c6af6523500be33148d6392e0；初始工作树干净。修改只在 TraceLens，保存为未提交工作。未推送、发布、部署、升级真实业务项目或操作睡眠。独立审查由云端父线程负责，本机没有启动独立审查代理。

依据是跨仓库 docs/ops/TraceLens与vNext_实施任务拆分与验收计划.md 及直接引用的定稿方案、VN-01／VN-02 契约、VN-03 交接和正式 VN-05 交付。完整源码、未提交 diff、逐文件摘要、实际 npm 包及必要证据通过 Library 交给云端。快照排除忽略目录中的旧私有项目资料、会话令牌和无关文件。

## 实施与边界

TL-01：异步短进程 task-status/read、全局并发与预算、单副本显式模块信任、配置与批次隔离、有界版本重读、文件／内存降级。TL-02：正式 v3 Schema、定义摘要、明确总目标、登记顺序、当前／历史关系和范围／对象四值模型。TL-03：真实 task_id 的 Task／Step 详情、局部来源读取、身份与来源核对分离。TL-04：单一需求区域、明确总目标及真实阶段／子目标、稳定顺序和未登记入口。TL-05：当前需求主图、祖先上下文、局部依赖、历史二级入口、报告／来源／Task 导航及实际滚动位置恢复。

产品读取与 Runtime 查询独立。可信来源须在单个工作副本显式选择并核对四模块 SHA-256；登记身份、root、配置版本、workflow home、批次和 view_revision 隔离。TraceLens 只执行 task-status/read，不写业务资料、不重放 journal、不调用维护或重建。测试准备中的 task prepare/adopt/pause/close 和 archive 由独立测试脚本对临时合成资料执行，不是消费应用能力。

刷新只取首批；用户明确续页后读取下一批。版本变化有界重读首批，不混合旧页；详情沿用原视图版本，版本错误显示局部失败并要求显式刷新。查询失败仅用识别过的 task-view/v1 或同上下文最近成功内存批次，显示来源、原读取／本次复用／文件时间及陈旧性。部分内存降级撤下续页入口，提示刷新成功后继续。未迁移事实保留关联诊断，不确认零任务。可选焦点冲突只撤销焦点，不丢合法列表。旧文档声明保存在 taskObservations，不替代 Runtime 生命周期。

## 预算与本机观察

默认：子进程 15 秒，每次请求批次 60 秒（含排队、执行和重读），全局并发 2；合并 stdout/stderr 16 MiB，task-view 单独 16 MiB，单来源 2 MiB；页长 100、最多 100 页。环境变量：TRACELENS_QUERY_TIMEOUT_MS、TRACELENS_QUERY_BATCH_MS、TRACELENS_QUERY_CONCURRENCY、TRACELENS_QUERY_OUTPUT_BYTES、TRACELENS_TASK_VIEW_BYTES、TRACELENS_SOURCE_BYTES、TRACELENS_QUERY_PAGE_SIZE、TRACELENS_QUERY_PAGES，启动读取并限制上限。未把产品通用文件预算直接套到 task-view。

实际安装合成资料含 3 Task、7 个事件、closed／paused／draft、两个未开始 Step、身份冲突和归档来源。最终本机观察：summary 5,653 字节／264.98ms；Task detail 5,843 字节／269.85ms；完整归档来源 1,222 字节、响应 4,098 字节／239.77ms；4 Task 既有投影 11,554 字节。默认字节预算为完整历史和更大投影保留余量，超限明确降级。探针并发峰值 2，等待期间事件循环活动；超时／输出超限进程回收，队列到期不 spawn。以上是小规模本机观察与默认值依据，不保证大规模日志性能、跨环境时延或容量。summary 仍由 Runtime 完整重算，展示分页不代表降低计算成本。

## 正式 VN-05 消费组合

候选 0.24.5，bundle-1d2110dac6531342ab66df9d；manifest 9a3bc3f567b31ae7ca4ad579c78ce74b7b5035b85230aa1d1ce435b123cfe909；tgz SHA-256 4bb219ff72cde1a64c11976731971103b0e70a3801609145628e8a73dbe77e53。完整 v3 Schema SHA-256 c08c9ffa781c2ffce8bf8889567aa8eff155b433376fd149454f8df5b15d405b，来源见 src/server/product-assets/PROVENANCE.md。

实际 tgz 离线安装到独立包环境，再以公开 dist/cli.js install 在 Git 根之外的系统临时目录安装合成项目。逐项匹配 116 项资产；正式 product-maintenance.js apply 保存共用定义、报告及关联，Task CLI 保存合成事实。删除 task-view 后查询仍读到事实，未写新投影。A/B 是同资料两个副本；C 无 Runtime；额外 D 是独立登记项目；E 有旧投影及更新事实；F 有未关联旧内容。D 用正式 archive plan/create/verify/quarantine 准备归档，loose 来源不存在时仍能读取原逻辑 ref，原文一致；保留 A 作为独立合成输入备份，未清理业务项目。

原始记录：系统临时 tracelens-int-20261011/scoped-0m2HPh/inputs.json、operations.json、installed-assets.json、evidence/report.json；最终附加 additional-e6ETyh/report.json、operations.json。全部随 r3 ZIP 保存，不依赖本机路径可达。

## 真实页面验收

最终生产构建、本机 Edge 1440×1080，18 项主流程与 5 项附加流程通过。记录源版本、输入、时间、请求路径、操作、页面读数、截图、DOM 文本和前后摘要；未以静态／单元测试冒充页面交互。

- 显式信任后首批 2/3、零自动续页请求；点击续页 3/3。唯一需求区域按 R-PIPELINE、R-IMPORT、R-DELTA、R-NEW，R-UNORDERED 独立保留。
- R-IMPORT 在 G-DEMO/working-copy satisfied、G-LIVE partially-satisfied、release not-satisfied；G-ALL 独立 undetermined。缺口图保留 G-ALL、G-LIVE、G-DEMO、R-PIPELINE 祖先，局部依赖展开 R-DELTA。
- A-LIVE 报告和原文往返；同一真实 Task 的重复 binding 去重。closed Task 的 S2 原样 not-started，不补为完成。prepare 原文按需读取；等待 Step／来源区域实际响应完成后截图。
- 单详情注入 503 只影响详情；临时移开合成来源只影响来源，列表／closed 保留，字节恢复。返回保持目标、对象、需求、筛选，实际非零滚动位置 1,866 精确恢复。
- source task_id 明确矛盾显示冲突；R-OLD 的 replaces 历史可读。B 相同 task_id 使用独立视图，切换无重复面板。C 保留 5 卡片、明确任务不可用。
- D 归档逻辑来源可读；E 仅用 4/4 旧文件快照并标陈旧性未知，不补更新事实；F 明确 LEGACY_ASSOCIATION_REQUIRED、不能确认零任务，产品保留。D 两页间正常写入从 3 变 4，续页重读首批 2/4，再续 4/4；B 仍 3。
- 各段只读消费前后全部被观察文件摘要一致。D 正常写入单独记录 writer 后摘要，其后的查询仍不改字节；浏览器无 pageerror。

视觉检查覆盖概览、缺口图、关闭 Task 的未开始 Step、归档原文和无 Runtime 产品视图；正文／JSON 可读、图无节点重叠、无编辑／重排入口。早期未等待来源响应的截图不作最终证明。

## 云端修复与回归

本机 r3 类型与构建通过；完整 Vitest 19 文件、225 测试通过（25.07 秒）。云端 r3 独立完整回归为 19 文件、223 项通过、2 项 Windows 专用测试按平台跳过，类型与构建通过；此前三项 P2 均以原复现核对闭环。原文观察回归转为 taskObservations，未删资料、来源或身份检查。

1. r1 文件回退 queried：失败／文件回退明确 stale-or-unknown，有限回归首批成功、续页失败、重读失败和旧文件。云端 r2 已确认。
2. r1 队列突破预算：deadline 贯穿 slot／spawn／重读；过期队项移出不 spawn、检查执行／返回、释放槽位。云端 r2 已确认，真正按需分页也确认通过。
3. r2 旧扫描删 cfg3 缓存：SnapshotStore 专有 Reader 使用真实登记 root/版本守卫；扫描返回、Reader 进入、home 读取后及内部保存检查有效上下文。仅注入 scanFiles 延迟的真实 Registry/Store/Reader 回归覆盖 cfg2 延迟、cfg3 发布、拒绝旧发布和 cfg3 查询失败且无文件后的 memory-snapshot 保留。
4. r2 可选焦点冲突丢列表：正式 snapshot_examples 单一对照只改 current_task.task_id，合法 2 Task/Step 保留、焦点撤销、有诊断；必需字段和 tasks 唯一性继续检查。
5. r2 assessment 约束差异：同步正式生产 parser 的 basis 身份、含时区实际 ISO checked_at、未固定工作副本 limitations、目标自评摘要一致及评估独立落位。三个云端变体保留报告、usable=false、undetermined/metadata-incomplete，未新增业务判断。
6. r3 原报告局部显示：不完整报告的原 conclusion/checked_at 已保存在 rawMetadata，却被显示区遗漏。r4 仅修改组件与有限组件回归，原报告采用对象／字符串／结论枚举检查后的 rawMetadata 回退，以 React 文本忠实展示原结论和原时间并标字段异常；当前 selectAssessment 逻辑未改，仍为 undetermined。本机相关 3 文件、26 项测试及类型／完整构建／格式检查通过；云端 r4 核对两个文件 before/after SHA，26/26 相关测试、类型及完整构建通过，确认当前“尚未判定”和原报告“已满足”明确分开。

## 最终云端核定与保存组合

父线程已核对正式 tgz 与 116 项安装资产一致，接受本机 18+5 条真实页面链路的操作、请求、截图和只读校验；云端另行运行已安装 Runtime summary，其 view_revision 与页面记录一致，观察字节不变。云端没有重跑全部业务浏览器场景；本机页面证据、云端回归／组件复核和云端 Runtime 读取分别记录，不互相冒充。此前已报 P2 全部闭环，TL-01～TL-05 和 INT-01 本轮限定范围最终通过。

保存组合：

- r3 完整源码与正式候选／证据包：Library libfile_97d2e9a0c86c81918a23257b1fca8490，SHA-256 76ea509f05286c718d8c5b11dc69ffc8b5fd8e8520149b398a9f924a1cd6e6c4。
- r4 最小 diff、两个改动源码、摘要及日志：Library libfile_a5439b0c32f88191992d5273b42e31ff，SHA-256 63ce9ea14a35b043d38460064180d524be9c7a7699e494a3cf38a067cfbad448；在 r3 上应用，临时副本 patch 校验及应用后摘要通过。
- 本最终文档补充仅更新验收记录，源码不再改。工作文件保存于 E:\coding\tracelens，交付包／上传收据保存在 output/review；Library 上传成功，本机 Windows Python 不支持 os.setxattr，收据侧文件保留 Library 身份与版本。

验收边界仍为合成项目、单宿主、小规模观测；不代表真实业务资料迁移、真实项目升级、大规模容量／跨环境性能或全面历史兼容。无待处理实施阻断，不扩展已核定范围。

## 失败、限制与复现

安装目标最初位于 TraceLens output 被 TARGET_ROOT_DENIED 拒绝，保留输出后改用系统临时目标，未绕过保护。沙箱限制缓存、hardlink、浏览器和本机网络，原生隔离环境重跑。实时调试器因未注册 TraceLens VS Code 窗口不可用，未声称成功；实际 DOM、请求和截图定位错误。

页面发现并修复刷新期间续页未禁用、重复 React sibling key 导致残留面板、保存非实际滚动容器。附加测试初次并行复制与主测试短暂移开来源竞争，改为顺序；项目切换回概览，测试修正为显式进入 Task 页。保留失败记录，这些失败不冒充上游安装或页面通过。

早期 VN-03 四模块复制不计正式安装。旧 test:browser 针对前一轮概览／文档任务展示，本轮未作为新计划验收执行；test:browser:scoped 执行两个真实浏览器脚本，既有解析、文档和身份断言保留在完整回归。未做历史版本矩阵、真实业务全量迁移、大规模压力或 Agent 用户决策推断。

复现：同 SHA-256 tgz 安装到独立包环境；设置 TRACELENS_TEST_PACKAGE_DIR、Git 根之外的 TRACELENS_TEST_OUTPUT_ROOT，运行 node tests/setup-scoped-browser.mjs。启动 build 后服务（隔离 TRACELENS_DATA_DIR，PORT=4439，TRACELENS_QUERY_PAGE_SIZE=2），以 inputs 中对应名称登记 A/B/C。设置 TRACELENS_TEST_INPUT 后运行 npm run test:browser:scoped。固定模块夹具有 MIT/来源记录，排除自动格式重写。生产查询仍需显式信任，合成脚本不能代真实项目作选择。

本任务测试服务及 tracelens-tl 浏览器会话已停止，4439 无监听；工作文件已落盘。保持未提交／未推送状态，不发布／部署、不自行睡眠；电脑睡眠仅由父线程后续统一安排。
