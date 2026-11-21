"use client";

import { useEffect, useRef, useState } from "react";
import { roomCodeFromScan } from "@/lib/roomCode";

// BarcodeDetector is not in TypeScript's DOM lib yet.
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorInstance { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorConstructor {
  new (options?: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}

const getBarcodeDetector = () =>
  (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;

/**
 * True when this browser can read QR codes from the camera. iOS Safari and
 * Firefox can't; on iPhones the system camera already opens the link.
 */
export async function canScanQrCodes(): Promise<boolean> {
  const Detector = getBarcodeDetector();
  if (!Detector || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    return (await Detector.getSupportedFormats()).includes("qr_code");
  } catch {
    return false;
  }
}

const SCAN_INTERVAL_MS = 250;

export default function QrScanner({ onRoomCode, onClose }: { onRoomCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "denied" | "error">(
    () => (getBarcodeDetector() ? "starting" : "error"),
  );
  const [hint, setHint] = useState("");
  const onRoomCodeRef = useRef(onRoomCode);
  useEffect(() => { onRoomCodeRef.current = onRoomCode; }, [onRoomCode]);

  useEffect(() => {
    const Detector = getBarcodeDetector();
    if (!Detector) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const detector = new Detector({ formats: ["qr_code"] });

    const scan = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      if (video.readyState >= 2) {
        try {
          for (const barcode of await detector.detect(video)) {
            const code = roomCodeFromScan(barcode.rawValue, window.location.origin);
            if (code) {
              stopped = true;
              onRoomCodeRef.current(code);
              return;
            }
            setHint("That QR code isn’t a Saveswitch room.");
          }
        } catch {
          // A frame can fail to decode; keep scanning.
        }
      }
      timer = setTimeout(() => { void scan(); }, SCAN_INTERVAL_MS);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then(async (media) => {
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        await video.play().catch(() => {});
        setStatus("scanning");
        void scan();
      })
      .catch((error: unknown) => {
        if (stopped) return;
        setStatus(error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "error");
      });

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-[#1e1e1e]">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Camera preview for scanning a room QR code" />
        {status === "scanning" && (
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.25)]" aria-hidden="true" />
        )}
        {status !== "scanning" && (
          <p className="absolute inset-0 m-0 flex items-center justify-center px-6 text-center text-[13px] leading-5 text-white/80" role={status === "starting" ? undefined : "alert"}>
            {status === "starting" && "Starting camera…"}
            {status === "denied" && "Camera access was blocked. Allow it in your browser settings, or paste the room address instead."}
            {status === "error" && "Couldn’t start the camera. Paste the room address instead."}
          </p>
        )}
      </div>
      <p className="m-0 min-h-4 text-[12px] text-[#68685d]" aria-live="polite">
        {status === "scanning" ? hint || "Point the camera at the QR code on the other device." : ""}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="text-[12px] font-medium text-[#4f5046] underline decoration-[#a6a593] underline-offset-4 hover:text-[#176bff]"
      >
        Type the address instead
      </button>
    </div>
  );
}
