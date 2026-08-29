// The client has no Bun type dependency, but Bun is the repository's test runner.
// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import {
  getCanvasZoomShortcut,
  getHorizontalSwipeNavigation,
  HORIZONTAL_SWIPE_COOLDOWN_MS,
  HORIZONTAL_SWIPE_DOMINANCE_RATIO,
  HORIZONTAL_SWIPE_THRESHOLD,
  HORIZONTAL_SWIPE_WINDOW_MS,
} from "./canvasInteractions";

type ZoomShortcutFixture = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
};

describe("canvas zoom shortcuts", () => {
  test.each([
    [{ key: "+", code: "Equal", ctrlKey: true, metaKey: false }, "in"],
    [{ key: "=", code: "Equal", ctrlKey: false, metaKey: true }, "in"],
    [{ key: "Add", code: "NumpadAdd", ctrlKey: true, metaKey: false }, "in"],
    [{ key: "-", code: "Minus", ctrlKey: true, metaKey: false }, "out"],
    [{ key: "_", code: "Minus", ctrlKey: false, metaKey: true }, "out"],
    [{ key: "Subtract", code: "NumpadSubtract", ctrlKey: true, metaKey: false }, "out"],
  ] as const)("maps %j to %s", (event: ZoomShortcutFixture, expected: "in" | "out") => {
    expect(getCanvasZoomShortcut(event)).toBe(expected);
  });

  test("requires a Ctrl/Cmd modifier", () => {
    expect(getCanvasZoomShortcut({ key: "+", code: "Equal", ctrlKey: false, metaKey: false })).toBeNull();
    expect(getCanvasZoomShortcut({ key: "-", code: "Minus", ctrlKey: false, metaKey: false })).toBeNull();
  });

  test("ignores unrelated modified keys", () => {
    expect(getCanvasZoomShortcut({ key: "0", code: "Digit0", ctrlKey: true, metaKey: false })).toBeNull();
    expect(getCanvasZoomShortcut({ key: "Add", code: "NumpadAdd", ctrlKey: false, metaKey: false })).toBeNull();
  });

  test("does not treat an unmodified plus or minus key as a canvas shortcut", () => {
    expect(getCanvasZoomShortcut({ key: "+", code: "Equal", ctrlKey: false, metaKey: false })).toBeNull();
    expect(getCanvasZoomShortcut({ key: "-", code: "Minus", ctrlKey: false, metaKey: false })).toBeNull();
  });
});

describe("horizontal canvas navigation threshold", () => {
  test("requires the accumulated horizontal threshold", () => {
    expect(getHorizontalSwipeNavigation(HORIZONTAL_SWIPE_THRESHOLD - 1, 0, 200)).toBeNull();
    expect(getHorizontalSwipeNavigation(-HORIZONTAL_SWIPE_THRESHOLD + 1, 0, 200)).toBeNull();
    expect(getHorizontalSwipeNavigation(HORIZONTAL_SWIPE_THRESHOLD, 0, 200)).toBe("next");
    expect(getHorizontalSwipeNavigation(-HORIZONTAL_SWIPE_THRESHOLD, 0, 200)).toBe("previous");
  });

  test("allows a horizontal gesture at exactly the 1.4 ratio", () => {
    const verticalDelta = HORIZONTAL_SWIPE_THRESHOLD / HORIZONTAL_SWIPE_DOMINANCE_RATIO;
    expect(getHorizontalSwipeNavigation(HORIZONTAL_SWIPE_THRESHOLD, verticalDelta, 200)).toBe("next");
    expect(getHorizontalSwipeNavigation(-HORIZONTAL_SWIPE_THRESHOLD, -verticalDelta, 200)).toBe("previous");
  });

  test("rejects vertical and high diagonal gestures below the dominance ratio", () => {
    const tooDiagonal = HORIZONTAL_SWIPE_THRESHOLD / HORIZONTAL_SWIPE_DOMINANCE_RATIO + 0.01;
    expect(getHorizontalSwipeNavigation(HORIZONTAL_SWIPE_THRESHOLD, tooDiagonal, 100)).toBeNull();
    expect(getHorizontalSwipeNavigation(HORIZONTAL_SWIPE_THRESHOLD, HORIZONTAL_SWIPE_THRESHOLD, 100)).toBeNull();
  });

  test("accepts the full gesture window and rejects gestures after it", () => {
    expect(getHorizontalSwipeNavigation(HORIZONTAL_SWIPE_THRESHOLD, 0, HORIZONTAL_SWIPE_WINDOW_MS)).toBe("next");
    expect(getHorizontalSwipeNavigation(HORIZONTAL_SWIPE_THRESHOLD, 0, HORIZONTAL_SWIPE_WINDOW_MS + 1)).toBeNull();
  });

  test("keeps directional accumulation signed", () => {
    expect(getHorizontalSwipeNavigation(220 - 61, 0, 200)).toBeNull();
    expect(getHorizontalSwipeNavigation(-220 + 61, 0, 200)).toBeNull();
  });

  test("uses a short navigation cooldown", () => {
    expect(HORIZONTAL_SWIPE_COOLDOWN_MS).toBeGreaterThanOrEqual(700);
    expect(HORIZONTAL_SWIPE_COOLDOWN_MS).toBeLessThanOrEqual(850);
  });
});
