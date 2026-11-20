"use client";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  /** Defaults to "Delete" with a trash icon. */
  confirmLabel?: string;
  /** "danger" (default) for destructive actions, "neutral" for reversible ones. */
  tone?: "danger" | "neutral";
  onConfirm: () => void;
  onCancel: () => void;
}

/** Destructive-action confirmation shared by the dashboard and Xoomshare rooms. */
export default function ConfirmDialog({ title, message, confirmLabel, tone = "danger", onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center"
      onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        style={{ animation: "modal-fade-in 0.2s ease-out forwards" }}
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="relative flex flex-col gap-4 rounded-2xl border border-[var(--color-surface-border)] bg-[var(--color-surface)] p-6 shadow-2xl"
        style={{
          width: "min(420px, calc(100vw - 32px))",
          animation: "modal-zoom-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      >
        <h2 id="confirm-dialog-title" className="m-0 font-jakarta text-xl font-bold" style={{ color: "var(--color-text-primary)" }}>
          {title}
        </h2>
        <p id="confirm-dialog-message" className="m-0 font-arimo text-[15px] leading-relaxed" style={{ color: "var(--color-text-primary)", opacity: 0.8 }}>
          {message}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="cursor-pointer rounded-xl border-none bg-transparent px-5 py-2.5 font-arimo text-sm font-semibold transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-primary)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={tone === "danger"
              ? "flex cursor-pointer items-center gap-2 rounded-xl border border-[#FF2A2A]/30 bg-[#FF2A2A]/10 px-5 py-2.5 font-arimo text-sm font-semibold text-[#FF2A2A] shadow-md transition-all hover:bg-[#FF2A2A]/15 hover:shadow-lg active:scale-95"
              : "flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/90 px-5 py-2.5 font-arimo text-sm font-semibold text-[#111] shadow-md transition-all hover:bg-white hover:shadow-lg active:scale-95"}
          >
            {!confirmLabel && tone === "danger" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/icons/icon-trash.svg" alt="" width={16} height={16} />
            )}
            {confirmLabel || "Delete"}
          </button>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes modal-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modal-zoom-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      ` }} />
    </div>
  );
}
