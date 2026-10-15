import type {
  ProductItem,
  ProductSource,
  ProductSourceCheck,
} from "./product-types.js";
import type { SourceRef } from "./types.js";

export interface AssessmentReviewIssue {
  code: string;
  title: string;
  detail: string;
  action: string;
  comparisons?: { label: string; recorded: string; current: string }[];
  sources?: {
    label: string;
    reference?: ProductSource;
    source?: SourceRef;
    status?: string;
  }[];
}

export function reviewValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "未记录";
  return typeof value === "string" ? value : JSON.stringify(value) || "无效值";
}

/** Do not send malformed raw metadata to source renderers. */
export function reviewReference(value: unknown): ProductSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as ProductSource;
  if (source.kind === "file" && typeof source.path === "string")
    return {
      kind: "file",
      path: source.path,
      item_id: typeof source.item_id === "string" ? source.item_id : undefined,
      section: typeof source.section === "string" ? source.section : undefined,
      lines:
        source.lines &&
        typeof source.lines.start === "number" &&
        typeof source.lines.end === "number"
          ? source.lines
          : undefined,
      sha256: typeof source.sha256 === "string" ? source.sha256 : undefined,
      note: typeof source.note === "string" ? source.note : undefined,
    };
  if (source.kind === "uri" && typeof source.uri === "string")
    return {
      kind: "uri",
      uri: source.uri,
      note: typeof source.note === "string" ? source.note : undefined,
    };
  if (
    source.kind === "text" &&
    typeof source.text === "string" &&
    typeof source.label === "string"
  )
    return source;
  return undefined;
}

export function reportReviewSources(reports: ProductItem[]) {
  return reports.map((report) => ({
    label: `${report.type === "assessment" ? "验收报告" : "关联条目"} ${report.id}`,
    source: report.source,
  }));
}

const readLabels: Record<ProductSourceCheck["readState"], string> = {
  read: "已读取",
  "not-read": "未读取",
  excluded: "被扫描规则排除",
  unavailable: "无法读取",
  outside: "不在允许读取范围内",
  unsupported: "格式不受支持",
  external: "外部链接未读取",
  text: "文字依据无法校验文件",
};
const locationLabels: Record<ProductSourceCheck["locationState"], string> = {
  located: "已定位条目",
  unlocated: "未定位到条目",
  ambiguous: "定位到多个条目",
  "not-applicable": "无法定位文件条目",
};
export function reviewSourceStatus(check?: ProductSourceCheck): string {
  return check
    ? `${readLabels[check.readState]}；${locationLabels[check.locationState]}${check.detail ? `；${check.detail}` : ""}`
    : "尚无来源核验记录";
}

