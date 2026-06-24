"use client";

interface FloatingActionButtonProps {
  onClick: () => void;
  onPaste?: () => void;
  isActive?: boolean;
}

export default function FloatingActionButton({
  onClick,
  onPaste,
  isActive = false,
}: FloatingActionButtonProps) {
  return (
    <div
      className={`relative flex items-center justify-between transition-all duration-200 ${isActive ? 'shadow-xl scale-105' : 'hover:shadow-xl hover:scale-105'}`}
      style={{
        width: 110,
        height: 40,
        background: isActive ? "var(--color-surface-border)" : "#191818",
        borderRadius: 20,
        zIndex: 50,
      }}
    >
      <button
        type="button"
        onClick={onPaste}
        className="flex-1 h-full flex items-center justify-center cursor-pointer border-none bg-transparent hover:bg-white/10 transition-colors rounded-l-full text-white/70 hover:text-white"
        aria-label="Paste from clipboard"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-paste.svg"
          alt="Paste"
          width={24}
          height={24}
          style={{ color: "currentColor" }}
        />
      </button>

      {/* Divider */}
      <div className="w-[1px] h-[18px] bg-white/10" />

      <button
        type="button"
        onClick={onClick}
        className="flex-1 h-full flex items-center justify-center cursor-pointer border-none bg-transparent hover:bg-white/10 transition-colors rounded-r-full text-white/70 hover:text-white"
        aria-label={isActive ? "Restore dashboard" : "Minimize dashboard"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-fab.svg"
          alt={isActive ? "Restore" : "Minimize"}
          width={45}
          height={40}
          style={{ color: "currentColor" }}
        />
      </button>
    </div>
  );
}
