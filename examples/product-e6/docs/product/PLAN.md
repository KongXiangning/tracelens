---
schema: vnext-product-doc/v2
items:
  - id: PLAN-IMPORT
    type: plan
    intent_state: adopted
    targets: [{target: REQ-IMPORT, coverage: 导入及其后续使用范围}]
    work_items:
      - id: E6A
        title: 第一批实施
        outcome: 提供包含导入脚本的第一批能力
        scope: 原 E6A 实施范围
        targets: [{target: REQ-IMPORT, coverage: 导入脚本基础范围}]
        state: included
        origin: initial
      - id: E6B
        title: 第二批实施
        outcome: 提供第二批约定能力
        scope: 原 E6B 实施范围
        targets: [{target: REQ-IMPORT, coverage: 第二批约定范围}]
        state: included
        origin: initial
        depends_on: [{item_id: E6A, kind: order, reason: 原分批安排}]
      - id: E6R
        title: 修复本次导入问题
        outcome: 处理本次失败所涉及的导入行为并取得实际检查结果
        scope: 不扩大输入格式，不推翻无关历史工作
        targets: [{target: REQ-IMPORT, coverage: 本次失败样例涉及范围}]
        state: included
        origin: added
        sources:
          - {kind: text, text: '原三项计划之后，依据用户提交的观察及当前决定新增。', label: 示例插入依据}
      - id: E6C
        title: 后续实施
        outcome: 提供依赖约定导入结果的后续能力
        scope: 原 E6C 范围，本次只调整相关先后安排
        targets: [{target: REQ-IMPORT, coverage: 后续使用范围}]
        state: included
        origin: initial
        depends_on:
          - {item_id: E6B, kind: order, reason: 原分批安排}
          - {item_id: E6R, kind: prerequisite, reason: 本示例中的 E6C 需要相关导入行为可靠；不能仅凭修复 task 关闭证明此前提满足}
---
# 导入实施计划

## [PLAN-IMPORT] 分批实施与修复安排
### 实施策略
按需求范围分批推进，实际 task 通过 TaskBinding 反向关联；此处没有 Runtime plan_ref。
### 阶段与工作项说明
原计划依次 E6A、E6B、E6C。本次保留 A、B 的历史处置，只插入 E6R 并调整相关 C 的安排。
### 调整与未决事项
E6R 为后加，不伪装成原定计划。缺陷是否由 A 引入尚未确定。修复及后续推进服从实际授权和工程条件；文档依赖不构成 Runtime 许可检查。
