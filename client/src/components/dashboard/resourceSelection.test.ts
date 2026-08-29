// The client has no Bun type dependency, but Bun is the repository's test runner.
// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { moveResource } from "./resourceSelection";

describe("canvas resource dragging", () => {
  test("persists a rounded displacement for only the dragged resource", () => {
    expect(moveResource(
      { id: "one", x: 10, y: 20 },
      { x: 14.6, y: -5.4 },
    )).toEqual({ id: "one", x: 25, y: 15 });
  });
});
