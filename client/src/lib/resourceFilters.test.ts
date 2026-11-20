// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { filterResourcesByCategory, parseCategory } from "./resourceFilters";

const resources = [
  { id: "1", type: "link" as const },
  { id: "2", type: "image" as const },
  { id: "3", type: "text" as const },
  { id: "4", type: "pdf" as const },
  { id: "5", type: "file" as const },
];

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("resource category filters", () => {
  test("each category shows only its own resource types", () => {
    expect(ids(filterResourcesByCategory(resources, "target"))).toEqual(["1", "2", "3", "4", "5"]);
    expect(ids(filterResourcesByCategory(resources, "link"))).toEqual(["1"]);
    expect(ids(filterResourcesByCategory(resources, "image"))).toEqual(["2"]);
    expect(ids(filterResourcesByCategory(resources, "document"))).toEqual(["3", "4"]);
    expect(ids(filterResourcesByCategory(resources, "video"))).toEqual(["5"]);
  });

  test("parseCategory rejects stored garbage", () => {
    expect(parseCategory("image")).toBe("image");
    expect(parseCategory("nonsense")).toBe("target");
    expect(parseCategory(null)).toBe("target");
  });
});
