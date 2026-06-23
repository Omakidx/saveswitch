"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import VisibilityToggle from "@/components/dashboard/VisibilityToggle";
import CardStack from "@/components/dashboard/CardStack";
import ResourceMiniPanel, { PageData } from "@/components/dashboard/ResourceMiniPanel";
import FloatingActionButton from "@/components/dashboard/FloatingActionButton";
import InfiniteCanvas from "@/components/dashboard/InfiniteCanvas";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";

/* ── Types ── */
interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
}

interface Resource {
  id: string;
  type: "text" | "link" | "image";
  content: string;
  created_at: string;
}

interface DateGroup {
  label: string;
  date: string; // ISO date string (YYYY-MM-DD)
  pages: PageData[];
}

interface ToastMessage {
  id: string;
  message: string;
  type: 'error' | 'success' | 'info';
}

interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

/* ── Helpers ── */
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const target = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  if (target.getTime() === today.getTime()) return "Today";
  if (target.getTime() === yesterday.getTime()) return "Yesterday";

  // Format: "17th May 2025"
  const day = target.getDate();
  const suffix =
    day === 1 || day === 21 || day === 31
      ? "st"
      : day === 2 || day === 22
        ? "nd"
        : day === 3 || day === 23
          ? "rd"
          : "th";
  const month = target.toLocaleString("en-US", { month: "long" });
  const year = target.getFullYear();
  return `${day}${suffix} ${month} ${year}`;
}

function groupPagesByDate(pages: PageData[]): DateGroup[] {
  const groups: Record<string, PageData[]> = {};

  for (const page of pages) {
    const dateKey = page.createdAt.split("T")[0]; // YYYY-MM-DD
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(page);
  }

  // Sort dates descending (most recent first)
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, pgs]) => ({
      label: formatDateLabel(date),
      date,
      pages: pgs.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    }));
}

