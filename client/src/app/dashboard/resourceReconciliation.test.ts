// The client has no Bun type dependency, but Bun is the repository's test runner.
// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { reconcileFetchedResources } from "./resourceReconciliation";

describe("resource fetch reconciliation", () => {
  test("retains a resource created after the request began when the response is stale", () => {
    const fetched = [{ id: "existing", title: "From fetch" }];
    const created = { id: "new", title: "Created response" };

    expect(reconcileFetchedResources(fetched, [created])).toEqual([
      { id: "existing", title: "From fetch" },
      created,
    ]);
  });

  test("deduplicates resources and keeps the authoritative create response", () => {
    const created = { id: "new", title: "Created response", x: 320 };

    expect(reconcileFetchedResources([
      { id: "new", title: "Stale fetch", x: 100 },
      { id: "existing", title: "Existing" },
      { id: "new", title: "Duplicated fetch", x: 200 },
    ], [created])).toEqual([
      created,
      { id: "existing", title: "Existing" },
    ]);
  });
});
