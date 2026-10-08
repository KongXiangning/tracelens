# 无计划、混合及多计划的离线消费样例

这些是虚构消费输入，不是用户决定、真实 task 操作或宿主 Agent 语义验收。源码由
`scripts/product-maintenance-assets.ts` 生成到随软件安装的 `examples/planning/`；本说明同时
随样例分发。既有 `examples/e6/` 继续演示预先规划、稳定工作项和计划外修复。
本轮没有实现或验证 TraceLens 页面。

## 1. 持续选取：no-plan

读取该目录会看到 project、goal、五项完整 requirement 和一项历史 assessment，没有 plan。
REQ-IMPORT 保留完整单设备、错误输入及新增双设备范围，B-BASE 只绑定历史单设备工作，
没有 plan_items。共享审计、后续导出、候选流式输入和退出的旧格式分别保留，不因未分配
工作项、没有 task 或本轮未选中就隐藏。

project 的“本轮选取与未决事项”保存建议、理由、来源与未知：先核对错误输入反馈，
再按范围准备双设备工作。消费者展示原文；建议未授权执行，不自行从正文生成有完成率、
优先级或排序的剩余待办。默认 read 摘要没有 body，需用 detail=items，不能把摘要缺字段
误报为项目没有规划信息。条目阅读顺序不表示实施顺序。

AS-BASE 的 pass-reported 仅属于历史单设备输入，implementation 为 partial-reported，
pending_sources 保留新增输入和错误反馈，当前代码版本未知。历史 task 来源文字称已关闭，
但消费者不查询／计算其当前状态，也不据此使完整需求完成。

## 2. 混合与多计划：multiple-plans

完整需求与 no-plan 相同，另外提供三份独立计划：

| 计划 | 状态／范围 | 应保留的解释 |
|---|---|---|
| PLAN-IMPORT | adopted；导入近期及后续阶段 | 明确选定它时按 W-VERIFY、W-BASE、W-RELEASE 原顺序显示各自 stage 和 coverage；远期仍未细化 |
| PLAN-EXPORT | proposed；后续导出 | 独立候选，不按最新文件时间替代或并入导入计划 |
| PLAN-LEGACY | retired；旧格式历史 | 历史可见，不视作已完成，也不自动恢复 |

REQ-IMPORT 在多个工作项／阶段分别表达覆盖，不分配唯一完成名次。W-RELEASE 只显式依赖
W-BASE 的实际能力；前两个工作项没有显式依赖，既不推断串行，也不推断已确认可并行。
PLAN-EXPORT 也有名为 W-RELEASE 的工作项，其身份与导入计划不同。没有中央当前计划字段，
调用者明确选择计划后从 items 取该条目；plan_tasks 仅提供反向绑定，不替代计划正文。

REQ-AUDIT 在计划正文中是共享约束，没有独立工作项、TaskBinding 或直接 targets；不能仅因
没有这些关系就报遗漏。是否真正满足审计要求仍需要相关实施和验证依据，本样例不作判断。

## 3. 读取方式与边界

使用随安装包提供的 Node helper，对明确样例根执行 read，标准输入为
`{"detail":"items"}`。也可复制 offline-reader.js 为 offline-reader.mjs，直接执行
`node offline-reader.mjs <明确样例根>`；无需安装 Runtime 或 node_modules。

检查 items／usable_items 的完整 body、metadata、原文定位、plan_tasks、diagnostics 和
coverage。来源、当前任务、业务盘点和交付不是同一类完整性：

- 只请求 REQUIREMENTS.md 时，该路径字节完整不代表已读 project、计划或历史依据
- 读取预算耗尽或明确登记文件缺失时，保留可读内容和 omitted，不用空数组冒充无开放范围
- 文件全部可读时 inventory 仍是 partial；AS-BASE 的 pending_sources 不因读取而消失
- 计划选择／读取本身不采用计划、不运行 task、不新建记录，不修改业务文件

行为测试比较结构、关系、顺序及范围，不用文案快照证明业务判断。源码 helper、安装后 Node
helper 和无 Runtime 离线输出分别验证；宿主对自然语言资料的实际判断另行验收。
