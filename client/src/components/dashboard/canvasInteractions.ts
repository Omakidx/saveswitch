export type CanvasZoomDirection = "in" | "out";
export type CanvasPageNavigationDirection = "previous" | "next";

export const CANVAS_ZOOM_STEP = 0.1;
export const HORIZONTAL_SWIPE_THRESHOLD = 160;
export const HORIZONTAL_SWIPE_WINDOW_MS = 450;
export const HORIZONTAL_SWIPE_DOMINANCE_RATIO = 1.4;
export const HORIZONTAL_SWIPE_COOLDOWN_MS = 800;

type CanvasShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey">;

export function getCanvasZoomShortcut(event: CanvasShortcutEvent): CanvasZoomDirection | null {
  if (!event.ctrlKey && !event.metaKey) return null;

  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
    return "in";
  }

  if (event.key === "-" || event.key === "_" || event.code === "NumpadSubtract") {
    return "out";
  }

  return null;
}

export function isCanvasEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable]");
}

export function getHorizontalSwipeNavigation(
  horizontalDelta: number,
  verticalDelta: number,
  elapsedMs: number,
): CanvasPageNavigationDirection | null {
  if (
    elapsedMs > HORIZONTAL_SWIPE_WINDOW_MS ||
    Math.abs(horizontalDelta) < HORIZONTAL_SWIPE_THRESHOLD ||
    Math.abs(horizontalDelta) < Math.abs(verticalDelta) * HORIZONTAL_SWIPE_DOMINANCE_RATIO
  ) {
    return null;
  }

  // Positive wheel delta moves the canvas left, matching a leftward trackpad fling.
  return horizontalDelta > 0 ? "next" : "previous";

}
