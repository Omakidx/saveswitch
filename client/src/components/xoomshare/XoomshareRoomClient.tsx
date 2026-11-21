"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import CardStack from "@/components/dashboard/CardStack";
import InfiniteCanvas, { InfiniteCanvasRef } from "@/components/dashboard/InfiniteCanvas";
import FigmaDashboardChrome, { chromeStyles, type ChromeMenuItem } from "@/components/dashboard/figma/FigmaDashboardChrome";
import { filterResourcesByCategory } from "@/lib/resourceFilters";
import Toaster from "@/components/feedback/Toaster";
import ConfirmDialog from "@/components/feedback/ConfirmDialog";
import LoadingSpinner from "@/components/LoadingSpinner";
import { PageData } from "@/components/dashboard/ResourceMiniPanel";
import { Resource } from "@/components/dashboard/ResourceCard";
import { API_BASE } from "@/lib/api";
import { safeGetItem, safeSetItem } from "@/lib/safeStorage";
import { buildRoomLink } from "@/lib/roomCode";
import PairDeviceDialog from "./PairDeviceDialog";
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

/** Reads a Blob/File as a data URL, resolving null (never "null" content) when reading fails. */
function readAsDataUrl(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.onabort = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function getInitialState(pathCode: string) {
  if (typeof window === "undefined") return {};
  try {
    const raw = safeGetItem(`xoomshare-state-${pathCode}`);
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
  const [isCanvasMode, setIsCanvasMode] = useState<boolean>(true);
  const [activeCategory, setActiveCategory] = useState<Category>(initialState.activeCategory ?? "target");
  const [highlightedResourceId, setHighlightedResourceId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialState.selectedDate ?? null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(initialState.expandedDates ?? new Set());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pages, setPages] = useState<PageData[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(initialState.activePageId ?? null);
  const [isResourceDragging, setIsResourceDragging] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  // A freshly created room arrives with ?pair=1 so the QR opens straight away.
  const [isPairDialogOpen, setIsPairDialogOpen] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("pair") === "1",
  );
  const [pageNameDraft, setPageNameDraft] = useState("");
  const [hasDismissedExpiryNotice, setHasDismissedExpiryNotice] = useState(() => {
    if (typeof window === "undefined") return false;
    return safeGetItem(`xoomshare-expiry-notice-${pathCode}`) === "dismissed";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    safeSetItem(`xoomshare-state-${pathCode}`, JSON.stringify({
      isCanvasMode,
      activeCategory,
      selectedDate,
      expandedDates: Array.from(expandedDates),
      activePageId,
    }));
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
    tone?: "danger" | "neutral";
  } | null>(null);

  const canvasOffsetRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<InfiniteCanvasRef>(null);
  const toastTimersRef = useRef<Set<number>>(new Set());
  const highlightTimerRef = useRef<number | null>(null);
  const placementReservationsRef = useRef<Array<{ x: number; y: number }>>([]);
  const roomRequestIdRef = useRef(0);

  useEffect(() => {
    const toastTimers = toastTimersRef.current;
    return () => {
      toastTimers.forEach((timer) => window.clearTimeout(timer));
      toastTimers.clear();
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);
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
    const timer = window.setTimeout(() => {
      toastTimersRef.current.delete(timer);
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3500);
    toastTimersRef.current.add(timer);
  }, []);

  // Drop ?pair=1 once read so a reload or a copied address doesn't reopen the QR.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("pair")) return;
    url.searchParams.delete("pair");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
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
    safeSetItem(`xoomshare-expiry-notice-${pathCode}`, "dismissed");
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
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      throw Object.assign(
        new Error(getApiErrorMessage(data?.error, res.ok ? "Xoomshare page not found" : `Unable to open this Xoomshare room (status ${res.status}).`)),
        { status: res.status },
      );
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

    const refreshController = new AbortController();
    const refreshRoom = () => {
      // Several websocket events can arrive back to back; only the newest response may be applied,
      // and nothing may be applied after this room subscription has been torn down.
      const requestId = ++roomRequestIdRef.current;
      void fetchRoom(refreshController.signal).then((data) => {
        if (cancelled || requestId !== roomRequestIdRef.current) return;
        applyRoomData(data);
      }).catch((error: Error & { status?: number }) => {
        if (cancelled || requestId !== roomRequestIdRef.current) return;
        // A missing room (destroyed or expired while we were offline) is final; anything else is a
        // transient outage where the last good canvas should stay visible.
        if (error.status === 404 || error.status === 410) {
          setRoom(null);
          setError(error.message || "This session is no longer available.");
        }
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
      refreshController.abort();
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
        const next = pages.filter((p) => p.id !== id);
        setPages(next);
        setResources((prev) => prev.filter((resource) => resource.pageId !== id));
        if (activePageId === id && next.length > 0) {
          handlePageSelect(next[next.length - 1].id);
        }
        showToast("Page deleted successfully", "success");
      } else {
        showToast(data.error || "Failed to delete page", "error");
      }
    } catch {
      showToast("Network error deleting page", "error");
    }
  }, [pathCode, room?.isOwner, activePageId, handlePageSelect, pages, showToast]);

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
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedResourceId(null), 3000);
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
      // Include spots claimed by uploads that are still in flight; otherwise several files added at
      // once all read the same stale `resources` and land on top of each other.
      isOccupied = [...resources, ...placementReservationsRef.current].some((resource) => {
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

    const reservation = { x, y };
    placementReservationsRef.current.push(reservation);
    const releaseReservation = () => {
      placementReservationsRef.current = placementReservationsRef.current.filter((item) => item !== reservation);
    };

    try {
      const res = await fetch(`${API_BASE}/xoomshare/${encodeURIComponent(pathCode)}/resources`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content, title, x, y, pageId: activePageId }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success || !data.resource) {
        showToast(getApiErrorMessage(data?.error, "Unable to save this resource."), "error");
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
    } finally {
      releaseReservation();
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
            const dataUrl = await readAsDataUrl(blob);
            if (dataUrl) void processPaste("image", dataUrl);
            else showToast("That image could not be read.", "error");
          }
        } else if (item.types.includes("application/pdf")) {
          hasItem = true;
          const blob = await item.getType("application/pdf");
          const dataUrl = await readAsDataUrl(blob);
          if (dataUrl) void processPaste("pdf", dataUrl);
          else showToast("That PDF could not be read.", "error");
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
      const type: Resource["type"] = file.type.startsWith("image/")
        ? "image"
        : file.type === "application/pdf"
          ? "pdf"
          : "file";
      void readAsDataUrl(file).then((dataUrl) => {
        if (dataUrl) void processPaste(type, dataUrl, file.name);
        else showToast(`Could not read “${file.name}”.`, "error");
      });
    }
  }, [processPaste, room?.allowGuestResources, room?.isOwner, showToast]);

  useEffect(() => {
    const handleGlobalPaste = (event: ClipboardEvent) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]")) return;
      if ((!room?.isOwner && !room?.allowGuestResources) || !isCanvasMode) return;

      const items = Array.from(event.clipboardData?.items || []);
      if (items.length === 0) return;

      let processed = false;
      for (const item of items) {
        if (item.type.startsWith("image/") || item.type === "application/pdf") {
          const file = item.getAsFile();
          if (file) {
            const pastedType = item.type === "application/pdf" ? "pdf" : "image";
            void readAsDataUrl(file).then((dataUrl) => {
              if (dataUrl) void processPaste(pastedType, dataUrl, file.name);
              else showToast("That file could not be read.", "error");
            });
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
  }, [handleFileUploads, isCanvasMode, processPaste, room?.allowGuestResources, room?.isOwner, showToast]);

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
      await navigator.clipboard.writeText(buildRoomLink(window.location.origin, room.pathCode));
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
      tone: "neutral",
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
      title: "Destroy room",
      message: "Destroy this Xoomshare room now? Everything in it will be permanently deleted for everyone.",
      confirmLabel: "Destroy room",
      onConfirm: () => {
        setConfirmModal(null);
        handleDestroySession();
      },
    });
  }, [handleDestroySession]);

  if (loading) {
    return <LoadingSpinner />;
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

  const filteredResources = filterResourcesByCategory(activePageResources, activeCategory);
  const activePage = pages.find((page) => page.id === (activePageId || room.id));
  const canManageResource = (resource: Resource) => Boolean(room.isOwner || resource.isOwner);
  const roomMenuItems: ChromeMenuItem[] = [
    { label: "Pair a device", onSelect: () => setIsPairDialogOpen(true) },
    { label: "Copy room link", onSelect: () => { void handleCopyShareLink(); } },
    ...(room.isOwner
      ? [
          ...(activePage
            ? [{ label: "Rename page", onSelect: () => { setPageNameDraft(activePage.name); setEditingPageId(activePage.id); } }]
            : []),
          {
            label: room.allowGuestResources ? "Make room view only" : "Let guests add resources",
            onSelect: handleToggleGuestAccessWithConfirm,
          },
          { label: "Destroy room", onSelect: handleDestroySessionWithConfirm, tone: "danger" as const },
        ]
      : []),
  ];
  const roomAccessLabel = room.isOwner
    ? room.allowGuestResources ? "Owner · guests can add" : "Owner · guests view only"
    : canAddResources ? "Guest · can add" : "Guest · view only";

  return (
    <div className={`${styles.room} relative h-dvh w-full overflow-hidden font-inter`}>
      <main
        className="relative h-dvh min-w-0 flex-1 overflow-hidden"
        style={{ background: "#fffDCE" }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length > 0) {
            handleFileUploads(Array.from(event.dataTransfer.files));
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
              <CardStack
                pages={pages}
                activePageId={activePageId || room.id}
                isExpanded={isCanvasMode}
                onPageSelect={handleCardSwipe}
                resources={filteredResources}
                onDeleteResource={canAddResources ? (id) => {
                  const resource = resources.find(r => r.id === id);
                  if (resource && canManageResource(resource)) {
                    handleDeleteResource(id);
                  } else {
                    showToast("You can only delete your own resources", "error");
                  }
                } : undefined}
                onUpdateResourcePosition={canAddResources ? (id, x, y) => {
                  const resource = resources.find(r => r.id === id);
                  if (resource && canManageResource(resource)) {
                    handleUpdateResourcePosition(id, x, y);
                  } else {
                    showToast("You can only move your own resources", "error");
                  }
                } : undefined}
                onUpdateTextResource={handleUpdateTextResource}
                onResourceDragStateChange={setIsResourceDragging}
                canManageResource={canManageResource}
                highlightedResourceId={highlightedResourceId}
                readOnly={!canAddResources}
              />
            </div>
          </InfiniteCanvas>

          <FigmaDashboardChrome
            pages={pages}
            resources={activePageResources}
            activePageId={activePageId || room.id}
            activeCategory={activeCategory}
            onPageSelect={handlePageSelect}
            onDeletePage={room.isOwner ? handleDeletePage : undefined}
            canDeletePage={() => pages.length > 1}
            onAddPage={handleAddXoomsharePage}
            canAddPage={room.isOwner}
            onCategoryChange={setActiveCategory}
            onResourceSelect={(resource, category) => {
              setActiveCategory(category);
              handlePanToResource(resource.id, resource.x ?? 100, resource.y ?? 100);
            }}
            onDeleteResource={(id) => {
              const resource = resources.find(r => r.id === id);
              if (resource && canManageResource(resource)) handleDeleteResource(id);
              else showToast("You can only delete your own resources", "error");
            }}
            canDeleteResource={(resource) => canAddResources && canManageResource(resource)}
            onFileUploads={handleFileUploads}
            onPaste={handlePaste}
            canAddResources={canAddResources}
            menuItems={roomMenuItems}
            menuTitle={roomAccessLabel}
            menuButtonLabel="Open room menu"
            menuIcon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e1e1e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d={room.allowGuestResources ? "M8 11V7a4 4 0 0 1 7.9-.9" : "M8 11V7a4 4 0 0 1 8 0v4"} />
              </svg>
            }
            topLeading={
              <button type="button" className={chromeStyles.topIconButton} onClick={handleBack} aria-label="Go back" title="Go back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M15 6 9 12l6 6" stroke="#1e1e1e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            }
            bottomLeading={
              <div className={chromeStyles.bottomTab}>
                <button type="button" onClick={handleCopyShareLink} title="Copy Xoomshare link" aria-label={`Copy link for room ${room.pathCode}`}>
                  <span className={chromeStyles.bottomTabText}>{room.pathCode}</span>
                  <Image src="/icons/icon-copy.svg" alt="" width={10} height={10} className="opacity-80 invert" />
                </button>
                <button type="button" onClick={() => setIsPairDialogOpen(true)} title="Pair a device with a QR code" aria-label="Pair a device with a QR code">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
                    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
                  </svg>
                </button>
                {expiryCountdownLabel && (
                  room.isOwner && !hasDismissedExpiryNotice ? (
                    <button type="button" className={chromeStyles.bottomTabMuted} onClick={dismissExpiryNotice} title="Time until this room expires">
                      {expiryCountdownLabel}
                    </button>
                  ) : (
                    <span className={chromeStyles.bottomTabMuted} title="Time until this room expires">{expiryCountdownLabel}</span>
                  )
                )}
              </div>
            }
          />
        </div>
      </main>

      {editingPageId && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onKeyDown={(event) => { if (event.key === "Escape") setEditingPageId(null); }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEditingPageId(null)} />
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="xoomshare-rename-title"
            className="relative flex flex-col gap-4 rounded-2xl border border-[var(--color-surface-border)] bg-[var(--color-surface)] p-6 shadow-2xl"
            style={{ width: "min(420px, calc(100vw - 32px))" }}
            onSubmit={(event) => { event.preventDefault(); handlePageUpdateName(editingPageId, pageNameDraft); setEditingPageId(null); }}
          >
            <h2 id="xoomshare-rename-title" className="m-0 font-jakarta text-xl font-bold" style={{ color: "var(--color-text-primary)" }}>Rename page</h2>
            <label htmlFor="xoomshare-page-name" className="sr-only">Page name</label>
            <input
              id="xoomshare-page-name"
              value={pageNameDraft}
              onChange={(event) => setPageNameDraft(event.target.value)}
              autoFocus
              maxLength={255}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-arimo text-[15px] text-white outline-none placeholder:text-white/40 focus:border-[#4570ff]"
            />
            <div className="mt-2 flex justify-end gap-3">
              <button type="button" onClick={() => setEditingPageId(null)} className="cursor-pointer rounded-xl border-none bg-transparent px-5 py-2.5 font-arimo text-sm font-semibold text-white transition-colors hover:bg-white/10">Cancel</button>
              <button type="submit" className="cursor-pointer rounded-xl border border-white/20 bg-white/90 px-5 py-2.5 font-arimo text-sm font-semibold text-[#111] shadow-md transition-all hover:bg-white active:scale-95">Save</button>
            </div>
          </form>
        </div>
      )}

      {isPairDialogOpen && (
        <PairDeviceDialog
          link={buildRoomLink(window.location.origin, room.pathCode)}
          pathCode={room.pathCode}
          expiresInMs={expiryRemainingMs}
          onCopy={() => { void handleCopyShareLink(); }}
          onClose={() => setIsPairDialogOpen(false)}
        />
      )}

      {confirmModal && confirmModal.isOpen && (
        <ConfirmDialog
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          tone={confirmModal.tone}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      <Toaster toasts={toasts} />
    </div>
  );
}
