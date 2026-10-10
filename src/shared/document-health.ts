import type { ProductPreview, ProductSnapshot } from "./product-types.js";
import type { NavigationReport } from "./types.js";
import { productStructureIssue } from "./product-health.js";

export type ProductReadState = ProductPreview | ProductSnapshot;
export interface DocumentIssue {
  path?: string;
  message: string;
}

export function documentIssues(
  report: NavigationReport,
  product?: ProductReadState,
): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const productPath =
    product && ("path" in product ? product.path : product.manifestPath);
  if (product?.status === "missing")
    issues.push({
      path: productPath,
      message: "未找到标准产品入口，目标、需求和总体计划暂无法展示。",
    });
  else if (product?.status === "disabled")
    issues.push({
      message:
        "当前使用自定义读取配置，标准产品读取已关闭。可在项目设置中恢复 vNext 自动读取。",
    });
  else if (product && ["unsupported", "unavailable"].includes(product.status))
    issues.push({
      path: productPath,
      message: "标准产品入口无法读取，需要 vNext 核对格式、版本或文件可读性。",
    });
  else if (product?.status === "excluded")
    issues.push({
      path: productPath,
      message: "标准产品入口被读取规则排除，需要核对项目设置中的排除规则。",
    });
  else if (product?.status === "empty")
    issues.push({
      path: productPath,
      message:
        "标准产品入口已读取，但尚未登记产品条目；请与 vNext 确认需要整理的内容。",
    });

  for (const entry of report.entries) {
    if (entry.availability === "missing" || entry.availability === "error")
      issues.push({
        path: entry.path,
        message:
          entry.availability === "missing"
            ? `${entry.classification === "declared" || entry.classification === "manual" ? "vNext 已登记此文档" : "已有文档引用此文件"}，但文件缺失。请在项目中确认是需要补齐还是更新引用。`
            : "vNext 已登记此文档，但本次无法读取。请核对文件可读性。",
      });
  }
  if (product && "coverage" in product) {
    for (const omitted of product.coverage.omitted) {
      if (!issues.some((issue) => issue.path === omitted.path))
        issues.push({
          path: omitted.path,
          message: `标准产品登记范围未读到：${omitted.reason}`,
        });
    }
    for (const diagnostic of product.diagnostics) {
      if (
        !productStructureIssue(diagnostic) ||
        issues.some((issue) => issue.path === diagnostic.path)
      )
        continue;
      issues.push({ path: diagnostic.path, message: diagnostic.message });
    }
  }
  for (const gap of report.gaps) {
    if (gap === "已登记的文档中存在缺失或不可读项") continue;
    const kind = (
      [
        ["需求文档", "requirement"],
        ["设计文档", "design"],
        ["规划文档", "plan"],
      ] as const
    ).find(([label]) => gap.includes(label))?.[1];
    if (
      kind &&
      product &&
      "items" in product &&
      product.items.some((i) => i.usable && i.type === kind)
    )
      continue;
    issues.push({
      message: gap
        .replace("请核对登记来源", "请由 vNext 核对登记用途")
        .replace("请查看导航与读取提示", "已读内容仍可浏览，详情见读取诊断"),
    });
  }
  return issues;
}
