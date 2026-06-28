"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import VisibilityToggle from "@/components/dashboard/VisibilityToggle";
import LoadingSpinner from "@/components/LoadingSpinner";
import CardStack from "@/components/dashboard/CardStack";
import ResourceMiniPanel, { PageData } from "@/components/dashboard/ResourceMiniPanel";
import FloatingActionButton from "@/components/dashboard/FloatingActionButton";
import InfiniteCanvas, { CanvasViewState, InfiniteCanvasRef } from "@/components/dashboard/InfiniteCanvas";
import CategorySwitch, { Category } from "@/components/dashboard/CategorySwitch";
import ResourceNavigator from "@/components/dashboard/ResourceNavigator";
import { API_BASE } from "@/lib/api";

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

type Visibility = "private" | "public";

interface WorkspaceSnapshot {
  activePageId: string | null;
  selectedDate: string | null;
  expandedDates: string[];
  isCanvasMode: boolean;
  activeCategory: Category;
  canvasView: CanvasViewState;
}

interface PersistedDashboardState {
  visibility: Visibility;
  workspaces: Record<Visibility, WorkspaceSnapshot>;
}

const DEFAULT_CANVAS_VIEW: CanvasViewState = {
  offset: { x: 0, y: 0 },
  zoom: 1,
};

const DASHBOARD_STATE_STORAGE_KEY = "saveswitch-dashboard-state";

function createWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    activePageId: null,
    selectedDate: null,
    expandedDates: [],
    isCanvasMode: false,
    activeCategory: "target",
    canvasView: DEFAULT_CANVAS_VIEW,
  };
}

function createDashboardState(): PersistedDashboardState {
  return {
    visibility: "public",
    workspaces: {
      private: createWorkspaceSnapshot(),
      public: createWorkspaceSnapshot(),
    },
  };
}

function isVisibility(value: unknown): value is Visibility {
  return value === "private" || value === "public";
}

function isCanvasViewState(value: unknown): value is CanvasViewState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanvasViewState>;
  return (
    typeof candidate.zoom === "number" &&
    !!candidate.offset &&
    typeof candidate.offset.x === "number" &&
    typeof candidate.offset.y === "number"
  );
}

function normalizeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  const fallback = createWorkspaceSnapshot();
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Partial<WorkspaceSnapshot>;
  const activeCategory = candidate.activeCategory;

  return {
    activePageId: typeof candidate.activePageId === "string" ? candidate.activePageId : null,
    selectedDate: typeof candidate.selectedDate === "string" ? candidate.selectedDate : null,
    expandedDates: Array.isArray(candidate.expandedDates)
      ? candidate.expandedDates.filter((date): date is string => typeof date === "string")
      : [],
    isCanvasMode: typeof candidate.isCanvasMode === "boolean" ? candidate.isCanvasMode : false,
    activeCategory:
      activeCategory === "target" ||
      activeCategory === "video" ||
      activeCategory === "image" ||
      activeCategory === "link" ||
      activeCategory === "document"
        ? activeCategory
        : "target",
    canvasView: isCanvasViewState(candidate.canvasView) ? candidate.canvasView : DEFAULT_CANVAS_VIEW,
  };
}

function readDashboardState(): PersistedDashboardState {
  if (typeof window === "undefined") return createDashboardState();

  try {
    const rawState = localStorage.getItem(DASHBOARD_STATE_STORAGE_KEY);
    if (!rawState) return createDashboardState();

    const parsed = JSON.parse(rawState) as Partial<PersistedDashboardState>;
    return {
      visibility: isVisibility(parsed.visibility) ? parsed.visibility : "public",
      workspaces: {
        private: normalizeWorkspaceSnapshot(parsed.workspaces?.private),
        public: normalizeWorkspaceSnapshot(parsed.workspaces?.public),
      },
    };
  } catch {
    return createDashboardState();
  }
}

function writeDashboardState(state: PersistedDashboardState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DASHBOARD_STATE_STORAGE_KEY, JSON.stringify(state));
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

