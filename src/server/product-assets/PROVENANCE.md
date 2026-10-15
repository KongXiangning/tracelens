# PRODUCT contract assets

## VN-03 / VN-05 v3 handoff

product-doc-v3.json is the full closed production schema, copied unchanged from
the VN-03 generated support asset and confirmed against the installed VN-05
local candidate. SHA-256: c08c9ffa781c2ffce8bf8889567aa8eff155b433376fd149454f8df5b15d405b.
Candidate: 0.24.5, bundle-1d2110dac6531342ab66df9d, manifest
9a3bc3f567b31ae7ca4ad579c78ce74b7b5035b85230aa1d1ce435b123cfe909.
product-parser adapts the current product-definition/v1 digest;
shared/product-view adapts scoped.ts selection. Product reads remain independent
of task queries. The following provenance of older v1/v2 assets is retained.

Source repository: https://github.com/KongXiangning/vibe-coding-workflow-system

Pinned commit: `813d3146561c974c1437fc4d116144dc800bc1ad`

The four `product-{manifest,doc}-v{1,2}.json` files are byte-for-byte copies of
`runtime/vnext/support/product-maintenance/schemas/` at the pinned commit.
They are the actual draft 2020-12 production schemas, validated with Ajv 2020;
TraceLens does not implement a reduced JSON Schema evaluator.

`../product-parser.ts` adapts the independent YAML/Markdown/digest algorithms in
`runtime/vnext/src/product-maintenance/parser.ts` and path grammar in `paths.ts`.
It does not import or execute the upstream Runtime or scripts in observed projects.
The MIT license accompanying these files applies to the copied/adapted material.
The parser permits the upstream JSON-compatible built-in YAML tags (`str`, `int`,
`float`, `bool`, `null`, `seq`, `map`) and rejects custom/non-JSON tags.

Intentional differences from the pinned offline reader:

- Root/envelope YAML errors reject the document; errors confined to an item,
  including duplicate keys and prohibited YAML features, degrade only that item
- YAML, schema and section failures in individual items are isolated;
  invalid items retain raw metadata and exact source locations for inspection
- Ajv implements the actual JSON Schemas rather than the upstream small evaluator
- Item identities are namespaced to a working copy and case-sensitive; line and
  metadata locations refer to the original file, including BOM/CRLF inputs

`tests/product-oracle/` contains the immutable offline comparison program and its
licenses. `examples/product-comprehensive`, `examples/product-e6`, and
`examples/product-planning` contain synthetic upstream inputs, never real project
records. Their provenance files describe the exact copied directories.

## 2026-10-10 handoff alignment

Reference: `docs/guides/tracelens-product-documents.md` from the upstream local
working tree at HEAD `334580494634cbd88c60b62bcdf50345e1b0abe5`.
Guide SHA-256: `15a900a29d41b854920f66427dc03b6f88360c7faafbe1b3a32744384f37b1e7`.
The guide and production v1/v2 schemas remain authoritative; no TraceLens-specific
document format was added.

The source working tree includes uncommitted path-coverage fixes. Therefore this
is a **working-tree snapshot**, not a claim that all files belong to that HEAD.
`../product-glob-coverage.ts` adapts the current
`runtime/vnext/src/product-maintenance/glob-coverage.ts` (original SHA-256
`7e39fd4760dee40264bf90d2389e04dbb8c708ef5e2086663b0deb94e8c4f442`).
It proves selected descendants are explicitly excluded before pruning implicit
blocked directories; otherwise IMPLICIT_PATH_EXCLUDED records an omitted range.
Current definitions overlapping capture_paths produce CURRENT_RAW_OVERLAP.

The current independent offline reader is pinned separately in
`tests/product-oracle/handoff-20261010/`, alongside the unchanged older oracle.
Both execute only against disposable test copies. TraceLens retains its own
disclosed byte budgets and snapshot/source-resolution layer; neither oracle
provides live task state or proves complete business inventory.

## 2026-10-14 v4/v5 Roadmap and contribution consumption

Source baseline: `dcf7b0af7a65c53bde7218eac3a3639921d59d31`.
`product-doc-v4.json` is the unchanged production schema, SHA-256:
`eca5e89455715bf25601c25d7599b75b743830ba1530d7e5a3027e283f582472`.
Fixed producer implementation: [1c56bf5fbde5003a7a9aca314ad04bb6794f1b6d](https://github.com/KongXiangning/vibe-coding-workflow-system/commit/1c56bf5fbde5003a7a9aca314ad04bb6794f1b6d) (source version 0.24.10).
`product-doc-v5.json` is the generated producer schema for BINDING-PROGRESS-v2, SHA-256:
`a3797f92ba11e1b678c78b77d82a37e8501bb26cf8794b038cdaecbe0a9f3561`.
It adds optional direct/supporting contribution only to v5 TaskBinding and inherits
v4 planning_baseline. Old schema bytes remain unchanged. The verified source commit
does not imply npm publication, deployment, or real project migration.

`../product-roadmap.ts` adapts the pinned production `roadmaps.ts` pure comparison
and `scoped.ts` graph rules. v4 and v5 are explicit known formats. Requirement/Goal
and arrangement hashes retain the producer algorithms. TraceLens resolves sources
only through its own bounded, same-snapshot reader; it never executes helpers from
observed projects. Coverage has separate registered selector attestation because
TraceLens coverage.paths lists files, whereas producer coverage.paths lists selected
patterns. Missing attestation, incomplete enumeration, and unavailable baseline
sources yield unknown; saved arrangements remain browseable. Business validity,
delivery and Task operations are never evaluated by Roadmap reconciliation.

The pinned test-only producer bundle in `tests/product-oracle/roadmap-v5/` supplies
independent differential tests for all selectors, four statuses, membership,
context, arrangements, working copies, sources and exact-version exceptions.
All copied/adapted code remains under the accompanying MIT license.

## 2026-10-15 v6 local evidence dispositions

Producer working-tree baseline: `26af10ef0d9224c44d906ccbf4d362412b28e067` in
`vibe-coding-workflow-system`, including the local v6 implementation. This is a
working-tree handoff, not a published release or a claim that the baseline commit
contains these changes. The unchanged generated `product-doc-v6.json` has SHA-256
`15b0c464781db1823c34a2ac93c8f49ca215dd318008af771b09d9e2a4c2a787`.
v1–v5 schema files remain unchanged.

`shared/evidence-dispositions.ts` adapts producer `dispositions.ts`:
`vnext-assessment-disposition/v1` fingerprints the report independently of appended
positive evidence. Reuse requires exact local scope, subject, definition and report
context, preservation of the original report sources, and same-version accessible
judgment sources. Other requirement scope declarations do not reopen this scope;
goal self-assessments retain the whole goal definition. Deferred/conflicting
judgments and new evidence remain pending. Original definition, historical basis
and report-conflict checks remain independent. TraceLens only consumes snapshot
bytes and never runs a helper or business code from an observed project.

The producer's `scripts/check-evidence-dispositions-consumers.ts <TraceLens-root>`
compares source, bundled Node helper and this consumer on 22 synthetic cases,
including unchanged reads, positive evidence additions, unrelated and own scope
changes, new counterevidence, changed/missing source bytes, preserved evidence,
deferred/conflicting judgments and legacy v5. Original report bytes remain unchanged
by all reads. Local validation also covers the snapshot/overview transport and
browser grouping at desktop and mobile widths; this is not real-project delivery
assessment or deployment evidence.
