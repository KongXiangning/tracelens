---
schema: vnext-product-doc/v2
items:
  - type: plan
    id: PLAN-IMPORT
    intent_state: adopted
    targets:
      - target: REQ-IMPORT
        coverage: 导入范围按近期及后续阶段逐步展开，受共享审计约束
    work_items:
      - id: W-VERIFY
        title: 错误输入反馈与既有单设备覆盖
        outcome: 取得错误输入反馈与既有单设备覆盖的实际结果
        scope: 错误输入反馈与既有单设备覆盖
        targets:
          - target: REQ-IMPORT
            coverage: 错误输入反馈与既有单设备覆盖
        state: included
        origin: initial
        stage: 近期核对
      - id: W-BASE
        title: 双设备输入的近期局部工作
        outcome: 取得双设备输入的近期局部工作的实际结果
        scope: 双设备输入的近期局部工作
        targets:
          - target: REQ-IMPORT
            coverage: 双设备输入的近期局部工作
        state: included
        origin: initial
        stage: 近期实施
      - id: W-RELEASE
        title: 其余输入与集成复验，细节待核对
        outcome: 取得其余输入与集成复验，细节待核对的实际结果
        scope: 其余输入与集成复验，细节待核对
        targets:
          - target: REQ-IMPORT
            coverage: 其余输入与集成复验，细节待核对
        state: included
        origin: initial
        stage: 后续交付
        depends_on:
          - item_id: W-BASE
            kind: prerequisite
            reason: 集成复验需要相关双设备行为真实可用；task 关闭不证明满足
---
# 已采用的局部安排

## [PLAN-IMPORT] 混合式导入安排
### 实施策略
近期范围具体，后续交付阶段保留粗略安排，未说明依赖的工作可否并行尚未核对。
### 阶段与工作项说明
按原数组展示 W-VERIFY、W-BASE、W-RELEASE；同一导入需求跨阶段覆盖。共享审计约束适用于每项，不另造审计工作项。
### 调整与未决事项
远期细节和当前代码适用性未核对；数组顺序不是新增依赖。