/* ── Dashboard Page ── */
export default function DashboardPage() {
  const [initialDashboardState] = useState(readDashboardState);
  const initialWorkspaceSnapshot = initialDashboardState.workspaces[initialDashboardState.visibility];

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'error') => {
    const id = crypto.randomUUID();
    const safeMessage = type === "error" ? sanitizeErrorToast(message) : message;
    setToasts((prev) => [...prev, { id, message: safeMessage, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // Modal
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

  const [visibility, setVisibility] = useState<Visibility>(initialDashboardState.visibility);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialWorkspaceSnapshot.selectedDate);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set(initialWorkspaceSnapshot.expandedDates));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isCanvasMode, setIsCanvasMode] = useState(initialWorkspaceSnapshot.isCanvasMode);
  const [activeCategory, setActiveCategory] = useState<Category>(initialWorkspaceSnapshot.activeCategory);

  // Pages state
  const [pages, setPages] = useState<PageData[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(initialWorkspaceSnapshot.activePageId);

  // Resources state
  const [resources, setResources] = useState<Resource[]>([]);
  const [, setIsPasting] = useState(false);
  const [resourcesPageId, setResourcesPageId] = useState<string | null>(null);
  const canvasOffsetRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<InfiniteCanvasRef>(null);
  const [highlightedResourceId, setHighlightedResourceId] = useState<string | null>(null);
  const visibilityRef = useRef<Visibility>(initialDashboardState.visibility);
  const pagesRequestIdRef = useRef(0);
  const pagesCacheRef = useRef<Record<Visibility, PageData[] | null>>({
    private: null,
    public: null,
  });
  const workspaceSnapshotRef = useRef<Record<Visibility, WorkspaceSnapshot>>(initialDashboardState.workspaces);

  const handlePanToResource = useCallback((id: string, x: number, y: number) => {
    if (canvasRef.current) {
      canvasRef.current.panTo(x, y);
    }
    setHighlightedResourceId(id);
    setTimeout(() => {
      setHighlightedResourceId(null);
    }, 3000);
  }, []);

  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);

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

    setPages(nextPages);
    setActivePageId(activeId);
    setSelectedDate(selected);
    setExpandedDates(new Set(expanded));
    setIsCanvasMode(snapshot.isCanvasMode);
    setActiveCategory(snapshot.activeCategory);

    if (activeId) {
      localStorage.setItem(`saveswitch-active-page-${mode}`, activeId);
    } else {
      localStorage.removeItem(`saveswitch-active-page-${mode}`);
    }

    const canvasView = snapshot.isCanvasMode
      ? preserveCurrentCanvas
        ? getCanvasViewState()
        : snapshot.canvasView
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

  // Fetch resources when active page changes
  useEffect(() => {
    if (!activePageId) {
      return;
    }
    
    const controller = new AbortController();

    const fetchResources = async () => {
      try {
        const pageId = activePageId;
        const res = await fetch(`${API_BASE}/pages/${pageId}/resources`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (controller.signal.aborted || activePageId !== pageId) return;
        if (res.ok) {
          const data = await res.json();
          setResourcesPageId(pageId);
          setResources(data.resources || []);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Failed to fetch resources", err);
      }
    };
    fetchResources();
    return () => controller.abort();
  }, [activePageId, visibility]);

  /* ── Fetch user on mount ── */
  useEffect(() => {
    async function initUser() {
      try {
        const meRes = await fetch(`${API_BASE}/auth/me`, {
          credentials: "include",
        });
        const meData = await meRes.json();
        if (meData.authenticated) {
          setUser(meData.user);
        }
      } catch (err) {
        console.error("Error fetching user", err);
      } finally {
        setLoading(false);
      }
    }
    initUser();
  }, []);

  /* ── Fetch pages when visibility changes ── */
  useEffect(() => {
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
          
          const formattedPages = fetchedPages.map((p) => ({
            id: p.id,
            color: p.color,
            createdAt: p.created_at,
            name: p.name,
          }));
          
          pagesCacheRef.current[mode] = formattedPages;
          restoreWorkspaceSnapshot(mode, formattedPages, true);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Failed to fetch pages", err);
      }
    }

    fetchPages();
    return () => controller.abort();
  }, [restorePendingWorkspaceSnapshot, restoreWorkspaceSnapshot, visibility]);

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
        body: JSON.stringify({ color: randomColor, name: newName, visibility }),
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
          setPages((prev) => {
            const next = [...prev, newPage];
            pagesCacheRef.current[visibility] = next;
            return next;
          });
          setActivePageId(newPage.id);
          setSelectedDate(todayPrefix);
          localStorage.setItem(`saveswitch-active-page-${visibility}`, newPage.id);
          setIsCanvasMode(true);
          setExpandedDates((prev) => new Set(prev).add(todayPrefix));
        } else {
          showToast(`Failed to add page: ${data.error || 'Unknown error'}`, 'error');
        }
      }
    } catch (err) {
      console.error("Failed to add page", err);
      showToast("A network error occurred while adding the page.", 'error');
    }
  }, [pages, showToast, visibility]);

  const handlePageSelect = useCallback((id: string) => {
    setActivePageId(id);
    localStorage.setItem(`saveswitch-active-page-${visibility}`, id);
    setIsCanvasMode(true);
  }, [visibility]);

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

    setPages((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, name: newName.trim() } : p));
      pagesCacheRef.current[visibility] = next;
      return next;
    });

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
  }, [pages, showToast, visibility]);

  const handleFabClick = useCallback(() => {
    setIsCanvasMode((prev) => !prev);
  }, []);

  const processPaste = useCallback(async (type: Resource['type'], content: string, title?: string) => {
    if (!activePageId) return;
    setIsPasting(true);
    showToast(`Pasting ${type}...`, 'info');
    
    // Find a completely clear space using a spiral grid search to prevent ANY overlapping
    const BOX_W = 320;
    const BOX_H = 340; // Generous bounding box for cards
    
    // Adjust by subtracting the canvas pan offset so it spawns exactly in the center of the user's current view
    // Ensure the final values are integers to avoid database errors
    let x = Math.round((window.innerWidth / 2) - (BOX_W / 2) - canvasOffsetRef.current.x);
    let y = Math.round((window.innerHeight / 2) - (BOX_H / 2) - canvasOffsetRef.current.y);
    
    let isOccupied = true;
    let attempts = 0;
    let dx = 0, dy = 0;
    let segmentLength = 1, segmentPassed = 0, direction = 0;

    while (isOccupied && attempts < 50) {
      isOccupied = resources.some(r => {
        const rx = r.x ?? 100;
        const ry = r.y ?? 100;
        // Check for bounding box intersection
        return !(x + BOX_W <= rx || x >= rx + BOX_W || y + BOX_H <= ry || y >= ry + BOX_H);
      });

      if (isOccupied) {
        if (direction === 0) { dx = 1; dy = 0; }
        else if (direction === 1) { dx = 0; dy = 1; }
        else if (direction === 2) { dx = -1; dy = 0; }
        else if (direction === 3) { dx = 0; dy = -1; }

        x += dx * BOX_W;
        y += dy * BOX_H;
        segmentPassed++;

        if (segmentPassed === segmentLength) {
          segmentPassed = 0;
          direction = (direction + 1) % 4;
          if (direction === 0 || direction === 2) {
            segmentLength++;
          }
        }
        attempts++;
      }
    }

    try {
      const res = await fetch(`${API_BASE}/pages/${activePageId}/resources`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content, title, x, y }),
      });
      const data = await res.json();
      if (data.success) {
        setResources(prev => [...prev, data.resource]);
        setResourcesPageId(activePageId);
        showToast(`Resource saved successfully!`, 'success');
      } else {
        showToast(getApiErrorMessage(data.error, "Unable to save this resource. Please try again."), 'error');
      }
    } catch (err) {
      console.error("Paste upload failed", err);
      showToast("Network error while pasting.", 'error');
    } finally {
      setIsPasting(false);
    }
  }, [activePageId, resources, showToast]);

  const handlePaste = useCallback(async () => {
    if (!isCanvasMode) {
      showToast("Please enter a canvas to paste resources.", "info");
      return;
    }
    if (!activePageId) {
      showToast("Please select a page first to paste resources.", "info");
      return;
    }
    
    try {
      const items = await navigator.clipboard.read();
      let hasItem = false;
      
      for (const item of items) {
        if (item.types.some(t => t.startsWith('image/'))) {
          hasItem = true;
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const reader = new FileReader();
            reader.onloadend = () => processPaste("image", reader.result as string);
            reader.readAsDataURL(blob);
          }
        } else if (item.types.includes('application/pdf')) {
           hasItem = true;
           const blob = await item.getType('application/pdf');
           const reader = new FileReader();
           reader.onloadend = () => processPaste("pdf", reader.result as string);
           reader.readAsDataURL(blob);
        } else if (item.types.includes('text/plain')) {
          hasItem = true;
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          const isUrl = /^https?:\/\//i.test(text.trim());
          processPaste(isUrl ? "link" : "text", text.trim());
        }
      }
      
      if (!hasItem) {
        showToast("Clipboard is empty or contains unsupported content.", "info");
      }
    } catch (err) {
      console.error("Paste read failed", err);
      // Fallback for browsers without advanced clipboard API
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const isUrl = /^https?:\/\//i.test(text.trim());
          processPaste(isUrl ? "link" : "text", text.trim());
        } else {
           showToast("Clipboard is empty.", "info");
        }
      } catch {
        showToast("Failed to read from clipboard. Allow clipboard permissions.", "error");
      }
    }
  }, [activePageId, processPaste, showToast, isCanvasMode]);

  const handleFileUploads = useCallback((files: File[]) => {
    if (!isCanvasMode) {
      showToast("Please enter a canvas to upload resources.", "info");
      return;
    }
    if (!activePageId) {
      showToast("Please select a page first to upload resources.", "info");
      return;
    }

    for (const file of files) {
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {
        reader.onloadend = () => processPaste("image", reader.result as string, file.name);
      } else if (file.type === 'application/pdf') {
        reader.onloadend = () => processPaste("pdf", reader.result as string, file.name);
      } else {
        reader.onloadend = () => processPaste("file", reader.result as string, file.name);
      }
      reader.readAsDataURL(file);
    }
  }, [activePageId, isCanvasMode, processPaste, showToast]);

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!activePageId) return;
      if (!isCanvasMode) return;
      
      const items = Array.from(e.clipboardData?.items || []);
      if (items.length === 0) return;

      let processed = false;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onloadend = () => processPaste("image", reader.result as string, file.name);
            reader.readAsDataURL(file);
            processed = true;
          }
        } else if (item.type === 'application/pdf') {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onloadend = () => processPaste("pdf", reader.result as string, file.name);
            reader.readAsDataURL(file);
            processed = true;
          }
        } else if (item.type === 'text/plain') {
          item.getAsString((text) => {
            const isUrl = /^https?:\/\//i.test(text.trim());
            processPaste(isUrl ? "link" : "text", text.trim());
          });
          processed = true;
        } else {
          // If we got a generic file from the clipboard (some browsers support this)
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onloadend = () => processPaste("file", reader.result as string, file.name);
            reader.readAsDataURL(file);
            processed = true;
          }
        }
      }
      
      if (processed) {
        e.preventDefault(); // Stop default pasting if we handled it
      }
    };

    const handleUploadEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ files?: File[] }>;
      if (customEvent.detail?.files) {
        handleFileUploads(customEvent.detail.files);
      }
    };
    
    window.addEventListener('paste', handleGlobalPaste);
    window.addEventListener('saveswitch-upload', handleUploadEvent);
    return () => {
       window.removeEventListener('paste', handleGlobalPaste);
       window.removeEventListener('saveswitch-upload', handleUploadEvent);
    };
  }, [activePageId, handleFileUploads, isCanvasMode, processPaste]);

  /* ── Active Page state ── */
  const activePage = pages.find(p => p.id === activePageId);
  const visibleResources = resourcesPageId === activePageId ? resources : [];
  const filteredResources = activeCategory === 'target'
    ? visibleResources
    : visibleResources.filter(r => activeCategory === 'video' ? r.type === 'link' : activeCategory === 'image' ? r.type === 'image' : activeCategory === 'document' ? r.type === 'pdf' || r.type === 'text' : true);

  /* ── Loading state ── */
  if (loading) {
    return <LoadingSpinner />;
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
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileUploads(Array.from(e.dataTransfer.files));
          }
        }}
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

          {/* ── Category Switch (top right) ── */}
          <div className="absolute top-8 right-8 z-10 pointer-events-auto">
            <CategorySwitch activeCategory={activeCategory} onChange={setActiveCategory} />
          </div>

          {/* ── Resource Navigator (top left) ── */}
          <ResourceNavigator 
            resources={filteredResources} 
            onSelectResource={handlePanToResource} 
            isActive={isCanvasMode} 
          />

          {/* ── Workspace / Card Stack (centered) ── */}
          <InfiniteCanvas ref={canvasRef} isActive={isCanvasMode} canvasColor={activePage?.color || "var(--color-app-bg)"} canvasOffsetRef={canvasOffsetRef}>
            <div className="flex-1 flex items-center justify-center h-full w-full">
            {pages.length > 0 ? (
              <CardStack 
                pages={pages}
                activePageId={activePageId}
                isExpanded={isCanvasMode} 
                onPageSelect={handleCardSwipe}
                resources={filteredResources}
                onDeleteResource={handleDeleteResource}
                onUpdateResourcePosition={handleUpdateResourcePosition}
                highlightedResourceId={highlightedResourceId}
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
          <FloatingActionButton 
            onClick={handleFabClick} 
            onPaste={handlePaste}
            isActive={isCanvasMode} 
          />
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
              maxWidth: "min(420px, calc(100vw - 32px))",
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
                overflowWrap: "anywhere",
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
