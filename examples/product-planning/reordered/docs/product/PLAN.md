---
schema: vnext-product-doc/v2
items:
  - type: plan
    id: PLAN-LOCAL
    intent_state: adopted
    targets:
      - target: REQ-IMPORT
        coverage: 基础 A 与新增 B/C 范围
    work_items:
      - id: B
        title: 双设备
        outcome: 取得双设备的实际结果
        scope: 双设备
        targets:
          - target: REQ-IMPORT
            coverage: 双设备
        state: included
        origin: initial
        stage: 近期
      - id: A
        title: 单设备有效输入
        outcome: 取得单设备有效输入的实际结果
        scope: 单设备有效输入
        targets:
          - target: REQ-IMPORT
            coverage: 单设备有效输入
        state: included
        origin: initial
        stage: 历史交付
      - id: C
        title: 错误输入
        outcome: 取得错误输入的实际结果
        scope: 错误输入
        targets:
          - target: REQ-IMPORT
            coverage: 错误输入
        state: included
        origin: initial
        stage: 后续
---
# 虚构重排消费输入

## [PLAN-LOCAL] 重排后的局部安排
### 实施策略
仅覆盖导入，不是总体计划。
### 阶段与工作项说明
展示 B、A、C；A 的历史单设备报告仍在 AS-BASE，B/C 尚未验证。
### 调整与未决事项
从 A、B、C 调为 B、A、C；展示变化不重开 A，也不改变 task 状态。

