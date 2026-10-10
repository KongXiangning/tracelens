// Adapted from vNext product-maintenance/glob-coverage.ts, MIT licensed.
// See product-assets/PROVENANCE.md for the source snapshot and digest.
type Edge = { to: number; kind: "literal" | "segment" | "any"; char?: string };
type State = { epsilon: number[]; edges: Edge[]; accepting: boolean };
type Matcher = {
  start: number[];
  advance: (active: number[], char: string) => number[];
  accepts: (active: number[]) => boolean;
};

function matchesEdge(edge: Edge, char: string): boolean {
  if (edge.kind === "literal") return char === edge.char;
  if (edge.kind === "segment") return char !== "/";
  return !"\r\n\u2028\u2029".includes(char);
}

// Compile the *, ** and ? grammar used by matchPattern. State sets let us check
// inclusion without treating a selected glob's wildcard characters as filenames.
function compile(patterns: string[]): Matcher {
  const states: State[] = [];
  function addState(): number {
    states.push({ epsilon: [], edges: [], accepting: false });
    return states.length - 1;
  }
  const start = addState();
  for (const pattern of patterns) {
    let current = addState();
    states[start]!.epsilon.push(current);
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i]!,
        next = addState();
      if (char === "*" && pattern[i + 1] === "*") {
        i++;
        states[current]!.epsilon.push(next);
        if (pattern[i + 1] === "/") {
          i++;
          const segment = addState();
          states[current]!.edges.push({ to: segment, kind: "segment" });
          states[segment]!.edges.push(
            { to: segment, kind: "segment" },
            { to: current, kind: "literal", char: "/" },
          );
        } else states[current]!.edges.push({ to: current, kind: "any" });
      } else if (char === "*") {
        states[current]!.epsilon.push(next);
        states[current]!.edges.push({ to: current, kind: "segment" });
      } else if (char === "?")
        states[current]!.edges.push({ to: next, kind: "segment" });
      else states[current]!.edges.push({ to: next, kind: "literal", char });
      current = next;
    }
    states[current]!.accepting = true;
  }
  function closure(seeds: number[]): number[] {
    const result = new Set(seeds),
      pending = [...seeds];
    while (pending.length) {
      for (const next of states[pending.pop()!]!.epsilon) {
        if (!result.has(next)) {
          result.add(next);
          pending.push(next);
        }
      }
    }
    return [...result].sort((a, b) => a - b);
  }
  function advance(active: number[], char: string): number[] {
    const next: number[] = [];
    for (const state of active) {
      for (const edge of states[state]!.edges) {
        if (matchesEdge(edge, char)) next.push(edge.to);
      }
    }
    return closure(next);
  }
  return {
    start: closure([start]),
    advance,
    accepts: (active: number[]) => active.some((s) => states[s]!.accepting),
  };
}

/** Prove that every selected descendant of a directory is explicitly excluded. */
export function createGlobCoverageCheck(
  patterns: string[],
  excludes: string[],
): (directory: string) => boolean {
  const selected = compile(patterns),
    excluded = compile(excludes);
  // All other characters behave alike; NUL is a representative absent from
  // validated patterns. Include line separators because ** uses RegExp's dot.
  const alphabet = [
    ...new Set(
      [...patterns, ...excludes]
        .join("")
        .split("")
        .filter((c) => c !== "*" && c !== "?")
        .concat(["/", "\0", "\u2028", "\u2029"]),
    ),
  ];
  return (directory: string): boolean => {
    let selection = selected.start,
      exclusion = excluded.start;
    for (const char of `${directory}/`.split("")) {
      selection = selected.advance(selection, char);
      exclusion = excluded.advance(exclusion, char);
    }
    const pending = [{ selection, exclusion, inSegment: false }],
      visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (!current.selection.length) continue;
      const key = `${current.selection.join(",")}|${current.exclusion.join(",")}|${current.inSegment}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (
        current.inSegment &&
        selected.accepts(current.selection) &&
        !excluded.accepts(current.exclusion)
      )
        return false;
      // Pathological glob combinations must retain the gap, never claim coverage.
      if (visited.size > 4096) return false;
      for (const char of alphabet) {
        // Files have nonempty path segments and do not end with a slash.
        if (char === "/" && !current.inSegment) continue;
        pending.push({
          selection: selected.advance(current.selection, char),
          exclusion: excluded.advance(current.exclusion, char),
          inSegment: char !== "/",
        });
      }
    }
    return true;
  };
}
