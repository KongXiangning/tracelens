# TraceLens

本地、单用户、只读的项目文档工作台。按确认的范围读取 Markdown / YAML，以及明确引用的 JSON / TXT 来源，展示文档记录的任务、状态、清单和显式引用。界面默认简体中文；不连接 vNext Runtime，不执行被观察项目的脚本。

## 环境与运行

- Node.js 22.12 或更高版本，npm；Windows 原生运行已验证（Node 24.12）。
- 路径使用服务所在系统的本地绝对路径，支持中文与空格。不转换 WSL 路径，不支持 UNC 网络目录。
- 首次安装需要网络；构建后的正常使用不需要网络、CDN 或云账号。

```sh
npm ci
npm run build
npm start
```

打开 **http://127.0.0.1:4317**。生产界面和 API 都由这一个服务提供，启动前必须构建。默认只监听 `127.0.0.1`。端口被占用时服务明确失败；可通过 `PORT` 环境变量选择其他端口。

开发：`npm run dev`，浏览器打开 http://127.0.0.1:5173。该命令同时运行 Node API 与 Vite；5173 和默认 API 端口 4317 需可用。开发代理保持 `/api` 同源。前端修改由 Vite 热更新；修改服务端源码后重启开发命令。

## 使用

1. 点击“添加项目”，在“Codex 项目”中搜索并快捷选择已登记路径，或在“浏览目录”中选择服务机器的目录。目录选择器支持盘符／根目录、上级目录和绝对路径跳转，点击“选择当前目录”后检查路径和候选范围。
2. 查看自动发现的文档、类型、状态及登记依据，确认项目名称后点击“添加并扫描”。默认通过 vNext Profile 与文档中心导航；“高级扫描设置”可补充分类规则、排除路径或关闭自动发现。
3. 在概览查看记录的当前任务、步骤、清单与提示。在任务中打开引用章节，在文档中查看目录、快照原文和反向引用，在关联中点击节点或引用边核对来源。
4. 修改项目文档后点击“刷新”。配置保存后也需手动刷新；刷新前旧快照继续展示它实际使用的范围。移除项目只删除登记，项目文件会保留。
5. 在概览的“文档登记与缺口”核对哪些需求／设计有明确登记、哪些分类未明、哪些是草案或缺失文件。“文档整理提示词”可预览并复制当前缺口和维护约定，交给项目中的 AI 补齐原有文档中心后再刷新；无入口时可按项目规则建立 `docs/README.md` 导航。TraceLens 本身不写项目或调用 AI。
6. 侧栏“vNext 使用说明”按业务场景列出 11 个 canonical skills 的调用提示词与模式，支持搜索、筛选和复制；未添加项目也可使用。内容基于核对的 0.23.8 源码，不代表当前项目的 Runtime 状态或线上最新版本。参见 [说明与维护依据](docs/vnext-guide.md)。

登记在服务重启后保留；内存快照不会保留，重启后显示“尚未扫描”。切换项目、浏览详情和阅读原文均不会隐式扫描。扫描期间可继续阅读旧快照；整体失败保留旧快照及其原始时间，没有旧快照时明确显示失败。

Codex 快捷列表只读服务机器用户的 `$CODEX_HOME/.codex-global-state.json`，未设置时使用 `~/.codex`。支持当前本地项目名称及 `rootPaths` 和旧版工作目录登记；不读取凭证、聊天历史或执行项目脚本，不需要 Codex 运行或云账号。已添加和不可读的路径会显示原因并禁用；可点击重新读取更新列表。未安装 Codex、登记损坏或格式不兼容时仍可浏览目录。目录选择器列出服务机器的直接子目录，不上传浏览器客户端文件，也不创建目录；过多条目会提示截断，可通过绝对路径继续导航。

## 范围配置

每行一个项目相对文件路径或 glob，使用 `/`，支持 `*`、`**`、`?` 和 glob 花括号。例如 `docs/requirements.md`、`docs/design/**/*.md`。开启自动发现时，这些规则补充或覆盖自动分类，留空仍读取自动发现的文档；关闭自动发现时只扫描手动范围，留空不扫描该类型。排除规则优先，如 `docs/workflow/generated/**`。不接受绝对路径、盘符、`..`、反斜杠或否定规则；不要把目录名当作文件规则。升级前已登记的项目保持原范围，可在配置中开启“刷新时从 vNext 文档入口自动发现”，保存后刷新。

