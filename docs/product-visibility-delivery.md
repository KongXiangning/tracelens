# PRODUCT 可视化实施交付记录

日期：2026-10-08。代码实现和可运行回归已交付；生产浏览器验收受环境限制，尚不满足方案的完整端到端验收定义。

## 基线与改动

- TraceLens 起点：master @ `816284390135bec96f1a87a02f2cd22a254f61e2`；读取时与方案一致，工作区干净，无需回退或覆盖已有工作
- 上游契约与合成输入：`KongXiangning/vibe-coding-workflow-system @ 813d3146561c974c1437fc4d116144dc800bc1ad`
- 交付结束点：本地交付提交，具体 SHA 随交付消息和恢复包 manifest 记录；没有推送、合并或部署
- 原需求、架构及 README 增量更新；附件原方案保存在 `docs/product-visibility-plan.md`

## 三批实现效果

1. 标准读取：独立 PRODUCT 开关、入口预览、自定义单入口、旧配置默认不扩权；固定 v1/v2 Schema + 严格 YAML + 根级 AST；多类型同文件、逐项降级、诊断及完整原文；需求页可筛选四种 scope 并打开目标／模块／设计关联
2. 规划与任务：无／单／多计划、工作项原数组顺序、stage 与显式依赖、计划局部身份；真实 task_id 与 UI ID／显示编号分离，多来源观察、TaskBinding 正反向、计划工作项及范围化 repairs；当前任务原 adopted-plan 链路保留
3. 报告与来源：仅按 assessment_id 选择，旧报告与 pending_sources 并列；当前需求定义、历史原文字节、原依据实际定义分开核对；declared/inferred/dismissed 完整保留；来源同快照定位，六个页面相互导航，局部产品图截断时完整依据列表仍可达

读取范围仅 managed 枚举与直接来源；source_paths 不递归遍历，capture_paths 不授权读取／写入。Markdown、YAML、JSON、TXT 精确来源共享本次缓存和预算；不执行被观察项目脚本／helper，不读 journal 状态链，不运行 AI，不联网获取 URI，不生成完成率。

## 验证与实际结果

最终命令结果随恢复包中的 `verification.json` 和原始日志记录。`npm run check` 包括类型检查、Vitest 和生产构建，不把内部重复命令算成额外验收。

- npm ci：已实际安装；锁文件包含 Ajv
- npm run check：已通过，134 项通过、2 项 Windows 专用测试在 Linux 跳过；涵盖标准解析／官方离线 oracle 对照、源定位和摘要、身份与绑定、刷新、服务、旧导航、当前任务计划及 UI 服务端渲染
- npm run format:check：已通过；固定原始 Schema 和离线 oracle 保持字节不变，明确排除重新格式化
- PRODUCT 浏览器夹具 preflight-only：通过；只检查隔离合成输入、真实身份导航数据、来源行号／摘要和原夹具未变化，不算实际浏览器验收
- npm run test:browser：已尝试但浏览器启动失败，见下文；最终脚本顺序覆盖旧功能与 PRODUCT，PRODUCT 也可用 test:browser:product 单独运行
- npm run test:real：未运行；没有提供脚本所需的真实 TermLink 样本
- Windows 原生：未运行；Linux 结果不能替代 Windows 验证

固定 oracle 仅在隔离测试中运行，没有引入运行时 shell-out。综合 12 项／9 类、八类 v1、E6、无／多计划等数字只描述所列合成夹具。上游 E6 原件已绑定 C；浏览器脚本在 E6 的隔离副本移除 B-C、保留 E6C，验证 C 未创建变体；另在综合样例的隔离副本添加有来源的合成 A/R 任务观察，以验证任务正反向导航。两种变体分开，不伪装成原件或真实项目。

### 浏览器阻塞（未通过，不含成功截图）

1. 默认 Playwright Chromium 未安装；指定工作区缓存后，官方 CDN 下载得到不可解压内容，日志保留
2. 已安装的 `/usr/bin/chromium` 启动报 `process_singleton_posix.cc: socket() failed: Operation not permitted`；标准提权请求获准执行，但同样的进程限制仍存在
3. 受支持的云 Chrome 对本地生产服务 `http://127.0.0.1:4317` 返回 `net::ERR_BLOCKED_BY_CLIENT`，工具进一步明确 URL 安全策略拒绝；随即停止，没有尝试替代主机、代理、端口或其他规避路线

因此没有真实页面交互通过记录，也没有可冒称验收证据的截图。1440／1024／390 实际浏览器布局、完整跨页面点击与浏览器刷新操作仍待在获准环境运行。类型、服务、SSR 和准备脚本均不能替代这些检查。

### 独立复核

只读复核复现并修复四项边界问题：JSON 内建 YAML 标签兼容；引号 schema／带空格分隔符不能让历史 PRODUCT 正文变成任务；父章节正确包含子章节身份声明；历史来源重复二级标题不能选择第一处。修复后聚焦回归通过，原文／路径缓存／定义范围／身份／摘要复核未发现剩余确认缺陷。最终 UI 复核另确认并修复任务关联图在同文件真实任务变化后的选择失效，以及未启用／不可用 PRODUCT 不应显示字节读取完整；均补充 SSR 回归。该结论不包含未运行的浏览器或 Windows 验收。

## 外部写入与恢复

只改动本 TraceLens 工作副本及自有隔离测试／证据目录；未改动观察项目、上游源仓库或原始固定夹具，未调用观察项目 helper／Runtime。测试修改仅发生在临时合成副本中，原夹具摘要完整性已检查。

恢复包包含 Git bundle、二进制完整 patch、交付报告、校验摘要与真实测试日志。以随包 verification.json 的 HEAD／Git 状态为准。浏览器失败属于本轮环境验证限制，历史 README 的 Windows／Edge 记录仍标明为 v0.6 基线历史，不转记为本轮通过。
