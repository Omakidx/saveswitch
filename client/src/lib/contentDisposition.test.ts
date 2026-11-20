// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { attachmentContentDisposition } from "./contentDisposition";

describe("attachment content disposition", () => {
  test("is a valid header value for non-Latin filenames", () => {
    const value = attachmentContentDisposition("文档 résumé.pdf");
    expect(() => new Headers({ "Content-Disposition": value })).not.toThrow();
    expect(value).toContain("filename*=UTF-8''%E6%96%87%E6%A1%A3%20r%C3%A9sum%C3%A9.pdf");
    expect(/^[\x20-\x7e]*$/.test(value)).toBe(true);
  });

  test("keeps ascii names readable", () => {
    expect(attachmentContentDisposition("report (1).pdf")).toBe(
      "attachment; filename=\"report (1).pdf\"; filename*=UTF-8''report%20%281%29.pdf",
    );
  });
});