默认读取 `.workflow-system/PROJECT_PROFILE.yaml` 的 `paths.workflow_home` 和 `paths.documentation_files`，后者是导航种子，不是全量分类或确认清单。读取已登记的文档中心、目录与需求索引，并跟随已知 `related_docs`、任务中的 `Project documents` 和 Markdown 引用。补充可用的 `README.md`、`docs/README.md`、管理目录中的 `DOCUMENT_CATALOG.md`，不遍历全仓库推断用途。分类优先依据目录明确用途／分类或 `document_type`／`doc_type`／`type` 元数据；仅有标题／路径提示时标为“建议分类”，未知或冲突保留“待分类”。旧 `requirements_files`、`design_files`、`planning_files` 分类扩展仍兼容，但不是 vNext 必需标准。不执行其他 Profile 字段。

自动发现还会跟随普通文档中的显式 Markdown 链接，兼容已知 `document_kind: governance-document`、`kind: vnext-task-view` / `vnext-project-profile`，以及 `path_references` 中明确声明为 `repo-relative` 的 `normalized` 路径。未知类型或损坏的 YAML 保留诊断，不自动修正文档或信任部分解析结果。管理目录的 `TASKS/` 和项目根 `TASKS/` 存在时均可发现；缺少可选任务目录不再作为文档缺失报告。

概览和添加预览提供“磁盘存在但未登记”列表。自动发现开启时，默认只枚举 `docs`、`TASKS` 的目录元数据，不读取候选正文，不把候选自动登记为需求／设计。高级扫描设置可修改盘点目录；清空可停用盘点。路径必须为项目相对目录，不支持 glob。候选可按用途加入手动分类规则，或通过“文档整理提示词”交给对应项目的 agent 核对已有内容与登记。盘点最多 500 个候选、20,000 项、深度 24；排除、符号链接、不可读目录和截断分别报告。

索引中的占位路径（如 `REQ-YYYYMMDD-<slug>.md`）仅提示为示例。反引号内的简写文件名，只在来源目录、项目根及已有明确路径中唯一匹配时关联；有歧义或未找到时提示补充相对路径，不制造根目录“必需文件”。完整 Markdown 链接仍严格按来源目录解析，真正失效的链接保留诊断。

每次刷新重新读取导航入口，新增或撤回的登记会更新范围。入口损坏或曾可读的可选索引被删除时，可重新读取上次快照由该入口发现的文件并明确登记核对不完整，不使用旧正文充当本次结果；主动排除入口或有效索引撤回条目时不恢复旧范围。重启后没有旧快照，无法恢复这些临时发现路径。Profile 本身如存在则作为管理 YAML 收录（除非排除）；管理目录没有声明时使用以下默认候选：

```text
管理：docs/workflow/CURRENT_TASK.md
      docs/workflow/STATUS.md
      docs/workflow/TASK_SUMMARY.md
      docs/workflow/TASK_ARCHIVE.md
      docs/workflow/TASKS/**/*.md
规划：docs/workflow/ROADMAP.md
需求、设计：通过已有索引／引用发现，或在高级设置补充
```

固定跳过 `.git`、`node_modules`、`dist`、`build`、`coverage`、`.vnext`、`journal` 和符号链接／目录联接。`records` 默认跳过，可在高级设置允许其中的 Markdown / YAML 参与导航、手动扫描及候选盘点；允许并不自动收录全部文件。默认最多 500 个文件、单文件 2 MiB、总读取量 20 MiB、枚举 20,000 项、相对遍历深度 24；导航另限 120 次读取、10 MiB、500 路径、3 层跳转、每路径 16 个来源。共享本次读取缓存，各导航上限分别说明；仅登记来源超过 16 条时标记来源列表截断，不将文件导航标为不完整。手动分类优先；明确分类冲突保留待分类，不以修改时间裁决。

扫描提示和实际文件范围在概览下方可展开。缺失、读取失败、解析异常、断裂章节和歧义引用会保留。引用范围外目标只核对文件元数据，不读取正文，区分“文件存在，未纳入扫描”“引用路径不存在”“已排除”和“示例或占位路径”；每次最多核对 500 个不同目标，未核对项保留“未纳入扫描”。部分结果不混入旧文件。关闭自动发现且配置为空、无 Profile 时可以得到正常零文档结果。

“明确登记”说明存在类型／用途声明，不代表 vNext 已核实全部用户需求、AI 已读懂或实现。文档 `status` 与 `superseded_by` 原样保留；草案、模板、归档、废弃及已被替代的材料不作为现行需求／设计齐备的依据。没有原始用户需求清单的对照，用户需求完整性保持尚未确认，不给出覆盖率或完成率。

