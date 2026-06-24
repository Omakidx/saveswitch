import React from "react";

interface ModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export default function Modal({
  isOpen,
  title,
  message,
  onClose,
  onConfirm,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDanger = false,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <>
      <style>{`
        @keyframes modal-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modal-zoom-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          style={{ animation: "modal-fade-in 0.2s ease-out forwards" }}
          onClick={onClose}
        />
        {/* Modal Content */}
        <div
          className="relative bg-[var(--color-surface)] border border-[var(--color-surface-border)] rounded-2xl shadow-2xl p-6 flex flex-col gap-4"
          style={{
            width: 420,
            maxWidth: "90vw",
            animation:
              "modal-zoom-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          }}
        >
          <h2
            className="font-jakarta text-xl font-bold m-0"
            style={{ color: "var(--color-text-primary)" }}
          >
            {title}
          </h2>
          <p
            className="font-arimo text-[15px] m-0 leading-relaxed"
            style={{ color: "var(--color-text-primary)", opacity: 0.8 }}
          >
            {message}
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl font-arimo text-sm font-semibold cursor-pointer transition-colors hover:bg-white/10 bg-transparent border-none"
              style={{ color: "var(--color-text-primary)" }}
            >
              {cancelText}
            </button>
            {onConfirm && (
              <button
                type="button"
                onClick={onConfirm}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-arimo text-sm font-semibold cursor-pointer transition-all shadow-md hover:shadow-lg active:scale-95 border-none ${
                  isDanger
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : "bg-white text-black hover:bg-gray-200"
                }`}
              >
                {isDanger && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src="/icons/icon-trash.svg"
                    alt=""
                    width={16}
                    height={16}
                    style={{ filter: "brightness(0) invert(1)" }}
                  />
                )}
                {confirmText}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
