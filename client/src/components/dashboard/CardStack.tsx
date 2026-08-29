"use client";


import ResourceCard, { Resource } from "./ResourceCard";
import styles from "./CardStack.module.css";
import { moveResource } from "./resourceSelection";

import React, { useState, useRef, useEffect } from "react";
import { motion } from 'framer-motion';
import { PageData } from "./ResourceMiniPanel";

interface CardStackProps {
  pages: PageData[];
  activePageId: string | null;
  isExpanded?: boolean;
  onPageSelect?: (id: string) => void;
  resources?: Resource[];
  onDeleteResource?: (id: string) => void;
  onUpdateResourcePosition?: (id: string, x: number, y: number) => void;
  onUpdateTextResource?: (id: string, content: string) => Promise<void>;
  canManageResource?: (resource: Resource) => boolean;
  onResourceDragStateChange?: (isDragging: boolean) => void;
  highlightedResourceId?: string | null;
  readOnly?: boolean;
}

const CARD_SHADOWS = [
  "0px 6px 18px 0px rgba(0,0,0,0.06), 0px 1px 2px 0px rgba(0,0,0,0.04)",
  "0px 6px 18px 0px rgba(0,0,0,0.07), 0px 1px 2px 0px rgba(0,0,0,0.05)",
  "0px 6px 18px 0px rgba(0,0,0,0.08), 0px 1px 2px 0px rgba(0,0,0,0.05)",
  "0px 8px 24px 0px rgba(0,0,0,0.09), 0px 1px 2px 0px rgba(0,0,0,0.06)",
  "0px 8px 24px 0px rgba(0,0,0,0.1), 0px 1px 2px 0px rgba(0,0,0,0.06)",
];