## 支持的结构

- Markdown 标题与章节目录、普通及引用式链接、GFM 表格和任务清单；来源保存文件、行号与扫描内容 SHA-256。
- 中文或英文已知字段，例如“任务 ID / Task ID”“任务标题 / Task title”“当前状态 / Status”“任务目标 / Goal”“当前任务 / Current task”“当前步骤 / Current step”；支持任务信息章节的列表与表格。
- “实施步骤 / Steps”“验收标准、验收清单 / Acceptance criteria”“问题、审查问题队列 / Issues”等章节中的条目；概览收录已知成果、待办、风险和规划章节。只展示明文声明及已勾选数量，不生成开发完成率。
- `CURRENT_TASK.md`、`TASKS/` 中的任务文档，以及包含明确任务 ID 字段的文档。占位模板 `{{TASK_ID}}` 不生成活跃任务；同编号文件分别保留，并提示歧义或冲突。`paused`、`terminated`、`skipped`、`archived` 各自保留，不并入 completed。
- `### Project documents` 下的 JSON `sources` 数组（`path`、可选 `section`、`revision`、`purpose`）。结构化路径从项目根解析，Markdown 路径从来源文件所在目录解析。章节尝试精确标题或标题锚点匹配，不猜相似章节。revision 仅作为声明展示。
- 唯一任务编号提及：`20261001-001`、`TASK-20261001-001`、`TASK-001`、`ABC-001`。日期编号的前两种写法统一匹配，声明及提及保留原文；不同文件的同编号声明仍提示歧义，不合并身份。普通提及不会升级为实现／完成／验证关系。
- YAML 使用安全解析并保留原文；已知 frontmatter 类型、状态、`related_docs`、`superseded_by` 用于登记与引用导航，其余内容不解释为 Runtime 状态。未知格式、未知状态、无匹配字段和错误结构化引用保持可读，不要求修改原文。

首版不解释任意 YAML frontmatter 字段、Runtime Schema、代码块内任务编号、自定义状态机或非显式自然语言关联；只在已识别文档索引的列表／表格中解释带用途的反引号路径，不跟随任意正文代码片段。不解析 PDF、Word、任意二进制或非 UTF-8 文档。不还原 vNext Runtime，不处理 journal、执行、审批、Git、AI 推断或实时监听。Markdown 禁用原始 HTML / MDX 执行，危险链接不可操作，图片均以文字占位，不自动加载远程资源。

快照绑定来源内容；文档 API 需要当前快照 ID，过期请求返回 409。关联图只展示选中节点的一层邻居，每侧最多 6 个可见节点，完整依据列表不截断。同一方向、类型的多条引用合并为计数边，点击可核对全部来源。

## 配置位置

项目登记及扫描配置写入工具用户数据目录的 `projects.json`，临时文件加替换写入；快照只存在内存。

- Windows：`%LOCALAPPDATA%\TraceLens\projects.json`。
- Linux / macOS：`$XDG_DATA_HOME/tracelens/projects.json`，未设置则使用 `~/.local/share/tracelens/projects.json`。
- `TRACELENS_DATA_DIR` 可指定独立的本机绝对路径。该目录不能位于被观察项目内，避免向观察目录写入工具配置；启动加载已有登记及保存前也检查此边界。迁移后越界会拒绝启动并保留原文件，需将工具数据目录移到项目之外。项目目录暂时不可用不阻止恢复或移除其登记。

UI 校验 Host / Origin，配置写入、刷新及只读路径来源接口需要本次服务会话令牌。文档 API 只返回登记项目的内存快照；路径来源接口只列出 Codex 登记与目录元数据，不提供任意文件正文读取或文件写入接口。配置文件损坏时启动明确失败并保留原文件；不要在服务运行中手工修改登记。

## 示例与验证

`examples/示例项目 Alpha`、`examples/示例项目 Beta` 与 `examples/示例项目 Gamma vNext` 是明确标注的合成数据。Alpha 验证旧分类扩展、正常／断裂引用、状态冲突、重复编号、未知格式和 Markdown 注入；Beta 使用另一管理目录；Gamma 只用标准 `documentation_files` 与文档中心，展示自动需求／设计／规划、草案及待分类资料，可体验整理提示词和索引更新后刷新。测试仅修改专用副本，不修改交付示例或外部项目。

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

