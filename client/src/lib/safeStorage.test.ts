// @ts-expect-error Bun provides this module at test runtime.
import { afterEach, describe, expect, test } from "bun:test";

import { safeGetItem, safeRemoveItem, safeSetItem } from "./safeStorage";

const globalWithWindow = globalThis as unknown as { window?: unknown };

afterEach(() => {
  delete globalWithWindow.window;
});

describe("safe storage", () => {
  test("is a no-op without a window", () => {
    expect(safeGetItem("a")).toBeNull();
    expect(() => safeSetItem("a", "b")).not.toThrow();
    expect(() => safeRemoveItem("a")).not.toThrow();
  });

  test("swallows storage access errors", () => {
    globalWithWindow.window = {
      get localStorage() {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    expect(safeGetItem("a")).toBeNull();
    expect(() => safeSetItem("a", "b")).not.toThrow();
    expect(() => safeRemoveItem("a")).not.toThrow();
  });

  test("reads and writes when storage works", () => {
    const store = new Map<string, string>();
    globalWithWindow.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    };
    safeSetItem("a", "b");
    expect(safeGetItem("a")).toBe("b");
    safeRemoveItem("a");
    expect(safeGetItem("a")).toBeNull();
  });
});
