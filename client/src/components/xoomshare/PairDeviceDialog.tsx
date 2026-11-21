"use client";

import { useEffect, useState } from "react";

export interface PairDeviceDialogProps {
  /** Full room link encoded in the QR code. */
  link: string;
  pathCode: string;
  /** Milliseconds until the room expires; null when unknown. */
  expiresInMs?: number | null;
  onCopy: () => void;
  onClose: () => void;
}

/** "2h 14m", "9m", or "under a minute". */
export function formatTimeLeft(ms: number | null | undefined): string | null {
  if (ms == null || ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "under a minute";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Shows the room link as a QR code so a second device can join by pointing its
 * camera at the screen instead of typing a 12–48 character code.
 */
export default function PairDeviceDialog({ link, pathCode, expiresInMs, onCopy, onClose }: PairDeviceDialogProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const expiryLabel = formatTimeLeft(expiresInMs);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    let cancelled = false;
    // Loaded on demand so the encoder stays out of the room's first load.
    import("qrcode")
      .then((QRCode) => QRCode.toString(link, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        color: { dark: "#111111", light: "#ffffff" },
      }))
      .then((markup) => { if (!cancelled) setSvg(markup); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [link]);

  const handleShare = async () => {
    try {
      await navigator.share({ title: "Join my Xoomshare room", url: link });
    } catch {
      // Dismissing the share sheet rejects; nothing to report.
    }
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center p-4"
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-device-title"
        aria-describedby="pair-device-help"
        className="relative flex max-h-[calc(100dvh-32px)] flex-col items-center gap-4 overflow-y-auto rounded-2xl border border-[var(--color-surface-border)] bg-[var(--color-surface)] p-6 text-center shadow-2xl"
        style={{ width: "min(360px, calc(100vw - 32px))" }}
      >
        <h2 id="pair-device-title" className="m-0 font-jakarta text-xl font-bold" style={{ color: "var(--color-text-primary)" }}>
          Pair a device
        </h2>
        <p id="pair-device-help" className="m-0 font-arimo text-[14px] leading-relaxed" style={{ color: "var(--color-text-primary)", opacity: 0.75 }}>
          Point your other device&rsquo;s camera at this code to open the room. No typing, no account.
        </p>

        <div
          className="flex aspect-square w-full max-w-[240px] items-center justify-center rounded-2xl bg-white p-3"
          role="img"
          aria-label={`QR code for room ${pathCode}`}
        >
          {svg ? (
            <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : failed ? (
            <span className="px-4 font-arimo text-[13px] text-[#6b6b6b]">Couldn&rsquo;t draw the code. Copy the link instead.</span>
          ) : (
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#d0d0d0] border-t-[#111]" aria-hidden="true" />
          )}
        </div>

        <div className="flex w-full flex-col items-center gap-1">
          <span className="max-w-full truncate font-arimo text-[15px] font-semibold" style={{ color: "var(--color-text-primary)" }} title={pathCode}>
            {pathCode}
          </span>
          {expiryLabel && (
            <span className="font-arimo text-[12px]" style={{ color: "var(--color-text-primary)", opacity: 0.55 }}>
              Room closes in {expiryLabel}
            </span>
          )}
        </div>

        <div className="mt-1 flex w-full flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onCopy}
            className="flex-1 cursor-pointer rounded-xl border border-white/20 bg-white/90 px-5 py-2.5 font-arimo text-sm font-semibold text-[#111] shadow-md transition-all hover:bg-white active:scale-95"
          >
            Copy link
          </button>
          {canShare && (
            <button
              type="button"
              onClick={() => { void handleShare(); }}
              className="flex-1 cursor-pointer rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 font-arimo text-sm font-semibold text-white transition-colors hover:bg-white/15"
            >
              Share
            </button>
          )}
        </div>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="cursor-pointer rounded-xl border-none bg-transparent px-5 py-2 font-arimo text-sm font-semibold transition-colors hover:bg-white/10"
          style={{ color: "var(--color-text-primary)" }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