export default function CardStack({ pages, activePageId, isExpanded = false, onPageSelect, resources = [], onDeleteResource, onUpdateResourcePosition, onUpdateTextResource, canManageResource, onResourceDragStateChange, highlightedResourceId, readOnly = false }: CardStackProps) {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const isDraggingCard = useRef(false);
  const dragCancelled = useRef(false);
  const dragTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [winSize, setWinSize] = useState(() => {
    if (typeof window === "undefined") return { w: 1920, h: 1080 };
    return { w: window.innerWidth, h: window.innerHeight };
  });

  useEffect(() => {
    const updateSize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Rotate pages so the active page is at the end, preserving circular order
  let sortedPages = [...pages];
  const activeIndex = pages.findIndex((p) => p.id === activePageId);
  if (activeIndex !== -1) {
    const afterActive = pages.slice(activeIndex + 1);
    const beforeActiveAndIncluding = pages.slice(0, activeIndex + 1);
    sortedPages = [...afterActive, ...beforeActiveAndIncluding];
  }

  // Limit stack size visually to 5
  const visiblePages = sortedPages.slice(-5);
  const totalCards = visiblePages.length;
  const stackScale = isExpanded
    ? 1
    : Math.min(
        1,
        Math.max(0.42, (winSize.w - 48) / 662),
        Math.max(0.42, (winSize.h - 160) / 372.38)
      );
  const stackWidth = isExpanded ? "100%" : 662 * stackScale;
  const stackHeight = isExpanded ? "100%" : 372.38 * stackScale;

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

  const stopCardPointerPropagation = (event: React.PointerEvent<HTMLDivElement>) => {
    // The canvas begins panning on pointer-down. Stop that event at the card so
    // the same gesture cannot move both the card and its canvas.
    event.stopPropagation();
  };

  const beginResourceDrag = () => {
    dragCancelled.current = false;
    isDraggingCard.current = true;
    onResourceDragStateChange?.(true);
    if (dragTimeout.current) clearTimeout(dragTimeout.current);
  };

  const finishResourceDragState = () => {
    if (!isDraggingCard.current) return;

    onResourceDragStateChange?.(false);
    dragTimeout.current = setTimeout(() => {
      isDraggingCard.current = false;
    }, 100);
  };

  const finishResourceDrag = (resource: Resource, offset: { x: number; y: number }) => {
    if (!dragCancelled.current && onUpdateResourcePosition) {
      const position = moveResource(
        { id: resource.id, x: resource.x ?? 100, y: resource.y ?? 100 },
        offset,
      );
      onUpdateResourcePosition(position.id, position.x, position.y);
    }

    finishResourceDragState();
  };

  // Calculate bounding box for all resources to scale them inside minimized card
  let contentScale = 1;
  let centerX = 0;
  let centerY = 0;

  if (resources.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    resources.forEach(r => {
      const x = r.x ?? 100;
      const y = r.y ?? 100;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      // Rough estimates of card dimensions (approx 320x400 max)
      maxX = Math.max(maxX, x + 320);
      maxY = Math.max(maxY, y + 400);
    });

    // Add padding
    minX -= 100; minY -= 100;
    maxX += 100; maxY += 100;

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    centerX = (minX + maxX) / 2;
    centerY = (minY + maxY) / 2;

    const topCardW = 662;
    const topCardH = 372.38;

    const scaleX = topCardW / contentW;
    const scaleY = topCardH / contentH;
    contentScale = Math.min(scaleX, scaleY, 1); // Cap scale at 1
  } else {
    // If no resources, default to center of screen
    centerX = winSize.w / 2;
    centerY = winSize.h / 2;
    contentScale = 662 / Math.max(winSize.w, 662);
  }

  return (
    <div
      className="relative flex items-center justify-center transition-all duration-500 ease-out"
      style={{ width: stackWidth, height: stackHeight, maxWidth: "100%" }}
    >
      <div
        className="relative transition-all duration-500 ease-out shrink-0"
        style={{
          width: isExpanded ? "100%" : 662,
          height: isExpanded ? "100%" : 372,
          minWidth: isExpanded ? "auto" : 662,
          minHeight: isExpanded ? "auto" : 372,
          transform: isExpanded ? "none" : `scale(${stackScale})`,
          transformOrigin: "center",
        }}
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
              className={`absolute ${!isExpanded ? "overflow-hidden" : ""} ${isExpanded && !isTopCard ? "opacity-0 pointer-events-none scale-95 translate-y-8" : "opacity-100 scale-100 translate-y-0"} ${isDragging && isTopCard ? "" : "transition-all duration-500 ease-out"}`}
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
              {isTopCard && (
                <div
                  className={`relative ${isExpanded ? "w-full h-full pointer-events-auto" : "absolute left-1/2 top-1/2 pointer-events-none"}`}
                  style={isExpanded ? {} : {
                    width: 0,
                    height: 0,
                    transform: `scale(${contentScale}) translate(${-centerX}px, ${-centerY}px)`,
                    transformOrigin: "0 0"
                  }}
                >
                  {resources.length === 0 && readOnly ? (
                    <div className="w-full h-full flex items-center justify-center pointer-events-none">
                      <span className="text-white/40 font-arimo text-lg select-none">
                        This page is empty.
                      </span>
                    </div>
                  ) : resources.length > 0 ? (
                    resources.map((res) => {
                      const resourceReadOnly = readOnly || (canManageResource ? !canManageResource(res) : false);
                      return (
                        <motion.div
                          key={res.id}
                          data-resource-id={res.id}
                          className={`absolute w-[min(300px,calc(100vw-48px))] max-w-[300px] flex-shrink-0 animate-fade-in transition-[box-shadow] duration-500 rounded-[12px] ${isExpanded ? 'pointer-events-auto cursor-grab active:cursor-grabbing' : 'pointer-events-none'} ${res.id === highlightedResourceId ? styles.focusedResource : ''}`}
                          style={{ zIndex: res.zIndex || 1 }}
                          initial={{ x: res.x ?? 100, y: res.y ?? 100, rotate: res.rotation ?? 0 }}
                          animate={{
                            x: res.x ?? 100,
                            y: res.y ?? 100,
                            rotate: res.rotation ?? 0,
                          }}
                          drag={!resourceReadOnly}
                          dragMomentum={false}
                          onPointerDown={stopCardPointerPropagation}
                          onPointerCancel={(event) => {
                            event.stopPropagation();
                            dragCancelled.current = true;
                            finishResourceDragState();
                          }}
                          onDragStart={beginResourceDrag}
                          onDragEnd={(_, info) => finishResourceDrag(res, info.offset)}
                          onClickCapture={(event) => {
                            if (isDraggingCard.current) {
                              event.stopPropagation();
                              event.preventDefault();
                            }
                          }}
                        >
                          <ResourceCard
                            resource={res}
                            onDelete={resourceReadOnly ? undefined : onDeleteResource}
                            onUpdateText={resourceReadOnly ? undefined : onUpdateTextResource}
                            readOnly={resourceReadOnly}
                          />
                        </motion.div>
                      );
                    })
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
