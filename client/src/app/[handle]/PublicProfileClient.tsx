"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import CardStack from "@/components/dashboard/CardStack";
import InfiniteCanvas, { InfiniteCanvasRef } from "@/components/dashboard/InfiniteCanvas";
import ResourceNavigator from "@/components/dashboard/ResourceNavigator";
import CategorySwitch, { Category } from "@/components/dashboard/CategorySwitch";
import FloatingActionButton from "@/components/dashboard/FloatingActionButton";
import LoadingSpinner from "@/components/LoadingSpinner";
import { PageData } from "@/components/dashboard/ResourceMiniPanel";
import { Resource } from "@/components/dashboard/ResourceCard";
import { API_BASE } from "@/lib/api";
import { safeGetItem, safeSetItem } from "@/lib/safeStorage";
import { filterResourcesByCategory, parseCategory } from "@/lib/resourceFilters";

interface PublicProfileClientProps {
  username: string;
}

interface PublicUser {
  id: string;
  email: string;
  name: string;
  picture: string;
}

interface PublicPage {
  id: string;
  name: string;
  color: string;
  createdAt?: string;
  created_at?: string;
}

interface PublicProfileResponse {
  success: boolean;
  user: PublicUser;
  pages: PublicPage[];
  error?: string;
}

export default function PublicProfileClient({ username }: PublicProfileClientProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [user, setUser] = useState<PublicUser | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourcesPageId, setResourcesPageId] = useState<string | null>(null);
  const [isCanvasMode, setIsCanvasMode] = useState(() => safeGetItem(`saveswitch-public-canvas-${username}`) === 'true');
  const [activeCategory, setActiveCategory] = useState<Category>(() =>
    parseCategory(safeGetItem(`saveswitch-public-category-${username}`)));
  const [highlightedResourceId, setHighlightedResourceId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const canvasRef = useRef<InfiniteCanvasRef>(null);
  const canvasOffsetRef = useRef({ x: 0, y: 0 });

  // 1. Fetch user & public pages
  useEffect(() => {
    const controller = new AbortController();

    async function fetchProfile() {
      try {
        const res = await fetch(`${API_BASE}/public/users/${encodeURIComponent(username)}`, { signal: controller.signal });
        if (res.status === 404) throw new Error("User not found");
        if (!res.ok) throw new Error("We couldn't load this profile right now. Please try again later.");
        const data = await res.json() as PublicProfileResponse;
        if (controller.signal.aborted) return;
        if (!data.success) throw new Error(data.error || "User not found");

        setUser(data.user);
        
        const formattedPages = data.pages.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          createdAt: p.createdAt || p.created_at || new Date().toISOString()
        }));
        
        setPages(formattedPages);

        if (formattedPages.length > 0) {
          const savedPageId = safeGetItem(`saveswitch-public-page-${username}`);
          const pageToSet = formattedPages.some((p) => p.id === savedPageId)
            ? savedPageId
            : formattedPages[formattedPages.length - 1].id;
          setActivePageId(pageToSet);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "User not found");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void fetchProfile();
    return () => controller.abort();
  }, [username]);

  // 2. Fetch resources when active page changes
  useEffect(() => {
    if (!activePageId) {
      return;
    }

    const pageId = activePageId;
    let cancelled = false;
    let requestId = 0;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let reconnectAttempt = 0;
    const controller = new AbortController();

    async function fetchResources() {
      // Responses can finish out of order after a page switch or a burst of socket events; only the
      // newest request for the current page may update the canvas.
      const currentRequest = ++requestId;
      try {
        const res = await fetch(`${API_BASE}/public/pages/${encodeURIComponent(pageId)}/resources`, { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || currentRequest !== requestId) return;
        setResourcesPageId(pageId);
        setResources(data.resources || []);
      } catch (e) {
        if (cancelled) return;
        console.error("Failed to fetch resources", e);
      }
    }
    void fetchResources();

    // Real-time updates, reconnecting with backoff so a dropped socket does not freeze the view.
    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/ws`);
      socket = ws;

      ws.onopen = () => {
        const isReconnect = reconnectAttempt > 0;
        reconnectAttempt = 0;
        ws.send(JSON.stringify({ type: 'subscribe', pageId }));
        // Changes made while disconnected were never delivered.
        if (isReconnect) void fetchResources();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'resource_updated') {
            void fetchResources();
          }
        } catch {
          // Ignore malformed non-resource messages.
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        const waitMs = Math.min(1000 * 2 ** reconnectAttempt, 12000);
        reconnectAttempt += 1;
        retryTimer = window.setTimeout(connect, waitMs);
      };
    };
    connect();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [activePageId]);

  // Sidebar grouping logic (reusing same logic from DashboardPage)
  const dateGroups = useMemo(() => {
    const groups: { [key: string]: { label: string; date: string; pages: PageData[] } } = {};
    const now = new Date();

    const getGroupKey = (dateStr: string) => {
      const d = new Date(dateStr);
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 3600 * 24));
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      if (diffDays <= 7) return "Previous 7 Days";
      if (diffDays <= 30) return "Previous 30 Days";
      return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    };

    pages.forEach((page) => {
      const key = getGroupKey(page.createdAt);
      if (!groups[key]) {
        groups[key] = { label: key, date: key, pages: [] };
      }
      groups[key].pages.push(page);
    });

    Object.values(groups).forEach(g => {
      g.pages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });

    const order = ["Today", "Yesterday", "Previous 7 Days", "Previous 30 Days"];
    return Object.values(groups).sort((a, b) => {
      const idxA = order.indexOf(a.label);
      const idxB = order.indexOf(b.label);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return new Date(b.pages[0].createdAt).getTime() - new Date(a.pages[0].createdAt).getTime();
    });
  }, [pages]);

  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const activeGroupDate = useMemo(() => {
    return dateGroups.find(g => g.pages.some(p => p.id === activePageId))?.date ?? null;
  }, [activePageId, dateGroups]);

  const visibleExpandedDates = useMemo(() => {
    const next = new Set(expandedDates);
    if (activeGroupDate) next.add(activeGroupDate);
    return next;
  }, [activeGroupDate, expandedDates]);

  const handleToggleExpand = useCallback((date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }, []);

  const handleDateSelect = useCallback((date: string) => {
    setSelectedDate(date);
  }, []);

  const handlePageSelect = useCallback((id: string) => {
    setActivePageId(id);
    setIsCanvasMode(true);
  }, []);

  const handleCardSwipe = useCallback((id: string) => {
    setActivePageId(id);
  }, []);

  // Sync state to localStorage
  useEffect(() => {
    if (activePageId) {
      safeSetItem(`saveswitch-public-page-${username}`, activePageId);
    }
  }, [activePageId, username]);

  useEffect(() => {
    safeSetItem(`saveswitch-public-canvas-${username}`, isCanvasMode.toString());
  }, [isCanvasMode, username]);

  useEffect(() => {
    safeSetItem(`saveswitch-public-category-${username}`, activeCategory);
  }, [activeCategory, username]);

  const panTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (panTimerRef.current) window.clearTimeout(panTimerRef.current);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
  }, []);

  const handlePanToResource = useCallback((id: string, x: number, y: number) => {
    setIsCanvasMode(true);
    setHighlightedResourceId(id);

    if (panTimerRef.current) window.clearTimeout(panTimerRef.current);
    panTimerRef.current = window.setTimeout(() => {
      canvasRef.current?.panTo(x, y);
    }, 100);

    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedResourceId(null);
    }, 3000);
  }, []);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error || !user) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#191818] px-4 text-center text-white">
        <h2 className="text-xl">{error || "User not found"}</h2>
      </div>
    );
  }

  const activePage = pages.find(p => p.id === activePageId);
  const visibleResources = resourcesPageId === activePageId ? resources : [];
  const filteredResources = filterResourcesByCategory(visibleResources, activeCategory);

  return (
    <div className="flex h-dvh w-full overflow-hidden text-[#F8F8F8]">
      <DashboardSidebar
        user={user}
        dateGroups={dateGroups}
        selectedDate={selectedDate}
        expandedDates={visibleExpandedDates}
        onDateSelect={handleDateSelect}
        onToggleExpand={handleToggleExpand}
        onPageSelect={handlePageSelect}
        onPageUpdateName={() => {}}
        activePageId={activePageId}
        onLogout={() => {}}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onDeletePage={() => {}}
        readOnly={true}
      />

      <main
        className="relative flex h-dvh flex-1 flex-col overflow-hidden"
        style={{ background: "var(--color-app-bg)" }}
      >
        <div className="relative flex-1 flex flex-col overflow-hidden bg-black">
          {/* Top Right Controls (Category Switch) */}
          <div className="absolute right-4 top-4 z-40 flex items-center gap-3 pointer-events-auto sm:right-8 sm:top-8">
            <CategorySwitch activeCategory={activeCategory} onChange={setActiveCategory} />
          </div>

          <ResourceNavigator
            resources={filteredResources}
            onSelectResource={handlePanToResource}
            isActive={isCanvasMode}
          />

          <InfiniteCanvas ref={canvasRef} isActive={isCanvasMode} canvasColor={activePage?.color || "var(--color-app-bg)"} canvasOffsetRef={canvasOffsetRef}>
            <div className="flex-1 flex items-center justify-center h-full w-full">
            {pages.length > 0 ? (
              <CardStack
                pages={pages}
                activePageId={activePageId}
                isExpanded={isCanvasMode}
                onPageSelect={handleCardSwipe}
                resources={filteredResources}
                readOnly={true}
                highlightedResourceId={highlightedResourceId}
              />
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/saveswitch-logo.svg" alt="" className="w-16 h-16 opacity-20 mb-4" />
                <h2 className="text-white/40 text-xl font-bold">This user has no public pages</h2>
              </div>
            )}
            </div>
          </InfiniteCanvas>

          {/* ── Minimizer Button (Bottom Right) ── */}
          <div className="absolute bottom-4 right-4 z-10 pointer-events-auto sm:bottom-6 sm:right-6">
            <FloatingActionButton 
              onClick={() => setIsCanvasMode(!isCanvasMode)} 
              isActive={isCanvasMode} 
              readOnly={true}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
