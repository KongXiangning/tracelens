import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Braces, FileText, Network } from "lucide-react";
import type { Root, Element } from "hast";
import type { Definition, Root as MarkdownRoot } from "mdast";
import { visit } from "unist-util-visit";
import { kindLabels, type Document, type Snapshot } from "../shared/types";
import type { OpenSource } from "./components";
import { documentSource } from "./pages";

type LineRange = { start: number; end: number };
function selectLines(options: { range?: LineRange }) {
  return (tree: MarkdownRoot) => {
    if (!options.range) return;
    const { start, end } = options.range;
    // Parse the complete captured document first: reference syntax can depend on
    // definitions outside the item. Keep their original first-definition order;
    // definition nodes are invisible and do not change any source positions.
    const definitions: Definition[] = [];
    visit(tree, "definition", (node) => {
      definitions.push(node);
    });
    tree.children = [
      ...definitions,
      ...tree.children.filter(
        (node) =>
          node.type !== "definition" &&
          node.position &&
          node.position.start.line >= start &&
          node.position.end.line <= end,
      ),
    ];
  };
}

function annotate(options: { lineOffset?: number } = {}) {
  return (tree: Root) => {
    function walk(node: Root | Element) {
      if (node.type === "element" && node.position)
        node.properties["data-line"] =
          node.position.start.line + (options.lineOffset || 0);
      for (const child of node.children)
        if (child.type === "element") walk(child);
    }
    walk(tree);
  };
}
export function DocumentReader({
  document,
  snapshot,
  line,
  open,
  relations,
}: {
  document: Document;
  snapshot: Snapshot;
  line: number;
  open: OpenSource;
  relations: () => void;
}) {
  const [raw, setRaw] = useState(/\.(ya?ml|json|txt)$/i.test(document.path));
  const content = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState(line);
  useEffect(() => {
    setRaw(/\.(ya?ml|json|txt)$/i.test(document.path));
    setTarget(line);
  }, [document.id]);
  useEffect(() => {
    setTarget(line);
  }, [line, snapshot.id]);
  useEffect(() => {
    const elements = [
      ...(content.current?.querySelectorAll<HTMLElement>("[data-line]") || []),
    ];
    elements.forEach((e) => e.classList.remove("source-highlight"));
    const element =
      elements.find((e) => Number(e.dataset.line) === target) ||
      elements.filter((e) => Number(e.dataset.line) <= target).at(-1);
    if (element && target > 1) {
      element.classList.add("source-highlight");
      element.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [target, raw, document.id, snapshot.id]);
  function goLine(next: number) {
    setTarget(next);
  }
  return (
    <article className="document-reader">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">{kindLabels[document.kind]}文档</span>
          <h2>{document.title}</h2>
          <code>{document.path}</code>
        </div>
        <button className="secondary" onClick={relations}>
          <Network size={16} />
          关联
        </button>
      </div>
      <div className="reader-toolbar">
        <div className="segmented">
          <button
            className={!raw ? "active" : ""}
            onClick={() => setRaw(false)}
          >
            <FileText size={14} />
            阅读
          </button>
          <button className={raw ? "active" : ""} onClick={() => setRaw(true)}>
            <Braces size={14} />
            原文
          </button>
        </div>
        <span>
          来源行 {target} · SHA-256 {document.digest.slice(0, 10)}
        </span>
      </div>
      {!document.recognized && (
        <div className="banner reader-note">
          未识别文档结构，保留扫描时原文。
        </div>
      )}
      <div className="reader-layout">
        <aside className="toc">
          <h4>目录</h4>
          {document.headings.map((heading) => (
            <button
              key={heading.line}
              style={{
                paddingLeft: `${Math.min(heading.depth - 1, 3) * 10 + 8}px`,
              }}
              onClick={() => goLine(heading.line)}
              title={heading.title}
            >
              {heading.title}
            </button>
          ))}
          {!document.headings.length && <p className="muted">无章节标题</p>}
        </aside>
        <div ref={content} className={raw ? "raw-document" : "markdown"}>
          {raw ? (
            document.raw.split("\n").map((text, i) => (
              <div data-line={i + 1} key={i}>
                <span className="line-number">{i + 1}</span>
                <code>{text || " "}</code>
              </div>
            ))
          ) : (
            <SnapshotMarkdown
              text={document.raw}
              documentId={document.id}
              path={document.path}
              snapshot={snapshot}
              open={open}
            />
          )}
        </div>
      </div>
    </article>
  );
}

/** Render only captured text. Local links never cause disk reads or a scan. */
export function SnapshotMarkdown({
  text,
  documentId,
  path,
  snapshot,
  open,
  startLine = 1,
  lineRange,
}: {
  text: string;
  documentId: string;
  path: string;
  snapshot: Snapshot;
  open: OpenSource;
  startLine?: number;
  lineRange?: LineRange;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, [selectLines, { range: lineRange }]]}
      rehypePlugins={[[annotate, { lineOffset: startLine - 1 }]]}
      skipHtml
      urlTransform={(url) =>
        /^(?:https?:|mailto:)/i.test(url) || !/^[a-z][a-z\d+.-]*:/i.test(url)
          ? url
          : ""
      }
      components={{
        a: ({ node, href, children }) => {
          const reference = snapshot.relations.find(
            (relation) =>
              relation.source.documentId === documentId &&
              relation.method === "markdown" &&
              relation.raw === href &&
              relation.source.line ===
                (node?.position?.start.line || 1) + startLine - 1,
          );
          let source = reference?.to
            ? documentSource(snapshot, reference.to, reference.targetLine || 1)
            : null;
          if (!source && href && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) {
            try {
              const [rawPath, rawFragment] = href.split("#");
              const relative = decodeURIComponent(rawPath).replace(/\\/g, "/");
              const segments: string[] = [];
              let safe = !relative.startsWith("/");
              for (const segment of (relative
                ? `${path.split("/").slice(0, -1).join("/")}/${relative}`
                : path
              ).split("/")) {
                if (!segment || segment === ".") continue;
                if (segment === "..") {
                  if (!segments.length) safe = false;
                  else segments.pop();
                } else segments.push(segment);
              }
              const target = safe
                ? snapshot.documents.find(
                    (document) => document.path === segments.join("/"),
                  )
                : null;
              const fragment = rawFragment
                ? decodeURIComponent(rawFragment)
                : "";
              const headings =
                target?.headings.filter(
                  (heading) =>
                    heading.anchor === fragment || heading.title === fragment,
                ) || [];
              if (target && (!fragment || headings.length === 1))
                source = documentSource(
                  snapshot,
                  target.id,
                  headings[0]?.line || 1,
                );
            } catch {
              /* Malformed URI stays visibly unresolved. */
            }
          }
          if (source)
            return (
              <button className="inline-link" onClick={() => open(source!)}>
                {children}
              </button>
            );
          if (href && /^(https?:|mailto:)/i.test(href))
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          return (
            <span
              className="unresolved-link"
              title="目标未收录到当前快照，或无法安全定位"
            >
              {children}
              <small> [未定位]</small>
            </span>
          );
        },
        img: ({ alt }) => (
          <span className="image-placeholder">[图片：{alt || "未加载"}]</span>
        ),
      }}
    >
      {text}
    </Markdown>
  );
}
