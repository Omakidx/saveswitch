"use client";

import React, { useState, useRef, useEffect } from "react";

interface InfiniteCanvasProps {
  children: React.ReactNode;
  isActive: boolean;
  canvasColor?: string;
  canvasOffsetRef?: React.MutableRefObject<{ x: number, y: number }>;
}

export default function InfiniteCanvas({
  children,
  isActive,
  canvasColor = "var(--color-app-bg)",
  canvasOffsetRef,
}: InfiniteCanvasProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });

  // Reset offset when toggling canvas mode off
  useEffect(() => {
    if (!isActive) {
      setOffset({ x: 0, y: 0 });
      if (canvasOffsetRef) canvasOffsetRef.current = { x: 0, y: 0 };
    }
  }, [isActive, canvasOffsetRef]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isActive) return;
    setIsDragging(true);
    startPos.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !isActive) return;
    const newOffset = {
      x: e.clientX - startPos.current.x,
      y: e.clientY - startPos.current.y,
    };
    setOffset(newOffset);
    if (canvasOffsetRef) canvasOffsetRef.current = newOffset;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isActive) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className={`absolute inset-0 overflow-hidden transition-colors duration-500 ease-out ${
        isActive ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{
        zIndex: 0,
        backgroundColor: isActive ? canvasColor : "transparent",
        backgroundImage: isActive ? "radial-gradient(circle, rgba(0, 0, 0, 0.15) 1.5px, transparent 1.5px)" : "none",
        backgroundSize: "24px 24px",
        backgroundPosition: `${offset.x}px ${offset.y}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="w-full h-full flex items-center justify-center"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          transition: isDragging || isActive ? "none" : "transform 0.3s ease-out",
        }}
      >
        <div 
          className="transition-all duration-500 ease-out"
          style={{ 
            transform: isActive ? "scale(1)" : "scale(1)",
            width: "100%",
            height: "100%"
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
