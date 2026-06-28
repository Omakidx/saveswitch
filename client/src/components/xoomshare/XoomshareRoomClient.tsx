"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import CardStack from "@/components/dashboard/CardStack";
import CategorySwitch, { Category } from "@/components/dashboard/CategorySwitch";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import FloatingActionButton from "@/components/dashboard/FloatingActionButton";
import InfiniteCanvas, { InfiniteCanvasRef } from "@/components/dashboard/InfiniteCanvas";
import ResourceMiniPanel, { PageData } from "@/components/dashboard/ResourceMiniPanel";
import ResourceNavigator from "@/components/dashboard/ResourceNavigator";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Resource } from "@/components/dashboard/ResourceCard";
import { API_BASE } from "@/lib/api";

interface XoomshareRoom {
  id: string;
  color: string;
  name: string;
  pathCode: string;
  created_at: string;
  expires_at: string | null;
  isOwner: boolean;
  allowGuestResources: boolean;
}

interface ToastMessage {
  id: string;
  message: string;
  type: "error" | "success" | "info";
}

interface DateGroup {
  label: string;
  date: string;
  pages: PageData[];
}

interface XoomshareRoomClientProps {
  pathCode: string;
}

function getFilteredResources(resources: Resource[], category: Category) {
  if (category === "target") return resources;
  if (category === "image") return resources.filter((resource) => resource.type === "image");
  if (category === "link" || category === "video") return resources.filter((resource) => resource.type === "link");
  return resources.filter((resource) => resource.type === "pdf" || resource.type === "file" || resource.type === "text");
}

function getApiErrorMessage(error: unknown, fallback: string) {
  return typeof error === "string" && error.trim() ? error.trim() : fallback;
}

function formatDateLabel(dateStr: string) {
  const date = new Date(dateStr);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  if (targetStart.getTime() === todayStart.getTime()) return "Today";
  if (targetStart.getTime() === yesterdayStart.getTime()) return "Yesterday";

  return targetStart.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours} : ${minutes.toString().padStart(2, "0")} : ${seconds.toString().padStart(2, "0")}`;
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}

/** Returns true when a hex colour is too dark to look good as a card background. */
function isDarkColor(color: string): boolean {
  const hex = color.replace(/^#/, "");
  if (hex.length !== 6) return false;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Luminance ≈ 0.299R + 0.587G + 0.114B  → dark when < 40
  return 0.299 * r + 0.587 * g + 0.114 * b < 40;
}

/** Deterministic vibrant pastel from a string seed. */
function vibrantColorFromSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 85%)`;
}