/* ── Dashboard Page ── */
export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'error') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // Modal
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

  const [visibility, setVisibility] = useState<"private" | "public">("public");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isCanvasMode, setIsCanvasMode] = useState(false);

  // Pages state - initialized with dummy data matching the Figma design dates
  const [pages, setPages] = useState<PageData[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  /* ── Fetch user & resources on mount ── */
  useEffect(() => {
    async function init() {
      try {
        // Fetch user info
        const meRes = await fetch(`${API_BASE}/auth/me`, {
          credentials: "include",
        });
        const meData = await meRes.json();
        if (meData.authenticated) {
          setUser(meData.user);
        }

        // Fetch pages
        const resRes = await fetch(`${API_BASE}/pages`, {
          credentials: "include",
        });
        if (resRes.ok) {
          const resData = await resRes.json();
          const fetchedPages = resData.pages || [];
          
          const formattedPages = fetchedPages.map((p: any) => ({
            id: p.id,
            color: p.color,
            createdAt: p.created_at,
            name: p.name,
          }));
          
          setPages(formattedPages);
          
          if (formattedPages.length > 0) {
            setActivePageId(formattedPages[formattedPages.length - 1].id);
            const groups = groupPagesByDate(formattedPages);
            if (groups.length > 0) {
              setSelectedDate(groups[0].date);
              const toExpand = groups.slice(0, 2).map(g => g.date);
              setExpandedDates(new Set(toExpand));
            }
          }
        }
      } catch (err) {
        console.error("Dashboard init error:", err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  /* ── Grouped resources ── */
  const dateGroups = groupPagesByDate(pages);

  /* ── Handlers ── */
  const handleDateSelect = useCallback((date: string) => {
    setSelectedDate(date);
  }, []);

  const handleToggleExpand = useCallback((date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }, []);

  const handleVisibilityToggle = useCallback(
    async (mode: "private" | "public") => {
      setVisibility(mode);
      try {
        await fetch(`${API_BASE}/users/me/visibility`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: mode }),
        });
      } catch (err) {
        console.error("Visibility toggle error:", err);
      }
    },
    []
  );

  const handleLogout = useCallback(async () => {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    window.location.href = "/login";
  }, []);

  const handleAddPage = useCallback(async () => {
    const randomColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 85%)`;
    
    // Ensure unique default name for the day
    const todayPrefix = new Date().toISOString().split('T')[0];
    let counter = pages.length + 1;
    let newName = `Untitled Page ${counter}`;
    while (pages.some(p => p.name === newName && p.createdAt.startsWith(todayPrefix))) {
      counter++;
      newName = `Untitled Page ${counter}`;
    }
    
    try {
      const res = await fetch(`${API_BASE}/pages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: randomColor, name: newName }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.page) {
          const newPage: PageData = {
            id: data.page.id,
            color: data.page.color,
            createdAt: data.page.created_at,
            name: data.page.name,
          };
          setPages((prev) => [...prev, newPage]);
          setActivePageId(newPage.id);
          setExpandedDates((prev) => new Set(prev).add(todayPrefix));
        } else {
          showToast(`Failed to add page: ${data.error || 'Unknown error'}`, 'error');
        }
      }
    } catch (err) {
      console.error("Failed to add page", err);
      showToast("A network error occurred while adding the page.", 'error');
    }
  }, [pages, showToast]);

  const handlePageSelect = useCallback((id: string) => {
    setActivePageId(id);
  }, []);

  const executeDeletePage = useCallback(async (id: string) => {
    setPages((prev) => {
      const filtered = prev.filter(p => p.id !== id);
      // Update active page id if we deleted the currently active page
      if (id === activePageId) {
        if (filtered.length > 0) {
          // Default to the last created one or the first one
          setActivePageId(filtered[filtered.length - 1].id);
        } else {
          setActivePageId(null);
        }
      }
      return filtered;
    });

    try {
      const res = await fetch(`${API_BASE}/pages/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(`Failed to delete page: ${errData.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error("Failed to delete page", err);
      showToast("A network error occurred while deleting the page.", 'error');
    }
  }, [activePageId, showToast]);

  const handleDeletePage = useCallback((id: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Page",
      message: "Are you sure you want to delete this page? This action cannot be undone.",
      onConfirm: () => {
        executeDeletePage(id);
        setConfirmModal(null);
      }
    });
  }, [executeDeletePage]);

  const handlePageUpdateName = useCallback(async (id: string, newName: string) => {
    if (!newName.trim()) return;

    const targetPage = pages.find(p => p.id === id);
    if (!targetPage) return;
    
    const targetDate = targetPage.createdAt.split('T')[0];
    const isDuplicate = pages.some(p => p.id !== id && p.name.trim() === newName.trim() && p.createdAt.startsWith(targetDate));
    
    if (isDuplicate) {
      showToast("A page with this name already exists on this day.", 'error');
      return;
    }

    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, name: newName.trim() } : p)));

    try {
      const res = await fetch(`${API_BASE}/pages/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(`Failed to update page name: ${errData.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error("Failed to update page name", err);
      showToast("A network error occurred while updating the page name.", 'error');
    }
  }, [pages, showToast]);

  const handleFabClick = useCallback(() => {
    setIsCanvasMode((prev) => !prev);
  }, []);

  /* ── Active Page state ── */
  const activePage = pages.find(p => p.id === activePageId);

  /* ── Loading state ── */
  if (loading) {
    return (
      <div
        className="flex items-center justify-center w-full h-screen"
        style={{ background: "var(--color-app-bg)" }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{
              borderColor: "var(--color-surface-border)",
              borderTopColor: "var(--color-text-primary)",
            }}
          />
          <span
            className="font-arimo text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Loading dashboard…
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Left Sidebar ── */}
      <DashboardSidebar
        user={user}
        dateGroups={dateGroups}
        selectedDate={selectedDate}
        expandedDates={expandedDates}
        onDateSelect={handleDateSelect}
        onToggleExpand={handleToggleExpand}
        onLogout={handleLogout}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        onPageSelect={handlePageSelect}
        onPageUpdateName={handlePageUpdateName}
        activePageId={activePageId}
        onDeletePage={handleDeletePage}
      />

      {/* ── Main Content Area ── */}
      <main
        className="flex-1 relative flex flex-col h-screen overflow-hidden"
        style={{ background: "var(--color-app-bg)" }}
      >
        <div className="relative flex-1 flex flex-col overflow-hidden bg-black">
          {/* ── Private/Public Toggle (top center) ── */}
          <div className="absolute top-0 left-0 w-full flex justify-center pt-8 z-10 pointer-events-none">
            <div className="pointer-events-auto">
              <VisibilityToggle
                visibility={visibility}
                onToggle={handleVisibilityToggle}
              />
            </div>
          </div>

          {/* ── Workspace / Card Stack (centered) ── */}
          <InfiniteCanvas isActive={isCanvasMode} canvasColor={activePage?.color || "var(--color-app-bg)"}>
            <div className="flex-1 flex items-center justify-center h-full w-full">
            {pages.length > 0 ? (
              <CardStack 
                pages={pages}
                activePageId={activePageId}
                isExpanded={isCanvasMode} 
                onPageSelect={handlePageSelect}
              />
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full">
                <span
                  className="font-arimo text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  No pages yet. Click the + button on the right to create a new page.
                </span>
              </div>
            )}
          </div>
        </InfiniteCanvas>

        {/* ── Right Navigation (Floating on right edge) ── */}
        <div
          className="absolute"
          style={{
            right: 66,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 10,
          }}
        >
          <ResourceMiniPanel
            pages={pages}
            activePageId={activePageId}
            onAddPage={handleAddPage}
            onPageSelect={handlePageSelect}
            onDeletePage={handleDeletePage}
          />
        </div>

        {/* ── Minimizer Button ── */}
        <div
          className="absolute"
          style={{ right: 24, bottom: 24, zIndex: 10 }}
        >
          <FloatingActionButton onClick={handleFabClick} isActive={isCanvasMode} />
        </div>

        </div> {/* Close inner relative flex-1 div */}
      </main>

      {/* ── Global Toaster ── */}
      <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto px-5 py-3.5 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.3)] flex items-center gap-3"
            style={{
              background:
                toast.type === "error"
                  ? "rgba(50, 20, 20, 0.65)"
                  : "rgba(30, 30, 30, 0.65)",
              border:
                toast.type === "error"
                  ? "1px solid rgba(255, 100, 100, 0.15)"
                  : "1px solid rgba(255, 255, 255, 0.1)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              transformOrigin: "bottom right",
              animation: "toast-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards",
            }}
          >
            {toast.type === "error" && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 140, 140, 1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            )}
            <span
              className="font-arimo text-[14px] leading-relaxed tracking-wide"
              style={{
                color: toast.type === "error" ? "rgba(255, 210, 210, 1)" : "white",
              }}
            >
              {toast.message}
            </span>
          </div>
        ))}
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes toast-slide-in {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes modal-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modal-zoom-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}} />

      {/* ── Global Confirmation Modal ── */}
      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            style={{ animation: "modal-fade-in 0.2s ease-out forwards" }}
            onClick={() => setConfirmModal(null)}
          />
          {/* Modal Content */}
          <div 
            className="relative bg-[var(--color-surface)] border border-[var(--color-surface-border)] rounded-2xl shadow-2xl p-6 flex flex-col gap-4"
            style={{ 
              width: 420, 
              maxWidth: '90vw',
              animation: "modal-zoom-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards"
            }}
          >
            <h2 className="font-jakarta text-xl font-bold m-0" style={{ color: "var(--color-text-primary)" }}>
              {confirmModal.title}
            </h2>
            <p className="font-arimo text-[15px] m-0 leading-relaxed" style={{ color: "var(--color-text-primary)", opacity: 0.8 }}>
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-5 py-2.5 rounded-xl font-arimo text-sm font-semibold cursor-pointer transition-colors hover:bg-white/10 bg-transparent border-none"
                style={{ color: "var(--color-text-primary)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-arimo text-sm font-semibold cursor-pointer transition-all bg-red-600 hover:bg-red-700 text-white shadow-md hover:shadow-lg active:scale-95 border-none"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/icons/icon-trash.svg"
                  alt=""
                  width={16}
                  height={16}
                  style={{ filter: "brightness(0) invert(1)" }}
                />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
