"use client";

import React, { useState, useRef, useEffect } from "react";

interface FloatingActionButtonProps {
  onClick: () => void;
  onPaste?: () => void;
  isActive?: boolean;
  readOnly?: boolean;
}

export default function FloatingActionButton({
  onClick,
  onPaste,
  isActive = false,
  readOnly = false,
}: FloatingActionButtonProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMenu]);

  return (
    <div
      className={`relative flex items-center justify-between transition-all duration-200 ${isActive ? 'shadow-xl scale-105' : 'hover:shadow-xl hover:scale-105'}`}
      style={{
        width: readOnly ? 55 : 110,
        height: 40,
        background: isActive ? "var(--color-surface-border)" : "#191818",
        borderRadius: 20,
        zIndex: 50,
      }}
    >
      {/* Left button with popup */}
      {!readOnly && (
        <div className="relative flex-1 h-full" ref={menuRef}>
        <button
          type="button"
          onClick={() => setShowMenu((prev) => !prev)}
          className="w-full h-full flex items-center justify-center cursor-pointer border-none bg-transparent hover:bg-white/10 transition-colors rounded-l-full text-white/70 hover:text-white"
          aria-label="Add resources"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-paste.svg"
            alt="Add"
            width={24}
            height={24}
            style={{ color: "currentColor" }}
          />
        </button>

        {showMenu && (
          <div className="absolute bottom-[50px] right-0 bg-[#191818] rounded-[16px] shadow-2xl border border-white/10 flex flex-col w-[170px] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
              onClick={() => {
                onPaste?.();
                setShowMenu(false);
              }}
              className="px-4 py-3 text-left hover:bg-white/10 text-white/90 text-sm transition-colors border-b border-white/5 flex items-center gap-3 cursor-pointer border-none"
            >
              <img src="/icons/icon-paste.svg" alt="Paste" width={16} height={16} style={{ opacity: 0.7 }} /> 
              Paste
            </button>
            <label className="px-4 py-3 text-left hover:bg-white/10 text-white/90 text-sm transition-colors flex items-center gap-3 cursor-pointer">
              <img src="/icons/icon-paste.svg" alt="Upload" width={16} height={16} style={{ opacity: 0.7 }} /> 
              Upload File
              <input 
                type="file" 
                multiple 
                className="hidden" 
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    const event = new CustomEvent('saveswitch-upload', { detail: { files: Array.from(e.target.files) } });
                    window.dispatchEvent(event);
                    e.target.value = '';
                    setShowMenu(false);
                  }
                }} 
              />
            </label>
          </div>
        )}
      </div>
      )}

      {/* Divider */}
      {!readOnly && <div className="w-[1px] h-[18px] bg-white/10" />}

      <button
        type="button"
        onClick={onClick}
        className={`flex-1 h-full flex items-center justify-center cursor-pointer border-none bg-transparent hover:bg-white/10 transition-colors ${readOnly ? 'rounded-full' : 'rounded-r-full'} text-white/70 hover:text-white`}
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
