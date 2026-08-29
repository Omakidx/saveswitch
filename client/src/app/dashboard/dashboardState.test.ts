// The client has no Bun type dependency, but Bun is the repository's test runner.
// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { DEFAULT_CANVAS_VIEW, normalizeDashboardState, normalizeWorkspaceSnapshot } from "./dashboardState";

describe("dashboard state normalization", () => {
  test("keeps a complete valid workspace snapshot", () => {
    const state = normalizeDashboardState({
      visibility: "private",
      workspaces: {
        private: {
          activePageId: "page-1",
          selectedDate: "2026-08-28",
          expandedDates: ["2026-08-28", "2026-08-28"],
          isCanvasMode: true,
          activeCategory: "document",
          canvasView: { offset: { x: 120, y: -35 }, zoom: 1.4 },
        },
      },
    });

    expect(state.visibility).toBe("private");
    expect(state.workspaces.private).toMatchObject({
      activePageId: "page-1",
      selectedDate: "2026-08-28",
      expandedDates: ["2026-08-28"],
      activeCategory: "document",
      canvasView: { offset: { x: 120, y: -35 }, zoom: 1.4 },
    });
  });

  test("falls back safely for malformed or stale persisted values", () => {
    expect(normalizeWorkspaceSnapshot({
      activePageId: 3,
      expandedDates: ["2026-08-28", null],
      activeCategory: "unknown",
      canvasView: { offset: { x: Number.NaN, y: 10 }, zoom: 0 },
    })).toMatchObject({
      activePageId: null,
      expandedDates: ["2026-08-28"],
      activeCategory: "target",
      canvasView: DEFAULT_CANVAS_VIEW,
    });
  });
});
