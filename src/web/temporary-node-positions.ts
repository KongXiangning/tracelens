import { useCallback, useEffect, useState } from "react";
import type { Node, NodeChange, XYPosition } from "@xyflow/react";

// Keep layout adjustments in this mounted graph only, separate from source data.
export function useTemporaryNodePositions(nodes: Node[], graphKey: string) {
  const [layout, setLayout] = useState<{
    key: string;
    positions: Map<string, XYPosition>;
  }>({ key: graphKey, positions: new Map() });
  useEffect(() => {
    setLayout((previous) =>
      previous.key === graphKey
        ? previous
        : { key: graphKey, positions: new Map() },
    );
  }, [graphKey]);
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moved = changes.filter(
        (change) => change.type === "position" && change.position,
      );
      if (!moved.length) return;
      setLayout((previous) => {
        const positions = new Map(
          previous.key === graphKey ? previous.positions : [],
        );
        for (const change of moved) {
          if (change.type === "position" && change.position)
            positions.set(change.id, change.position);
        }
        return { key: graphKey, positions };
      });
    },
    [graphKey],
  );
  return {
    nodes: nodes.map((node) => {
      const position =
        layout.key === graphKey ? layout.positions.get(node.id) : undefined;
      return position ? { ...node, position } : node;
    }),
    onNodesChange,
  };
}
