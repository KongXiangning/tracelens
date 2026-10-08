---
schema: vnext-product-doc/v2
items:
  - id: PROJECT-E6
    type: project
    inventory:
      state: partial
      checked_sources: []
      unreviewed_sources:
        - {kind: text, text: '本夹具只展示导入相关范围，不代表真实全项目盘点。', label: 示例范围}
  - id: GOAL-IMPORT
    type: goal
    scope: current
  - id: MOD-IMPORT
    type: module
    scope: current
    links:
      - {id: L-GOAL, relation: supports, target: GOAL-IMPORT, origin: declared, state: active}
---
# 示例项目

## [PROJECT-E6] 项目说明
### 项目定位
验证项目文档如何表达预先规划与计划外修复。
### 盘点范围与未核对项
只覆盖导入相关示例，其他业务未盘点。

## [GOAL-IMPORT] 可靠导入
### 目标说明
按已约定的输入行为提供可靠导入能力。
### 范围边界
业务细则以 REQ-IMPORT 为准；本夹具不是实际产品规范。

## [MOD-IMPORT] 导入业务
### 业务能力
导入脚本及使用其结果的相关工作。
### 范围边界
只组织本示例的需求，不定义代码修改权限。
