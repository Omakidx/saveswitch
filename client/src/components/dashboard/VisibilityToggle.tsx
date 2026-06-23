"use client";

interface VisibilityToggleProps {
  visibility: "private" | "public";
  onToggle: (mode: "private" | "public") => void;
}

export default function VisibilityToggle({
  visibility,
  onToggle,
}: VisibilityToggleProps) {
  return (
    <div
      className="inline-flex items-center gap-[3px] rounded-full"
      style={{
        padding: 3,
        background: "var(--color-surface)",
        border: "1px solid var(--color-surface-border)",
      }}
    >
      <button
        type="button"
        onClick={() => onToggle("private")}
        className="flex items-center justify-center cursor-pointer border-none transition-all duration-200"
        style={{
          height: 30,
          padding: "0 20px",
          borderRadius: 9999,
          background:
            visibility === "private" ? "var(--color-text-primary)" : "transparent",
          color:
            visibility === "private"
              ? "var(--color-surface)"
              : "var(--color-text-muted)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontWeight: 500,
          fontSize: 12,
          lineHeight: "16px",
          textTransform: "uppercase" as const,
          letterSpacing: "0.02em",
        }}
      >
        Private
      </button>
      <button
        type="button"
        onClick={() => onToggle("public")}
        className="flex items-center justify-center cursor-pointer border-none transition-all duration-200"
        style={{
          height: 30,
          padding: "0 20px",
          borderRadius: 9999,
          background:
            visibility === "public" ? "var(--color-text-primary)" : "transparent",
          color:
            visibility === "public"
              ? "var(--color-surface)"
              : "var(--color-text-muted)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontWeight: 500,
          fontSize: 12,
          lineHeight: "16px",
          textTransform: "uppercase" as const,
          letterSpacing: "0.02em",
        }}
      >
        Public
      </button>
    </div>
  );
}
