"use client";

import React, { useState } from "react";
import { Resource } from "@/components/dashboard/ResourceCard";

interface ResourceNavigatorProps {
  resources: Resource[];
  onSelectResource: (id: string, x: number, y: number) => void;
  isActive: boolean;
}

export default function ResourceNavigator({ resources, onSelectResource, isActive }: ResourceNavigatorProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isActive) return null;

  return (
    <div className="absolute bottom-20 left-4 z-50 pointer-events-auto sm:bottom-8 sm:left-8">
      <div className="relative">
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="flex rounded-[20px] border border-white/10 bg-[#1D1D1D] px-3 py-2.5 text-white shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-colors hover:bg-[#2A2A2A] sm:items-center sm:gap-3 sm:px-4"
          title="Jump to Resource"
          aria-expanded={isOpen}
          aria-label="Jump to resource"
        >
          <img src="/icons/icon-resources.svg" alt="Resources" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
          <span className="hidden font-bold text-[13px] tracking-wide sm:inline">Resources</span>
          <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-bold">{resources.length}</span>
        </button>

        {isOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-3 w-[min(16rem,calc(100vw-32px))] overflow-hidden rounded-[20px] border border-white/10 bg-[#1D1D1D] shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-fade-in">
            <div className="max-h-[min(400px,60dvh)] overflow-y-auto p-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-black [&::-webkit-scrollbar-thumb]:rounded-full custom-scrollbar">
            {resources.length === 0 ? (
              <div className="text-white/50 text-xs text-center py-6 font-medium">No resources on this page</div>
            ) : (
              <div className="flex flex-col gap-1">
                {resources.map((res) => (
                  <button
                    key={res.id}
                    onClick={() => {
                      onSelectResource(res.id, res.x ?? 100, res.y ?? 100);
                      setIsOpen(false);
                    }}
                    className="flex items-center gap-3 p-2.5 hover:bg-white/10 rounded-[14px] text-left transition-colors w-full group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/5 group-hover:bg-white/10 flex items-center justify-center shrink-0 transition-colors">
                      <img 
                        src={`/icons/icon-${res.type === 'image' ? 'image' : res.type === 'link' ? 'link' : res.type === 'text' ? 'edit' : 'document'}.svg`} 
                        alt={res.type} 
                        className="w-[14px] h-[14px]" 
                        style={{ filter: 'brightness(0) invert(1)' }} 
                      />
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-white text-[13px] font-bold truncate w-full">
                        {res.title || `Untitled ${res.type}`}
                      </span>
                      <span className="text-white/40 text-[10px] font-medium uppercase tracking-wider">
                        {res.type}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
