// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { buildRoomLink, extractRoomCode, roomCodeFromScan, safeDecodeURIComponent } from "./roomCode";

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

describe("QR pairing links", () => {
  const origin = "https://saveswitch.example";

  test("builds a link the scanner accepts", () => {
    const link = buildRoomLink(`${origin}/`, "team_references-01");
    expect(link).toBe("https://saveswitch.example/team_references-01");
    expect(roomCodeFromScan(link, origin)).toBe("team_references-01");
  });

  test("accepts a bare code", () => {
    expect(roomCodeFromScan("  team_references-01\n", origin)).toBe("team_references-01");
  });

  test("ignores query strings and fragments on our own links", () => {
    expect(roomCodeFromScan(`${origin}/team_references-01?pair=1#x`, origin)).toBe("team_references-01");
  });

  test("rejects links to other sites", () => {
    expect(roomCodeFromScan("https://evil.example/team_references-01", origin)).toBeNull();
    expect(roomCodeFromScan("http://saveswitch.example/team_references-01", origin)).toBeNull();
  });

  test("rejects profiles, deeper paths and junk", () => {
    expect(roomCodeFromScan(`${origin}/@someone_public`, origin)).toBeNull();
    expect(roomCodeFromScan(`${origin}/xoomshare/join`, origin)).toBeNull();
    expect(roomCodeFromScan(`${origin}/`, origin)).toBeNull();
    expect(roomCodeFromScan("short", origin)).toBeNull();
    expect(roomCodeFromScan("javascript:alert(1)", origin)).toBeNull();
  });
});