function getInitialState(pathCode: string) {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(`xoomshare-state-${pathCode}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.expandedDates && Array.isArray(parsed.expandedDates)) {
        parsed.expandedDates = new Set(parsed.expandedDates);
      }
      return parsed;
    }
  } catch {}
  return {};
}

export default function XoomshareRoomClient({ pathCode }: XoomshareRoomClientProps) {
  const router = useRouter();
  const initialState = useMemo(() => getInitialState(pathCode), [pathCode]);
  const [room, setRoom] = useState<XoomshareRoom | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isCanvasMode, setIsCanvasMode] = useState<boolean>(initialState.isCanvasMode ?? false);
  const [activeCategory, setActiveCategory] = useState<Category>(initialState.activeCategory ?? "target");
  const [highlightedResourceId, setHighlightedResourceId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (initialState.sidebarCollapsed !== undefined) return initialState.sidebarCollapsed;
    if (typeof window !== "undefined") return window.innerWidth < 768;
    return false;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(initialState.selectedDate ?? null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(initialState.expandedDates ?? new Set());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pages, setPages] = useState<PageData[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(initialState.activePageId ?? null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [hasDismissedExpiryNotice, setHasDismissedExpiryNotice] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`xoomshare-expiry-notice-${pathCode}`) === "dismissed";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(`xoomshare-state-${pathCode}`, JSON.stringify({
        isCanvasMode,
        activeCategory,
        sidebarCollapsed,
        selectedDate,
        expandedDates: Array.from(expandedDates),
        activePageId,
      }));
    } catch {}
  }, [pathCode, isCanvasMode, activeCategory, sidebarCollapsed, selectedDate, expandedDates, activePageId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmLabel?: string;
    confirmClassName?: string;
  } | null>(null);

  const canvasOffsetRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<InfiniteCanvasRef>(null);

  const showToast = useCallback((message: string, type: ToastMessage["type"] = "info") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3500);
  }, []);

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/xoomshare");
  }, [router]);

  const dismissExpiryNotice = useCallback(() => {
    setHasDismissedExpiryNotice(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(`xoomshare-expiry-notice-${pathCode}`, "dismissed");
    }
  }, [pathCode]);

  const renderBackButton = (className = "") => (
    <button
      type="button"
      onClick={handleBack}
      className={`flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 ${className}`}
      aria-label="Go back"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  const fetchRoom = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}`, {
      credentials: "include",
      signal,
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Xoomshare page not found");
    }

    return {
      room: data.room as XoomshareRoom,
      pages: (data.pages || []) as PageData[],
      resources: (data.resources || []) as Resource[],
    };
  }, [pathCode]);

  useEffect(() => {
    const controller = new AbortController();

    Promise.resolve()
      .then(() => fetchRoom(controller.signal))
      .then((data) => {
        setError("");
        setRoom(data.room);
        setPages(data.pages.length > 0 ? data.pages : [{
          id: data.room.id,
          color: data.room.color,
          createdAt: data.room.created_at,
          name: data.room.name,
        }]);
        setResources(data.resources);
        const roomDate = data.room.created_at.split("T")[0];
        setSelectedDate(prev => prev ?? roomDate);
        setExpandedDates(prev => prev.size > 0 ? prev : new Set([roomDate]));
        setActivePageId(prev => prev ?? data.room.id);
      })
      .catch((err: Error) => {
        if (!isAbortError(err)) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [fetchRoom]);

  useEffect(() => {
    if (!room?.id) return;

    let pingInterval: number;
    const ws = new WebSocket(`${API_BASE.replace(/^http/, "ws")}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", pageId: room.id }));
      pingInterval = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "room_destroyed") {
          setRoom(null);
          setError("This session was destroyed by the creator.");
        } else if (message.type === "resource_updated" || message.type === "page_added" || message.type === "page_updated" || message.type === "page_deleted" || message.type === "settings_updated") {
          fetchRoom()
            .then((data) => {
              setError("");
              setRoom(data.room);
              setPages(data.pages.length > 0 ? data.pages : [{
                id: data.room.id,
                color: data.room.color,
                createdAt: data.room.created_at,
                name: data.room.name,
              }]);
              setResources(data.resources);
            })
            .catch(() => {});
        }
      } catch {}
    };

    return () => {
      window.clearInterval(pingInterval);
      ws.close();
    };
  }, [fetchRoom, room?.id]);

  const roomDisplayColor = useMemo(() => {
    if (!room) return "hsl(200, 70%, 85%)";
    if (!room.color || isDarkColor(room.color)) {
      return vibrantColorFromSeed(room.pathCode || room.id);
    }
    return room.color;
  }, [room]);

  const expiryRemainingMs = (() => {
    if (!room?.expires_at) return null;
    const expiresAtMs = new Date(room.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs)) return null;
    return Math.max(0, expiresAtMs - nowMs);
  })();

  const expiryCountdownLabel = expiryRemainingMs === null
    ? null
    : formatCountdown(expiryRemainingMs);
  const hasRoomExpired = !!room?.expires_at && expiryRemainingMs === 0;

  const dateGroups: DateGroup[] = useMemo(() => {
    if (!room || pages.length === 0) return [];
    
    const groups: Record<string, PageData[]> = {};
    for (const page of pages) {
      const dateKey = page.createdAt.split("T")[0];
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(page);
    }
    
    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, pgs]) => ({
        label: formatDateLabel(date),
        date,
        pages: pgs.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
      }));
  }, [pages, room]);

  const handlePageSelect = useCallback((pageId: string) => {
    setActivePageId(pageId);
    setIsCanvasMode(true);
    
    // Find the date for this page and select/expand it
    const page = pages.find((p) => p.id === pageId);
    if (page) {
      const pageDate = page.createdAt.split("T")[0];
      setSelectedDate(pageDate);
      setExpandedDates((prev) => new Set(prev).add(pageDate));
    }
  }, [pages]);

  const handleCardSwipe = useCallback((pageId: string) => {
    setActivePageId(pageId);
  }, []);

  const handleAddXoomsharePage = useCallback(async () => {
    if (!room?.isOwner) return;

    try {
      const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/pages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Xoomshare ${pathCode} ${pages.length + 1}` }),
      });
      const data = await res.json();
      if (data.success && data.page) {
        setPages((prev) => [...prev, data.page]);
        handleCardSwipe(data.page.id);
        showToast("Page created successfully", "success");
      } else {
        showToast(data.error || "Failed to create page", "error");
      }
    } catch {
      showToast("Network error creating page", "error");
    }
  }, [pathCode, room?.isOwner, handleCardSwipe, pages.length, showToast]);

  const handlePageUpdateName = useCallback(async (id: string, newName: string) => {
    if (!room?.isOwner || !newName.trim()) return;

    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, name: newName.trim() } : p)));

    try {
      const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/pages/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || "Failed to rename page", "error");
        fetchRoom().then(d => setPages(d.pages));
      }
    } catch {
      showToast("Network error renaming page", "error");
      fetchRoom().then(d => setPages(d.pages));
    }
  }, [pathCode, room?.isOwner, showToast, fetchRoom]);

  const executeDeletePage = useCallback(async (id: string) => {
    if (!room?.isOwner) return;

    try {
      const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/pages/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      
      if (data.success) {
        setPages((prev) => {
          const next = prev.filter((p) => p.id !== id);
          if (activePageId === id && next.length > 0) {
            handlePageSelect(next[next.length - 1].id);
          }
          return next;
        });
        showToast("Page deleted successfully", "success");
      } else {
        showToast(data.error || "Failed to delete page", "error");
      }
    } catch {
      showToast("Network error deleting page", "error");
    }
  }, [pathCode, room?.isOwner, activePageId, handlePageSelect, showToast]);

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

  const handlePanToResource = useCallback((id: string, x: number, y: number) => {
    setIsCanvasMode(true);
    requestAnimationFrame(() => {
      canvasRef.current?.panTo(x, y);
    });
    setHighlightedResourceId(id);
    setTimeout(() => setHighlightedResourceId(null), 3000);
  }, []);

  const activePageResources = useMemo(() => {
    return resources.filter((r) => r.pageId === activePageId);
  }, [resources, activePageId]);

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

  const processPaste = useCallback(async (type: Resource["type"], content: string, title?: string) => {
    if (!room) return;
    if (!room.isOwner) {
      showToast("This device can view and copy resources, but only the creator can add more.", "info");
      return;
    }

    const boxWidth = 320;
    const boxHeight = 340;
    let x = Math.round((window.innerWidth / 2) - (boxWidth / 2) - canvasOffsetRef.current.x);
    let y = Math.round((window.innerHeight / 2) - (boxHeight / 2) - canvasOffsetRef.current.y);

    let isOccupied = true;
    let attempts = 0;
    let dx = 0;
    let dy = 0;
    let segmentLength = 1;
    let segmentPassed = 0;
    let direction = 0;

    while (isOccupied && attempts < 50) {
      isOccupied = resources.some((resource) => {
        const resourceX = resource.x ?? 100;
        const resourceY = resource.y ?? 100;
        return !(x + boxWidth <= resourceX || x >= resourceX + boxWidth || y + boxHeight <= resourceY || y >= resourceY + boxHeight);
      });

      if (isOccupied) {
        if (direction === 0) {
          dx = 1;
          dy = 0;
        } else if (direction === 1) {
          dx = 0;
          dy = 1;
        } else if (direction === 2) {
          dx = -1;
          dy = 0;
        } else {
          dx = 0;
          dy = -1;
        }

        x += dx * boxWidth;
        y += dy * boxHeight;
        segmentPassed++;

        if (segmentPassed === segmentLength) {
          segmentPassed = 0;
          direction = (direction + 1) % 4;
          if (direction === 0 || direction === 2) segmentLength++;
        }
        attempts++;
      }
    }

    try {
      const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/resources`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content, title, x, y, pageId: activePageId }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showToast(getApiErrorMessage(data.error, "Unable to save this resource."), "error");
        return;
      }

      setResources((prev) => [...prev, data.resource]);
      showToast("Resource saved successfully", "success");
    } catch {
      showToast("Network error while saving this resource.", "error");
    }
  }, [pathCode, resources, room, showToast, activePageId]);

  const handlePaste = useCallback(async () => {
    if (!isCanvasMode) {
      showToast("Please enter a canvas to paste resources.", "info");
      return;
    }
    if (!room?.isOwner) {
      showToast("Only the creator device can add resources to this page.", "info");
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      let hasItem = false;

      for (const item of items) {
        if (item.types.some((type) => type.startsWith("image/"))) {
          hasItem = true;
          const imageType = item.types.find((type) => type.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            const reader = new FileReader();
            reader.onloadend = () => processPaste("image", reader.result as string);
            reader.readAsDataURL(blob);
          }
        } else if (item.types.includes("application/pdf")) {
          hasItem = true;
          const blob = await item.getType("application/pdf");
          const reader = new FileReader();
          reader.onloadend = () => processPaste("pdf", reader.result as string);
          reader.readAsDataURL(blob);
        } else if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          const text = await blob.text();
          const trimmedText = text.trim();
          if (trimmedText) {
            hasItem = true;
            const isUrl = /^https?:\/\//i.test(trimmedText);
            processPaste(isUrl ? "link" : "text", trimmedText);
          }
        }
      }

      if (!hasItem) showToast("Clipboard is empty or unsupported.", "info");
    } catch {
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
          showToast("Clipboard is empty.", "info");
          return;
        }
        const isUrl = /^https?:\/\//i.test(text.trim());
        processPaste(isUrl ? "link" : "text", text.trim());
      } catch {
        showToast("Allow clipboard permission to paste resources.", "error");
      }
    }
  }, [processPaste, room?.isOwner, showToast, isCanvasMode]);

  const handleFileUploads = useCallback((files: File[]) => {
    if (!room?.isOwner) {
      showToast("Only the creator device can upload resources to this page.", "info");
      return;
    }

    for (const file of files) {
      const reader = new FileReader();
      if (file.type.startsWith("image/")) {
        reader.onloadend = () => processPaste("image", reader.result as string, file.name);
      } else if (file.type === "application/pdf") {
        reader.onloadend = () => processPaste("pdf", reader.result as string, file.name);
      } else {
        reader.onloadend = () => processPaste("file", reader.result as string, file.name);
      }
      reader.readAsDataURL(file);
    }
  }, [processPaste, room?.isOwner, showToast]);

  useEffect(() => {
    const handleGlobalPaste = (event: ClipboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!room?.isOwner || !isCanvasMode) return;

      const items = Array.from(event.clipboardData?.items || []);
      if (items.length === 0) return;

      let processed = false;
      for (const item of items) {
        if (item.type.startsWith("image/") || item.type === "application/pdf") {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onloadend = () => processPaste(item.type === "application/pdf" ? "pdf" : "image", reader.result as string, file.name);
            reader.readAsDataURL(file);
            processed = true;
          }
        } else if (item.type === "text/plain") {
          item.getAsString((text) => {
            const trimmedText = text.trim();
            if (!trimmedText) return;
            const isUrl = /^https?:\/\//i.test(trimmedText);
            processPaste(isUrl ? "link" : "text", trimmedText);
          });
          processed = true;
        }
      }

      if (processed) event.preventDefault();
    };

    const handleUploadEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ files?: File[] }>;
      if (customEvent.detail?.files) {
        handleFileUploads(customEvent.detail.files);
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    window.addEventListener("saveswitch-upload", handleUploadEvent);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
      window.removeEventListener("saveswitch-upload", handleUploadEvent);
    };
  }, [handleFileUploads, isCanvasMode, processPaste, room?.isOwner]);

  const handleUpdateResourcePosition = useCallback(async (id: string, x: number, y: number) => {
    if (!room?.isOwner) return;
    setResources((prev) => prev.map((resource) => resource.id === id ? { ...resource, x, y } : resource));

    try {
      await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/resources/${id}/position`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
    } catch {
      showToast("Unable to move this resource right now.", "error");
    }
  }, [pathCode, room?.isOwner, showToast]);

  const executeDeleteResource = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/resources/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showToast(getApiErrorMessage(data.error, "Unable to delete this resource."), "error");
        return;
      }

      setResources((prev) => prev.filter((resource) => resource.id !== id));
      showToast("Resource deleted", "success");
    } catch {
      showToast("Network error while deleting this resource.", "error");
    }
  }, [pathCode, showToast]);

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

  const handleCopyShareLink = useCallback(async () => {
    if (!room) return;
    await navigator.clipboard.writeText(`${window.location.origin}/${room.pathCode}`);
    showToast("Xoomshare link copied", "success");
  }, [room, showToast]);

  const handleToggleGuestAccess = useCallback(async () => {
    if (!room) return;
    try {
      const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ allowGuestResources: !room.allowGuestResources }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "Failed to update settings", "error");
        return;
      }
      setRoom((prev) => prev ? { ...prev, allowGuestResources: data.allowGuestResources } : prev);
      showToast(data.allowGuestResources ? "Anyone can now add resources" : "Only you can add resources", "success");
    } catch {
      showToast("Failed to update settings", "error");
    }
  }, [room, pathCode, showToast]);

  const handleToggleGuestAccessWithConfirm = useCallback(() => {
    if (!room) return;
    const isCurrentlyOpen = room.allowGuestResources;
    setConfirmModal({
      isOpen: true,
      title: isCurrentlyOpen ? "Restrict to view only?" : "Open to everyone?",
      message: isCurrentlyOpen
        ? "Visitors will no longer be able to add resources to this page. Existing guest resources will remain."
        : "Anyone with the link will be able to add their own resources to this page. They won\u2019t be able to modify or delete resources created by others.",
      confirmLabel: isCurrentlyOpen ? "Restrict" : "Open access",
      confirmClassName: isCurrentlyOpen
        ? "flex items-center gap-2 px-5 py-2.5 rounded-xl font-arimo text-sm font-semibold cursor-pointer transition-all bg-orange-600 hover:bg-orange-700 text-white shadow-md hover:shadow-lg active:scale-95 border-none"
        : "flex items-center gap-2 px-5 py-2.5 rounded-xl font-arimo text-sm font-semibold cursor-pointer transition-all bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg active:scale-95 border-none",
      onConfirm: () => {
        setConfirmModal(null);
        handleToggleGuestAccess();
      },
    });
  }, [room, handleToggleGuestAccess]);

  const handleDestroySession = useCallback(async () => {
    if (!room) return;
    try {
      const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "Failed to destroy session", "error");
        return;
      }
      showToast("Session destroyed successfully", "success");
      setRoom(null);
      setError("This session was destroyed by the creator.");
    } catch {
      showToast("Network error while destroying session", "error");
    }
  }, [room, pathCode, showToast]);

  const handleDestroySessionWithConfirm = useCallback(() => {
    setConfirmModal({
      isOpen: true,
      title: "Destroy Session",
      message: "Are you sure you want to destroy this Xoomshare session? All files will be permanently deleted.",
      confirmLabel: "Destroy Session",
      confirmClassName: "flex items-center gap-2 px-5 py-2.5 rounded-xl font-arimo text-sm font-semibold cursor-pointer transition-all bg-red-600 hover:bg-red-700 text-white shadow-md hover:shadow-lg active:scale-95 border-none",
      onConfirm: () => {
        setConfirmModal(null);
        handleDestroySession();
      },
    });
  }, [handleDestroySession]);

  if (loading) return <LoadingSpinner />;

  if (error || !room || hasRoomExpired) {
    return (
      <main className="relative flex min-h-screen w-full items-center justify-center bg-black px-6 font-inter text-white">
        {renderBackButton("absolute left-6 top-6")}
        <div className="flex w-[260px] flex-col items-center text-center">
          <h1 className="text-[14px] font-bold leading-[19px]">Xoomshare page unavailable</h1>
          <p className="mt-3 text-[10px] font-medium leading-[15px] text-white/55">
            {hasRoomExpired ? "This Xoomshare page has expired." : error || "This secret page code could not be found."}
          </p>
          <Link href="/xoomshare/join" className="mt-6 text-[10px] font-bold text-white no-underline">
            Try another code
          </Link>
        </div>
      </main>
    );
  }

  const filteredResources = getFilteredResources(activePageResources, activeCategory);
  const activePage = pages.find((p) => p.id === (activePageId || room.id));
  const canAddResources = room.isOwner || room.allowGuestResources;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-black font-inter text-white">
      <DashboardSidebar
        user={null}
        dateGroups={dateGroups}
        selectedDate={selectedDate}
        expandedDates={expandedDates}
        onDateSelect={setSelectedDate}
        onToggleExpand={handleToggleExpand}
        onPageSelect={handlePageSelect}
        onPageUpdateName={handlePageUpdateName}
        activePageId={activePageId || room.id}
        onLogout={() => {}}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        onDeletePage={handleDeletePage}
        readOnly={!room.isOwner}
        xoomshareExpiryNotice={expiryCountdownLabel ? {
          countdownLabel: expiryCountdownLabel,
          onDismiss: room.isOwner && !hasDismissedExpiryNotice ? dismissExpiryNotice : undefined,
          showAlways: !room.isOwner,
        } : undefined}
      />

      <main
        className="relative flex h-dvh flex-1 flex-col overflow-hidden"
        style={{ background: "var(--color-app-bg)" }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length > 0) {
            handleFileUploads(Array.from(event.dataTransfer.files));
          }
        }}
      >
        <div className="relative flex flex-1 flex-col overflow-hidden bg-black">
          <div
            className="absolute left-4 right-4 top-4 z-40 flex max-w-[calc(100vw-32px)] flex-wrap items-center gap-2 transition-[left] duration-200 sm:left-6 sm:right-auto sm:top-6 sm:max-w-[calc(100vw-280px)] sm:gap-3 md:left-6"
          >
            <button
              type="button"
              onClick={handleCopyShareLink}
              className="flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-[#0A0A0A] px-3 text-[11px] font-bold text-white shadow-[0_8px_24px_rgba(0,0,0,0.24)] transition-colors hover:border-white/25 hover:bg-white/10 sm:px-4"
              title="Copy Xoomshare link"
            >
              <span className="text-white/70">Xoomshare</span>
              <span className="min-w-0 truncate">{room.pathCode}</span>
              <Image src="/images/copy-icon.svg" alt="Copy Link" width={16} height={16} className="ml-1 opacity-90" />
            </button>
            {room.isOwner ? (
              <>
                <button
                  type="button"
                  onClick={handleToggleGuestAccessWithConfirm}
                  className={`flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-[10px] font-bold transition-colors ${
                    room.allowGuestResources
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      : "border-white/10 bg-[#0A0A0A] text-white/55 hover:border-white/25 hover:bg-white/10"
                  }`}
                  title={room.allowGuestResources ? "Click to restrict to view-only" : "Click to let anyone add resources"}
                >
                  {room.allowGuestResources ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                      Open
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      View only
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDestroySessionWithConfirm}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 text-[10px] font-bold text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/20 shadow-[0_8px_24px_rgba(0,0,0,0.24)]"
                  title="Destroy session early"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Destroy
                </button>
              </>
            ) : !canAddResources ? (
              <span className="rounded-full border border-white/10 bg-[#0A0A0A] px-3 py-2 text-[10px] font-bold text-white/55">
                View only
              </span>
            ) : null}
          </div>

          <div className="absolute right-4 top-24 z-40 sm:right-8 sm:top-8">
            <CategorySwitch activeCategory={activeCategory} onChange={setActiveCategory} />
          </div>

          <ResourceNavigator
            resources={filteredResources}
            onSelectResource={handlePanToResource}
            isActive={isCanvasMode}
          />

          <InfiniteCanvas
            ref={canvasRef}
            isActive={isCanvasMode}
            canvasColor={activePage?.color || roomDisplayColor}
            canvasOffsetRef={canvasOffsetRef}
          >
            <div className="flex h-full w-full flex-1 items-center justify-center">
              <CardStack
                pages={pages}
                activePageId={activePageId || room.id}
                isExpanded={isCanvasMode}
                onPageSelect={handleCardSwipe}
                resources={filteredResources}
                onDeleteResource={(room.isOwner || canAddResources) ? (id) => {
                  const resource = resources.find(r => r.id === id);
                  if (room.isOwner || resource?.isOwner) {
                    handleDeleteResource(id);
                  } else {
                    showToast("You can only delete your own resources", "error");
                  }
                } : undefined}
                onUpdateResourcePosition={(room.isOwner || canAddResources) ? (id, x, y) => {
                  const resource = resources.find(r => r.id === id);
                  if (room.isOwner || resource?.isOwner) {
                    handleUpdateResourcePosition(id, x, y);
                  } else {
                    showToast("You can only move your own resources", "error");
                  }
                } : undefined}
                highlightedResourceId={highlightedResourceId}
                readOnly={!canAddResources}
              />
            </div>
          </InfiniteCanvas>

          <div className="absolute right-3 top-1/2 z-10 -translate-y-1/2 sm:right-[66px]">
            <ResourceMiniPanel
              pages={pages}
              activePageId={activePageId || room.id}
              onAddPage={handleAddXoomsharePage}
              onPageSelect={handlePageSelect}
              onDeletePage={handleDeletePage}
              readOnly={!room.isOwner}
            />
          </div>

          <div className="absolute bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
            <FloatingActionButton
              onClick={() => setIsCanvasMode((prev) => !prev)}
              onPaste={handlePaste}
              isActive={isCanvasMode}
              readOnly={!canAddResources}
            />
          </div>
        </div>
      </main>

      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-auto">
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
            <div className="mt-4 flex flex-wrap justify-end gap-3">
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
                className={confirmModal.confirmClassName || "flex items-center gap-2 px-5 py-2.5 rounded-xl font-arimo text-sm font-semibold cursor-pointer transition-all bg-red-600 hover:bg-red-700 text-white shadow-md hover:shadow-lg active:scale-95 border-none"}
              >
                {!confirmModal.confirmLabel && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src="/icons/icon-trash.svg"
                    alt=""
                    width={16}
                    height={16}
                    style={{ filter: "brightness(0) invert(1)" }}
                  />
                )}
                {confirmModal.confirmLabel || "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-8 sm:left-auto sm:right-8">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex w-full items-center gap-3 rounded-xl px-4 py-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.3)] sm:w-auto sm:px-5"
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
      `}} />
    </div>
  );
}
