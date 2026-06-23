"use client";

interface FloatingActionButtonProps {
  onClick: () => void;
  isActive?: boolean;
}

export default function FloatingActionButton({
  onClick,
  isActive = false,
}: FloatingActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center justify-center cursor-pointer border-none transition-all duration-200 hover:scale-110 hover:shadow-xl active:scale-95 ${isActive ? 'scale-110 shadow-xl' : ''}`}
      style={{
        width: 45,
        height: 40,
        background: isActive ? "var(--color-surface-border)" : "#191818",
        borderRadius: 23,
        zIndex: 50,
      }}
      aria-label={isActive ? "Restore dashboard" : "Minimize dashboard"}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/icon-fab.svg"
        alt="Chat"
        width={45}
        height={40}
      />
    </button>
  );
}
