"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { PageData } from "./ResourceMiniPanel";

interface DateGroup {
  label: string;
  date: string;
  pages: PageData[];
}

interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
}

interface DashboardSidebarProps {
  user: User | null;
  dateGroups: DateGroup[];
  selectedDate: string | null;
  expandedDates: Set<string>;
  onDateSelect: (date: string) => void;
  onToggleExpand: (date: string) => void;
  onPageSelect: (pageId: string) => void;
  onPageUpdateName: (pageId: string, newName: string) => void;
  activePageId: string | null;
  onLogout: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onDeletePage: (pageId: string) => void;
  readOnly?: boolean;
}

export default function DashboardSidebar({
  user,
  dateGroups,
  selectedDate,
  expandedDates,
  onDateSelect,
  onToggleExpand,
  onPageSelect,
  onPageUpdateName,
  activePageId,
  onLogout,
  collapsed,
  onToggleCollapse,
  onDeletePage,
  readOnly = false,
}: DashboardSidebarProps) {
  const router = useRouter();
  const [isProfileExpanded, setIsProfileExpanded] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        className="fixed z-50 flex items-center justify-center cursor-pointer border border-white/10 transition-all duration-200 hover:scale-110 hover:shadow-xl active:scale-95"
        style={{
          width: 48,
          height: 48,
          background: "#191818",
          borderRadius: 24,
          left: 24,
          bottom: 24,
        }}
        aria-label="Expand sidebar"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-layout-right.svg"
          alt=""
          width={20}
          height={20}
          className="opacity-80"
          style={{ filter: "brightness(0) invert(1)" }}
        />
      </button>
    );
  }

  return (
    <aside
      className="relative flex flex-col shrink-0 h-screen"
      style={{ width: 247, background: "var(--color-sidebar-bg)" }}
    >
      {/* ── Header / Logo Area ── */}
      <div className="flex flex-col p-2" style={{ height: 64 }}>
        <div className="flex items-center justify-between rounded-md p-2 h-full">
          <div className="flex items-center gap-2 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/saveswitch-logo.svg"
              alt="SaveSwitch logo icon"
              className="h-5 w-auto object-contain shrink-0"
            />
            <span
              className="font-jakarta font-bold text-lg leading-7 truncate"
              style={{ color: "var(--color-text-primary)" }}
            >
              SaveSwitch
            </span>
          </div>
          
          <button
            type="button"
            onClick={onToggleCollapse}
            className="cursor-pointer border-none bg-transparent hover:opacity-80 transition-opacity duration-200 flex items-center justify-center shrink-0 ml-2"
            aria-label="Collapse sidebar"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/icon-layout-right.svg"
              alt=""
              width={20}
              height={20}
              className="opacity-60"
            />
          </button>
        </div>
      </div>

      {/* ── Date Navigation List ── */}
      <nav
        className="flex flex-col gap-1 overflow-y-auto flex-1"
        style={{ padding: "8px", width: 247 }}
      >
        {dateGroups.map((group) => (
          <SidebarDateEntry
            key={group.date}
            group={group}
            isExpanded={expandedDates.has(group.date)}
            isSelected={selectedDate === group.date}
            onToggle={() => onToggleExpand(group.date)}
            onSelect={() => onDateSelect(group.date)}
            onPageSelect={onPageSelect}
            onPageUpdateName={onPageUpdateName}
            activePageId={activePageId}
            onDeletePage={onDeletePage}
            readOnly={readOnly}
          />
        ))}
      </nav>

      {/* ── User Profile Footer / Sign Up CTA ── */}
      {readOnly ? (
        <div className="p-3 w-full" style={{ marginTop: "auto" }}>
          <div className="flex flex-col gap-3.5 p-3.5 rounded-[12px] bg-[#1C1C1C] border border-white/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            <div className="flex gap-2.5 items-start">
              {/* Info SVG */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/50 shrink-0 mt-[2px]"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <span className="text-white/70 font-arimo text-[12px] leading-[16px]">You are currently exploring a public workspace.</span>
            </div>
            
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex gap-2.5 items-start">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-[#5DF286] shrink-0 mt-[2px]"><polyline points="20 6 9 17 4 12"/></svg>
                <span className="text-white/40 font-arimo text-[11px] leading-[14px]">Read-only access to shared resources</span>
              </div>
              <div className="flex gap-2.5 items-start">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-[#5DF286] shrink-0 mt-[2px]"><polyline points="20 6 9 17 4 12"/></svg>
                <span className="text-white/40 font-arimo text-[11px] leading-[14px]">Pan, zoom, and view any content safely</span>
              </div>
              <div className="flex gap-2.5 items-start">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-[#5DF286] shrink-0 mt-[2px]"><polyline points="20 6 9 17 4 12"/></svg>
                <span className="text-white/40 font-arimo text-[11px] leading-[14px]">Create your own canvas to start saving</span>
              </div>
            </div>

            <a href="/register" className="w-full py-2 mt-1 bg-[#282828] hover:bg-[#333333] rounded-md text-[#E0E0E0] font-arimo font-semibold text-[12px] text-center transition-colors no-underline shadow-sm border border-white/5">
              Get Started
            </a>
          </div>
        </div>
      ) : user ? (
        <div 
          className="p-2 pb-2 relative" 
          style={{ marginTop: "auto" }}
          onMouseEnter={() => !readOnly && setIsProfileExpanded(true)}
          onMouseLeave={() => !readOnly && setIsProfileExpanded(false)}
        >
          {/* Profile Menu Popup Wrapper (maintains hover state across gap) */}
          {isProfileExpanded && (
            <div
              className="absolute left-2 right-2 z-50"
              style={{ bottom: "100%", paddingBottom: "4px" }}
            >
              <div
                className="flex flex-col p-1.5 rounded-xl shadow-2xl border animate-in fade-in zoom-in-95 duration-150"
                style={{
                  background: "rgba(30, 30, 30, 0.75)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  borderColor: "rgba(255, 255, 255, 0.1)",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsProfileExpanded(false);
                    router.push("/dashboard/profile");
                  }}
                  className="group flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer border-none bg-transparent text-white/90 hover:bg-white/10 hover:text-white rounded-lg transition-all duration-200 text-left w-full font-arimo"
                >
                  <img
                    src="/icons/icon-profile.svg"
                    alt=""
                    width={14}
                    height={14}
                    className="opacity-70 group-hover:opacity-100 transition-all duration-200"
                    style={{ filter: "brightness(0) invert(1)" }}
                  />
                  Profile
                </button>
                <div className="h-[1px] w-full bg-white/10 my-1"></div>
                <button
                  type="button"
                  onClick={() => {
                    setIsProfileExpanded(false);
                    onLogout();
                  }}
                  className="group flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer border-none bg-transparent text-red-400 hover:bg-red-600 hover:text-white rounded-lg transition-all duration-200 text-left w-full font-arimo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/icons/icon-logout.svg"
                    alt=""
                    width={14}
                    height={14}
                    className="delete-context-icon opacity-80 group-hover:opacity-100 transition-all duration-200"
                  />
                  Log out
                </button>
              </div>
            </div>
          )}

          <div
            className="flex items-center gap-2 rounded-md p-2 cursor-pointer hover:bg-white/5 transition-colors"
            style={{
              width: "100%",
              height: 48,
              background: "var(--color-user-footer-bg)",
            }}
          >
            {/* Avatar */}
            <div className="shrink-0 rounded-full overflow-hidden" style={{ width: 32, height: 32 }}>
              {user.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.picture}
                  alt={user.name}
                  width={32}
                  height={32}
                  className="rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/icons/avatar-placeholder.png"
                  alt={user.name}
                  width={32}
                  height={32}
                  className="rounded-full object-cover"
                />
              )}
            </div>

            {/* Name & Email */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <span
                className="font-arimo text-[13px] truncate"
                style={{
                  color: "var(--color-text-primary)",
                  lineHeight: "16px",
                  marginBottom: "2px",
                }}
              >
                {user.name}
              </span>
              <span
                className="font-arimo text-[11px] truncate"
                style={{
                  color: "var(--color-text-primary)",
                  lineHeight: "14px",
                  opacity: 0.6,
                }}
              >
                {user.email}
              </span>
            </div>

            {/* Expand Toggle */}
            <div className="shrink-0 flex items-center justify-center text-[var(--color-text-primary)]">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60 transition-transform duration-200" style={{ transform: isProfileExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                <path d="m7 15 5 5 5-5"/>
                <path d="m7 9 5-5 5 5"/>
              </svg>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

/* ── Sidebar Date Entry (internal) ── */

interface DateEntryProps {
  group: DateGroup;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onPageSelect: (pageId: string) => void;
  onPageUpdateName: (pageId: string, newName: string) => void;
  activePageId: string | null;
  onDeletePage: (pageId: string) => void;
  readOnly?: boolean;
}

function SidebarDateEntry({
  group,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onPageSelect,
  onPageUpdateName,
  activePageId,
  onDeletePage,
  readOnly = false,
}: DateEntryProps) {
  const hasPages = group.pages.length > 0;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ pageId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

  return (
    <div className="flex flex-col w-full">
      {/* Date header row */}
      <button
        type="button"
        onClick={() => {
          onSelect();
          if (hasPages) onToggle();
        }}
        className="flex items-center gap-2 rounded-md cursor-pointer border-none transition-all duration-200 group w-full"
        style={{
          height: 32,
          padding: "0 8px",
          background: isSelected
            ? "linear-gradient(180deg, rgba(51,51,51,1) 0%, rgba(29,29,29,0.4) 100%)"
            : "transparent",
          border: isSelected
            ? "1px solid var(--color-surface-border)"
            : "1px solid transparent",
          borderRadius: 6,
        }}
      >
        {/* Calendar icon */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-calendar.svg"
          alt=""
          width={20}
          height={20}
          className="shrink-0 opacity-70"
        />

        {/* Date text */}
        <span
          className="font-arimo text-sm leading-5 flex-1 text-left truncate"
          style={{ color: "var(--color-text-primary)" }}
        >
          {group.label}
        </span>

        {/* Chevron */}
        {hasPages && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/icons/icon-chevron-down.svg"
            alt=""
            width={16}
            height={16}
            className="shrink-0 opacity-50 transition-transform duration-200"
            style={{
              transform: isExpanded ? "rotate(0deg)" : "rotate(90deg)",
            }}
          />
        )}
      </button>

      {/* Expanded resources sub-list */}
      {isExpanded && hasPages && (
        <div
          className="flex flex-col mt-1"
          style={{ padding: "0 12px" }}
        >
          <div
            className="flex flex-col gap-1"
            style={{
              padding: "4px 0 4px 10px",
              borderLeft: "1px solid var(--color-sidebar-sub-border)",
            }}
          >
            {group.pages.map((page) => {
              const isEditing = editingId === page.id;
              
              return (
                <div
                  key={page.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPageSelect(page.id);
                  }}
                  onDoubleClick={(e) => {
                    if (readOnly) return;
                    e.stopPropagation();
                    setEditingId(page.id);
                    setEditName(page.name);
                  }}
                  onContextMenu={(e) => {
                    if (readOnly) return;
                    e.preventDefault();
                    setContextMenu({ pageId: page.id, x: e.clientX, y: e.clientY });
                  }}
                  className="flex items-center gap-2 rounded-md cursor-pointer hover:bg-white/10 transition-colors duration-150 w-full"
                  style={{
                    padding: "0 8px",
                    height: 28,
                    borderRadius: 6,
                    background: activePageId === page.id ? "rgba(255, 255, 255, 0.1)" : "transparent",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/icons/icon-browser.svg"
                    alt=""
                    width={18}
                    height={18}
                    className="shrink-0 opacity-70"
                  />
                  {isEditing ? (
                    <input
                      type="text"
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onPageUpdateName(page.id, editName);
                          setEditingId(null);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      onBlur={() => {
                        onPageUpdateName(page.id, editName);
                        setEditingId(null);
                      }}
                      className="font-arimo text-[13px] leading-5 flex-1 bg-transparent border-none outline-none text-white w-full"
                    />
                  ) : (
                    <span
                      className="font-arimo text-[13px] leading-5 truncate flex-1 select-none"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {page.name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Context Menu Portal */}
      {contextMenu && (
        <div 
          className="fixed z-[9999] flex flex-col p-1.5 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-150"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            background: "rgba(30, 30, 30, 0.75)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            width: 160,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-white/90 hover:bg-white/10 hover:text-white rounded-lg transition-colors border-none bg-transparent cursor-pointer text-left w-full font-arimo"
            onClick={() => {
              const p = group.pages.find(p => p.id === contextMenu.pageId);
              if (p) {
                setEditingId(p.id);
                setEditName(p.name);
              }
              setContextMenu(null);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-edit.svg" alt="" width={14} height={14} style={{ filter: "brightness(0) invert(1)", opacity: 0.7 }} />
            Edit name
          </button>
          
          <div className="h-[1px] w-full bg-white/10 my-1"></div>
          
          <button
            type="button"
            className="group flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-red-600 hover:text-white rounded-lg transition-all duration-200 border-none bg-transparent cursor-pointer text-left w-full font-arimo"
            onClick={() => {
              onDeletePage(contextMenu.pageId);
              setContextMenu(null);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src="/icons/icon-trash.svg" 
              alt="" 
              width={14} 
              height={14} 
              className="delete-context-icon opacity-80 group-hover:opacity-100 transition-all duration-200" 
            />
            Delete
          </button>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .delete-context-icon { filter: brightness(0) invert(0.6) sepia(1) saturate(5) hue-rotate(-50deg); }
        .group:hover .delete-context-icon { filter: brightness(0) invert(1); }
      `}} />
    </div>
  );
}
