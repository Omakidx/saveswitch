"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import LoadingSpinner from "@/components/LoadingSpinner";
import CardStack from "@/components/dashboard/CardStack";
import type { PageData } from "@/components/dashboard/ResourceMiniPanel";
import InfiniteCanvas, { CanvasViewState, InfiniteCanvasRef } from "@/components/dashboard/InfiniteCanvas";
import type { Category } from "@/components/dashboard/CategorySwitch";
import FigmaDashboardChrome from "@/components/dashboard/figma/FigmaDashboardChrome";
import { API_BASE } from "@/lib/api";
import { reconcileFetchedResources } from "./resourceReconciliation";
import {
  canvasViewsEqual,
  DEFAULT_CANVAS_VIEW,
  readDashboardState,
  type DashboardVisibility,
  type WorkspaceSnapshot,
  writeDashboardState,
} from "./dashboardState";
import {
  enqueueDashboardToast,
  toastKey,
  type DashboardToast,
} from "./toastQueue";

/* ── Types ── */
interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
}


import { Resource } from "@/components/dashboard/ResourceCard";

interface DateGroup {
  label: string;
  date: string; // ISO date string (YYYY-MM-DD)
  pages: PageData[];
}

interface ApiPage {
  id: string;
  color: string;
  created_at: string;
  name: string;
}

interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

interface ResourceMutation {
  revision: number;
  resource: Resource;
}

type Visibility = DashboardVisibility;

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

function sanitizeErrorToast(message: string): string {
  const technicalPatterns = [
    /failed query/i,
    /params:/i,
    /\b(insert|select|update|delete)\b[\s\S]*\b(from|into|set|where)\b/i,
    /drizzle/i,
    /postgres/i,
    /syntax error/i,
  ];

  if (message.length > 180 || technicalPatterns.some((pattern) => pattern.test(message))) {
    return "Something went wrong. Please try again.";
  }

  return message;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "string" || error.trim().length === 0) {
    return fallback;
  }

  return sanitizeErrorToast(error.trim());
}

function isAuthenticationError(error: unknown): boolean {
  if (typeof error !== "string") return false;

  const normalizedError = error.trim().toLowerCase();
  return (
    normalizedError === "unauthorized" ||
    normalizedError === "invalid token" ||
    normalizedError.includes("sign in again")
  );
}

function shouldAutoEnterCanvasAfterCreate(): boolean {
  if (typeof window === "undefined") return true;
  return !window.matchMedia("(max-width: 639px)").matches;
}

const MAX_RESOURCE_UPLOAD_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const NEW_CANVAS_COLORS = [
  "rgba(255, 244, 210, 0.48)",
  "rgba(222, 241, 232, 0.44)",
  "rgba(224, 238, 255, 0.42)",
  "rgba(244, 229, 245, 0.42)",
];

function createNewCanvasColor(): string {
  return NEW_CANVAS_COLORS[Math.floor(Math.random() * NEW_CANVAS_COLORS.length)];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resourceTypeForFile(file: File): Resource["type"] {
  if (SUPPORTED_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "file";
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.onabort = () => reject(new Error("Reading the selected file was cancelled."));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("The selected file could not be read."));
    reader.readAsDataURL(file);
  });
}

function readResourceFileContent(file: Blob, type: Resource["type"]): Promise<string> {
  return readFileAsDataUrl(file).then((content) => type === "file"
    ? content.replace(/^data:[^,]*,/, "data:application/octet-stream;base64,")
    : content
  );
}