浏览器验收在 Windows 默认使用已安装的 Microsoft Edge。其他系统先执行 `npx playwright install chromium`；`TRACELENS_BROWSER_CHANNEL` 可选择已安装的 `chrome` 或 `msedge`，`HEADED=1` 可显示测试浏览器。验收脚本自己在空闲回环端口启动生产服务，使用本仓库 `output/playwright/acceptance-*` 中的独立中文路径样例副本和数据目录，完成后关闭服务和浏览器，保留 `result.json` 与截图。检查加载、空／未扫描、双项目、来源章节、关联、无匹配、配置变更、文档增删改、部分／整体失败、重启和 1440/1024/390 布局；不伪造扫描返回值。

可选真实文档核对：构建后设置 `TRACELENS_REAL_PROJECT` 为 TermLink 的本机绝对路径，执行 `npm run test:real`。该脚本只复制列明的 10 份 Markdown/YAML（含原有文档中心与目录）到本工具 `output/playwright/real-documents-*`，通过原有登记自动发现需求和设计，核对归档状态、步骤、清单、占位模板、来源与浏览器原文；比较扫描前后原文件和副本摘要，不执行原项目脚本。它是指定样本回归，不能宣称所有 vNext 版本兼容或用户需求完整。

以下为 v0.6 基线的历史验收记录，不是本轮 Windows 或浏览器验收结果。v0.7 的实际检查与阻塞见 [本轮交付报告](docs/product-visibility-delivery.md)。

2026-10-02 在 Windows / Node 24.12 / Edge 154 实际执行并通过：`npm run check`（类型检查、31 项解析／服务／项目来源／文档导航／使用说明测试、生产构建）、`npm run format:check`、`npm run test:browser`、`npm run test:real`。本次修复回归覆盖 Windows 路径别名去重和稳定身份、带／不带 TASK- 日期编号的原文保留与歧义、段落引用式链接、已知可选索引删除及主动排除／撤回、配置目录迁移越界拒绝和离线项目登记恢复。首次交付还通过了 `npm ci` 和开发服务的页面／API 代理检查，Ctrl+C 后两个开发服务均退出；本次未重新安装依赖或复测开发服务。生产构建无告警。

最终浏览器验收结果与截图保存在 [output/playwright/acceptance-LBXJyr/result.json](output/playwright/acceptance-LBXJyr/result.json)。检查四页完整闭环及异常状态、1440/1024/390 视口、Codex 快捷添加、服务机器目录导航、失效／重复登记禁用、标准 Profile 自动导航、文档状态与待分类提示、整理提示词复制、段落引用式索引变更后刷新、索引删除后的失效提示及新正文阅读、登记来源跳转；使用说明页验证无项目访问、23 个场景、搜索／类别／无匹配、真实剪贴板、1440/390 布局及无隐式扫描。无非预期浏览器错误或自动外部资源请求；无效目录测试按预期收到 400 并在表单展示错误，测试用 Codex 登记内容保持不变。首次交付还用本机真实 Codex 登记核对了项目列表、搜索和范围发现（取消登记，不污染用户项目配置）。本次真实副本核对结果保存在 [output/playwright/real-documents-G7KCFu/result.json](output/playwright/real-documents-G7KCFu/result.json)：10 份文档、2 个历史任务，通过原有文档中心自动发现需求和设计，核对占位模板、归档状态、步骤、清单与来源行，并确认原件／副本内容摘要未变。237 条提示主要对应这份有意收窄的副本中的缺失登记、读取限制及引用诊断，均保留可用内容，不据此宣称真实项目完整扫描或用户需求齐备。

已知限制：只验证以上系统和指定真实样本，未运行 Linux／macOS、Node 22 或其他浏览器，不宣称真实 vNext 全版本兼容。Codex 快捷读取适配当前已验证的本地登记格式；后续格式变化可能需要调整，届时目录选择器仍可使用。不支持远程 Codex 主机、云项目、UNC／WSL 网络路径或链接目录。自定义文档索引／类型可能保留待分类，可使用高级扫描设置明确范围；导航登记不证明全部用户需求、设计已被确认。单次扫描没有跨文件事务保证；需要一致视图时应避免扫描期间编辑，并在变动后再刷新。当前首版验收及本次导航改进无未完成项；范围外能力未实现。

