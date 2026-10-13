import { useState, type ReactNode } from "react";

/** Closed sections do not construct or retain their potentially large subtrees. */
export function LazyDetails({
  summary,
  children,
  className,
  label,
}: {
  summary: ReactNode;
  children: () => ReactNode;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={className}
      aria-label={label}
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>{summary}</summary>
      {open && children()}
    </details>
  );
}

export function PagedItems<T>({
  items,
  children,
  pageSize = 40,
}: {
  items: T[];
  children: (items: T[]) => ReactNode;
  pageSize?: number;
}) {
  const [requestedPage, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage, pages - 1);
  return (
    <>
      {children(items.slice(page * pageSize, (page + 1) * pageSize))}
      {pages > 1 && (
        <nav className="record-pagination" aria-label="记录分页">
          <button
            className="secondary"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </button>
          <span>
            第 {page + 1} / {pages} 页 · 共 {items.length} 项
          </span>
          <button
            className="secondary"
            disabled={page + 1 === pages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </nav>
      )}
    </>
  );
}