/* ── Dashboard Page ── */
export default function DashboardPage() {
  const router = useRouter();
  const [initialDashboardState] = useState(readDashboardState);
  const initialWorkspaceSnapshot = initialDashboardState.workspaces[initialDashboardState.visibility];

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Keep feedback focused: actionable errors and completed user actions, never a growing notification stack.
  const [toasts, setToasts] = useState<DashboardToast[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const toastDedupeRef = useRef<Map<string, number>>(new Map());

  const showToast = useCallback((message: string, type: DashboardToast["type"] = "error") => {
    const safeMessage = (type === "error" ? sanitizeErrorToast(message) : message).trim();
    if (!safeMessage) return;

    const now = Date.now();
    const key = toastKey(safeMessage, type);
    const lastShownAt = toastDedupeRef.current.get(key);
    if (lastShownAt && now - lastShownAt < 4500) return;

    toastDedupeRef.current.set(key, now);
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${now}-${Math.random()}`;
    const toast: DashboardToast = { id, message: safeMessage, type };
    setToasts((previous) => enqueueDashboardToast(previous, toast));

    const timer = window.setTimeout(() => {
      toastTimersRef.current.delete(id);
      setToasts((previous) => previous.filter((item) => item.id !== id));
      if (toastDedupeRef.current.get(key) === now) toastDedupeRef.current.delete(key);
    }, type === "error" ? 5200 : 3200);
    toastTimersRef.current.set(id, timer);
  }, []);

  // Modal
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

  const [visibility, setVisibility] = useState<Visibility>(initialDashboardState.visibility);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialWorkspaceSnapshot.selectedDate);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set(initialWorkspaceSnapshot.expandedDates));
  const [isCanvasMode, setIsCanvasMode] = useState(initialWorkspaceSnapshot.isCanvasMode);
  const [activeCategory, setActiveCategory] = useState<Category>(initialWorkspaceSnapshot.activeCategory);

  // Pages state
  const [pages, setPages] = useState<PageData[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(initialWorkspaceSnapshot.activePageId);

  // Resources state
  const [resources, setResources] = useState<Resource[]>([]);
  const [highlightedResourceId, setHighlightedResourceId] = useState<string | null>(null);
  const [isResourceDragging, setIsResourceDragging] = useState(false);
  const [isPasting, setIsPasting] = useState(false);
  const [ingestionProgress, setIngestionProgress] = useState<{ completed: number; total: number } | null>(null);
  const [resourcesPageId, setResourcesPageId] = useState<string | null>(null);
  const canvasOffsetRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<InfiniteCanvasRef>(null);
  const activePageIdRef = useRef<string | null>(initialWorkspaceSnapshot.activePageId);
  const resourcePlacementRef = useRef<Record<string, Array<Pick<Resource, "x" | "y">>>>({});
  const resourceCacheRef = useRef<Record<string, Resource[]>>({});
  const resourceRevisionRef = useRef<Record<string, number>>({});
  const resourceMutationLogRef = useRef<Record<string, ResourceMutation[]>>({});
  const resourceUploadQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingIngestionCountRef = useRef(0);
  const visibilityRef = useRef<Visibility>(initialDashboardState.visibility);
  const pagesRequestIdRef = useRef(0);
  const pagesCacheRef = useRef<Record<Visibility, PageData[] | null>>({
    private: null,
    public: null,
  });
  const workspaceSnapshotRef = useRef<Record<Visibility, WorkspaceSnapshot>>(initialDashboardState.workspaces);
  const autoPageCreationRef = useRef<Record<Visibility, boolean>>({ private: false, public: false });
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredWorkspaceRef = useRef<Record<Visibility, boolean>>({ private: false, public: false });
  const skipNextDashboardPersistRef = useRef<Record<Visibility, boolean>>({ private: false, public: false });

  useEffect(() => () => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    toastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    toastTimersRef.current.clear();
    toastDedupeRef.current.clear();
  }, []);

  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);

  useEffect(() => {
    activePageIdRef.current = activePageId;
  }, [activePageId]);

  useEffect(() => {
    if (resourcesPageId) {
      resourcePlacementRef.current[resourcesPageId] = resources;
      resourceCacheRef.current[resourcesPageId] = resources;
    }
  }, [resources, resourcesPageId]);

  const getCanvasViewState = useCallback((): CanvasViewState => {
    return canvasRef.current?.getViewState() ?? {
      offset: { ...canvasOffsetRef.current },
      zoom: 1,
    };
  }, []);

  const persistDashboardState = useCallback((nextVisibility: Visibility = visibilityRef.current) => {
    writeDashboardState({
      visibility: nextVisibility,
      workspaces: workspaceSnapshotRef.current,
    });
  }, []);

  const saveWorkspaceSnapshot = useCallback((mode: Visibility = visibility) => {
    workspaceSnapshotRef.current[mode] = {
      activePageId,
      selectedDate,
      expandedDates: Array.from(expandedDates),
      isCanvasMode,
      activeCategory,
      canvasView: getCanvasViewState(),
    };
    persistDashboardState();
  }, [activeCategory, activePageId, expandedDates, getCanvasViewState, isCanvasMode, persistDashboardState, selectedDate, visibility]);

  const restoreWorkspaceSnapshot = useCallback((mode: Visibility, nextPages: PageData[], preserveCurrentCanvas = false) => {
    const snapshot = workspaceSnapshotRef.current[mode];
    const storedPageId = snapshot.activePageId ?? localStorage.getItem(`saveswitch-active-page-${mode}`);
    const activeId = storedPageId && nextPages.some((page) => page.id === storedPageId)
      ? storedPageId
      : nextPages.length > 0
        ? nextPages[nextPages.length - 1].id
        : null;
    const groups = groupPagesByDate(nextPages);
    const validDates = new Set(groups.map((group) => group.date));
    const activePage = nextPages.find((page) => page.id === activeId);
    const fallbackDate = activePage?.createdAt.split("T")[0] ?? groups[0]?.date ?? null;
    const selected = snapshot.selectedDate && validDates.has(snapshot.selectedDate)
      ? snapshot.selectedDate
      : fallbackDate;
    const restoredExpandedDates = snapshot.expandedDates.filter((date) => validDates.has(date));
    const expanded = restoredExpandedDates.length > 0
      ? restoredExpandedDates
      : fallbackDate
        ? [fallbackDate]
        : [];

    // Do not let the state persistence effect overwrite the saved view while these
    // restored values are being applied to the freshly mounted canvas.
    skipNextDashboardPersistRef.current[mode] = true;
    setPages(nextPages);
    setActivePageId(activeId);
    setSelectedDate(selected);
    setExpandedDates(new Set(expanded));
    setIsCanvasMode(true);
    setActiveCategory(snapshot.activeCategory);

    if (activeId) {
      localStorage.setItem(`saveswitch-active-page-${mode}`, activeId);
    } else {
      localStorage.removeItem(`saveswitch-active-page-${mode}`);
    }

    const canvasView = snapshot.isCanvasMode && preserveCurrentCanvas && restoredWorkspaceRef.current[mode]
      ? getCanvasViewState()
      : snapshot.isCanvasMode
        ? snapshot.canvasView
        : DEFAULT_CANVAS_VIEW;
    requestAnimationFrame(() => {
      canvasRef.current?.setViewState(canvasView);
    });

    workspaceSnapshotRef.current[mode] = {
      ...snapshot,
      activePageId: activeId,
      selectedDate: selected,
      expandedDates: expanded,
      canvasView,
    };
    restoredWorkspaceRef.current[mode] = true;
    persistDashboardState(mode);
  }, [getCanvasViewState, persistDashboardState]);

  const restorePendingWorkspaceSnapshot = useCallback((mode: Visibility) => {
    const snapshot = workspaceSnapshotRef.current[mode];
    setPages([]);
    setActivePageId(snapshot.activePageId);
    setSelectedDate(snapshot.selectedDate);
    setExpandedDates(new Set(snapshot.expandedDates));
    setIsCanvasMode(snapshot.isCanvasMode);
    setActiveCategory(snapshot.activeCategory);
    requestAnimationFrame(() => {
      canvasRef.current?.setViewState(snapshot.isCanvasMode ? snapshot.canvasView : DEFAULT_CANVAS_VIEW);
    });
  }, []);

  useEffect(() => {
    const mode = visibilityRef.current;
    if (!restoredWorkspaceRef.current[mode]) return;
    if (skipNextDashboardPersistRef.current[mode]) {
      skipNextDashboardPersistRef.current[mode] = false;
      return;
    }

    workspaceSnapshotRef.current[mode] = {
      activePageId,
      selectedDate,
      expandedDates: Array.from(expandedDates),
      isCanvasMode,
      activeCategory,
      canvasView: getCanvasViewState(),
    };
    persistDashboardState(mode);
  }, [activeCategory, activePageId, expandedDates, getCanvasViewState, isCanvasMode, persistDashboardState, selectedDate]);

  useEffect(() => {
    const persistCanvasView = () => {
      const mode = visibilityRef.current;
      if (!restoredWorkspaceRef.current[mode]) return;
      const snapshot = workspaceSnapshotRef.current[mode];
      const canvasView = getCanvasViewState();
      if (canvasViewsEqual(snapshot.canvasView, canvasView)) return;

      workspaceSnapshotRef.current[mode] = { ...snapshot, canvasView };
      persistDashboardState(mode);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") persistCanvasView();
    };
    const intervalId = window.setInterval(persistCanvasView, 750);
    window.addEventListener("pagehide", persistCanvasView);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", persistCanvasView);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [getCanvasViewState, persistDashboardState]);

  // Fetch resources when active page changes
  useEffect(() => {
    if (loading || !user || !activePageId) {
      return;
    }
    
    const controller = new AbortController();
    const pageId = activePageId;
    const requestedVisibility = visibility;
    const revisionAtRequestStart = resourceRevisionRef.current[pageId] ?? 0;

    const fetchResources = async () => {
      try {
        const res = await fetch(`${API_BASE}/pages/${pageId}/resources`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) return;

        const data = await res.json();
        if (
          controller.signal.aborted ||
          activePageIdRef.current !== pageId ||
          visibilityRef.current !== requestedVisibility
        ) return;

        const createdSinceRequest = (resourceMutationLogRef.current[pageId] ?? [])
          .filter((mutation) => mutation.revision > revisionAtRequestStart)
          .map((mutation) => mutation.resource);
        const nextResources = reconcileFetchedResources(data.resources || [], createdSinceRequest);

        resourceCacheRef.current[pageId] = nextResources;
        resourcePlacementRef.current[pageId] = nextResources;
        resourceMutationLogRef.current[pageId] = (resourceMutationLogRef.current[pageId] ?? [])
          .filter((mutation) => mutation.revision > (resourceRevisionRef.current[pageId] ?? 0));
        setResourcesPageId(pageId);
        setResources(nextResources);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Failed to fetch resources", err);
      }
    };
    fetchResources();
    return () => controller.abort();
  }, [activePageId, loading, user, visibility]);

  /* ── Fetch user on mount ── */
  useEffect(() => {
    const controller = new AbortController();

    async function initUser() {
      try {
        const meRes = await fetch(`${API_BASE}/auth/me`, {
          credentials: "include",
          signal: controller.signal,
        });
        const meData = await meRes.json();
        if (!meRes.ok || !meData.authenticated || !meData.user) {
          router.replace("/login");
          return;
        }

        setUser(meData.user);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Error fetching user", err);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }
    void initUser();
    return () => controller.abort();
  }, [router]);

  /* ── Fetch pages when visibility changes ── */
  useEffect(() => {
    if (loading || !user) return;

    const mode = visibility;
    const requestId = ++pagesRequestIdRef.current;
    const controller = new AbortController();

    const cachedPages = pagesCacheRef.current[mode];
    if (cachedPages) {
      restoreWorkspaceSnapshot(mode, cachedPages);
    } else {
      restorePendingWorkspaceSnapshot(mode);
    }

    async function fetchPages() {
      try {
        const resRes = await fetch(`${API_BASE}/pages?visibility=${mode}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (controller.signal.aborted || requestId !== pagesRequestIdRef.current || visibilityRef.current !== mode) {
          return;
        }

        if (resRes.ok) {
          const resData = await resRes.json();
          if (controller.signal.aborted || requestId !== pagesRequestIdRef.current || visibilityRef.current !== mode) {
            return;
          }

          const fetchedPages = (resData.pages || []) as ApiPage[];
          
          let formattedPages = fetchedPages.map((p) => ({
            id: p.id,
            color: p.color,
            createdAt: p.created_at,
            name: p.name,
          }));
          
          pagesCacheRef.current[mode] = formattedPages;

          if (formattedPages.length === 0 && !autoPageCreationRef.current[mode]) {
            autoPageCreationRef.current[mode] = true;
            const createResponse = await fetch(`${API_BASE}/pages`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                color: "#fffDCE",
                name: "Untitled Page 1",
                visibility: mode,
              }),
              signal: controller.signal,
            });
            const createData = await createResponse.json().catch(() => null);
            if (isAuthenticationError(createData?.error)) {
              router.replace("/login");
              return;
            }
            if (createResponse.ok && createData?.success && createData.page) {
              formattedPages = [{
                id: createData.page.id,
                color: createData.page.color,
                createdAt: createData.page.created_at,
                name: createData.page.name,
              }];
            }
          }

          restoreWorkspaceSnapshot(mode, formattedPages, true);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Failed to fetch pages", err);
      }
    }

    fetchPages();
    return () => controller.abort();
  }, [loading, restorePendingWorkspaceSnapshot, restoreWorkspaceSnapshot, router, user, visibility]);

  /* ── Handlers ── */

  const handleVisibilityToggle = useCallback(
    (mode: Visibility) => {
      if (mode === visibility) return;

      saveWorkspaceSnapshot(visibility);
      setVisibility(mode);
      const cachedPages = pagesCacheRef.current[mode];
      if (cachedPages) {
        restoreWorkspaceSnapshot(mode, cachedPages);
      } else {
        restorePendingWorkspaceSnapshot(mode);
      }
      persistDashboardState(mode);
    },
    [persistDashboardState, restorePendingWorkspaceSnapshot, restoreWorkspaceSnapshot, saveWorkspaceSnapshot, visibility]
  );

  const handleLogout = useCallback(async () => {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    window.location.href = "/login";
  }, []);

  const handleAddPage = useCallback(async () => {
    const randomColor = createNewCanvasColor();
    
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
        body: JSON.stringify({ color: randomColor, name: newName, visibility }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.page) {
        if (isAuthenticationError(data?.error)) {
          router.replace("/login");
          return;
        }
        showToast(
          getApiErrorMessage(data?.error, "Unable to create a new page. Please try again."),
          "error",
        );
        return;
      }

      const newPage: PageData = {
        id: data.page.id,
        color: data.page.color,
        createdAt: data.page.created_at,
        name: data.page.name,
      };
      setPages((prev) => {
        const next = [...prev, newPage];
        pagesCacheRef.current[visibility] = next;
        return next;
      });
      setActivePageId(newPage.id);
      setSelectedDate(todayPrefix);
      localStorage.setItem(`saveswitch-active-page-${visibility}`, newPage.id);
      if (shouldAutoEnterCanvasAfterCreate()) {
        setIsCanvasMode(true);
      }
      setExpandedDates((prev) => new Set(prev).add(todayPrefix));
      showToast("Page created successfully!", "success");
    } catch (err) {
      console.error("Failed to add page", err);
      showToast("A network error occurred while adding the page.", 'error');
    }
  }, [pages, router, showToast, visibility]);

  const handlePageSelect = useCallback((id: string) => {
    setActivePageId(id);
    localStorage.setItem(`saveswitch-active-page-${visibility}`, id);
    setIsCanvasMode(true);
  }, [visibility]);

  const handleCanvasPageNavigation = useCallback((direction: "previous" | "next") => {
    const currentIndex = pages.findIndex((page) => page.id === activePageId);
    if (currentIndex === -1) return;

    const adjacentIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
    const adjacentPage = pages[adjacentIndex];
    if (adjacentPage) handlePageSelect(adjacentPage.id);
  }, [activePageId, handlePageSelect, pages]);

  const handleCardSwipe = useCallback((id: string) => {
    setActivePageId(id);
    localStorage.setItem(`saveswitch-active-page-${visibility}`, id);
  }, [visibility]);

  const executeDeletePage = useCallback(async (id: string) => {
    setPages((prev) => {
      const filtered = prev.filter(p => p.id !== id);
      pagesCacheRef.current[visibility] = filtered;
      // Update active page id if we deleted the currently active page
      if (id === activePageId) {
        if (filtered.length > 0) {
          // Default to the last created one or the first one
          const newId = filtered[filtered.length - 1].id;
          setActivePageId(newId);
          localStorage.setItem(`saveswitch-active-page-${visibility}`, newId);
        } else {
          setActivePageId(null);
          localStorage.removeItem(`saveswitch-active-page-${visibility}`);
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
  }, [activePageId, showToast, visibility]);

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

  const handleUpdateResourcePosition = async (id: string, x: number, y: number) => {
    // Optimistic update
    setResources(prev => prev.map(r => r.id === id ? { ...r, x, y } : r));
    
    try {
      await fetch(`${API_BASE}/resources/${id}/position`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
    } catch (err) {
      console.error("Failed to update position", err);
    }
  };

  const handleUpdateTextResource = useCallback(async (id: string, content: string) => {
    try {
      const res = await fetch(`${API_BASE}/resources/${id}/content`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Unable to update this text.");
      }

      const savedContent = typeof data.resource?.content === "string" ? data.resource.content : content;
      setResources((prev) => prev.map((resource) =>
        resource.id === id ? { ...resource, content: savedContent } : resource
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update this text.";
      showToast(message, "error");
      throw new Error(message);
    }
  }, [showToast]);

  const executeDeleteResource = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/resources/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setResources(prev => prev.filter(r => r.id !== id));
        showToast("Resource deleted successfully", "success");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(`Failed to delete resource: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error("Delete resource failed", err);
      showToast("A network error occurred while deleting the resource.", 'error');
    }
  }, [showToast]);

  const handleDeleteResource = useCallback((id: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Resource",
      message: "Are you sure you want to delete this resource? This action cannot be undone.",
      onConfirm: () => {
        executeDeleteResource(id);
        setConfirmModal(null);
      }
    });
  }, [executeDeleteResource]);

  const handlePanToResource = useCallback((resource: Resource, category: Category) => {
    setActiveCategory(category);
    canvasRef.current?.panTo(resource.x ?? 100, resource.y ?? 100);
    setHighlightedResourceId(resource.id);

    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedResourceId(null);
      highlightTimeoutRef.current = null;
    }, 2600);
  }, []);

  const beginResourceIngestion = useCallback(() => {
    pendingIngestionCountRef.current += 1;
    setIsPasting(true);
  }, []);

  const finishResourceIngestion = useCallback(() => {
    pendingIngestionCountRef.current = Math.max(0, pendingIngestionCountRef.current - 1);
    setIsPasting(pendingIngestionCountRef.current > 0);
  }, []);

  const processPaste = useCallback((type: Resource["type"], content: string, title?: string, pageId = activePageIdRef.current): Promise<boolean> => {
    if (!pageId || !content) return Promise.resolve(false);

    const saveResource = async (): Promise<boolean> => {
      const BOX_W = 320;
      const BOX_H = 340;
      let x = Math.round((window.innerWidth / 2) - (BOX_W / 2) - canvasOffsetRef.current.x);
      let y = Math.round((window.innerHeight / 2) - (BOX_H / 2) - canvasOffsetRef.current.y);
      const placements = resourcePlacementRef.current[pageId] ?? [];
      let isOccupied = true;
      let attempts = 0;
      let dx = 0;
      let dy = 0;
      let segmentLength = 1;
      let segmentPassed = 0;
      let direction = 0;

      while (isOccupied && attempts < 50) {
        isOccupied = placements.some((resource) => {
          const resourceX = resource.x ?? 100;
          const resourceY = resource.y ?? 100;
          return !(x + BOX_W <= resourceX || x >= resourceX + BOX_W || y + BOX_H <= resourceY || y >= resourceY + BOX_H);
        });

        if (isOccupied) {
          if (direction === 0) { dx = 1; dy = 0; }
          else if (direction === 1) { dx = 0; dy = 1; }
          else if (direction === 2) { dx = -1; dy = 0; }
          else { dx = 0; dy = -1; }

          x += dx * BOX_W;
          y += dy * BOX_H;
          segmentPassed += 1;
          if (segmentPassed === segmentLength) {
            segmentPassed = 0;
            direction = (direction + 1) % 4;
            if (direction === 0 || direction === 2) segmentLength += 1;
          }
          attempts += 1;
        }
      }

      const reservation = { x, y };
      resourcePlacementRef.current[pageId] = [...placements, reservation];
      const clearReservation = () => {
        resourcePlacementRef.current[pageId] = (resourcePlacementRef.current[pageId] ?? []).filter((resource) => resource !== reservation);
      };

      try {
        const response = await fetch(`${API_BASE}/pages/${pageId}/resources`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, content, title, x, y }),
        });
        const data = await response.json().catch(() => null) as { success?: boolean; resource?: Resource; error?: unknown } | null;
        if (!response.ok || !data?.success || !data.resource) {
          throw new Error(getApiErrorMessage(data?.error, `Unable to save this resource (status ${response.status}).`));
        }

        const createdResource = data.resource;
        const cachedResources = resourceCacheRef.current[pageId] ?? [];
        const nextResources = reconcileFetchedResources(cachedResources, [createdResource]);
        const nextRevision = (resourceRevisionRef.current[pageId] ?? 0) + 1;

        resourceRevisionRef.current[pageId] = nextRevision;
        resourceMutationLogRef.current[pageId] = [
          ...(resourceMutationLogRef.current[pageId] ?? []),
          { revision: nextRevision, resource: createdResource },
        ];
        resourceCacheRef.current[pageId] = nextResources;
        resourcePlacementRef.current[pageId] = (resourcePlacementRef.current[pageId] ?? []).map((resource) =>
          resource === reservation ? createdResource : resource
        );
        if (activePageIdRef.current === pageId) {
          setResourcesPageId(pageId);
          setResources(nextResources);
        }
        return true;
      } catch (error) {
        clearReservation();
        const label = title ? `“${title}”` : type;
        showToast(`Could not save ${label}: ${getApiErrorMessage(error instanceof Error ? error.message : "", "Please try again.")}`, "error");
        return false;
      }
    };

    const queued = resourceUploadQueueRef.current.then(saveResource, saveResource);
    resourceUploadQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [showToast]);

  const handleFileUploads = useCallback(async (files: File[]) => {
    if (!isCanvasMode) {
      showToast("Please enter a canvas to upload resources.", "info");
      return;
    }
    if (!activePageId) {
      showToast("Please select a page first to upload resources.", "info");
      return;
    }

    const oversizedFiles = files.filter((file) => file instanceof File && file.size > MAX_RESOURCE_UPLOAD_BYTES);
    const validFiles = files.filter((file) => file instanceof File && file.size > 0 && file.size <= MAX_RESOURCE_UPLOAD_BYTES && file.name.trim().length > 0);
    if (oversizedFiles.length > 0) {
      showToast(`${oversizedFiles.length} file${oversizedFiles.length === 1 ? " is" : "s are"} over the 10 MB limit and ${oversizedFiles.length === 1 ? "was" : "were"} skipped.`, "error");
    }

    if (validFiles.length === 0) {
      showToast("No non-empty files were selected. Empty folders cannot be uploaded.", "info");
      return;
    }
    if (validFiles.length !== files.length) {
      showToast(`${files.length - validFiles.length} empty or unsupported selection${files.length - validFiles.length === 1 ? " was" : "s were"} skipped.`, "info");
    }

    const targetPageId = activePageId;
    let savedCount = 0;
    beginResourceIngestion();
    setIngestionProgress({ completed: 0, total: validFiles.length });
    try {
      for (const [index, file] of validFiles.entries()) {
        const title = file.webkitRelativePath || file.name;
        try {
          const type = resourceTypeForFile(file);
          const content = await readResourceFileContent(file, type);
          if (await processPaste(type, content, title, targetPageId)) savedCount += 1;
        } catch (error) {
          showToast(`Could not read “${title}”: ${getApiErrorMessage(error instanceof Error ? error.message : "", "Please choose another file.")}`, "error");
        } finally {
          setIngestionProgress({ completed: index + 1, total: validFiles.length });
        }
      }

      if (savedCount > 0) {
        showToast(`${savedCount} resource${savedCount === 1 ? "" : "s"} saved.`, "success");
      }
    } finally {
      setIngestionProgress(null);
      finishResourceIngestion();
    }
  }, [activePageId, beginResourceIngestion, finishResourceIngestion, isCanvasMode, processPaste, showToast]);

  const handlePaste = useCallback(async () => {
    if (!isCanvasMode) {
      showToast("Please enter a canvas to paste resources.", "info");
      return;
    }
    if (!activePageId) {
      showToast("Please select a page first to paste resources.", "info");
      return;
    }

    const targetPageId = activePageId;
    let savedCount = 0;
    beginResourceIngestion();
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => SUPPORTED_IMAGE_MIME_TYPES.has(type.toLowerCase()));
          const fileType = imageType ?? (item.types.includes("application/pdf") ? "application/pdf" : undefined);
          if (fileType) {
            const blob = await item.getType(fileType);
            if (blob.size > MAX_RESOURCE_UPLOAD_BYTES) {
              showToast("Clipboard file is over the 10 MB limit and was skipped.", "error");
              continue;
            }
            const type = imageType ? "image" : "pdf";
            const content = await readResourceFileContent(blob, type);
            if (await processPaste(type, content, imageType ? "Pasted image" : "Pasted PDF", targetPageId)) savedCount += 1;
            continue;
          }

          if (item.types.includes("text/plain")) {
            const text = (await (await item.getType("text/plain")).text()).trim();
            if (text && await processPaste(isHttpUrl(text) ? "link" : "text", text, undefined, targetPageId)) savedCount += 1;
            continue;
          }

          const genericType = item.types.find((type) => !type.startsWith("text/") && type !== "text/html");
          if (genericType) {
            const blob = await item.getType(genericType);
            if (blob.size > MAX_RESOURCE_UPLOAD_BYTES) {
              showToast("Clipboard file is over the 10 MB limit and was skipped.", "error");
              continue;
            }
            const content = await readResourceFileContent(blob, "file");
            if (await processPaste("file", content, "Pasted file", targetPageId)) savedCount += 1;
          }
        }
      } else {
        const text = (await navigator.clipboard.readText()).trim();
        if (text && await processPaste(isHttpUrl(text) ? "link" : "text", text, undefined, targetPageId)) savedCount += 1;
      }

      if (savedCount === 0) {
        showToast("Clipboard is empty or contains unsupported content.", "info");
      } else {
        showToast(`${savedCount} resource${savedCount === 1 ? "" : "s"} saved.`, "success");
      }
    } catch {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (text && await processPaste(isHttpUrl(text) ? "link" : "text", text, undefined, targetPageId)) {
          showToast("Resource saved.", "success");
        } else {
          showToast("Clipboard is empty or contains unsupported content.", "info");
        }
      } catch {
        showToast("Failed to read from clipboard. Allow clipboard permissions and try again.", "error");
      }
    } finally {
      finishResourceIngestion();
    }
  }, [activePageId, beginResourceIngestion, finishResourceIngestion, isCanvasMode, processPaste, showToast]);

  useEffect(() => {
    const handleGlobalPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, [contenteditable='true']") || !activePageId || !isCanvasMode) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      if (items.length === 0) return;

      event.preventDefault();
      const targetPageId = activePageId;
      const processItems = async () => {
        let savedCount = 0;
        beginResourceIngestion();
        try {
          for (const item of items) {
            if (item.type === "text/plain") {
              const text = (await new Promise<string>((resolve) => item.getAsString(resolve))).trim();
              if (text && await processPaste(isHttpUrl(text) ? "link" : "text", text, undefined, targetPageId)) savedCount += 1;
              continue;
            }

            const file = item.getAsFile();
            if (file && file.size > 0 && file.size <= MAX_RESOURCE_UPLOAD_BYTES) {
              const type = resourceTypeForFile(file);
              const content = await readResourceFileContent(file, type);
              if (await processPaste(type, content, file.name || "Pasted file", targetPageId)) savedCount += 1;
            } else if (file && file.size > MAX_RESOURCE_UPLOAD_BYTES) {
              showToast("Clipboard file is over the 10 MB limit and was skipped.", "error");
            }
          }
          if (savedCount === 0) showToast("Clipboard is empty or contains unsupported content.", "info");
        } catch (error) {
          showToast(`Could not process clipboard content: ${getApiErrorMessage(error instanceof Error ? error.message : "", "Please try again.")}`, "error");
        } finally {
          finishResourceIngestion();
        }
      };
      void processItems();
    };

    const handleUploadEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ files?: File[] }>;
      if (customEvent.detail?.files) void handleFileUploads(customEvent.detail.files);
    };

    window.addEventListener("paste", handleGlobalPaste);
    window.addEventListener("saveswitch-upload", handleUploadEvent);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
      window.removeEventListener("saveswitch-upload", handleUploadEvent);
    };
  }, [activePageId, beginResourceIngestion, finishResourceIngestion, handleFileUploads, isCanvasMode, processPaste, showToast]);

  /* ── Active Page state ── */
  const activePage = pages.find(p => p.id === activePageId);
  const visibleResources = resourcesPageId === activePageId ? resources : [];
  const filteredResources = activeCategory === 'target'
    ? visibleResources
    : visibleResources.filter(r => activeCategory === 'video' ? r.type === 'file' : activeCategory === 'image' ? r.type === 'image' : activeCategory === 'document' ? r.type === 'pdf' || r.type === 'text' : r.type === 'link');

  /* ── Loading state ── */
  if (loading || !user) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <main
        className="relative h-dvh min-w-0 flex-1 overflow-hidden"
        style={{ background: "#fffDCE" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            void handleFileUploads(Array.from(e.dataTransfer.files));
          }
        }}
      >
        <div className="relative h-full overflow-hidden">
          <InfiniteCanvas
            ref={canvasRef}
            isActive={isCanvasMode}
            canvasColor={activePage?.color || "#fffDCE"}
            canvasOffsetRef={canvasOffsetRef}
            onNavigatePage={handleCanvasPageNavigation}
            isResourceDragging={isResourceDragging}
          >
            <div className="flex h-full w-full flex-1 items-center justify-center">
              {pages.length > 0 ? (
                <CardStack
                  pages={pages}
                  activePageId={activePageId}
                  isExpanded={isCanvasMode}
                  onPageSelect={handleCardSwipe}
                  resources={filteredResources}
                  onDeleteResource={handleDeleteResource}
                  onUpdateResourcePosition={handleUpdateResourcePosition}
                  onUpdateTextResource={handleUpdateTextResource}
                  onResourceDragStateChange={setIsResourceDragging}
                  highlightedResourceId={highlightedResourceId}
                />
              ) : (
                null
              )}
            </div>
          </InfiniteCanvas>

          <FigmaDashboardChrome
            user={user}
            pages={pages}
            resources={visibleResources}
            activePageId={activePageId}
            activeCategory={activeCategory}
            visibility={visibility}
            onPageSelect={handlePageSelect}
            onDeletePage={handleDeletePage}
            onAddPage={handleAddPage}
            onCategoryChange={setActiveCategory}
            onResourceSelect={handlePanToResource}
            onDeleteResource={handleDeleteResource}
            onVisibilityChange={handleVisibilityToggle}
            onFileUploads={handleFileUploads}
            onPaste={handlePaste}
            isResourceIngesting={isPasting}
            ingestionProgress={ingestionProgress}
            onOpenProfile={() => window.location.assign("/dashboard/profile")}
            onLogout={handleLogout}
          />
        </div>
      </main>

      {/* ── Global Toaster ── */}
      <div className="pointer-events-none fixed bottom-3 left-3 right-3 z-50 flex flex-col items-end gap-1.5 sm:bottom-5 sm:left-auto sm:right-5" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full items-center gap-2 rounded-full px-3 py-2 shadow-[0_5px_16px_rgba(80,73,42,0.13)] sm:w-auto"
            style={{
              maxWidth: "min(320px, calc(100vw - 24px))",
              background: toast.type === "error"
                ? "rgba(255, 244, 244, 0.82)"
                : "rgba(255, 255, 255, 0.62)",
              border: toast.type === "error"
                ? "1px solid rgba(224, 103, 103, 0.32)"
                : "1px solid rgba(255, 255, 255, 0.72)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              animation: "toast-slide-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
            }}
          >
            {toast.type === "error" && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(196, 77, 77, 0.92)" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            <span
              className="font-arimo text-[11px] font-medium leading-[1.25] tracking-[0.01em]"
              style={{ color: toast.type === "error" ? "rgba(139, 53, 53, 0.96)" : "rgba(44, 43, 37, 0.92)", overflowWrap: "anywhere" }}
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
              width: "min(420px, calc(100vw - 32px))",
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
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-arimo text-sm font-semibold cursor-pointer transition-all border border-[#FF2A2A]/30 bg-[#FF2A2A]/10 text-[#FF2A2A] hover:bg-[#FF2A2A]/15 shadow-md hover:shadow-lg active:scale-95"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/icons/icon-trash.svg"
                  alt=""
                  width={16}
                  height={16}
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
