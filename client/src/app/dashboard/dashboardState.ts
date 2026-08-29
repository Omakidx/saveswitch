import type { Category } from "@/components/dashboard/CategorySwitch";
import type { CanvasViewState } from "@/components/dashboard/InfiniteCanvas";

export type DashboardVisibility = "private" | "public";

export interface WorkspaceSnapshot {
  activePageId: string | null;
  selectedDate: string | null;
  expandedDates: string[];
  isCanvasMode: boolean;
  activeCategory: Category;
  canvasView: CanvasViewState;
}

export interface PersistedDashboardState {
  visibility: DashboardVisibility;
  workspaces: Record<DashboardVisibility, WorkspaceSnapshot>;
}

export const DEFAULT_CANVAS_VIEW: CanvasViewState = {
  offset: { x: 0, y: 0 },
  zoom: 1,
};

export const DASHBOARD_STATE_STORAGE_KEY = "saveswitch-dashboard-state";

const VALID_CATEGORIES = new Set<Category>(["target", "video", "image", "link", "document"]);

export function createWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    activePageId: null,
    selectedDate: null,
    expandedDates: [],
    isCanvasMode: true,
    activeCategory: "target",
    canvasView: {
      offset: { ...DEFAULT_CANVAS_VIEW.offset },
      zoom: DEFAULT_CANVAS_VIEW.zoom,
    },
  };
}

export function createDashboardState(): PersistedDashboardState {
  return {
    visibility: "public",
    workspaces: {
      private: createWorkspaceSnapshot(),
      public: createWorkspaceSnapshot(),
    },
  };
}

function isVisibility(value: unknown): value is DashboardVisibility {
  return value === "private" || value === "public";
}

function normalizeCanvasView(value: unknown): CanvasViewState {
  if (!value || typeof value !== "object") {
    return { offset: { ...DEFAULT_CANVAS_VIEW.offset }, zoom: DEFAULT_CANVAS_VIEW.zoom };
  }

  const candidate = value as Partial<CanvasViewState>;
  const x = candidate.offset?.x;
  const y = candidate.offset?.y;
  const zoom = candidate.zoom;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || (zoom ?? 0) <= 0) {
    return { offset: { ...DEFAULT_CANVAS_VIEW.offset }, zoom: DEFAULT_CANVAS_VIEW.zoom };
  }

  return { offset: { x: x as number, y: y as number }, zoom: zoom as number };
}

export function normalizeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  const fallback = createWorkspaceSnapshot();
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Partial<WorkspaceSnapshot>;
  return {
    activePageId: typeof candidate.activePageId === "string" ? candidate.activePageId : null,
    selectedDate: typeof candidate.selectedDate === "string" ? candidate.selectedDate : null,
    expandedDates: Array.isArray(candidate.expandedDates)
      ? [...new Set(candidate.expandedDates.filter((date): date is string => typeof date === "string"))]
      : [],
    isCanvasMode: candidate.isCanvasMode !== false,
    activeCategory: VALID_CATEGORIES.has(candidate.activeCategory as Category)
      ? candidate.activeCategory as Category
      : fallback.activeCategory,
    canvasView: normalizeCanvasView(candidate.canvasView),
  };
}

export function normalizeDashboardState(value: unknown): PersistedDashboardState {
  const candidate = value && typeof value === "object" ? value as Partial<PersistedDashboardState> : {};
  return {
    visibility: isVisibility(candidate.visibility) ? candidate.visibility : "public",
    workspaces: {
      private: normalizeWorkspaceSnapshot(candidate.workspaces?.private),
      public: normalizeWorkspaceSnapshot(candidate.workspaces?.public),
    },
  };
}

export function readDashboardState(): PersistedDashboardState {
  if (typeof window === "undefined") return createDashboardState();

  try {
    const rawState = window.localStorage.getItem(DASHBOARD_STATE_STORAGE_KEY);
    return rawState ? normalizeDashboardState(JSON.parse(rawState)) : createDashboardState();
  } catch {
    return createDashboardState();
  }
}

export function writeDashboardState(state: PersistedDashboardState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(DASHBOARD_STATE_STORAGE_KEY, JSON.stringify(normalizeDashboardState(state)));
  } catch {
    // Storage can be unavailable or full. Keeping the in-memory state is still safe.
  }
}

export function canvasViewsEqual(first: CanvasViewState, second: CanvasViewState) {
  return first.zoom === second.zoom && first.offset.x === second.offset.x && first.offset.y === second.offset.y;
}
