"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import type { Category } from "@/components/dashboard/CategorySwitch";
import type { PageData } from "@/components/dashboard/ResourceMiniPanel";
import type { Resource } from "@/components/dashboard/ResourceCard";
import { formatSavedPageTimestamp, getSavedPageDayLabel, groupSavedPagesByDay } from "@/components/dashboard/savedPageGroups";

import styles from "./FigmaDashboardChrome.module.css";

type Visibility = "private" | "public";

interface DashboardUser {
  name: string;
  email: string;
}

interface FigmaDashboardChromeProps {
  user: DashboardUser | null;
  pages: PageData[];
  resources: Resource[];
  activePageId: string | null;
  activeCategory: Category;
  visibility: Visibility;
  onPageSelect: (id: string) => void;
  onDeletePage: (id: string) => void;
  onAddPage: () => void | Promise<void>;
  onCategoryChange: (category: Category) => void;
  onResourceSelect: (resource: Resource, category: Category) => void;
  onDeleteResource: (id: string) => void;
  onVisibilityChange: (visibility: Visibility) => void;
  onFileUploads: (files: File[]) => void | Promise<void>;
  onPaste: () => void | Promise<void>;
  isResourceIngesting?: boolean;
  ingestionProgress?: { completed: number; total: number } | null;
  onOpenProfile: () => void;
  onLogout: () => void;
}

const ASSET_ROOT = "/assets/figma-dashboard";

function DeleteIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </svg>
  );
}

const CATEGORIES: Array<{
  id: Category;
  label: string;
  asset: string;
  invert: boolean;
  matches: (resource: Resource) => boolean;
}> = [
  {
    id: "target",
    label: "All resources",
    asset: "nav-all-files.svg",
    invert: false,
    matches: () => true,
  },
  {
    id: "document",
    label: "Copied text and documents",
    asset: "nav-copied-text.svg",
    invert: true,
    matches: (resource) => resource.type === "text" || resource.type === "pdf",
  },
  {
    id: "image",
    label: "Images",
    asset: "nav-images.svg",
    invert: true,
    matches: (resource) => resource.type === "image",
  },
  {
    id: "video",
    label: "Files",
    asset: "nav-files.svg",
    invert: true,
    matches: (resource) => resource.type === "file",
  },
  {
    id: "link",
    label: "Links",
    asset: "nav-links.svg",
    invert: true,
    matches: (resource) => resource.type === "link",
  },
];

function getCurrentDateLabel() {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());
}

function getProfileBlobStyle(user: DashboardUser | null) {
  const identity = user?.email || user?.name || "anonymous";
  let hash = 5381;

  for (const character of identity) {
    hash = (hash * 33) ^ character.charCodeAt(0);
  }

  const seed = hash >>> 0;
  const primaryHue = seed % 360;
  const secondaryHue = (primaryHue + 76 + ((seed >>> 8) % 96)) % 360;
  const accentHue = (primaryHue + 170 + ((seed >>> 16) % 64)) % 360;
  const shape = ["52% 48% 43% 57% / 56% 42% 58% 44%", "43% 57% 58% 42% / 49% 53% 47% 51%", "58% 42% 49% 51% / 43% 57% 43% 57%", "46% 54% 41% 59% / 55% 45% 55% 45%"][seed % 4];

  return {
    background: `radial-gradient(circle at 28% 24%, hsl(${accentHue} 94% 83% / 0.95), transparent 41%), linear-gradient(135deg, hsl(${primaryHue} 84% 63%), hsl(${secondaryHue} 78% 54%))`,
    borderRadius: shape,
  };
}

function getResourceLabel(resource: Resource) {
  const fallback = resource.type === "text"
    ? "Untitled text"
    : resource.type === "pdf"
      ? "Untitled PDF"
      : resource.type === "image"
        ? "Untitled image"
        : resource.type === "link"
          ? "Untitled link"
          : "Untitled file";
  const candidate = resource.title?.trim() || resource.description?.trim() || resource.content?.trim() || fallback;

  return candidate.startsWith("data:") ? fallback : candidate.replace(/\s+/g, " ");
}