2026-10-03 通用发现修复通过 `npm run check`（39 项测试、类型检查和构建）、`npm run format:check` 及 `npm run test:browser`。浏览器结果见 [acceptance-M7oKgv/result.json](output/playwright/acceptance-M7oKgv/result.json)，覆盖候选搜索、项目 agent 整理提示词、records 开关、自定义盘点目录、保存后手动刷新及 1440/390 候选布局。使用原登记配置只读核对 LawAgent 与 TermLink-rust-source-resolution-codex，分别收录 61/135 份文档并列出 32/66 个候选；已读取原件摘要与读取后磁盘一致，项目登记文件字节未变。真实断链、格式错误及触及 3 层导航上限仍报告，不将收录数量当成项目文档完整度。本次未改被观察项目，也未重跑旧的 10 文件副本脚本。


## 标准产品文档阅读（v0.7）

添加项目时先预览 PRODUCT 的当前文档与来源范围，再明确勾选产品读取；已登记项目在设置里开启并手动刷新。旧配置默认关闭，不因升级扩大读取范围。默认入口 `.workflow-system/PRODUCT.yaml`，高级设置可选择一个其他入口，maintenance paused 仍可阅读。产品开关与普通文档自动发现、records 全般读取相互独立。

需求页可查看九类条目、目标／模块／设计、四种需求 scope、完整正文及坏项原文；规划页先明确选择计划，保持工作项原顺序、stage、覆盖与显式依赖。无计划不隐藏已知需求，多个计划不猜“当前唯一计划”。任务页可反查范围化 TaskBinding、repair 与被修复范围，显示编号不会当真实 task_id；原有当前任务步骤／adopted-plan 跳转保留。

报告只沿 requirement.assessment_id 显示，实施／验证报告、对象版本、覆盖、定义摘要核对、旧原件可核验性与 pending_sources 同时保留。明确声明、推断、已否定关系可分别查看；来源读到了、计划 adopted、工作 included、任务关闭均不证明需求或项目完成。正文可在同快照原文中按绝对行号核对，刷新后旧来源请求返回 409。

支持固定 vnext-product-manifest/v1、v2 和 vnext-product-doc/v1、v2；v1 不静默迁移。只枚举 managed_paths；source_paths 只按直接 SourceRef 读取 Markdown/YAML/JSON/TXT，不递归扫历史/raw，不联网获取 URI，不执行被观察项目脚本、helper 或 journal。PRODUCT glob 只支持 `*`、`**`、`?`，大小写敏感；文件缓存仍按运行平台路径规则去重。当前定义、源资料、坏项、读取覆盖、业务盘点及交付报告分别说明。

本次固定契约来自 KongXiangning/vibe-coding-workflow-system@813d3146561c974c1437fc4d116144dc800bc1ad。examples/product-comprehensive（综合12项9类）、product-e6（插入修复）、product-planning（无／多计划）全部为合成输入，不是真实项目交付证明。源文件和许可及固定 oracle 说明随代码保留。测试只在隔离副本修改夹具，生产只写 TraceLens 自己的登记配置。

验证仍用 npm ci、npm run check、npm run format:check、npm run test:browser；浏览器脚本启动构建后的本地生产服务。真实 TermLink 样本检查须显式设置 TRACELENS_REAL_PROJECT，未提供时不伪造样本。Linux 验证不能替代 Windows 原生实测；本轮实际命令、浏览器证据及未验证环境见 [本轮交付报告](docs/product-visibility-delivery.md)。

浏览器回归仍采用原生产服务方式；`npm run test:browser` 顺序运行旧功能与 PRODUCT 闭环，`npm run test:browser:product` 可单独运行新增场景。默认使用 Playwright Chromium（Windows 默认 Edge），也可设置 `TRACELENS_BROWSER_EXECUTABLE` 指向本机已安装且获准使用的浏览器。`TRACELENS_PREFLIGHT_ONLY=1 node tests/product-browser.mjs` 只准备并核对隔离合成夹具与快照；`TRACELENS_PREPARE_ONLY=1` 则只准备夹具。两者都不算浏览器验收。


### 2026-10-08 独立审查后的范围修复

在本地交付 c46b5a2 上继续修复四项已复现问题：PRODUCT 的排除约束统一覆盖通用导航／手动范围／候选盘点／adopted-plan 和缓存；失败 UTF-8、二进制及后置检查消耗的实际读取字节纳入预算；标准文档的普通 Markdown 引用恢复到旧关联依据；条目分段正文可使用同快照其他条目或文末的引用式定义，保持原文绝对行号。原有真实任务身份、历史依据条目、契约 glob、手动启用及选择失效守卫不变。最新结果见 [交付报告](docs/product-visibility-delivery.md)；浏览器、Windows 和真实外部样本仍按报告保留未验证项。
