---
schema: vnext-product-doc/v2
items:
  - id: REQ-IMPORT
    type: requirement
    scope: current
    assessment_id: AS-IMPORT
    links:
      - {id: L-MODULE, relation: part_of, target: MOD-IMPORT, origin: declared, state: active}
    task_bindings:
      - id: B-A
        task:
          task_id: example-task-A
          source: {kind: text, text: 'E6A 的任务记录来源占位；测试中不是一次真实 task 操作。', label: 示例}
        role: implementation
        coverage: 导入脚本的既定实施范围
        origin: declared
        state: active
        plan_items: [{plan_id: PLAN-IMPORT, work_item_id: E6A}]
      - id: B-B
        task:
          task_id: example-task-B
          source: {kind: text, text: 'E6B 的任务记录来源占位。', label: 示例}
        role: implementation
        coverage: 第二批已规划范围
        origin: declared
        state: active
        plan_items: [{plan_id: PLAN-IMPORT, work_item_id: E6B}]
      - id: B-C
        task:
          task_id: example-task-C
          source: {kind: text, text: '本变体中 E6C task 已创建，但还未开始。', label: 示例}
        role: implementation
        coverage: 依赖约定导入结果的后续范围
        origin: declared
        state: active
        plan_items: [{plan_id: PLAN-IMPORT, work_item_id: E6C}]
      - id: B-R
        task:
          task_id: example-task-R
          source: {kind: text, text: '本次实际 prepare 成功后应使用返回的 task 身份；这里仅为夹具。', label: 示例}
        role: repair
        coverage: 本次提交的失败样例涉及的导入行为
        origin: declared
        state: active
        plan_items: [{plan_id: PLAN-IMPORT, work_item_id: E6R}]
        repairs:
          - task:
              task_id: example-task-A
              source: {kind: text, text: '脚本属于 E6A 交付范围；未确定缺陷何时引入。', label: 示例历史}
            coverage: 导入脚本相关交付，不代表整个 E6A 均需重做
            sources:
              - {kind: text, text: '用户报告导入输入出现异常；本示例没有真实日志或复现。', label: 示例观察}
        sources:
          - {kind: text, text: '示例决定：先修复相关导入行为，再推进受影响的 E6C 工作。', label: 示例决定}
---
# 导入需求

## [REQ-IMPORT] 导入行为
### 需求内容
按既定规则处理有效输入及错误输入。
### 范围边界
本次发现缺陷，不增加新的输入格式或改变原有目标。
### 验收要求
使用实际项目已经约定的输入和输出要求验证；不能把本示例文字当作真实验收计划。
