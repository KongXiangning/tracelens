---
schema: vnext-product-doc/v5
items:
  - id: REQ-INPUT
    type: requirement
    scope: current
    task_bindings:
      - id: B-INPUT
        task:
          task_id: TASK-SAMPLE-PARSER
          source:
            kind: text
            label: 合成 Task 采用材料
            text: 实现 CSV 必填字段检查和错误行号、字段名返回；排除租户隔离与审计。
        role: implementation
        contribution: direct
        coverage: CSV 必填字段校验及错误行号、字段名定位；不含整体回滚。
        origin: declared
        state: active
        reason: 采用的解析器工作直接对应本需求的字段校验及错误定位义务。
        sources:
          - kind: text
            label: 合成需求与采用范围核对
            text: 本需求要求必填字段检查及错误定位，解析器的采用范围明确包含两者。
  - id: REQ-TENANT
    type: requirement
    scope: current
    task_bindings:
      - id: B-TENANT
        task:
          task_id: TASK-SAMPLE-PARSER
          source:
            kind: text
            label: 合成 Task 采用材料
            text: 实现 CSV 必填字段检查和错误行号、字段名返回；排除租户隔离与审计。
        role: implementation
        contribution: supporting
        coverage: 为租户导入提供校验后的行输入；不含身份验证或数据访问隔离。
        origin: declared
        state: active
        reason: 输入标准化服务于隔离导入流程，但未履行本需求的隔离义务；纠正原 direct。
        sources:
          - kind: text
            label: 合成原分类依据
            text: 原 B-TENANT 被记为 direct，依据仅为租户导入需要解析器。
          - kind: text
            label: 合成本次核对材料
            text: 采用范围排除租户隔离；设计明确租户导入消费校验后的解析器输出。
  - id: REQ-AUDIT
    type: requirement
    scope: current
    task_bindings:
      - id: B-AUDIT
        task:
          task_id: null
          label: 历史显示编号（合成）
          source:
            kind: text
            label: 合成旧索引
            text: 旧索引曾关联此显示编号，原任务正文尚不可恢复。
        role: implementation
        coverage: 旧记录称覆盖审计事件，具体范围待核对。
        origin: declared
        state: active
---
# 合成贡献核对

## [REQ-INPUT] CSV 字段校验

### 需求内容
导入 CSV 时校验必填字段，错误返回行号和字段名，合法行进入后续处理。

### 范围边界
本项不包括导入事务整体回滚。

### 验收要求
缺失必填字段能定位具体行与字段，合法输入可继续处理。

## [REQ-TENANT] 租户隔离

### 需求内容
查询、导入和导出按租户隔离。

### 范围边界
适用于已采用的三个数据入口；共用解析器本身不承担隔离。

### 验收要求
身份校验和数据访问限制均覆盖对应租户，不能跨租户读取或导入。

## [REQ-AUDIT] 操作审计

### 需求内容
关键操作保留操作者、时间和结果。

### 范围边界
审计操作及留存约束保持原有约定，缺材料不缩减要求。

### 验收要求
在实际约定的操作范围内能够查到上述审计信息。
