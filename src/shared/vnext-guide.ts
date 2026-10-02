export const guideSource = {
  version: "0.23.8",
  revision: "79519895",
  checkedAt: "2026-10-02",
  repository: "vibe-coding-workflow-system",
};

export const skillIds = [
  "bootstrap-project",
  "capture-work-item",
  "prepare-task",
  "review-draft",
  "execute-step",
  "debug-task",
  "review-change",
  "validate-change",
  "task-lifecycle",
  "close-task",
  "git-commit",
] as const;
export type SkillId = (typeof skillIds)[number];
export const guideCategories = [
  "项目接入",
  "需求与计划",
  "实施与调试",
  "审查与验证",
  "暂停与恢复",
  "交付与提交",
  "文档与管理",
] as const;
export interface GuideScenario {
  id: string;
  category: (typeof guideCategories)[number];
  title: string;
  skill: SkillId;
  mode?: string;
  when: string;
  request: string;
  result: string;
  boundary: string;
}

export const guideScenarios: GuideScenario[] = [
  {
    id: "design",
    category: "项目接入",
    title: "新项目：先明确需求和设计",
    skill: "bootstrap-project",
    mode: "design",
    when: "已有产品想法，需要形成设计基线，还不开始实现。",
    request:
      "请使用 design 模式，基于我提供的原始需求整理目标、设计、边界和待确认事项，并按项目约定维护需求、设计及文档导航。只做设计，不实现产品；找不到依据的需求保持待确认。原始需求：<填写需求或文档路径>。",
    result: "需求与设计依据、已确认选择、未知项、实际修改文件和下一步建议。",
    boundary: "初始化和文档登记不等于全部用户需求已确认；不能补造项目事实。",
  },
  {
    id: "greenfield",
    category: "项目接入",
    title: "新项目：建立项目治理基线",
    skill: "bootstrap-project",
    mode: "greenfield",
    when: "已安装 Distribution，希望建立新项目的治理文档和协作约定。",
    request:
      "请使用 greenfield 模式，根据已确认设计 <文档路径> 建立本项目的治理基线和文档入口。保留已有文件，不覆盖用户数据；报告实际初始化结果和待补事项。本次不授权产品实现。",
    result: "实际初始化文件、保留的数据、项目决策和未完成安装事项。",
    boundary:
      "安装只提供 Runtime 与 skills，不自动生成完整项目事实或任务定义。",
  },
  {
    id: "inventory",
    category: "项目接入",
    title: "已有项目：先盘点，不重建",
    skill: "bootstrap-project",
    mode: "inventory",
    when: "代码和文档已存在，先了解实际架构、命令与边界。",
    request:
      "请使用 inventory 模式，只读盘点 <模块或目录> 的现状、已有需求和设计、稳定边界及未知项。列出证据路径，不改产品文件，不重新初始化，不写管理记录。",
    result: "带来源的现状盘点、可接管事实与待确认选择。",
    boundary: "盘点只证明观察到的事实；不自动授权采用或变更设计。",
  },
  {
    id: "adopt",
    category: "项目接入",
    title: "已有项目：接管或对齐治理资产",
    skill: "bootstrap-project",
    mode: "adopt / realign / maintain-domains",
    when: "采用盘点结果用 adopt；对齐已有治理路径用 realign；维护职责域用 maintain-domains。",
    request:
      "请使用 <adopt、realign 或 maintain-domains 中的一种> 模式，基于已确认盘点 <路径> 更新我授权的治理资产。保留现有正文、用户文件与任务历史；涉及已同意设计或职责边界的实质变更，先汇总差异供确认。",
    result: "真实更新范围、原有数据保留情况、边界差异与剩余工作。",
    boundary:
      "这些是同一个 skill 的模式，不是旧版 /adopt-existing-project 等入口。",
  },
  {
    id: "capture",
    category: "需求与计划",
    title: "临时需求或 Bug：先记下来",
    skill: "capture-work-item",
    when: "出现新想法，但不希望打断当前任务或立即实现。",
    request:
      "请仅记录这项工作，不激活、不实现、不改变当前任务焦点。保留原始来源、期望结果、背景和与已有工作的关系；未知优先级不要猜。工作项：<内容>。",
    result: "保存的工作项引用、原始来源和真正缺失的信息。",
    boundary: "记录成功不是实施授权，也不表示此需求已完成设计。",
  },
  {
    id: "prepare",
    category: "需求与计划",
    title: "开始一个需求：制定任务计划",
    skill: "prepare-task",
    mode: "default",
    when: "将需求变成目标、验收、允许范围、步骤和必要验证。",
    request:
      "请根据需求 <路径或内容>、设计 <路径> 和现有项目情况制定任务计划，明确目标、验收、允许与禁止修改范围、实施步骤和最低充分验证。保留用户原话与待确认选择，只规划，不实现。",
    result: "稳定任务标识、候选计划引用、范围、验收、步骤与验证方案。",
    boundary: "候选计划不自动成为采用计划，也不能凭规划结果切换当前工作焦点。",
  },
  {
    id: "draft-review",
    category: "需求与计划",
    title: "实现前：检查计划是否靠谱",
    skill: "review-draft",
    when: "检查计划是否遗漏需求、边界、跨步骤影响或必要验证。",
    request:
      "请审查候选计划 <路径或引用>，对照原始需求和设计，检查目标、验收、范围、可行性、步骤衔接及验证价值。输出具体问题和解决条件，不改产品代码，不替我采用计划。",
    result: "针对该计划版本的审查问题、条件和下一步建议。",
    boundary: "审查通过不是用户采用；不为凑证据要求无关全量测试或 E2E。",
  },
  {
    id: "confirm",
    category: "需求与计划",
    title: "确认采用已审查计划",
    skill: "prepare-task",
    mode: "confirm",
    when: "已经选定具体计划，需要记录采用范围和审查条件。",
    request:
      "请使用 confirm 模式。我确认采用计划 <精确计划引用>，并接受这些审查条件：<条件或无>。保留本次决定的原文，核对采用计划和当前步骤；本次只确认，不实现。",
    result: "实际采用的计划引用、条件和读回的当前步骤。",
    boundary:
      "沿用仍有效的确认，不重复索取旧批准令牌；不要静默关闭另一个任务。",
  },
  {
    id: "replan",
    category: "需求与计划",
    title: "需求变更：调整计划或范围",
    skill: "prepare-task",
    mode: "replan / amend-scope",
    when: "目标、范围、验收或实施顺序发生实质变化。",
    request:
      "请使用 <replan 或 amend-scope> 模式，针对现有任务 <任务引用> 调整 <具体变化>。保留旧计划和执行证据，列明差异、风险与待确认选择；候选修订不自动采用，不将旧验证当作新计划已通过。",
    result: "关联前序计划的修订、真实差异和需要用户决定的事项。",
    boundary: "修订沿用任务身份，不为内部状态漂移伪造后继任务。",
  },
  {
    id: "execute",
    category: "实施与调试",
    title: "按范围实现当前步骤",
    skill: "execute-step",
    mode: "default",
    when: "已有明确实施授权，希望完成当前步骤。",
    request:
      "请实施任务 <任务引用> 的当前步骤，遵守已采用计划与我授权的范围。保留已有用户改动，完成必要实现与风险相称的验证；报告实际改动、命令、结果及未运行项。不推送、不部署。本次不要求正式审查。",
    result: "实际实现、执行与测试记录、来源版本及剩余工作。",
    boundary: "实现自检不等于正式审查；执行记录、审查和步骤收尾是不同状态。",
  },
  {
    id: "repair",
    category: "实施与调试",
    title: "修复审查发现的问题",
    skill: "execute-step",
    mode: "repair",
    when: "已有具体审查发现，并已授权在当前范围内修复。",
    request:
      "请使用 repair 模式，修复审查 <引用> 中的 <问题编号>，仅限已授权范围。保留旧审查与失败证据，执行必要验证并报告新执行结果；越界或改变原承诺时先说明，不顺手重构。",
    result: "修复内容、新执行与验证证据、仍未解决的问题。",
    boundary: "修复不会改写旧审查结论；需要复核时使用 review-change。",
  },
  {
    id: "debug",
    category: "实施与调试",
    title: "报错、卡住或行为不对：查根因",
    skill: "debug-task",
    mode: "investigate-only / resolve",
    when: "只定位用 investigate-only；已授权修复用 resolve。",
    request:
      "请使用 investigate-only 模式，只读调查 <症状>，复现条件是 <条件>。区分假设和已证实原因，优先使用现有证据与有限探测，不改产品文件，不写记录。请报告证据和真正的外部阻塞。",
    result: "诊断、已证实原因、失败或矛盾观察，以及必要的后续修复范围。",
    boundary:
      "要修复时明确要求 resolve 并给出授权范围；管理服务报错不等于产品根因。",
  },
  {
    id: "change-review",
    category: "审查与验证",
    title: "检查实现或指定 Git diff",
    skill: "review-change",
    mode: "default / recheck-completed-step",
    when: "实现后审查，或复核已完成步骤的历史／更新版本。",
    request:
      "请审查 <确切 diff、提交区间或版本>，核对需求、调用链、正确性、安全、兼容性及测试证据。列明审查覆盖与未观察项，不修代码、不关闭任务、不提交。说明这是实施者自审还是独立审查。",
    result: "覆盖明确版本的结论、具体发现和审查来源；历史复核保留旧结论。",
    boundary:
      "干净审查不自动收尾步骤；未收尾时通常转 execute-step 的 finish 模式。",
  },
  {
    id: "validate",
    category: "审查与验证",
    title: "只验证某项行为，不修改实现",
    skill: "validate-change",
    when: "需要读取既有报告或运行获授权的非修改性检查。",
    request:
      "请验证 <目标及版本> 是否满足 <预期行为>，仅运行 <获授权检查或选择器>，可复用适用的已有报告。保留实际命令、版本、失败及未运行项，不修代码、不新增永久测试、不扩大为全量回归；本次不写管理记录。",
    result: "明确目标与版本的实际验证结果、证据和限制。",
    boundary: "历史 PASS 不证明当前版本；失败、环境限制和未运行不能算通过。",
  },
  {
    id: "pause",
    category: "暂停与恢复",
    title: "临时暂停或记录中断",
    skill: "task-lifecycle",
    mode: "pause / interrupt",
    when: "暂时停下用 pause；记录工作中断用 interrupt。",
    request:
      "请使用 <pause 或 interrupt> 模式处理任务 <任务引用>。保留当前计划、工作区改动、已完成证据和未完成项，记录原因 <原因>；不回滚、不删除、不替我提交。",
    result: "实际生命周期和工作焦点读回、保留的上下文与待办。",
    boundary: "生命周期变更不等于验证通过，不需要先清空或恢复旧状态。",
  },
  {
    id: "resume",
    category: "暂停与恢复",
    title: "恢复已有任务，不重复已完成操作",
    skill: "task-lifecycle",
    mode: "resume-paused / resume-interrupted",
    when: "从真实保留的计划、代码和证据继续。",
    request:
      "请使用 <resume-paused 或 resume-interrupted> 模式恢复任务 <任务引用>。核对现存计划、工作区和历史证据，报告当前焦点及下一项未完成工作。不要仅因回执丢失重跑命令；本次只恢复管理状态，不实施下一步。",
    result: "实际恢复结果、当前焦点、缺失上下文与下一步建议。",
    boundary: "恢复本身不授权重跑测试、提交或部署。",
  },
  {
    id: "supersede",
    category: "暂停与恢复",
    title: "旧任务被新任务替代",
    skill: "task-lifecycle",
    mode: "supersede",
    when: "用户已决定更换任务方向，需要保留原任务的历史。",
    request:
      "请使用 supersede 模式，将任务 <旧任务> 与替代任务 <新任务> 建立替代关系，保留旧计划、执行证据和未完成项。我选择的工作焦点是 <选择>；不回滚代码、不删除历史。",
    result: "替代关系、实际工作焦点和保留的历史／剩余工作。",
    boundary: "软件或任务替代不是覆盖用户数据的许可。",
  },
  {
    id: "finish",
    category: "交付与提交",
    title: "步骤已实现和审查：明确收尾",
    skill: "execute-step",
    mode: "finish",
    when: "执行和审查已完成，但步骤仍未记录收尾处置。",
    request:
      "请使用 finish 模式，核对任务 <任务引用> 当前步骤的实际执行、适用审查、验证及未解决问题，并记录真实收尾处置后读回状态。不为收尾重跑实现或测试；承诺未满足时先汇总影响，不伪造干净审查。",
    result: "步骤处置已保存与否、适用证据、剩余工作及新鲜状态下的下一步建议。",
    boundary:
      "finish 不自动实施下一步、关闭任务或 Git 提交；最后一步后通常建议 close-task。",
  },
  {
    id: "close-preview",
    category: "交付与提交",
    title: "交付前先看关闭后果",
    skill: "close-task",
    mode: "preview",
    when: "还不关闭，只查看交付、未完成步骤和风险。",
    request:
      "请使用 preview 模式，只读预览任务 <任务引用> 的关闭后果。汇总交付、验证、未完成步骤、审查发现、Git 状态和外部影响；不写记录、不关闭、不提交。",
    result: "真实交付摘要、缺失检查、未完成步骤、未提交改动与关闭后果。",
    boundary: "预览不改变任务状态；Git 干净或审查干净都不能代替步骤处置。",
  },
  {
    id: "close",
    category: "交付与提交",
    title: "完成交付，或明确终止未完成任务",
    skill: "close-task",
    when: "用户已要求关闭任务，或接受列明后果后终止。",
    request:
      "请关闭任务 <任务引用>，先汇总实际交付、步骤处置、验证、未解决问题和未提交改动。若与已同意承诺有实质偏离，集中说明后供我选择；保存真实处置并读回关闭及工作焦点结果，不提交、不推送、不部署。",
    result: "关闭结果、剩余工作、证据限制；持久化、关联和展示更新分别报告。",
    boundary:
      "关闭是任务处置，不证明任务已完成全部验收；不能隐瞒失败或跳过项。",
  },
  {
    id: "commit",
    category: "交付与提交",
    title: "保存阶段或最终 Git 提交",
    skill: "git-commit",
    when: "需要真实本地提交；范围由本次用户指令决定。",
    request:
      "请在当前仓库创建本地提交，提交范围为 <明确文件、阶段范围或仅暂存区>，说明为 <提交说明>。检查真实 diff 和暂存内容，保留无关用户改动与部分暂存，遵守项目 checkpoint 约定。报告实际 SHA 与剩余变更；不推送、不 amend、不重置或清理。",
    result: "真实提交 SHA、实际范围、核对结果和剩余工作区变更。",
    boundary:
      "next_route: git-commit 只是建议，不是提交授权；默认 checkpoint 可含项目级持久记录，明确路径／仅暂存指令优先。",
  },
  {
    id: "documents",
    category: "文档与管理",
    title: "补齐需求、设计和规划的文档登记",
    skill: "bootstrap-project",
    mode: "realign",
    when: "TraceLens 提示登记缺口，需要项目 AI 维护现有文档入口。",
    request:
      "请使用 realign 模式，结合 TraceLens 的“文档整理提示词”和项目维护规则，对照我提供的原始需求，补齐现有文档中心中需求、设计、规划的登记。保留正文位置，注明状态、类别和替代关系；不手改生成目录、任务历史或 Runtime 记录，不把导航齐备说成用户需求全部确认。授权文档范围：<范围>。",
    result: "实际导航改动、需求／设计待确认项；完成后回到 TraceLens 手动刷新。",
    boundary:
      "没有独立的 sync-documents vNext skill；TraceLens 不替 AI 执行 skill，也不写项目。",
  },
  {
    id: "recovery",
    category: "文档与管理",
    title: "记录已保存，但任务关联或展示不对",
    skill: "task-lifecycle",
    when: "管理关联缺失、视图过期或记录冲突；并非产品操作失败。",
    request:
      "请核对任务 <引用> 的已保存记录、关联和实时管理视图，列出具体差异并做可确定的有界视图修复。不能确定时给出 link、correct、resolve 或 defer 的选择及后果；保留未知用户备注。不要重跑实现、测试、Git 提交或部署来修复管理展示。",
    result: "保存、关联和展示的实际结果，可恢复项与需要用户选择的歧义。",
    boundary:
      "纯管理错误不自动阻止独立获授权工作；未保存或未协调的结果仍须如实报告。",
  },
];

export function scenarioPrompt(scenario: GuideScenario): string {
  return `$${scenario.skill} ${scenario.request}`;
}

export function findScenarios(
  query: string,
  category: string,
): GuideScenario[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return guideScenarios.filter((scenario) => {
    if (category && scenario.category !== category) return false;
    const text = Object.values(scenario).join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
