import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { api } from "./api";
import type { CodexProjects, DirectoryListing } from "../shared/types";

export function ProjectPicker({
  disabled,
  choose,
}: {
  disabled: boolean;
  choose: (root: string, name?: string) => void;
}) {
  const [mode, setMode] = useState<"codex" | "directory">("codex");
  const [codex, setCodex] = useState<CodexProjects | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  async function loadCodex() {
    setLoading(true);
    setError("");
    try {
      setCodex(await api<CodexProjects>("/project-sources/codex", {}, "POST"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  async function browse(target?: string) {
    setLoading(true);
    setError("");
    try {
      const result = await api<DirectoryListing>(
        "/project-sources/directories",
        target ? { path: target } : {},
        "POST",
      );
      setListing(result);
      setAddress(result.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadCodex();
  }, []);
  const locked = disabled || loading;
  const filtered =
    codex?.projects.filter((p) =>
      `${p.name} ${p.root}`.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  return (
    <section className="project-picker" aria-label="项目路径选择">
      <div className="picker-heading">
        <div className="segmented" role="tablist" aria-label="添加方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "codex"}
            className={mode === "codex" ? "active" : ""}
            disabled={locked}
            onClick={() => setMode("codex")}
          >
            Codex 项目
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "directory"}
            className={mode === "directory" ? "active" : ""}
            disabled={locked}
            onClick={() => {
              setMode("directory");
              if (!listing) void browse();
            }}
          >
            <FolderOpen size={15} />
            浏览目录
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          title="重新读取"
          aria-label="重新读取"
          disabled={locked}
          onClick={() =>
            mode === "codex" ? void loadCodex() : void browse(listing?.current)
          }
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {mode === "codex" ? (
        <div role="tabpanel" aria-label="Codex 项目">
          <input
            aria-label="搜索 Codex 项目"
            placeholder="搜索项目名称或路径"
            value={query}
            disabled={locked}
            onChange={(e) => setQuery(e.target.value)}
          />
          {codex?.notice && <p className="muted">{codex.notice}</p>}
          <div className="picker-list">
            {filtered.map((p) => (
              <button
                type="button"
                className="picker-row"
                key={p.root}
                disabled={locked || Boolean(p.reason)}
                title={p.reason || p.root}
                onClick={() => choose(p.root, p.name)}
              >
                <Folder size={18} />
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.root}</small>
                  {p.reason && (
                    <small className="warning-text">{p.reason}</small>
                  )}
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {codex && !codex.notice && !filtered.length && (
              <p className="muted">没有匹配的项目</p>
            )}
          </div>
        </div>
      ) : (
        <div role="tabpanel" aria-label="服务机器目录">
          <div className="directory-address">
            <button
              type="button"
              className="icon-button"
              aria-label="上级目录"
              title="上级目录"
              disabled={locked || !listing?.parent}
              onClick={() => void browse(listing!.parent!)}
            >
              <ArrowUp size={17} />
            </button>
            <input
              aria-label="服务机器目录路径"
              placeholder="本地绝对路径"
              value={address}
              disabled={locked}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!locked && address.trim()) void browse(address.trim());
                }
              }}
            />
            <button
              type="button"
              className="icon-button"
              title="前往目录"
              aria-label="前往目录"
              disabled={locked || !address.trim()}
              onClick={() => void browse(address.trim())}
            >
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="directory-shortcuts">
            {listing?.shortcuts.map((s) => (
              <button
                type="button"
                key={s.path}
                disabled={locked}
                onClick={() => void browse(s.path)}
              >
                <Folder size={14} />
                {s.name}
              </button>
            ))}
          </div>
          <p className="directory-current" title={listing?.current}>
            {listing?.current}
          </p>
          <div className="picker-list">
            {listing?.directories.map((d) => (
              <button
                type="button"
                className="picker-row directory-row"
                key={d.path}
                disabled={locked}
                onClick={() => void browse(d.path)}
              >
                <Folder size={17} />
                <span>{d.name}</span>
                <ChevronRight size={15} />
              </button>
            ))}
            {listing && !listing.directories.length && (
              <p className="muted">没有子目录</p>
            )}
          </div>
          {listing?.truncated && (
            <p className="warning-text">
              目录项过多，当前列表不完整；可通过路径直接前往。
            </p>
          )}
          {listing?.reason && <p className="warning-text">{listing.reason}</p>}
          <button
            type="button"
            className="secondary"
            disabled={locked || !listing?.selectable}
            onClick={() => choose(listing!.current)}
          >
            <FolderOpen size={16} />
            选择当前目录
          </button>
        </div>
      )}
      {loading && (
        <p className="picker-loading" role="status">
          <LoaderCircle size={16} className="spin" />
          {mode === "codex"
            ? "正在读取 Codex 项目登记"
            : "正在读取服务机器目录"}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
