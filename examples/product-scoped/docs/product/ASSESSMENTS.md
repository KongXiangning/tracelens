---
schema: vnext-product-doc/v3
items:
  - id: A-DEMO
    type: assessment
    target: R-IMPORT
    target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: R-IMPORT}
    target_definition_algorithm: vnext-product-definition/v1
    target_definition_sha256: 67c6af37db967502e78c5b9de0b2a700b7adc0749c911f49c53e243432a808cc
    goal_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-DEMO}
    goal_definition_algorithm: vnext-product-definition/v1
    goal_definition_sha256: 09351d926d7aaa9fd6df4cf87f930559095bec66639ca34a278d3065db954261
    checked_at: "2026-10-11T10:00:00+08:00"
    applicability: {goal_id: G-DEMO, scope_id: FULL, coverage: 固定知识集全量入库；排除持续更新及失败恢复}
    subject: {kind: working-copy, value: sample-copy-a, revision: sample-baseline}
    conclusion: satisfied
    implementation: delivered-reported
    verification: pass-reported
    sources: [{kind: file, path: docs/evidence/import.md}]
  - id: A-LIVE
    type: assessment
    target: R-IMPORT
    target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: R-IMPORT}
    target_definition_algorithm: vnext-product-definition/v1
    target_definition_sha256: 67c6af37db967502e78c5b9de0b2a700b7adc0749c911f49c53e243432a808cc
    goal_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-LIVE}
    goal_definition_algorithm: vnext-product-definition/v1
    goal_definition_sha256: 9fc7db52440d164bdfb82e7637174d611b4cf6f55d5f32b0a9d7c4f51ccbaee4
    checked_at: "2026-10-11T11:00:00+08:00"
    applicability: {goal_id: G-LIVE, scope_id: RECOVERABLE, coverage: 全量入库及失败恢复；增量识别另由 R-DELTA 承接}
    subject: {kind: working-copy, value: sample-copy-a, revision: sample-baseline}
    conclusion: partially-satisfied
    implementation: partial-reported
    verification: mixed-reported
    sources: [{kind: file, path: docs/evidence/import.md}]
  - id: A-RELEASE
    type: assessment
    target: R-IMPORT
    target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: R-IMPORT}
    target_definition_algorithm: vnext-product-definition/v1
    target_definition_sha256: 67c6af37db967502e78c5b9de0b2a700b7adc0749c911f49c53e243432a808cc
    goal_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-DEMO}
    goal_definition_algorithm: vnext-product-definition/v1
    goal_definition_sha256: 09351d926d7aaa9fd6df4cf87f930559095bec66639ca34a278d3065db954261
    checked_at: "2026-10-11T12:00:00+08:00"
    applicability: {goal_id: G-DEMO, scope_id: FULL, coverage: 固定知识集全量入库；排除持续更新及失败恢复}
    subject: {kind: release, value: sample-release-0}
    conclusion: not-satisfied
    implementation: none-reported
    verification: failure-reported
    sources: [{kind: file, path: docs/evidence/import.md}]
  - id: A-ALL
    type: assessment
    target: G-ALL
    target_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-ALL}
    target_definition_algorithm: vnext-product-definition/v1
    target_definition_sha256: c7f8d38074fed123dd7d4dde4559fadf48df741042c152f425f5890f41bbb67e
    goal_basis: {kind: file, path: docs/product/PROJECT.md, item_id: G-ALL}
    goal_definition_algorithm: vnext-product-definition/v1
    goal_definition_sha256: c7f8d38074fed123dd7d4dde4559fadf48df741042c152f425f5890f41bbb67e
    checked_at: "2026-10-11T12:30:00+08:00"
    applicability: {goal_id: G-ALL, scope_id: OVERALL, coverage: 演示与持续使用的总体结果}
    subject: {kind: working-copy, value: sample-copy-a, revision: sample-baseline}
    conclusion: undetermined
    implementation: unknown
    verification: unknown
    sources: [{kind: file, path: docs/evidence/import.md}]
---
# 范围化报告

## [A-DEMO] 演示范围
### 覆盖范围
R-IMPORT 在 G-DEMO 的 FULL 范围，sample-copy-a 的 sample-baseline。
### 交付与验证依据
合成证据明确全量入库可用。
### 剩余与待核对
此范围无已知缺口；不覆盖恢复能力。

## [A-LIVE] 持续使用范围
### 覆盖范围
R-IMPORT 在 G-LIVE 的 RECOVERABLE 范围，同一工作副本版本。
### 交付与验证依据
全量入库已确认；失败恢复明确未达到约定。
### 剩余与待核对
缺少失败恢复；不把 R-DELTA 的未知混成当前已验证结果。

## [A-RELEASE] 另一发布对象
### 覆盖范围
同一演示范围，sample-release-0。
### 交付与验证依据
合成旧发布对象没有入库能力，约定演示失败。
### 剩余与待核对
全量入库未达到约定；不覆盖 sample-copy-a。

## [A-ALL] 总体使用结果
### 覆盖范围
G-ALL 的 OVERALL 范围。
### 交付与验证依据
已有演示成果，但没有总体实际使用核对。
### 剩余与待核对
总体尚未判定；保留各局部成果。
