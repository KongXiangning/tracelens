---
schema: vnext-product-doc/v2
items:
  - id: PROJECT-IMPORT
    type: project
    inventory:
      state: partial
      checked_sources:
        - {kind: file, path: docs/evidence/baseline-report.md}
      unreviewed_sources:
        - {kind: file, path: docs/evidence/incoming-report.md}
      note: 合成案例只整理导入范围，不代表实际项目全量盘点。
  - id: GOAL-IMPORT
    type: goal
    scope: current
  - id: MOD-IMPORT
    type: module
    scope: current
    links:
      - {id: L-GOAL, relation: supports, target: GOAL-IMPORT, origin: declared, state: active}
  - id: REQ-IMPORT
    type: requirement
    scope: current
    assessment_id: AS-BASE
    links:
      - {id: L-MODULE, relation: part_of, target: MOD-IMPORT, origin: declared, state: active}
      - {id: L-GOAL, relation: supports, target: GOAL-IMPORT, origin: declared, state: active}
    task_bindings:
      - id: B-BASE
        task:
          task_id: null
          source: {kind: file, path: docs/evidence/baseline-report.md, note: 合成历史记录未取得稳定任务身份。}
          label: 历史单设备实施（身份未知）
        role: implementation
        coverage: 旧版单设备有效输入，不含新增双设备或异常输入范围。
        origin: declared
        state: active
        plan_items: [{plan_id: PLAN-IMPORT, work_item_id: W-BASE}]
  - id: REQ-EXPORT
    type: requirement
    scope: planned
  - id: REQ-STREAM
    type: requirement
    scope: candidate
  - id: REQ-LEGACY
    type: requirement
    scope: retired
  - id: DES-IMPORT
    type: design
    intent_state: proposed
    links:
      - {id: L-REQ, relation: addresses, target: REQ-IMPORT, origin: declared, state: active}
  - id: PLAN-IMPORT
    type: plan
    intent_state: proposed
    targets:
      - {target: REQ-IMPORT, coverage: 核对已有单设备范围，再分析双设备及异常输入。}
    work_items:
      - id: W-CHECK
        title: 核对新增反馈
        outcome: 明确异常输入的实际影响和待修复范围。
        scope: 只核对已有反馈，不表示已复现或修复。
        targets: [{target: REQ-IMPORT, coverage: 异常输入及当前交付缺口。}]
        state: included
        origin: added
        stage: 近期核对
        sources:
          - {kind: file, path: docs/evidence/incoming-report.md}
      - id: W-BASE
        title: 历史单设备范围
        outcome: 单设备有效输入的导入能力。
        scope: 原安排范围保留，关联历史报告；不表示当前完成。
        targets: [{target: REQ-IMPORT, coverage: 单设备有效输入。}]
        state: included
        origin: initial
        stage: 历史安排
      - id: W-DUAL
        title: 双设备行为细化
        outcome: 双设备标识与去重规则的具体实现安排。
        scope: 后续细化，不提前创建任务。
        targets: [{target: REQ-IMPORT, coverage: 双设备输入及错误处理。}]
        state: deferred
        origin: added
        stage: 后续细化
        sources:
          - {kind: text, text: 合成范围变化增加双设备输入，需先核对异常反馈。, label: 合成安排依据}
        depends_on:
          - {item_id: W-CHECK, kind: order, reason: 先核对反馈以明确工作范围；不是任务准入条件。}
  - id: CHG-DUAL
    type: change
    recorded_at: "2026-10-08T09:00:00+08:00"
    basis:
      kind: document-edit
      text: 合成示例编辑：需求增加双设备和异常输入范围。
    deltas:
      - target: REQ-IMPORT
        before: 只覆盖单设备有效输入。
        after: 覆盖单设备与双设备有效输入，并说明异常输入错误。
        note: 旧原文保存在 history；旧交付报告未同步到新范围。
  - id: AS-BASE
    type: assessment
    target: REQ-IMPORT
    target_basis:
      kind: file
      path: docs/product/history/REQUIREMENTS-before.md
      item_id: REQ-IMPORT
    target_definition_sha256: null
    checked_at: "2026-10-07T16:00:00+08:00"
    subject: {kind: unknown, value: null}
    implementation: partial-reported
    verification: pass-reported
    sources:
      - {kind: file, path: docs/evidence/baseline-report.md}
    pending_sources:
      - {kind: file, path: docs/evidence/incoming-report.md}
  - id: DISC-STREAM
    type: discussion
    raw_ref:
      kind: file
      path: docs/product/discussions/raw/stream.txt
      sha256: 0bdd5b8d6487170b330a944c3e1694b638c01aa4c2f58ee872a32ef3a0398d37
    submitted_at: "2026-10-08T10:00:00+08:00"
    origin: {channel: other, locator: 合成讨论文件}
    record_state: active
    links:
      - id: L-STREAM
        relation: discusses
        target: REQ-STREAM
        origin: inferred
        state: active
        reason: 原文提出流式导入议题，相关性不代表采纳。
        sources:
          - {kind: file, path: docs/product/discussions/raw/stream.txt, lines: {start: 1, end: 1}}
