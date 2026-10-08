---
schema: vnext-product-doc/v2
items:
  - type: project
    id: PROJECT-SELECT
    inventory:
      state: partial
      checked_sources:
        - kind: text
          text: 本轮已读取导入与审计要求及历史局部报告。
          label: 虚构消费样例，非用户决定
      unreviewed_sources:
        - kind: text
          text: 其余业务资料尚未核对。
          label: 虚构消费样例，非用户决定
  - type: goal
    id: GOAL-RELIABLE
    scope: current
---
# 虚构规划消费样例

## [PROJECT-SELECT] 规划消费示例
### 项目定位
导入业务示例，完整需求与近期工作分开。
### 盘点范围与未核对项
已核对导入与共享审计；其余业务未知，字节读取完整不代表全项目盘点完成。

### 规划阅读说明
采用混合方式，近期导入工作见 PLAN-IMPORT，远期仍保留粗略阶段。PLAN-EXPORT 是另一个候选范围，PLAN-LEGACY 仅作历史；分别展示，不合并。调用者可明确选择 PLAN-IMPORT，此选择不写入新配置字段。


## [GOAL-RELIABLE] 可靠导入
### 目标说明
可靠处理已约定输入。
### 范围边界
范围由完整需求表达，不缩成当前 task。

