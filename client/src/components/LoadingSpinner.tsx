import React from "react";

export default function LoadingSpinner() {
  return (
    <div
      className="flex h-dvh w-full items-center justify-center bg-white"
      role="status"
      aria-label="Loading"
    >
      <span className="relative flex h-7 w-7 items-end justify-center" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-[#5f84e8] shadow-[0_3px_9px_rgba(75,108,202,0.25)] motion-safe:animate-[loading-ball-bounce_720ms_cubic-bezier(0.28,0.84,0.42,1)_infinite] motion-reduce:animate-none" />
      </span>
      <span className="sr-only">Loading content</span>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes loading-ball-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-11px); }
        }
      ` }} />
    </div>
  );
}
