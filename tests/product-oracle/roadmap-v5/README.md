# Pinned v4/v5 Roadmap test oracle

Source: https://github.com/KongXiangning/vibe-coding-workflow-system

Baseline commit: dcf7b0af7a65c53bde7218eac3a3639921d59d31.
Fixed producer implementation: [1c56bf5fbde5003a7a9aca314ad04bb6794f1b6d](https://github.com/KongXiangning/vibe-coding-workflow-system/commit/1c56bf5fbde5003a7a9aca314ad04bb6794f1b6d), source version 0.24.10.
This pins the generated BINDING-PROGRESS-v2 artifact, not an npm publication claim.
`offline-reader.mjs` is copied byte-for-byte from
`runtime/vnext/support/product-maintenance/offline-reader.js`, renamed only for ESM.
SHA-256: 4fd4f5538f19dcc1417dbd9f6940f1ebe86b8df9172a36a276769104d42f69c2.

The oracle includes production v5 schemas and the production read-only Roadmap
comparison, whose only v5 semantic change is explicit [4,5] format support.
Tests run it only against disposable synthetic directories and compare all result
fields except consumer-specific planKey and diagnostic representations. They
verify every fixture file is unchanged afterward. Production TraceLens never
imports or executes this oracle or any observed project helper.

The parent ../LICENSE and ../THIRD_PARTY_NOTICES.txt preserve the upstream MIT
license and bundled dependency notices. Runtime task operations remain separate.
