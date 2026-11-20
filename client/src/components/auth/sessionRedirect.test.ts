// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { shouldRedirectAuthenticatedSession } from "./sessionRedirect";

describe("authenticated session redirect scope", () => {
  test("redirects only from sign-in entry points", () => {
    expect(shouldRedirectAuthenticatedSession("/")).toBe(true);
    expect(shouldRedirectAuthenticatedSession("/login")).toBe(true);
    expect(shouldRedirectAuthenticatedSession("/register/")).toBe(true);
  });

  test("leaves public profiles, rooms and the dashboard alone", () => {
    expect(shouldRedirectAuthenticatedSession("/@duck")).toBe(false);
    expect(shouldRedirectAuthenticatedSession("/%40duck")).toBe(false);
    expect(shouldRedirectAuthenticatedSession("/team_references-01")).toBe(false);
    expect(shouldRedirectAuthenticatedSession("/xoomshare")).toBe(false);
    expect(shouldRedirectAuthenticatedSession("/dashboard/profile")).toBe(false);
    expect(shouldRedirectAuthenticatedSession(null)).toBe(false);
  });
});
