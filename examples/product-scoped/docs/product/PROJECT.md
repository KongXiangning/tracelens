---
schema: vnext-product-doc/v3
items:
  - id: PROJECT
    type: project
    inventory:
      state: partial
      checked_sources: []
      unreviewed_sources: []
      note: 合成场景，不声明全项目已盘点。
    root_goal_id: G-ALL
    requirement_order: [R-PIPELINE, R-IMPORT, R-OLD, R-DELTA, R-NEW]
  - id: G-ALL
    type: goal
    scope: current
    assessment_scopes:
      - {target: G-ALL, scope_id: OVERALL, coverage: 演示与持续使用的总体结果}
  - id: G-DEMO
    type: goal
    scope: current
    goal_kind: stage
    assessment_scopes:
      - {target: R-IMPORT, scope_id: FULL, coverage: 固定知识集全量入库；排除持续更新及失败恢复}
      - {target: R-NEW, scope_id: BATCH, coverage: 约定批次输入}
    links:
      - {id: demo-parent, relation: part_of, target: G-ALL, origin: declared, state: active}
  - id: G-LIVE
    type: goal
    scope: current
    assessment_scopes:
      - {target: R-IMPORT, scope_id: RECOVERABLE, coverage: 全量入库及失败恢复；增量识别另由 R-DELTA 承接}
      - {target: R-PIPELINE, scope_id: PIPELINE, coverage: 约定输入与恢复流程}
      - {target: R-DELTA, scope_id: DELTA, coverage: 增量识别}
    links:
      - {id: live-parent, relation: part_of, target: G-ALL, origin: declared, state: active}
  - id: R-PIPELINE
    type: requirement
    scope: current
    links:
      - {id: pipeline-live, relation: supports, target: G-LIVE, origin: declared, state: active}
  - id: R-IMPORT
    type: requirement
    scope: current
    links:
      - {id: import-parent, relation: part_of, target: R-PIPELINE, origin: declared, state: active}
      - {id: import-demo, relation: supports, target: G-DEMO, origin: declared, state: active}
      - {id: import-live, relation: supports, target: G-LIVE, origin: declared, state: active}
  - id: R-OLD
    type: requirement
    scope: retired
  - id: R-DELTA
    type: requirement
    scope: current
    links:
      - {id: delta-live, relation: supports, target: G-LIVE, origin: declared, state: active}
      - {id: delta-import, relation: depends_on, target: R-IMPORT, origin: declared, state: active}
  - id: R-NEW
    type: requirement
    scope: current
    links:
      - {id: new-demo, relation: supports, target: G-DEMO, origin: declared, state: active}
      - {id: new-replaces, relation: replaces, target: R-OLD, origin: declared, state: active}
  - id: R-UNORDERED
    type: requirement
    scope: current
---
# 合成导入项目

## [PROJECT] 导入项目
### 项目定位
验证目标、范围与对象选择。
### 盘点范围与未核对项
仅覆盖这组合成资料。

## [G-ALL] 可使用的内容导入系统
### 目标说明
演示与持续使用均有明确结果。
### 范围边界
总体使用结果需独立核对，不按任务数量汇总。

## [G-DEMO] 固定知识集演示阶段
### 目标说明
演示固定知识集导入。
### 范围边界
只要求全量导入，不要求持续更新。

## [G-LIVE] 持续更新目标
### 目标说明
持续导入内容并从失败中恢复。
### 范围边界
全量导入、增量更新和失败恢复。

## [R-PIPELINE] 导入流程
### 需求内容
维护全量及持续导入流程。
### 范围边界
保留父需求；子需求细化不替代父项。
### 验收要求
按约定输入和恢复场景核对。

## [R-IMPORT] 内容入库
### 需求内容
将约定内容写入目标库。
### 范围边界
演示范围只含全量，持续使用范围另含恢复能力。
### 验收要求
分别核对全量入库和失败恢复。

## [R-OLD] 手工输入
### 需求内容
旧手工导入方式。
### 范围边界
本合成场景已明确由 R-NEW 替代并退出当前要求。
### 验收要求
历史保留，不作为当前缺口。

## [R-DELTA] 增量导入
### 需求内容
只导入新增内容。
### 范围边界
持续使用目标下的新增要求。
### 验收要求
核对增量识别；具体实现尚未判定。

## [R-NEW] 批量输入
### 需求内容
以批量输入替代手工输入。
### 范围边界
替代依据仅为本合成场景设定，不代表真实用户决定。
### 验收要求
核对约定批次输入；结果尚未判定。

## [R-UNORDERED] 未登记顺序的要求
### 需求内容
已读到、但未纳入项目登记顺序。
### 范围边界
不因顺序缺失隐藏需求。
### 验收要求
保持可读；成果未知。
