// The client has no Bun type dependency, but Bun is the repository's test runner.
// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { enqueueDashboardToast, toastKey } from "./toastQueue";

describe("dashboard toast queue", () => {
  test("keeps the newest two notifications", () => {
    const first = { id: "one", message: "First", type: "info" as const };
    const second = { id: "two", message: "Second", type: "success" as const };
    const third = { id: "three", message: "Third", type: "error" as const };

    expect(enqueueDashboardToast(enqueueDashboardToast([first], second), third)).toEqual([second, third]);
  });

  test("uses a stable key to deduplicate messages regardless of casing", () => {
    expect(toastKey("  Resource saved. ", "success")).toBe(toastKey("resource saved.", "success"));
    expect(toastKey("Resource saved.", "success")).not.toBe(toastKey("Resource saved.", "error"));
  });
});
