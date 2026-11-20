"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CardStack from "@/components/dashboard/CardStack";
import InfiniteCanvas, { InfiniteCanvasRef } from "@/components/dashboard/InfiniteCanvas";
import type { Category } from "@/components/dashboard/CategorySwitch";
import FigmaDashboardChrome, { chromeStyles, type ChromeMenuItem } from "@/components/dashboard/figma/FigmaDashboardChrome";
import Toaster, { type ToastItem } from "@/components/feedback/Toaster";
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
  const [activeCategory, setActiveCategory] = useState<Category>(() =>
    parseCategory(safeGetItem(`saveswitch-public-category-${username}`)));
  const [highlightedResourceId, setHighlightedResourceId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const router = useRouter();

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

  const handlePageSelect = useCallback((id: string) => {
    setActivePageId(id);
  }, []);

  // Sync state to localStorage
  useEffect(() => {
    if (activePageId) {
      safeSetItem(`saveswitch-public-page-${username}`, activePageId);
    }
  }, [activePageId, username]);

  useEffect(() => {
    safeSetItem(`saveswitch-public-category-${username}`, activeCategory);
  }, [activeCategory, username]);

  const panTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const toastTimersRef = useRef(new Set<number>());
  useEffect(() => {
    const toastTimers = toastTimersRef.current;
    return () => {
      if (panTimerRef.current) window.clearTimeout(panTimerRef.current);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
      toastTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const showToast = useCallback((message: string, type: ToastItem["type"] = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((previous) => [...previous.slice(-1), { id, message, type }]);
    const timer = window.setTimeout(() => {
      toastTimersRef.current.delete(timer);
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, 3500);
    toastTimersRef.current.add(timer);
  }, []);

  const handleCopyProfileLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Profile link copied", "success");
    } catch {
      showToast("Couldn't copy the link. Copy it from the address bar instead.", "error");
    }
  }, [showToast]);

  const handlePanToResource = useCallback((resource: Resource, category: Category) => {
    setActiveCategory(category);
    setHighlightedResourceId(resource.id);

    if (panTimerRef.current) window.clearTimeout(panTimerRef.current);
    panTimerRef.current = window.setTimeout(() => {
      canvasRef.current?.panTo(resource.x ?? 100, resource.y ?? 100);
    }, 100);

    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedResourceId(null);
    }, 3000);
  }, []);

  const handleCanvasPageNavigation = useCallback((direction: "previous" | "next") => {
    if (pages.length < 2) return;
    const index = Math.max(0, pages.findIndex((page) => page.id === activePageId));
    const nextIndex = direction === "next"
      ? Math.min(pages.length - 1, index + 1)
      : Math.max(0, index - 1);
    setActivePageId(pages[nextIndex].id);
  }, [activePageId, pages]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error || !user) {
    return (
      <main className="flex h-dvh w-full items-center justify-center px-6 font-inter" style={{ background: "#fffDCE" }}>
        <div className="flex w-full max-w-[340px] flex-col items-center gap-3 rounded-2xl border border-[var(--color-surface-border)] bg-[var(--color-surface)] px-6 py-7 text-center shadow-2xl">
          <h1 className="m-0 font-jakarta text-lg font-bold text-white">{error || "User not found"}</h1>
          <p className="m-0 font-arimo text-[13px] leading-relaxed text-white/70">
            {error === "User not found" || !error
              ? `There is no public Saveswitch profile at @${username}.`
              : "Please try again in a moment."}
          </p>
          <Link href="/login" className="mt-2 rounded-xl border border-white/20 bg-white/90 px-5 py-2.5 font-arimo text-sm font-semibold text-[#111] transition-colors hover:bg-white">
            Go to Saveswitch
          </Link>
        </div>
      </main>
    );
  }

  const activePage = pages.find(p => p.id === activePageId);
  const visibleResources = resourcesPageId === activePageId ? resources : [];
  const filteredResources = filterResourcesByCategory(visibleResources, activeCategory);
  const profileMenuItems: ChromeMenuItem[] = [
    { label: "Copy profile link", onSelect: () => { void handleCopyProfileLink(); } },
    { label: "Open Saveswitch", onSelect: () => router.push("/login") },
  ];

  return (
    <>
      <main className="relative h-dvh w-full shrink-0 overflow-hidden" style={{ background: "#fffDCE" }}>
        <div className="relative h-full overflow-hidden">
          <InfiniteCanvas
            ref={canvasRef}
            isActive
            canvasColor={activePage?.color || "#fffDCE"}
            canvasOffsetRef={canvasOffsetRef}
            onNavigatePage={handleCanvasPageNavigation}
          >
            <div className="flex h-full w-full flex-1 items-center justify-center">
              {pages.length > 0 ? (
                <CardStack
                  pages={pages}
                  activePageId={activePageId}
                  isExpanded
                  onPageSelect={handlePageSelect}
                  resources={filteredResources}
                  readOnly
                  highlightedResourceId={highlightedResourceId}
                />
              ) : null}
            </div>
          </InfiniteCanvas>

          {pages.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
              <p className="m-0 rounded-2xl bg-[rgba(30,30,30,0.58)] px-5 py-3 text-center font-arimo text-[13px] font-semibold text-white backdrop-blur-xl">
                @{username} hasn&apos;t shared any public pages yet.
              </p>
            </div>
          )}

          <FigmaDashboardChrome
            user={{ name: user.name, email: user.email }}
            pages={pages}
            resources={visibleResources}
            activePageId={activePageId}
            activeCategory={activeCategory}
            onPageSelect={handlePageSelect}
            onCategoryChange={setActiveCategory}
            onResourceSelect={handlePanToResource}
            canAddPage={false}
            canAddResources={false}
            menuItems={profileMenuItems}
            menuTitle={user.name || `@${username}`}
            menuButtonLabel={`About @${username}`}
            bottomLeading={
              <div className={chromeStyles.bottomTab}>
                <button type="button" onClick={handleCopyProfileLink} title="Copy profile link" aria-label={`Copy link to @${username}'s profile`}>
                  <span className={chromeStyles.bottomTabText}>@{username}</span>
                </button>
                <span className={chromeStyles.bottomTabMuted}>Public</span>
              </div>
            }
          />
        </div>
      </main>

      <Toaster toasts={toasts} />
    </>
  );
}
