import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Braces, FileText, Network } from "lucide-react";
import type { Root, Element } from "hast";
import { kindLabels, type Document, type Snapshot } from "../shared/types";
import type { OpenSource } from "./components";
import { documentSource } from "./pages";

function annotate() {
  return (tree: Root) => {
    function walk(node: Root | Element) {
      if (node.type === "element" && node.position)
        node.properties["data-line"] = node.position.start.line;
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
  const [raw, setRaw] = useState(/\.(ya?ml|json)$/i.test(document.path));
  const content = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState(line);
  useEffect(() => {
    setRaw(/\.(ya?ml|json)$/i.test(document.path));
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
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[annotate]}
              skipHtml
              urlTransform={(url) =>
                /^(?:https?:|mailto:)/i.test(url) ||
                !/^[a-z][a-z\d+.-]*:/i.test(url)
                  ? url
                  : ""
              }
              components={{
                a: ({ node, href, children }) => {
                  const reference = snapshot.relations.find(
                    (r) =>
                      r.source.documentId === document.id &&
                      r.method === "markdown" &&
                      r.raw === href &&
                      r.source.line === node?.position?.start.line,
                  );
                  const targetSource =
                    reference?.to &&
                    documentSource(
                      snapshot,
                      reference.to,
                      reference.targetLine || 1,
                    );
                  if (targetSource)
                    return (
                      <button
                        className="inline-link"
                        title={
                          reference?.section || reference?.targetPath || ""
                        }
                        onClick={() => open(targetSource)}
                      >
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
                      title={
                        reference?.state === "unsafe"
                          ? "不安全链接"
                          : "目标未纳入扫描或不可用"
                      }
                    >
                      {children}
                      <small> [未定位]</small>
                    </span>
                  );
                },
                img: ({ alt }) => (
                  <span className="image-placeholder">
                    [图片：{alt || "未加载"}]
                  </span>
                ),
              }}
            >
              {document.raw}
            </Markdown>
          )}
        </div>
      </div>
    </article>
  );
}
