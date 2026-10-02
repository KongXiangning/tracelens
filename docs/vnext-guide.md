# vNext 使用说明页

TraceLens 侧栏的“vNext 使用说明”无需添加项目即可打开，按场景搜索、筛选并复制提示词。示例在目标项目 AI 会话中发送，不在 TraceLens 内运行；尖括号需替换为实际需求、范围或引用。模式是给 AI 的自然语言要求，不是 CLI 参数。

## 场景路由

| 业务场景 | Canonical skill | 模式／边界 |
|---|---|---|
| 需求与设计基线、新项目治理、已有项目盘点／接管 | `$bootstrap-project` | design、greenfield、inventory、adopt、realign、maintain-domains；保留未知事实和用户文件 |
| 临时需求、Bug 或想法只记录 | `$capture-work-item` | 不激活、不实施 |
| 制定计划、采用计划、变更范围 | `$prepare-task` | default、confirm、replan、amend-scope；候选不等于采用 |
| 实现前检查计划 | `$review-draft` | 审查不代替用户采用 |
| 当前步骤实现、修复审查发现、步骤收尾 | `$execute-step` | default、repair、finish；执行、审查和收尾分别记录 |
| 定位问题或授权修复 | `$debug-task` | investigate-only、resolve；区分假设和原因 |
| 实现／diff 审查、历史步骤复核 | `$review-change` | default、recheck-completed-step；自审不能冒充独立审查 |
| 指定行为验证 | `$validate-change` | 不自动修代码、扩大验证或新增永久测试 |
| 暂停、中断、恢复、替代及管理恢复 | `$task-lifecycle` | pause、interrupt、resume-paused、resume-interrupted、supersede；不重放业务操作 |
| 交付预览、关闭或终止 | `$close-task` | preview 只读；关闭不证明验收通过，也不自动提交 |
| 阶段／最终本地提交 | `$git-commit` | 明确授权和范围；保留用户改动，不自动推送 |
| 补齐需求／设计／规划文档导航 | `$bootstrap-project` | realign，结合文档整理提示词及具体文档授权；没有独立 sync-documents skill |

参考需求链：prepare-task → review-draft → prepare-task（confirm）→ execute-step → review-change → execute-step（finish）→ 下一步或 close-task。这是场景建议，不是强制准入链；用户已授权的组合工作可以连续完成。`next_route` 仅是建议，不产生新授权。

## 安装与版本

核对日期：2026-10-02。本页基于本机 `vibe-coding-workflow-system` 的 0.23.8 源码、HEAD `79519895`，不是线上最新版本保证，也不根据所选项目自动适配。以目标项目实际安装的 `.agents/skills/<skill-name>/SKILL.md` 及宿主调用方式为准；不要与旧版 `/create-current-task`、`/implement-current-step` 等混用。

源码 README 的用户安装入口：未安装目标使用 `npx vibe-governance@latest install`，随后调用 bootstrap-project；旧版迁移使用 migrate，较旧 vNext Distribution 使用 upgrade。三种操作互不隐式替代。此说明未执行安装、迁移或升级；实际前提与限制以对应安装器为准。

## 维护依据

页面场景、提示词与边界唯一维护在 `src/shared/vnext-guide.ts`，页面为 `src/web/vnext-guide.tsx`。调整时只读核对以下上游资料，不执行其脚本、不调用其 API：

- `README.md`：Distribution 与 canonical Agent Skill 安装入口。
- `templates/vnext/skills/*.SKILL.md.tmpl`：11 个公共 skills 的模式、方法、结果与下一步边界。
- `runtime/vnext/support/ASSISTANCE_API.md`：保存、关联、展示及管理恢复的区分。

页面不接入 Runtime、AI、安装器或 Git；复制只写浏览器剪贴板。测试核对 canonical skills 场景覆盖、搜索过滤，以及无项目访问、真实剪贴板、无隐式扫描和桌面／小屏布局。新增静态说明不改变项目扫描语义。
