import { useEffect, useRef } from "react";
import { navigationScrollContainer } from "./navigation-scroll";

export type NavigationState = {
  active: string;
  page:
    | "overview"
    | "requirements"
    | "planning"
    | "tasks"
    | "documents"
    | "relations"
    | "guide";
  selection: {
    task?: string;
    taskRealId?: string | null;
    taskRequirement?: string;
    taskAssociationReview?: boolean;
    doc?: string;
    line?: number;
    relation?: string;
    relationRealId?: string | null;
    product?: string;
    plan?: string;
    work?: string;
  };
};
type Entry = { route: NavigationState; scroll: number };
const key = "tracelensNavigation";
const pages = new Set([
  "overview",
  "requirements",
  "planning",
  "tasks",
  "documents",
  "relations",
  "guide",
]);
function readEntry(state: unknown): Entry | undefined {
  const entry = (state as Record<string, Entry> | null)?.[key];
  if (
    !entry ||
    typeof entry.route?.active !== "string" ||
    !pages.has(entry.route.page) ||
    !entry.route.selection ||
    typeof entry.route.selection !== "object"
  )
    return undefined;
  return entry;
}
export function initialNavigation(): NavigationState {
  return (
    readEntry(window.history.state)?.route || {
      active: "",
      page: "overview",
      selection: {},
    }
  );
}
function routeKey(route: NavigationState): string {
  // A snapshot changing without document navigation must not create a Back entry.
  const selection = { ...route.selection };
  if (!selection.doc) delete selection.line;
  else selection.line ??= 1;
  return JSON.stringify({ ...route, selection });
}

export function useNavigationHistory(
  route: NavigationState,
  ready: boolean,
  restore: (route: NavigationState) => void,
  contentReady: boolean,
) {
  const current = useRef(route);
  current.current = route;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const recorded = useRef<string | undefined>(undefined);
  const pendingScroll = useRef<number | undefined>(undefined);
  useEffect(() => {
    const previousMode = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const pop = (event: PopStateEvent) => {
      const entry = readEntry(event.state);
      if (!entry) return;
      recorded.current = routeKey(entry.route);
      pendingScroll.current = entry.scroll;
      restoreRef.current(entry.route);
    };
    const saveScroll = () => {
      const entry = readEntry(window.history.state);
      if (!entry || routeKey(entry.route) !== routeKey(current.current)) return;
      window.history.replaceState(
        {
          ...window.history.state,
          [key]: {
            ...entry,
            scroll: navigationScrollContainer()?.scrollTop || 0,
          },
        },
        "",
      );
    };
    window.addEventListener("popstate", pop);
    document.addEventListener("scroll", saveScroll, true);
    return () => {
      window.removeEventListener("popstate", pop);
      document.removeEventListener("scroll", saveScroll, true);
      window.history.scrollRestoration = previousMode;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const next = routeKey(route);
    if (recorded.current === next) return;
    const entry: Entry = { route, scroll: 0 };
    if (recorded.current === undefined) {
      window.history.replaceState(
        { ...window.history.state, [key]: entry },
        "",
      );
    } else {
      window.history.pushState({ [key]: entry }, "");
    }
    recorded.current = next;
  }, [route.active, route.page, route.selection, ready]);
  useEffect(() => {
    if (!contentReady || pendingScroll.current === undefined) return;
    const timer = window.setTimeout(() => {
      const container = navigationScrollContainer();
      if (container) container.scrollTop = pendingScroll.current || 0;
      pendingScroll.current = undefined;
    }, 100);
    return () => window.clearTimeout(timer);
  }, [route.active, route.page, route.selection, contentReady]);
}
