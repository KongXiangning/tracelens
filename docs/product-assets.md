# PRODUCT 固定来源资产

来源：[KongXiangning/vibe-coding-workflow-system](https://github.com/KongXiangning/vibe-coding-workflow-system/tree/813d3146561c974c1437fc4d116144dc800bc1ad)，提交 `813d3146561c974c1437fc4d116144dc800bc1ad`。

- `src/server/product-schemas/`：生产 `product-{manifest,doc}-v{1,2}.json`，原始字节复制，无本地更改。随附上游 MIT LICENSE。
- `tests/vendor/product/offline-reader.mjs`：上游 `runtime/vnext/support/product-maintenance/offline-reader.js` 原字节，仅改扩展名供 Node 隔离对照使用。随附上游 MIT LICENSE；`THIRD-PARTY-NOTICES.txt` 按 bundle 中保留的依赖路径，附对应本地锁定包的原许可文字并注明采集版本。生产服务不导入或执行该文件。
- `examples/product-comprehensive/`：上游 `docs/product/project-maintenance/examples/tracelens/`，含隐藏入口、历史、TXT 原文和 `.gitattributes`。
- `examples/product-e6/`、`examples/product-planning/`：上游 `runtime/vnext/support/product-maintenance/examples/` 中相应目录，原字节复制。样例全为合成资料，不是实际任务或交付记录。许可见 `examples/PRODUCT-LICENSE`。
- `docs/product-document-contract.md`：固定版本的上游文档契约；读取行为以此与生产 Schema 为依据。
- `docs/product-visibility-plan.md`：用户提供的实施方案留档，产品长期边界仍在 requirements 与 architecture 维护。

本轮不复制 Runtime 执行链、安装工作流或联网更新协议。测试变体只在临时副本中修改；上游样例本身保持固定。
