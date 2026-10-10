---
schema: vnext-product-doc/v2
items:
  - type: change
    id: CHG-ORDER
    recorded_at: 2026-10-09T00:00:00Z
    basis:
      kind: delegated
      text: 虚构样例明确重排
      sources:
        - kind: text
          text: 将 B 放在已交付 A 前面，保留历史。
          label: 虚构消费样例，非用户决定
    deltas:
      - target: PLAN-LOCAL
        before: A、B、C
        after: B、A、C
        note: 稳定工作项 B/A/C；不改变 A 历史。
---
# 项目业务资料

## [CHG-ORDER] 局部展示重排
### 变更说明
只改变展示顺序。
### 影响与未同步项
原单设备报告保留，新增范围不继承旧 PASS。

