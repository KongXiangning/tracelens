---
schema: vnext-product-doc/v2
items:
  - type: requirement
    id: REQ-IMPORT
    scope: current
    assessment_id: AS-BASE
    task_bindings:
      - id: B-BASE
        task:
          task_id: example-closed-base-task
          source:
            kind: text
            text: 合成历史：基础导入 task 已关闭，只覆盖单设备有效输入；不是当前任务状态查询。
            label: 虚构消费样例，非用户决定
        role: implementation
        coverage: 单设备有效输入的基础导入
        origin: declared
        state: active
  - type: requirement
    id: REQ-AUDIT
    scope: current
  - type: requirement
    id: REQ-EXPORT
    scope: planned
  - type: requirement
    id: REQ-STREAM
    scope: candidate
  - type: requirement
    id: REQ-LEGACY
    scope: retired
---
# 完整需求，非剩余待办

## [REQ-IMPORT] 完整导入要求
### 需求内容
处理有效输入、错误输入及新增双设备输入。
### 范围边界
保留已交付的单设备行为；本轮不新增文件格式。
### 验收要求
分别检查单设备、错误输入、双设备；历史单设备 PASS 不能代替其余检查。


## [REQ-AUDIT] 共享审计约束
### 需求内容
记录导入结果及错误，日志不得包含原始个人数据。
### 范围边界
跨所有导入阶段有效；没有独立工作项不等于遗漏。
### 验收要求
按实际日志核对脱敏和结果定位。


## [REQ-EXPORT] 后续导出
### 需求内容
按已知格式导出处理结果。
### 范围边界
尚未进入近期安排，需求仍然保留。
### 验收要求
交付前核对约定格式，当前未验证。


## [REQ-STREAM] 流式输入候选
### 需求内容
是否需要流式输入尚未决定。
### 范围边界
不是已采纳工作。
### 验收要求
尚无已采纳验收要求。


## [REQ-LEGACY] 退出的旧格式
### 需求内容
旧格式导入的历史范围。
### 范围边界
退出当前范围不等于已交付，也不恢复旧工作。
### 验收要求
仅保留历史约定，当前不作交付结论。

