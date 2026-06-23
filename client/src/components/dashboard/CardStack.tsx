"use client";

interface Resource {
  id: string;
  type: "text" | "link" | "image";
  content: string;
  created_at: string;
}

import React, { useState, useRef } from "react";
import { PageData } from "./ResourceMiniPanel";

interface CardStackProps {
  pages: PageData[];
  activePageId: string | null;
  isExpanded?: boolean;
  onPageSelect?: (id: string) => void;
}

const CARD_SHADOWS = [
  "0px 6px 18px 0px rgba(0,0,0,0.06), 0px 1px 2px 0px rgba(0,0,0,0.04)",
  "0px 6px 18px 0px rgba(0,0,0,0.07), 0px 1px 2px 0px rgba(0,0,0,0.05)",
  "0px 6px 18px 0px rgba(0,0,0,0.08), 0px 1px 2px 0px rgba(0,0,0,0.05)",
  "0px 8px 24px 0px rgba(0,0,0,0.09), 0px 1px 2px 0px rgba(0,0,0,0.06)",
  "0px 8px 24px 0px rgba(0,0,0,0.1), 0px 1px 2px 0px rgba(0,0,0,0.06)",
];

export default function CardStack({ pages, activePageId, isExpanded = false, onPageSelect }: CardStackProps) {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });

  // Sort pages so the active page is always rendered last (on top)
  const sortedPages = [...pages].sort((a, b) => {
    if (a.id === activePageId) return 1;
    if (b.id === activePageId) return -1;
    return 0;
  });

  // Limit stack size visually to 5
  const visiblePages = sortedPages.slice(-5);
  const totalCards = visiblePages.length;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isExpanded) return;
    setIsDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || isExpanded) return;
    setDragOffset({
      x: e.clientX - startPos.current.x,
      y: e.clientY - startPos.current.y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging || isExpanded) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    const distance = Math.sqrt(dragOffset.x ** 2 + dragOffset.y ** 2);
    if (distance > 100) {
      // Swiped! Swap to the one underneath
      if (pages.length > 1 && onPageSelect) {
        const nextActive = sortedPages[sortedPages.length - 2];
        if (nextActive) {
          onPageSelect(nextActive.id);
        }
      }
    }
    setDragOffset({ x: 0, y: 0 });
  };

  return (
    <div
      className="relative flex items-center justify-center transition-all duration-500"
      style={{ width: isExpanded ? "100%" : 662, height: isExpanded ? "100%" : 372.38 }}
    >
      <div
        className="relative transition-all duration-500"
        style={{ width: isExpanded ? "100%" : 662, height: isExpanded ? "100%" : 372 }}
      >
        {visiblePages.map((page, index) => {
          const isTopCard = index === totalCards - 1;
          
          // Original Figma stacking math
          const widthBase = 503.12;
          const heightBase = 282.72;
          const widthStep = 39.72;
          const heightStep = 22.32;
          const xStep = 19.86;
          const yStep = 26.06;

          // Adjust math based on actual number of cards (so the top card is always full size)
          // We pretend index is shifted so the top card behaves as index 4 would in a 5-card stack
          const adjustedIndex = 4 - (totalCards - 1 - index);

          const cardWidth = widthBase + adjustedIndex * widthStep;
          const cardHeight = heightBase + adjustedIndex * heightStep;
          const cardX = (4 - adjustedIndex) * xStep; 
          const cardY = (4 - adjustedIndex) * (-yStep) + 52.13;

          const radiusBase = 6.08;
          const radiusStep = 0.48;
          const borderRadius = radiusBase + adjustedIndex * radiusStep;

          return (
            <div
              key={page.id}
              className={`absolute ease-out ${isExpanded && !isTopCard ? "opacity-0 pointer-events-none scale-90" : "opacity-100"} ${isDragging && isTopCard ? "" : "transition-all duration-500"}`}
              style={
                isExpanded && isTopCard
                  ? {
                      width: "100%",
                      height: "100%",
                      left: 0,
                      top: 0,
                      background: "transparent",
                      boxShadow: "none",
                      zIndex: index,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 0,
                    }
                  : {
                      width: cardWidth,
                      height: cardHeight,
                      left: cardX,
                      top: cardY,
                      background: page.color,
                      backgroundImage: "radial-gradient(circle, rgba(0, 0, 0, 0.15) 1.5px, transparent 1.5px)",
                      backgroundSize: "24px 24px",
                      borderRadius,
                      boxShadow: CARD_SHADOWS[Math.min(adjustedIndex, CARD_SHADOWS.length - 1)],
                      zIndex: index,
                      transform: isTopCard && isDragging ? `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${dragOffset.x * 0.02}deg)` : "none",
                      cursor: isTopCard ? (isDragging ? "grabbing" : "grab") : "default",
                      touchAction: isTopCard ? "none" : "auto",
                    }
              }
              onPointerDown={isTopCard ? handlePointerDown : undefined}
              onPointerMove={isTopCard ? handlePointerMove : undefined}
              onPointerUp={isTopCard ? handlePointerUp : undefined}
              onPointerCancel={isTopCard ? handlePointerUp : undefined}
            >
              {isExpanded && isTopCard && (
                <div style={{ width: "100%", height: "100%", borderRadius: 0, overflow: "hidden" }}>
                  {/* Inside content could go here in canvas mode */}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
