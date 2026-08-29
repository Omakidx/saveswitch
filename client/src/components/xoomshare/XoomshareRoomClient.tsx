"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import CardStack from "@/components/dashboard/CardStack";
import InfiniteCanvas, { InfiniteCanvasRef } from "@/components/dashboard/InfiniteCanvas";
import { PageData } from "@/components/dashboard/ResourceMiniPanel";
import { Resource } from "@/components/dashboard/ResourceCard";
import { API_BASE } from "@/lib/api";
import styles from "./XoomshareRoomClient.module.css";

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

type Category = "target" | "document" | "image" | "link" | "video";

interface XoomshareRoomClientProps {
  pathCode: string;
}

interface XoomshareRoomResponse {
  room: XoomshareRoom;
  pages: PageData[];
  resources: Resource[];
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

function CategoryIcon({ category }: { category: Category }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true as const };
  if (category === "target") return <svg {...common}><path d="m12 2 8.5 4.8v10.4L12 22l-8.5-4.8V6.8L12 2Z" stroke="currentColor" strokeWidth="1.5"/><path d="m3.8 7 8.2 4.7L20.2 7M12 11.7V22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (category === "document") return <svg {...common}><path d="M7 3.5h7l3 3V20a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 7 20V3.5Z" stroke="currentColor" strokeWidth="1.5"/><path d="M14 3.5v3h3M9.5 11h5M9.5 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
  if (category === "image") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="9" r="1.4" fill="currentColor"/><path d="m4.5 17 5-5 3.5 3 2.2-2.2 4.3 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (category === "link") return <svg {...common}><path d="M10 14 8.5 15.5a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="m14 10 1.5-1.5a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="m8.5 15.5 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
  return <svg {...common}><rect x="3" y="6" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="m16 10 4-2v8l-4-2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>;
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
  const [selectedDate, setSelectedDate] = useState<string | null>(initialState.selectedDate ?? null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(initialState.expandedDates ?? new Set());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pages, setPages] = useState<PageData[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(initialState.activePageId ?? null);
  const [isResourceDragging, setIsResourceDragging] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isResourceMenuOpen, setIsResourceMenuOpen] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageNameDraft, setPageNameDraft] = useState("");
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
        selectedDate,
        expandedDates: Array.from(expandedDates),
        activePageId,
      }));
    } catch {}
  }, [pathCode, isCanvasMode, activeCategory, selectedDate, expandedDates, activePageId]);

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
  const canAddResources = Boolean(room?.isOwner || room?.allowGuestResources);

  const showToast = useCallback((message: string, type: ToastMessage["type"] = "info") => {
    const id = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => {
      // A reconnect or browser event can repeat the same outcome. Keep feedback useful
      // without stacking identical notifications.
      if (prev.some((toast) => toast.message === message && toast.type === type)) return prev;
      return [...prev.slice(-2), { id, message, type }];
    });
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
      className={`${styles.glassButton} flex h-9 w-9 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#176bff] focus:ring-offset-2 ${className}`}
      aria-label="Go back"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
    } satisfies XoomshareRoomResponse;
  }, [pathCode]);

  const applyRoomData = useCallback((data: XoomshareRoomResponse) => {
    const nextPages = data.pages.length > 0 ? data.pages : [{
      id: data.room.id,
      color: data.room.color,
      createdAt: data.room.created_at,
      name: data.room.name,
    }];

    setError("");
    setRoom(data.room);
    setPages(nextPages);
    setResources(data.resources);
    const roomDate = data.room.created_at.split("T")[0];
    setSelectedDate((previous) => previous ?? roomDate);
    setExpandedDates((previous) => previous.size > 0 ? previous : new Set([roomDate]));
    setActivePageId((previous) => nextPages.some((page) => page.id === previous) ? previous : nextPages[0]?.id ?? data.room.id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    Promise.resolve()
      .then(() => fetchRoom(controller.signal))
      .then(applyRoomData)
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
  }, [applyRoomData, fetchRoom]);

  useEffect(() => {
    if (!room?.id) return;

    let pingInterval: number | undefined;
    let retryTimer: number | undefined;
    let socket: WebSocket | null = null;
    let cancelled = false;
    let reconnectAttempt = 0;

    const refreshRoom = () => {
      void fetchRoom().then(applyRoomData).catch(() => {
        // Keep the last good canvas visible during a transient network outage.
      });
    };

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(`${API_BASE.replace(/^http/, "ws")}/ws`);
      socket.onopen = () => {
        reconnectAttempt = 0;
        socket?.send(JSON.stringify({ type: "subscribe", pageId: room.id }));
        pingInterval = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
        }, 30000);
        refreshRoom();
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "room_destroyed") {
            setRoom(null);
            setError("This session was destroyed by the creator.");
          } else if (["resource_updated", "page_added", "page_updated", "page_deleted", "settings_updated"].includes(message.type)) {
            refreshRoom();
          }
        } catch {
          // Ignore malformed non-room messages.
        }
      };
      socket.onclose = () => {
        if (pingInterval) window.clearInterval(pingInterval);
        if (cancelled) return;
        const waitMs = Math.min(1000 * 2 ** reconnectAttempt, 12000);
        reconnectAttempt += 1;
        retryTimer = window.setTimeout(connect, waitMs);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (pingInterval) window.clearInterval(pingInterval);
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [applyRoomData, fetchRoom, room?.id]);

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

  const handleCanvasPageNavigation = useCallback((direction: "previous" | "next") => {
    if (pages.length < 2) return;
    const currentIndex = pages.findIndex((page) => page.id === activePageId);
    const index = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = direction === "next"
      ? (index + 1) % pages.length
      : (index - 1 + pages.length) % pages.length;
    handlePageSelect(pages[nextIndex].id);
  }, [activePageId, handlePageSelect, pages]);

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

  const processPaste = useCallback(async (type: Resource["type"], content: string, title?: string) => {
    if (!room) return;
    if (!room.isOwner && !room.allowGuestResources) {
      showToast("This room is view only.", "info");
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

      // The API response and the room websocket can arrive in either order.
      // Keeping this update idempotent prevents a newly-added card from briefly
      // appearing twice when a refresh wins the race.
      setResources((prev) => prev.some((resource) => resource.id === data.resource.id)
        ? prev
        : [...prev, data.resource]);
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
    if (!room?.isOwner && !room?.allowGuestResources) {
      showToast("This room is view only.", "info");
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
  }, [processPaste, room?.allowGuestResources, room?.isOwner, showToast, isCanvasMode]);

  const handleFileUploads = useCallback((files: File[]) => {
    if (!room?.isOwner && !room?.allowGuestResources) {
      showToast("This room is view only.", "info");
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
  }, [processPaste, room?.allowGuestResources, room?.isOwner, showToast]);

  useEffect(() => {
    const handleGlobalPaste = (event: ClipboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if ((!room?.isOwner && !room?.allowGuestResources) || !isCanvasMode) return;

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
  }, [handleFileUploads, isCanvasMode, processPaste, room?.allowGuestResources, room?.isOwner]);

  const handleUpdateResourcePosition = useCallback(async (id: string, x: number, y: number) => {
    const resource = resources.find((candidate) => candidate.id === id);
    if (!room?.isOwner && !resource?.isOwner) {
      showToast("You can only move resources you added.", "error");
      return;
    }
    if (!resource) return;

    const previousPosition = { x: resource.x, y: resource.y };
    setResources((prev) => prev.map((resource) => resource.id === id ? { ...resource, x, y } : resource));

    try {
      const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/resources/${id}/position`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(getApiErrorMessage(data.error, "Unable to move this resource right now."), "error");
        setResources((prev) => prev.map((item) => item.id === id
          ? { ...item, ...previousPosition }
          : item));
      }
    } catch {
      showToast("Unable to move this resource right now.", "error");
      setResources((prev) => prev.map((item) => item.id === id
        ? { ...item, ...previousPosition }
        : item));
    }
  }, [pathCode, resources, room?.isOwner, showToast]);

  const handleUpdateTextResource = useCallback(async (id: string, content: string) => {
    const resource = resources.find((candidate) => candidate.id === id);
    if (!room?.isOwner && !resource?.isOwner) {
      throw new Error("You can only edit text you added.");
    }

    const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/resources/${id}/text`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, title: resource?.title }),
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.resource) {
      throw new Error(getApiErrorMessage(data.error, "Unable to save this text."));
    }
    setResources((previous) => previous.map((item) => item.id === id ? { ...item, ...data.resource } : item));
  }, [pathCode, resources, room?.isOwner]);

  const executeDeleteResource = useCallback(async (id: string) => {
    const resource = resources.find((candidate) => candidate.id === id);
    if (!room?.isOwner && !resource?.isOwner) {
      showToast("You can only delete resources you added.", "error");
      return;
    }
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
  }, [pathCode, resources, room?.isOwner, showToast]);

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
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${room.pathCode}`);
      showToast("Xoomshare link copied", "success");
    } catch {
      showToast("Allow clipboard access to copy the share link.", "error");
    }
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

  if (loading) {
    return (
      <main className={`${styles.unavailable} flex items-center justify-center px-5 font-inter`} aria-busy="true" aria-live="polite">
        <div className={`${styles.overlayPanel} flex min-w-[190px] flex-col items-center rounded-2xl px-6 py-5`}>
          <span className="h-3 w-3 animate-bounce rounded-full bg-[#176bff]" aria-hidden="true" />
          <p className="mt-3 text-[12px] font-medium text-[#5d5e54]">Opening Xoomshare room</p>
        </div>
      </main>
    );
  }

  if (error || !room || hasRoomExpired) {
    return (
      <main className={`${styles.unavailable} relative flex w-full items-center justify-center px-6 font-inter`}>
        {renderBackButton("absolute left-5 top-5 sm:left-7 sm:top-7")}
        <div className={`${styles.overlayPanel} flex w-full max-w-[320px] flex-col items-center rounded-[24px] px-6 py-7 text-center`}>
          <h1 className="text-[17px] font-semibold leading-[22px] text-[#383932]">Xoomshare room unavailable</h1>
          <p className={`${styles.notice} mt-3 text-[12px] font-medium leading-[18px]`}>
            {hasRoomExpired ? "This Xoomshare page has expired." : error || "This secret page code could not be found."}
          </p>
          <Link href="/xoomshare/join" className="mt-6 text-[12px] font-semibold text-[#4e5045] underline decoration-[#a5a38f] underline-offset-4 hover:text-[#176bff]">
            Try another code
          </Link>
        </div>
      </main>
    );
  }

  const filteredResources = getFilteredResources(activePageResources, activeCategory);
  const activePage = pages.find((page) => page.id === (activePageId || room.id));
  const categoryCounts: Record<Category, number> = {
    target: activePageResources.length,
    document: activePageResources.filter((resource) => resource.type === "text" || resource.type === "pdf" || resource.type === "file").length,
    image: activePageResources.filter((resource) => resource.type === "image").length,
    link: activePageResources.filter((resource) => resource.type === "link").length,
    video: 0,
  };
  const categories: Category[] = ["target", "document", "image", "link", "video"];

  return (
    <div className={`${styles.room} relative h-dvh w-full overflow-hidden font-inter`}>
      <main
        className="relative flex h-full min-h-0 w-full flex-col overflow-hidden"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length > 0) {
            handleFileUploads(Array.from(event.dataTransfer.files));
          }
        }}
      >
        <div className="xoomshare-shell relative flex flex-1 flex-col overflow-hidden bg-transparent">
          <div className={`${styles.roomHeader} absolute left-3 right-3 top-3 z-40 flex items-center justify-between gap-2 sm:left-5 sm:right-5 sm:top-4`}>
            <div className="flex min-w-0 items-center gap-2">
              {renderBackButton("shrink-0")}
            <button
              type="button"
              onClick={handleCopyShareLink}
              className={`${styles.chrome} flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-full px-3 text-[11px] font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff] sm:px-4`}
              title="Copy Xoomshare link"
            >
              <span className="hidden text-white/70 sm:inline">Xoomshare</span>
              <span className="min-w-0 truncate">{room.pathCode}</span>
              <Image src="/icons/icon-copy.svg" alt="" width={14} height={14} className="ml-1 opacity-80 invert" />
            </button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {expiryCountdownLabel && (
                <button
                  type="button"
                  onClick={room.isOwner && !hasDismissedExpiryNotice ? dismissExpiryNotice : undefined}
                  className={`${styles.chrome} hidden h-9 items-center rounded-full px-3 text-[10px] font-semibold text-white/80 sm:flex`}
                  title={room.isOwner ? "Session expiry countdown. Click to dismiss." : "Session expiry countdown"}
                >
                  {expiryCountdownLabel}
                </button>
              )}
            {room.isOwner ? (
              <>
                <button
                  type="button"
                  onClick={handleToggleGuestAccessWithConfirm}
                  className={`${styles.chrome} flex h-9 cursor-pointer items-center gap-2 rounded-full px-3 text-[10px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff] ${
                    room.allowGuestResources
                      ? "text-[#e9ffe9]"
                      : "text-white/75"
                  }`}
                  title={room.allowGuestResources ? "Click to restrict to view-only" : "Click to let anyone add resources"}
                >
                  {room.allowGuestResources ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                      <span className="hidden sm:inline">Open</span>
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      <span className="hidden sm:inline">View only</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDestroySessionWithConfirm}
                  className={`${styles.chrome} ${styles.deleteAction} hidden h-9 cursor-pointer items-center gap-2 rounded-full px-3 text-[10px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff] sm:flex`}
                  title="Destroy session early"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Destroy
                </button>
              </>
            ) : !canAddResources ? (
              <span className={`${styles.chrome} rounded-full px-3 py-2 text-[10px] font-semibold text-white/75`}>
                View only
              </span>
            ) : null}
            <div className="relative">
              <button
                type="button"
                disabled={!canAddResources}
                onClick={() => setIsActionMenuOpen((open) => !open)}
                className={`${styles.glassButton} flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff] disabled:cursor-not-allowed disabled:opacity-45`}
                aria-expanded={isActionMenuOpen}
                aria-label="Add resources"
                title={canAddResources ? "Add resources" : "This room is view only"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
              {isActionMenuOpen && canAddResources && (
                <div className={`${styles.popover} absolute right-0 top-[calc(100%+8px)] w-[172px] rounded-2xl p-1.5`}>
                  <label className={`${styles.popoverAction} cursor-pointer`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V3m0 0L7.5 7.5M12 3l4.5 4.5M5 14.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Upload files
                    <input type="file" multiple className="sr-only" onChange={(event) => {
                      if (event.target.files?.length) handleFileUploads(Array.from(event.target.files));
                      event.currentTarget.value = "";
                      setIsActionMenuOpen(false);
                    }} />
                  </label>
                  <button type="button" onClick={() => { setIsActionMenuOpen(false); void handlePaste(); }} className={styles.popoverAction}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 7V5a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-2M8 7h5a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a5 5 0 0 1 5-5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Paste from clipboard
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>

          <nav aria-label="Resource categories" className={`${styles.categoryRail} absolute left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-1 p-1.5 sm:left-5`}>
            {categories.map((category) => {
              const isActive = category === activeCategory;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`${styles.categoryButton} ${isActive ? styles.categoryButtonActive : ""} relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff]`}
                  aria-label={`Show ${category} resources`}
                  aria-pressed={isActive}
                  title={category}
                >
                  <CategoryIcon category={category} />
                  {categoryCounts[category] > 0 && <span className={styles.categoryCount}>{categoryCounts[category]}</span>}
                </button>
              );
            })}
          </nav>

          {isCanvasMode && (
            <div className="absolute bottom-5 left-3 z-40 sm:bottom-6 sm:left-5">
              <div className="relative">
                <button type="button" onClick={() => setIsResourceMenuOpen((open) => !open)} className={`${styles.glassButton} flex h-9 items-center gap-2 rounded-full px-3 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff]`} aria-expanded={isResourceMenuOpen}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5 12 2l8 3.5V18l-8 4-8-4V5.5Z" stroke="currentColor" strokeWidth="1.5"/><path d="m4 5.5 8 4 8-4M12 9.5V22" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                  Resources <span className={styles.inlineCount}>{filteredResources.length}</span>
                </button>
                {isResourceMenuOpen && (
                  <div className={`${styles.popover} absolute bottom-[calc(100%+8px)] left-0 w-[min(240px,calc(100vw-32px))] rounded-2xl p-1.5`}>
                    <div className={styles.resourceList}>
                      {filteredResources.length === 0 ? <p className="px-3 py-4 text-center text-[11px] text-[#6e6d61]">No matching resources</p> : filteredResources.map((resource) => (
                        <button key={resource.id} type="button" className={styles.resourceRow} onClick={() => { handlePanToResource(resource.id, resource.x ?? 100, resource.y ?? 100); setIsResourceMenuOpen(false); }}>
                          <CategoryIcon category={resource.type === "image" ? "image" : resource.type === "link" ? "link" : "document"} />
                          <span>{resource.title || `Untitled ${resource.type}`}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <InfiniteCanvas
            ref={canvasRef}
            isActive={isCanvasMode}
            canvasColor="#fbf8dc"
            canvasOffsetRef={canvasOffsetRef}
            onNavigatePage={handleCanvasPageNavigation}
            isResourceDragging={isResourceDragging}
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
                onUpdateTextResource={handleUpdateTextResource}
                onResourceDragStateChange={setIsResourceDragging}
                canManageResource={(resource) => Boolean(room.isOwner || resource.isOwner)}
                highlightedResourceId={highlightedResourceId}
                readOnly={!canAddResources}
              />
            </div>
          </InfiniteCanvas>

          <section aria-label="Room pages" className={`${styles.pageDock} absolute bottom-3 left-1/2 z-40 flex max-w-[calc(100vw-110px)] -translate-x-1/2 items-center gap-1.5 rounded-2xl p-1.5 sm:bottom-5`}>
            <div className="flex max-w-[min(62vw,440px)] items-center gap-1.5 overflow-x-auto px-0.5">
              {pages.map((page) => {
                const isActive = page.id === (activePageId || room.id);
                return <div className="relative shrink-0" key={page.id}>
                  <button type="button" onClick={() => handlePageSelect(page.id)} className={`${styles.pageSwatch} ${isActive ? styles.pageSwatchActive : ""}`} style={{ backgroundColor: page.color }} aria-label={`Open ${page.name}`} aria-pressed={isActive} title={page.name} />
                  {room.isOwner && isActive && pages.length > 1 && <button type="button" onClick={() => handleDeletePage(page.id)} className={styles.pageDelete} aria-label={`Delete ${page.name}`} title={`Delete ${page.name}`}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></button>}
                </div>;
              })}
            </div>
            {room.isOwner && <button type="button" onClick={handleAddXoomsharePage} className={styles.addPageButton} aria-label="Add page" title="Add page"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>}
            <button type="button" onClick={() => setIsCanvasMode((active) => !active)} className={`${styles.canvasToggle} ${isCanvasMode ? styles.canvasToggleActive : ""}`} aria-label={isCanvasMode ? "Exit canvas" : "Open canvas"} title={isCanvasMode ? "Exit canvas" : "Open canvas"}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z" stroke="currentColor" strokeWidth="1.5"/><path d="M8 8h8v8H8z" stroke="currentColor" strokeWidth="1.5"/></svg>
            </button>
          </section>

          {room.isOwner && activePage && (
            <button type="button" className={`${styles.renamePageButton} absolute right-3 top-[60px] z-30 rounded-full px-3 py-2 text-[10px] font-semibold sm:right-5 sm:top-[68px]`} onClick={() => { setPageNameDraft(activePage.name); setEditingPageId(activePage.id); }}>Rename page</button>
          )}
        </div>
      </main>

      {editingPageId && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#4e4d42]/25 backdrop-blur-sm" onClick={() => setEditingPageId(null)} />
          <form className={`${styles.overlayPanel} relative flex w-full max-w-[340px] flex-col gap-3 rounded-[22px] p-5`} onSubmit={(event) => { event.preventDefault(); handlePageUpdateName(editingPageId, pageNameDraft); setEditingPageId(null); }}>
            <label htmlFor="xoomshare-page-name" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#66665a]">Page name</label>
            <input id="xoomshare-page-name" value={pageNameDraft} onChange={(event) => setPageNameDraft(event.target.value)} autoFocus className={styles.renameInput} />
            <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditingPageId(null)} className={styles.dialogSecondary}>Cancel</button><button type="submit" className={styles.dialogPrimary}>Save</button></div>
          </form>
        </div>
      )}

      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-auto">
          <div 
            className="absolute inset-0 bg-[#4e4d42]/25 backdrop-blur-sm"
            style={{ animation: "modal-fade-in 0.2s ease-out forwards" }}
            onClick={() => setConfirmModal(null)}
          />
          <div 
            className={`${styles.overlayPanel} relative flex flex-col gap-4 rounded-[22px] p-5`}
            style={{ 
              width: "min(420px, calc(100vw - 32px))",
              animation: "modal-zoom-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards"
            }}
          >
            <h2 className="m-0 font-jakarta text-[18px] font-semibold text-[#383932]">
              {confirmModal.title}
            </h2>
            <p className="m-0 font-arimo text-[13px] leading-relaxed text-[#65665b]">
              {confirmModal.message}
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="rounded-full border border-white/50 bg-white/25 px-4 py-2 font-arimo text-[12px] font-semibold text-[#505147] transition-colors hover:bg-white/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className={`${styles.modalAction} ${confirmModal.title.includes("Delete") || confirmModal.title.includes("Destroy") ? styles.modalDanger : ""} flex items-center gap-2 rounded-full px-4 py-2 font-arimo text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff]`}
              >
                {!confirmModal.confirmLabel && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {confirmModal.confirmLabel || "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex flex-col items-end gap-2 sm:bottom-6 sm:left-auto sm:right-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${toast.type === "error" ? styles.toastError : ""} pointer-events-auto flex w-full items-center gap-2 rounded-full px-3 py-2 sm:w-auto`}
            style={{
              maxWidth: "min(340px, calc(100vw - 32px))",
              transformOrigin: "bottom right",
              animation: "toast-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards",
            }}
          >
            {toast.type === "error" && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF2A2A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            )}
            <span
              className="font-arimo text-[11px] font-medium leading-4"
              style={{ overflowWrap: "anywhere" }}
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
