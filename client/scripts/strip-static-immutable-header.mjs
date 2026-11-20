// vinext emits a `_headers` rule that marks every /_next/static/* response as
// `public, max-age=31536000, immutable`. Cloudflare applies `_headers` rules to
// 404s from the static-asset layer too, so a browser that requests a chunk while
// a deploy is still propagating caches that 404 for a year and the page stays
// broken. Drop the rule so assets use Cloudflare's default ETag revalidation.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const headersPath = new URL("../dist/client/_headers", import.meta.url);

if (!existsSync(headersPath)) process.exit(0);

const lines = readFileSync(headersPath, "utf8").split("\n");
const kept = [];
let skipping = false;

for (const line of lines) {
  const isRuleStart = line.length > 0 && !/^\s/.test(line) && !line.startsWith("#");
  if (isRuleStart) skipping = line.trim().startsWith("/_next/static/");
  if (line.startsWith("# Cache content-hashed assets")) continue;
  if (!skipping) kept.push(line);
}

const output = kept.join("\n").trim();
writeFileSync(headersPath, output ? `${output}\n` : "");
console.log("Removed immutable /_next/static/* rule from dist/client/_headers");
