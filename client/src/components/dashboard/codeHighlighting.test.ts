// The client has no Bun type dependency, but Bun is the repository's test runner.
// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { tokenizeCode } from "./codeHighlighting";

describe("tokenizeCode", () => {
  test("preserves the source exactly", () => {
    const source = 'export default async function example() {\n  return "hello";\n}';
    expect(tokenizeCode(source).map((token) => token.text).join("")).toBe(source);
  });

  test("adds useful syntax categories without interpreting markup", () => {
    const source = '<section data-id="42">{true}</section> // note';
    const tokens = tokenizeCode(source);

    expect(tokens).toContainEqual({ text: "<section", kind: "tag" });
    expect(tokens).toContainEqual({ text: '"42"', kind: "string" });
    expect(tokens).toContainEqual({ text: "true", kind: "literal" });
    expect(tokens).toContainEqual({ text: "// note", kind: "comment" });
  });
});
