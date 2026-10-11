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
