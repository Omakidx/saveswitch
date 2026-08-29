// The client has no Bun type dependency, but Bun is the repository's test runner.
// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import type { PageData } from "./ResourceMiniPanel";
import { formatSavedPageTimestamp, getSavedPageDayLabel, groupSavedPagesByDay } from "./savedPageGroups";

function page(id: string, createdAt: Date): PageData {
  return { id, color: "#fffDCE", createdAt: createdAt.toISOString(), name: `Page ${id}` };
}

describe("saved page date folders", () => {
  const now = new Date(2024, 8, 25, 16, 30);

  test("uses Today, Yesterday, and an immutable calendar label", () => {
    expect(getSavedPageDayLabel(new Date(2024, 8, 25, 9, 0).toISOString(), now)).toBe("Today");
    expect(getSavedPageDayLabel(new Date(2024, 8, 24, 14, 1).toISOString(), now)).toBe("Yesterday");
    expect(getSavedPageDayLabel(new Date(2024, 8, 20, 14, 1).toISOString(), now)).toBe("20 Sep 2024");
  });

  test("uses a stable fallback label for an invalid creation timestamp", () => {
    expect(getSavedPageDayLabel("not-a-date", now)).toBe("Earlier");
    expect(formatSavedPageTimestamp("not-a-date")).toBe("Unknown creation time");
  });

  test("shows the exact created date and 24-hour time", () => {
    expect(formatSavedPageTimestamp(new Date(2024, 8, 24, 14, 1).toISOString())).toBe("24 Sep 2024  14:01");
  });

  test("groups days and pages newest first", () => {
    const groups = groupSavedPagesByDay([
      page("older", new Date(2024, 8, 24, 8, 0)),
      page("newest", new Date(2024, 8, 25, 14, 0)),
      page("newer-yesterday", new Date(2024, 8, 24, 16, 0)),
    ], now);

    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday"]);
    expect(groups[1].pages.map((item) => item.id)).toEqual(["newer-yesterday", "older"]);
  });
});
