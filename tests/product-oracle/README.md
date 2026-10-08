# Pinned PRODUCT test oracle

Source: https://github.com/KongXiangning/vibe-coding-workflow-system

Commit: `813d3146561c974c1437fc4d116144dc800bc1ad`

`offline-reader.mjs` is an unchanged copy of
`runtime/vnext/support/product-maintenance/offline-reader.js`, renamed only to
make its ESM interpretation independent of a caller's package settings.
SHA-256: `bdcf6e071e67f60aa9707057b3fd3fd6f21a8c6785bb94944fc5b95aa0c6d8f6`.

It is executed only in tests against isolated synthetic fixture directories.
The production application never imports this bundle or shells out to it.
It does not run scripts in observed projects. `LICENSE` is the upstream MIT
license; `THIRD_PARTY_NOTICES.txt` preserves licenses for its bundled dependencies.

Differential tests compare metadata, complete Markdown bodies, line numbers,
requirement definition hashes, relations, and plan/work order. They also compare
safe item-level degradation. Damaged YAML has an intentional stricter result in
TraceLens: the entire frontmatter is rejected instead of salvaging its decoded
members. See `src/server/product-assets/PROVENANCE.md`.
