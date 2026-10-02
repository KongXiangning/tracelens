# 本地资料索引设计

## 目录布局

索引来源只包括配置中明确列出的 Markdown。

## 恢复策略

单文件失败保留错误；整体失败保留旧快照，标明时间。

新快照发布后，已删除文档应从当前结果移除。

## 安全内容示例

原始 HTML 不执行，图片不自动加载。

<script>window.tracelensInjected = true</script>

[危险协议示例](javascript:alert%281%29)

![远程图片示例](https://example.invalid/tracelens-probe.png)