---
# TraceLens 合成展示数据

全部业务、时间、安排与报告均为合成材料，不代表真实任务、用户决定或产品交付。

## [PROJECT-IMPORT] 导入项目样例
### 项目定位
展示标准业务文档如何表达目标、完整需求、安排、交付与资料。
### 盘点范围与未核对项
只整理导入相关范围。新增反馈尚未对账；其他业务未盘点。
### 本轮选取与未决事项
提案先核对新增反馈，再决定双设备范围；没有授权执行，没有创建新任务。

## [GOAL-IMPORT] 可靠导入
### 目标说明
让使用者能够按约定规则导入设备数据，并识别异常输入。
### 范围边界
导入规则以 REQ-IMPORT 为准；流式输入仍为候选。

## [MOD-IMPORT] 导入模块
### 业务能力
组织设备数据导入、错误提示及相关资料。
### 范围边界
本例不包含账户、网络同步或设备管理能力。

## [REQ-IMPORT] 设备数据导入
### 需求内容
支持单设备与双设备有效输入；无效输入提供可定位错误，不静默丢失数据。
### 范围边界
本例包含有效输入和异常输入，不包含流式输入或网络同步。
### 验收要求
有效输入得到对应设备记录；异常输入返回约定错误位置。双设备标识与去重细则仍待核对，未声明其已验证。

## [REQ-EXPORT] 后续导出
### 需求内容
后续提供已导入记录的离线导出。
### 范围边界
不在当前实施选择中；输出格式未确定。
### 验收要求
待后续范围细化后形成具体输入、条件与预期结果。

## [REQ-STREAM] 流式导入候选
### 需求内容
保留流式输入的候选想法。
### 范围边界
尚未采纳，不构成实施义务。
### 验收要求
未记录；候选可行性及业务价值待讨论。

## [REQ-LEGACY] 旧格式支持
### 需求内容
保留过去提出的旧格式支持范围。
### 范围边界
已退出当前方向；没有声明开发完成。
### 验收要求
历史验收规则未取得，不能以退出范围推断通过。

## [DES-IMPORT] 导入解析提案
### 设计方案
先区分设备标识，再验证记录；方案仍是提案。
### 约束与取舍
异常输入不静默丢失；标识与去重细则未定。
### 实际实现与差异
未核对当前代码。历史报告只覆盖旧单设备有效输入。

## [PLAN-IMPORT] 导入范围核对提案
### 实施策略
混合安排：近期具体核对反馈，保留历史安排，后续双设备工作暂缓细化。
### 阶段与工作项说明
展示顺序为 W-CHECK、W-BASE、W-DUAL；W-DUAL 显式安排在 W-CHECK 之后，其他顺序不构成隐含依赖。
### 调整与未决事项
计划未采用；未创建未来任务。当前代码版本、异常影响和双设备细则未知。

## [CHG-DUAL] 增加双设备及异常输入范围
### 变更说明
合成案例从旧单设备有效输入扩展范围，保留旧定义。
### 影响与未同步项
旧报告与新增要求尚未对账；计划和设计仍是提案。

## [AS-BASE] 历史单设备报告
### 覆盖范围
仅报告旧单设备有效输入；不包含双设备与异常输入。
### 交付与验证依据
合成 baseline-report 报告该旧范围已实施且检查通过。实施标签相对于完整新需求为部分报告；实际代码版本未知，定义摘要未登记。
### 剩余与待核对
incoming-report 含异常反馈待核对。旧通过标签不能当作当前完整需求通过。

## [DISC-STREAM] 流式输入讨论
### 整理摘要
原文提出流式导入是否必要的议题；只推断相关性。
### 议题与未决问题
价值与可行性未确定，没有采纳观点或创建任务。
