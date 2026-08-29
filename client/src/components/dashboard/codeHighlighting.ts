export type CodeTokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "literal"
  | "number"
  | "tag"
  | "punctuation";

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

const KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
  "def", "default", "delete", "do", "else", "enum", "export", "extends", "finally",
  "for", "from", "function", "if", "implements", "import", "in", "instanceof", "interface",
  "let", "new", "package", "private", "protected", "public", "return", "static", "switch",
  "throw", "try", "type", "typeof", "var", "void", "while", "with", "yield",
]);

const LITERALS = new Set(["false", "null", "undefined", "true", "None", "False", "True"]);

const CODE_TOKEN_PATTERN =
  /(<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<\/?[A-Za-z][\w:.-]*|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b|[{}[\]();,.<>:=+\-*/!?&|]+)/g;

function classifyToken(token: string): CodeTokenKind {
  if (
    token.startsWith("//") ||
    token.startsWith("/*") ||
    token.startsWith("<!--") ||
    token.startsWith("#")
  ) {
    return "comment";
  }

  if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) return "string";
  if (/^<\/?[A-Za-z]/.test(token)) return "tag";
  if (KEYWORDS.has(token)) return "keyword";
  if (LITERALS.has(token)) return "literal";
  if (/^\d/.test(token)) return "number";
  if (/^[{}[\]();,.<>:=+\-*/!?&|]+$/.test(token)) return "punctuation";
  return "plain";
}

export function tokenizeCode(value: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let cursor = 0;

  for (const match of value.matchAll(CODE_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ text: value.slice(cursor, index), kind: "plain" });
    tokens.push({ text: match[0], kind: classifyToken(match[0]) });
    cursor = index + match[0].length;
  }

  if (cursor < value.length) tokens.push({ text: value.slice(cursor), kind: "plain" });
  return tokens;
}
