import type { Snapshot, SnapshotView } from "../shared/types";
import {
  isOverviewSnapshot,
  type OverviewSnapshot,
} from "../shared/overview-data";

export type ViewSnapshot = Snapshot | OverviewSnapshot;
export type ProjectView = SnapshotView<ViewSnapshot>;

/** Preserve object identity when a status response reports no actual change. */
export function mergeProjectView(
  previous: ProjectView | undefined,
  incoming: ProjectView,
): ProjectView {
  let snapshot =
    incoming.unchanged && !incoming.snapshot
      ? previous?.snapshot || null
      : incoming.snapshot;
  const old = previous?.snapshot;
  if (snapshot && old) {
    if (
      isOverviewSnapshot(snapshot) &&
      isOverviewSnapshot(old) &&
      snapshot.revision === old.revision
    ) {
      snapshot = { ...snapshot, overview: old.overview };
      if (
        snapshot.id === old.id &&
        snapshot.configVersion === old.configVersion &&
        snapshot.completedAt === old.completedAt &&
        snapshot.phase === old.phase &&
        snapshot.outcome === old.outcome
      )
        snapshot = old;
    } else if (
      !isOverviewSnapshot(snapshot) &&
      !isOverviewSnapshot(old) &&
      snapshot.id === old.id
    )
      snapshot = old;
  }
  const sameAttempt =
    JSON.stringify(previous?.attempt || null) ===
    JSON.stringify(incoming.attempt || null);
  if (
    previous &&
    snapshot === old &&
    sameAttempt &&
    previous.configChanged === incoming.configChanged &&
    Boolean(previous.restored) === Boolean(incoming.restored)
  )
    return previous;
  return {
    snapshot,
    attempt: sameAttempt ? previous?.attempt || null : incoming.attempt,
    configChanged: incoming.configChanged,
    restored: incoming.restored,
  };
}
