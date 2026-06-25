"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import CardStack from "@/components/dashboard/CardStack";
import InfiniteCanvas from "@/components/dashboard/InfiniteCanvas";
import ResourceNavigator from "@/components/dashboard/ResourceNavigator";
import CategorySwitch, { Category } from "@/components/dashboard/CategorySwitch";
import FloatingActionButton from "@/components/dashboard/FloatingActionButton";
import LoadingSpinner from "@/components/LoadingSpinner";
import { PageData } from "@/components/dashboard/ResourceMiniPanel";
import { Resource } from "@/components/dashboard/ResourceCard";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface PublicProfileClientProps {
  username: string;
}

export default function PublicProfileClient({ username }: PublicProfileClientProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [user, setUser] = useState<any>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [isCanvasMode, setIsCanvasMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`saveswitch-public-canvas-${username}`) === 'true';
    }
    return false;
  });
  const [activeCategory, setActiveCategory] = useState<Category>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`saveswitch-public-category-${username}`);
      return (saved as Category) || 'target';
    }
    return 'target';
  });
  const [highlightedResourceId, setHighlightedResourceId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const canvasRef = useRef<any>(null);
  const canvasOffsetRef = useRef({ x: 0, y: 0 });

  // 1. Fetch user & public pages
  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch(`${API_BASE}/public/users/${username}`);
        if (!res.ok) throw new Error("User not found");
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "User not found");

        setUser(data.user);
        
        const formattedPages = data.pages.map((p: any) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          createdAt: p.createdAt || p.created_at
        }));
        
        setPages(formattedPages);

        if (formattedPages.length > 0) {
          const savedPageId = localStorage.getItem(`saveswitch-public-page-${username}`);
          const pageToSet = formattedPages.some((p: any) => p.id === savedPageId)
            ? savedPageId
            : formattedPages[formattedPages.length - 1].id;
          setActivePageId(pageToSet);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [username]);

  // 2. Fetch resources when active page changes
  useEffect(() => {
    if (!activePageId) {
      setResources([]);
      return;
    }

    async function fetchResources() {
      try {
        const res = await fetch(`${API_BASE}/public/pages/${activePageId}/resources`);
        if (res.ok) {
          const data = await res.json();
          setResources(data.resources || []);
        }
      } catch (e) {
        console.error("Failed to fetch resources", e);
      }
    }
    fetchResources();

    // Setup WebSocket for real-time updates
    const wsUrl = `${API_BASE.replace(/^http/, 'ws')}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', pageId: activePageId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'resource_updated') {
          fetchResources();
        }
      } catch (e) {}
    };

    return () => {
      ws.close();
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

  // Auto-expand group of active page
  useEffect(() => {
    if (activePageId && dateGroups.length > 0) {
      const group = dateGroups.find(g => g.pages.some(p => p.id === activePageId));
      if (group) {
        setExpandedDates(prev => {
          const next = new Set(prev);
          next.add(group.date);
          return next;
        });
      }
    }
  }, [activePageId, dateGroups]);

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
      localStorage.setItem(`saveswitch-public-page-${username}`, activePageId);
    }
  }, [activePageId, username]);

  useEffect(() => {
    localStorage.setItem(`saveswitch-public-canvas-${username}`, isCanvasMode.toString());
  }, [isCanvasMode, username]);

  useEffect(() => {
    localStorage.setItem(`saveswitch-public-category-${username}`, activeCategory);
  }, [activeCategory, username]);

  const handlePanToResource = useCallback((id: string, x: number, y: number) => {
    setIsCanvasMode(true);
    setHighlightedResourceId(id);
    
    setTimeout(() => {
      if (canvasRef.current) {
        canvasRef.current.panTo(x, y);
      }
    }, 100);

    setTimeout(() => {
      setHighlightedResourceId(null);
    }, 3000);
  }, []);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error || !user) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-[#191818] text-white">
        <h2 className="text-xl">{error || "User not found"}</h2>
      </div>
    );
  }

  const activePage = pages.find(p => p.id === activePageId);

  return (
    <div className="flex h-screen overflow-hidden w-full text-[#F8F8F8]">
      <DashboardSidebar
        user={user}
        dateGroups={dateGroups}
        selectedDate={selectedDate}
        expandedDates={expandedDates}
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
        className="flex-1 relative flex flex-col h-screen overflow-hidden"
        style={{ background: "var(--color-app-bg)" }}
      >
        <div className="relative flex-1 flex flex-col overflow-hidden bg-black">
          {/* Top Right Controls (Category Switch) */}
          <div className="absolute top-8 right-8 z-40 flex items-center gap-3 pointer-events-auto">
            <CategorySwitch activeCategory={activeCategory} onChange={setActiveCategory} />
          </div>

          <ResourceNavigator
            resources={resources}
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
                resources={activeCategory === 'target' ? resources : resources.filter(r => activeCategory === 'video' ? r.type === 'link' : activeCategory === 'image' ? r.type === 'image' : activeCategory === 'document' ? r.type === 'pdf' || r.type === 'text' : true)}
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
          <div
            className="absolute pointer-events-auto"
            style={{ right: 24, bottom: 24, zIndex: 10 }}
          >
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
