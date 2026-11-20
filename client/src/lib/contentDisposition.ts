/**
 * Builds an attachment Content-Disposition header value. HTTP header values
 * must be Latin-1, so the plain `filename` parameter is an ASCII fallback and
 * the full name travels in the RFC 5987 `filename*` parameter.
 */
export function attachmentContentDisposition(filename: string): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
