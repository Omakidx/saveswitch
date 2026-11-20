// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { extractRoomCode, safeDecodeURIComponent } from "./roomCode";

describe("room code parsing", () => {
  test("keeps a plain code", () => {
    expect(extractRoomCode("  team_references-01 ")).toBe("team_references-01");
  });

  test("extracts the code from a pasted share link", () => {
    expect(extractRoomCode("https://saveswitch.example/team_references-01")).toBe("team_references-01");
    expect(extractRoomCode("https://saveswitch.example/team_references-01/?x=1#y")).toBe("team_references-01");
  });

  test("returns an empty code for a bare origin", () => {
    expect(extractRoomCode("https://saveswitch.example/")).toBe("");
  });

  test("does not throw on malformed percent-encoding", () => {
    expect(safeDecodeURIComponent("%E0%A4%A")).toBe("%E0%A4%A");
    expect(safeDecodeURIComponent("%40duck")).toBe("@duck");
  });
});
