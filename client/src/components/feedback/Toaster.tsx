"use client";

export interface ToastItem {
  id: string;
  message: string;
  type: "error" | "success" | "info";
}

/** Toast stack shared by the dashboard, Xoomshare rooms and public profiles. */
export default function Toaster({ toasts }: { toasts: ToastItem[] }) {
  return (
    <>
      <div className="pointer-events-none fixed bottom-3 left-3 right-3 z-50 flex flex-col items-end gap-1.5 sm:bottom-5 sm:left-auto sm:right-5" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full items-center gap-2 rounded-full px-3 py-2 shadow-[0_5px_16px_rgba(80,73,42,0.13)] sm:w-auto"
            style={{
              maxWidth: "min(320px, calc(100vw - 24px))",
              background: toast.type === "error" ? "rgba(255, 244, 244, 0.82)" : "rgba(255, 255, 255, 0.62)",
              border: toast.type === "error" ? "1px solid rgba(224, 103, 103, 0.32)" : "1px solid rgba(255, 255, 255, 0.72)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              animation: "toast-slide-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
            }}
          >
            {toast.type === "error" && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(196, 77, 77, 0.92)" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            <span
              className="font-arimo text-[11px] font-medium leading-[1.25] tracking-[0.01em]"
              style={{ color: toast.type === "error" ? "rgba(139, 53, 53, 0.96)" : "rgba(44, 43, 37, 0.92)", overflowWrap: "anywhere" }}
            >
              {toast.message}
            </span>
          </div>
        ))}
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      ` }} />
    </>
  );
}