function getResourceTypeLabel(resource: Resource) {
  switch (resource.type) {
    case "text": return "Text";
    case "pdf": return "PDF document";
    case "image": return "Image";
    case "link": return "Link";
    default: return "File";
  }
}

export default function FigmaDashboardChrome({
  user,
  pages,
  resources,
  activePageId,
  activeCategory,
  visibility,
  onPageSelect,
  onDeletePage,
  onAddPage,
  onCategoryChange,
  onResourceSelect,
  onDeleteResource,
  onVisibilityChange,
  onFileUploads,
  onPaste,
  isResourceIngesting = false,
  ingestionProgress = null,
  onOpenProfile,
  onLogout,
}: FigmaDashboardChromeProps) {
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [openCategoryId, setOpenCategoryId] = useState<Category | null>(null);
  const [isAddingPage, setIsAddingPage] = useState(false);
  const savedPageGroups = useMemo(() => groupSavedPagesByDay(pages), [pages]);
  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) ?? null,
    [activePageId, pages],
  );
  const pageNavigatorLabel = activePage
    ? getSavedPageDayLabel(activePage.createdAt)
    : getCurrentDateLabel();
  const pageMenuRef = useRef<HTMLDivElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const categoryRailRef = useRef<HTMLElement>(null);
  const categoryCloseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCategoryCloseTimeout = () => {
    if (categoryCloseTimeout.current) {
      clearTimeout(categoryCloseTimeout.current);
      categoryCloseTimeout.current = null;
    }
  };

  const openCategoryResources = (category: Category) => {
    clearCategoryCloseTimeout();
    setOpenCategoryId(category);
  };

  const closeCategoryResourcesSoon = () => {
    clearCategoryCloseTimeout();
    categoryCloseTimeout.current = setTimeout(() => setOpenCategoryId(null), 140);
  };

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!pageMenuRef.current?.contains(target)) setIsPageMenuOpen(false);
      if (!uploadMenuRef.current?.contains(target)) setIsUploadMenuOpen(false);
      if (!profileMenuRef.current?.contains(target)) setIsProfileMenuOpen(false);
      if (!categoryRailRef.current?.contains(target)) setOpenCategoryId(null);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsPageMenuOpen(false);
      setIsUploadMenuOpen(false);
      setIsProfileMenuOpen(false);
      setOpenCategoryId(null);
    };

    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", closeOnEscape);
      clearCategoryCloseTimeout();
    };
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onFileUploads(files);
    event.target.value = "";
    setIsUploadMenuOpen(false);
  };

  const handleCreatePage = async () => {
    if (isAddingPage) return;

    setIsAddingPage(true);
    try {
      await onAddPage();
    } finally {
      setIsAddingPage(false);
    }
  };

  const profileBlobStyle = getProfileBlobStyle(user);
  return (
    <>
      <nav className={styles.categoryRail} aria-label="Resource categories" ref={categoryRailRef}>
        {CATEGORIES.map((category) => {
          const categoryResources = resources.filter(category.matches);
          const count = categoryResources.length;
          const isActive = activeCategory === category.id;
          const isResourcePanelOpen = openCategoryId === category.id;
          const panelId = `category-resources-${category.id}`;
          return (
            <div
              key={category.id}
              className={styles.categoryItem}
              onMouseEnter={() => openCategoryResources(category.id)}
              onMouseLeave={closeCategoryResourcesSoon}
              onFocusCapture={() => openCategoryResources(category.id)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  closeCategoryResourcesSoon();
                }
              }}
            >
              <button
                type="button"
                className={`${styles.categoryButton} ${isActive ? styles.categoryButtonActive : ""}`}
                onClick={() => onCategoryChange(category.id)}
                aria-pressed={isActive}
                aria-label={`${category.label}: ${count}`}
                title={category.label}
              >
                <Image
                  src={`${ASSET_ROOT}/${category.asset}`}
                  alt=""
                  width={25}
                  height={25}
                  className={isActive ? styles.categoryIconActive : styles.categoryIcon}
                />
              </button>
              {count > 0 && (
                <button
                  type="button"
                  className={styles.countBadge}
                  onClick={() => openCategoryResources(category.id)}
                  aria-label={`Show ${count} ${category.label.toLowerCase()}`}
                  aria-controls={panelId}
                  aria-expanded={isResourcePanelOpen}
                >
                  {count > 99 ? "99+" : count}
                </button>
              )}
              {isResourcePanelOpen && (
                <section id={panelId} className={styles.categoryResourcePanel} aria-label={`${category.label} resources`}>
                  <div className={styles.categoryResourcePanelHeader}>
                    <span>{category.label}</span>
                    <span>{count > 99 ? "99+" : count}</span>
                  </div>
                  <div className={styles.categoryResourceList}>
                    {categoryResources.length === 0 ? (
                      <p className={styles.emptyCategoryResources}>No resources in this category.</p>
                    ) : categoryResources.map((resource) => {
                      const label = getResourceLabel(resource);
                      return (
                        <div className={styles.categoryResourceRow} key={resource.id}>
                          <button
                            type="button"
                            className={styles.categoryResourceSelectButton}
                            onClick={() => {
                              onResourceSelect(resource, category.id);
                              setOpenCategoryId(null);
                            }}
                            title={label}
                          >
                            <span className={styles.categoryResourceName}>{label}</span>
                            <span className={styles.categoryResourceType}>{getResourceTypeLabel(resource)}</span>
                          </button>
                          <button
                            type="button"
                            className={styles.deleteResourceButton}
                            onClick={(event) => {
                              event.stopPropagation();
                              onDeleteResource(resource.id);
                            }}
                            aria-label={`Delete ${label}`}
                          >
                            <DeleteIcon size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          );
        })}
      </nav>

      <div className={styles.pageNavigator} ref={pageMenuRef}>
        <button
          type="button"
          className={styles.pageNavigatorButton}
          onClick={() => setIsPageMenuOpen((open) => !open)}
          aria-expanded={isPageMenuOpen}
          aria-controls="saved-pages-menu"
          aria-label={isPageMenuOpen ? "Close saved pages" : "Open saved pages"}
        >
          <span className={styles.dateLabel}>{pageNavigatorLabel}</span>
          <span className={`${styles.navigatorIcon} ${isPageMenuOpen ? styles.navigatorIconOpen : ""}`} aria-hidden="true">
            <Image src={`${ASSET_ROOT}/date-navigator.svg`} alt="" width={21} height={7} className={styles.navigatorHamburger} />
            <span className={styles.closeNavigatorIcon} aria-hidden="true" />
          </span>
        </button>

        {isPageMenuOpen && (
          <section id="saved-pages-menu" className={`${styles.pageMenu} ${styles.glassPopover}`} aria-label="Saved pages">
            <div className={styles.pageMenuHeader}>
              <span>Saved pages</span>
            </div>
            <div className={styles.pageList}>
              {pages.length === 0 ? (
                <p className={styles.emptyPages}>No pages yet.</p>
              ) : (
                savedPageGroups.map((group) => (
                  <details className={styles.pageDayFolder} key={group.dateKey} open>
                    <summary className={styles.pageDayFolderSummary}>
                      <Image src={`${ASSET_ROOT}/nav-files.svg`} alt="" width={17} height={17} />
                      <span>{group.label}</span>
                      <span className={styles.pageDayCount}>{group.pages.length}</span>
                    </summary>
                    <div className={styles.pageDayPages}>
                      {group.pages.map((page) => {
                        const createdLabel = formatSavedPageTimestamp(page.createdAt);
                        return (
                          <div key={page.id} className={styles.pageRow} data-active={page.id === activePageId}>
                            <button
                              type="button"
                              className={styles.pageSelectButton}
                              onClick={() => {
                                onPageSelect(page.id);
                                setIsPageMenuOpen(false);
                              }}
                              aria-current={page.id === activePageId ? "page" : undefined}
                              aria-label={`Open page created ${createdLabel}`}
                              title={`${page.name} · created ${createdLabel}`}
                            >
                              <Image src={`${ASSET_ROOT}/file-item.svg`} alt="" width={17} height={17} />
                              <span>{createdLabel}</span>
                            </button>
                            <button
                              type="button"
                              className={styles.deletePageButton}
                              onClick={() => onDeletePage(page.id)}
                              aria-label={`Delete page created ${createdLabel}`}
                            >
                              <DeleteIcon size={18} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      <div className={styles.topActions}>
        <div className={styles.actionMenu} ref={uploadMenuRef}>
          <button
            type="button"
            className={styles.topIconButton}
            onClick={() => setIsUploadMenuOpen((open) => !open)}
            aria-label={isResourceIngesting ? (ingestionProgress ? `Saving ${ingestionProgress.completed} of ${ingestionProgress.total} resources` : "Saving resources") : "Add resources"}
            aria-busy={isResourceIngesting}
            aria-expanded={isUploadMenuOpen}
          >
            <Image src={`${ASSET_ROOT}/upload.svg`} alt="" width={21} height={21} />
          </button>
          {isUploadMenuOpen && (
            <div className={`${styles.actionPopover} ${styles.glassPopover}`}>
              <label className={styles.actionPopoverButton}>
                Upload files
                <input type="file" multiple onChange={handleFileChange} />
              </label>
              <button
                type="button"
                className={styles.actionPopoverButton}
                onClick={() => {
                  void onPaste();
                  setIsUploadMenuOpen(false);
                }}
              >
                Paste from clipboard
              </button>
              {isResourceIngesting && (
                <span className={styles.actionPopoverStatus} role="status">
                  {ingestionProgress ? `Saving ${ingestionProgress.completed}/${ingestionProgress.total}` : "Saving resources…"}
                </span>
              )}
            </div>
          )}
        </div>

        <div className={styles.actionMenu} ref={profileMenuRef}>
          <button
            type="button"
            className={styles.topIconButton}
            onClick={() => setIsProfileMenuOpen((open) => !open)}
            aria-label="Open account menu"
            aria-expanded={isProfileMenuOpen}
          >
            <span className={styles.profileBlob} style={profileBlobStyle} aria-hidden="true" />
          </button>
          {isProfileMenuOpen && (
            <div className={`${styles.actionPopover} ${styles.glassPopover}`}>
              {user && <p className={styles.accountName}>{user.name || user.email}</p>}
              <button type="button" className={styles.actionPopoverButton} onClick={onOpenProfile}>
                Profile
              </button>
              {user && (
                <button type="button" className={styles.actionPopoverButton} onClick={onLogout}>
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <section className={styles.bottomControls} aria-label="Page controls">
        <div className={styles.pageSwitch} aria-label="Choose or create a page">
          <div className={styles.visibilityControl} role="group" aria-label="Workspace visibility">
            <button type="button" onClick={() => onVisibilityChange("private")} aria-pressed={visibility === "private"} className={visibility === "private" ? styles.visibilityActive : ""}>Private</button>
            <button type="button" onClick={() => onVisibilityChange("public")} aria-pressed={visibility === "public"} className={visibility === "public" ? styles.visibilityActive : ""}>Public</button>
          </div>
          <div className={styles.pageColorList}>
            {(pages.length === 0 ? [{ id: "__starter__", color: "#fffDCE", createdAt: "", name: "Create your first page" }] : pages).map((page) => (
              <button
                type="button"
                key={page.id}
                className={`${styles.pageColor} ${page.id === activePageId ? styles.pageColorActive : ""}`}
                style={{ backgroundColor: page.color }}
                onClick={page.id === "__starter__" ? handleCreatePage : () => onPageSelect(page.id)}
                disabled={page.id === "__starter__" && isAddingPage}
                aria-label={page.id === "__starter__" && isAddingPage ? "Creating your first page" : `Open ${page.name}`}
                aria-pressed={page.id === activePageId}
                aria-busy={page.id === "__starter__" ? isAddingPage : undefined}
                title={page.name}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.addPageButton}
            onClick={handleCreatePage}
            disabled={isAddingPage}
            aria-label={isAddingPage ? "Creating a new page" : "Create a new page"}
            aria-busy={isAddingPage}
          >
            <Image src={`${ASSET_ROOT}/add-subpage.svg`} alt="" width={21} height={21} className={isAddingPage ? styles.addPageIconPending : undefined} />
          </button>
        </div>
      </section>
    </>
  );
}
