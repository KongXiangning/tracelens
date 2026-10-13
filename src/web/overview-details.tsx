import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Snapshot } from "../shared/types";

/** Mounted only after expansion; discard late responses from a previous snapshot. */
export function OverviewDetails({
  snapshotId,
  load,
  children,
}: {
  snapshotId: string;
  load: () => Promise<Snapshot>;
  children: (snapshot: Snapshot) => ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let cancelled = false;
    setSnapshot(undefined);
    setError("");
    void loader
      .current()
      .then((next) => {
        if (!cancelled) {
          if (next.id !== snapshotId)
            setError("快照已更新，请刷新当前视图后重试");
          else setSnapshot(next);
        }
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [snapshotId, retry]);
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <button
          className="secondary"
          onClick={() => setRetry((value) => value + 1)}
        >
          重试读取
        </button>
      </div>
    );
  if (!snapshot || snapshot.id !== snapshotId)
    return <p role="status">正在读取详细记录…</p>;
  return children(snapshot);
}