/** Explain the exact predicates used by selectAssessment, without selecting again. */
export function definitionReviewIssues(input: {
  prefix: "target" | "goal";
  definition: ProductItem;
  algorithm: unknown;
  digest: unknown;
  basis: ProductSource | undefined;
  checked?: ProductSourceCheck;
  algorithmChanged: boolean;
  definitionChanged: boolean;
  unverified: boolean;
}): AssessmentReviewIssue[] {
  const {
    prefix,
    definition,
    algorithm,
    digest,
    basis,
    checked,
    algorithmChanged,
    definitionChanged,
    unverified,
  } = input;
  const label = definition.type === "requirement" ? "需求" : "目标";
  const sources = [
    {
      label: `报告记录的${label}依据`,
      reference: reviewReference(basis),
      source: checked?.source || undefined,
      status: reviewSourceStatus(checked),
    },
    { label: `当前${label} ${definition.id}`, source: definition.source },
  ];
  const issues: AssessmentReviewIssue[] = [];
  const add = (
    code: string,
    title: string,
    detail: string,
    action: string,
    comparisons?: AssessmentReviewIssue["comparisons"],
  ) =>
    issues.push({
      code: `${prefix}-${code}`,
      title,
      detail,
      action,
      comparisons,
      sources,
    });
  const compare = (label: string, recorded: unknown, current: unknown) => [
    { label, recorded: reviewValue(recorded), current: reviewValue(current) },
  ];
  if (algorithmChanged)
    add(
      "definition-algorithm-changed",
      `${label}定义算法变化`,
      "报告与当前条目使用的定义摘要算法不同，不能直接据此认定正文变化。",
      "使用当前定义算法重新核验报告依据与条目，再确认原报告是否仍适用。",
      compare("定义摘要算法", algorithm, definition.definitionAlgorithm),
    );
  if (definitionChanged) {
    const comparable =
      typeof digest === "string" &&
      /^[a-f0-9]{64}$/i.test(digest) &&
      typeof definition.definitionSha256 === "string" &&
      /^[a-f0-9]{64}$/i.test(definition.definitionSha256);
    add(
      "definition-changed",
      comparable ? `${label}定义变化` : `${label}定义摘要无法确认`,
      comparable
        ? `在相同定义算法下，报告记录的${label}定义摘要与当前条目不同。此比较针对条目定义，不是整份文件。`
        : `报告记录的${label}定义摘要与当前值不一致，且至少一方缺少有效摘要，尚不能据此确认具体定义变化。`,
      `比较报告依据中的 ${definition.id} 与当前条目的定义内容，确认哪些要求影响验收。核验原报告适用性或重新验收后，再更新报告及定义摘要，不能只刷新摘要。`,
      compare(`${label}定义 SHA-256`, digest, definition.definitionSha256),
    );
  }
  if (!unverified) return issues;
  if (!digest)
    add(
      "definition-digest-missing",
      `${label}定义摘要缺失`,
      `报告未记录用于核验 ${definition.id} 的定义摘要。`,
      `补充经核验的${label}定义摘要，并确认对应的来源依据。`,
    );
  if (!basis || basis.kind !== "file")
    add(
      "basis-missing",
      `${label}文件依据缺失`,
      basis ? "报告依据不是可核验的文件引用。" : "报告未提供定义来源文件引用。",
      `为报告补充指向 ${definition.id} 的文件依据及条目定位。`,
    );
  else if (basis.item_id !== definition.id)
    add(
      "basis-item-mismatch",
      `${label}依据条目不匹配`,
      `报告的文件依据没有指向当前${label}条目。`,
      `核对来源引用并使 item_id 正确指向 ${definition.id}。`,
      compare("依据条目 ID", basis.item_id, definition.id),
    );
  if (algorithm !== definition.definitionAlgorithm && !algorithmChanged)
    add(
      "definition-algorithm-unverified",
      `${label}定义算法无法匹配`,
      "报告没有记录可与当前条目匹配的定义摘要算法。",
      "核对并补充正确的定义摘要算法，再重新计算、验证定义摘要。",
      compare("定义摘要算法", algorithm, definition.definitionAlgorithm),
    );
  if (!checked || checked.readState !== "read")
    add(
      "basis-not-read",
      `${label}来源${checked ? readLabels[checked.readState] : "尚未校验"}`,
      checked?.detail || "当前没有成功读取此报告依据的核验记录。",
      "确认来源路径、读取范围和文件可用性，成功读取后重新核验引用条目及摘要。",
    );
  else if (checked.locationState !== "located")
    add(
      "basis-not-located",
      `${label}来源${locationLabels[checked.locationState]}`,
      checked.detail || "文件已读取，但引用条目无法唯一定位。",
      `核对来源文件中的 ${definition.id}、章节或行号，使依据能唯一定位到正确条目。`,
    );
  else {
    if (checked.definitionAlgorithm !== algorithm)
      add(
        "basis-algorithm-mismatch",
        `${label}来源定义算法不匹配`,
        "已定位的来源条目，其定义摘要算法与报告记录不同。",
        "核对报告引用的来源版本与算法，重新生成可验证的依据。",
        compare("来源条目的定义算法", algorithm, checked.definitionAlgorithm),
      );
    if (checked.definitionSha256 !== digest)
      add(
        "basis-definition-mismatch",
        `${label}来源定义摘要不匹配`,
        "已定位的来源条目，其定义摘要不能验证报告记录的原始定义。",
        "比较此来源条目与报告原始依据，确认是否引用了其他版本，再核对验收结论。",
        compare("来源条目的定义 SHA-256", digest, checked.definitionSha256),
      );
  }
  if (checked?.byteState === "changed") {
    const sameDefinition =
      digest &&
      digest === definition.definitionSha256 &&
      algorithm === definition.definitionAlgorithm;
    add(
      "source-file-changed",
      `来源文件变化（${label}依据）`,
      `报告引用的整份文件摘要与当前读取结果不同。${sameDefinition ? `当前${label}条目的定义摘要仍与报告一致，文件变化可能来自其他内容。` : `文件变化本身不能证明${label}定义发生变化。`}`,
      `比较来源文件的原版本与当前版本，检查改动是否影响 ${definition.id} 及本次验收。核验原报告适用性或重新验收后，再更新依据，不能只刷新摘要。`,
      compare(
        "整份来源文件 SHA-256",
        basis?.kind === "file" ? basis.sha256 : undefined,
        checked.source?.digest,
      ),
    );
  }
  return issues;
}
