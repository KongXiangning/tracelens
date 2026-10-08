# PRODUCT contract assets

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

- Any frontmatter syntax error or prohibited YAML feature rejects the entire
  frontmatter; TraceLens does not salvage values from a damaged YAML document
- Schema and section failures in safely parsed individual items are isolated;
  invalid items retain raw metadata and exact source locations for inspection
- Ajv implements the actual JSON Schemas rather than the upstream small evaluator
- Item identities are namespaced to a working copy and case-sensitive; line and
  metadata locations refer to the original file, including BOM/CRLF inputs

`tests/product-oracle/` contains the immutable offline comparison program and its
licenses. `examples/product-comprehensive`, `examples/product-e6`, and
`examples/product-planning` contain synthetic upstream inputs, never real project
records. Their provenance files describe the exact copied directories.
