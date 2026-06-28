"use client";

export interface PageData {
  id: string;
  color: string;
  createdAt: string;
  name: string;
}

interface PageNavigationProps {
  pages: PageData[];
  activePageId: string | null;
  onPageSelect: (id: string) => void;
  onAddPage: () => void;
  onDeletePage?: (id: string) => void;
  readOnly?: boolean;
}

export default function ResourceMiniPanel({
  pages,
  activePageId,
  onPageSelect,
  onAddPage,
  onDeletePage,
  readOnly = false,
}: PageNavigationProps) {
  if (pages.length === 0) {
    return (
      <button
        type="button"
        onClick={onAddPage}
        disabled={readOnly}
        className="flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 shadow-lg"
        style={{
          width: 55,
          height: 55,
          background: "var(--color-surface)",
          border: "1px solid var(--color-surface-border)",
          borderRadius: "50%",
        }}
        aria-label="New Page"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-plus.svg"
          alt="Add"
          width={24}
          height={24}
          className="opacity-70"
        />
      </button>
    );
  }

  return (
    <div
      className="flex flex-col shrink-0"
      style={{
        width: 87,
        background: "var(--color-surface)",
        border: "1px solid var(--color-surface-border)",
        borderRadius: 26,
      }}
    >
      <div className="flex flex-col pt-4 pb-6" style={{ width: 86 }}>
        {/* ── Add Button ── */}
        <div className="flex flex-col gap-2.5 items-center">
          <button
            type="button"
            onClick={onAddPage}
            disabled={readOnly}
            className="flex items-center justify-center cursor-pointer bg-transparent transition-all duration-200 hover:bg-white/5"
            style={{
              width: 55,
              height: 55,
              border: "1px solid var(--color-surface-border)",
              borderRadius: "50%",
              flexShrink: 0,
            }}
            aria-label="New Page"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/icon-plus.svg"
              alt="Add"
              width={24}
              height={24}
              className="opacity-70"
            />
          </button>

          {/* ── Page Thumbnails ── */}
          <div 
            className="flex flex-col gap-2.5 items-center overflow-y-auto py-3 -my-3"
            style={{ 
              maxHeight: 315 + 24, // 5 items * 55px + 4 * 10px gap + 24px padding
              width: "100%",
              scrollbarWidth: "none", // Firefox
              msOverflowStyle: "none", // IE/Edge
            }}
          >
            <style jsx>{`
              div::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            {pages.map((page) => {
              const isActive = page.id === activePageId;
              return (
                <div
                  key={page.id}
                  className="relative group transition-all duration-200 hover:scale-105 flex items-center justify-center"
                  style={{
                    width: 77,
                    height: 77,
                    flexShrink: 0,
                    marginTop: -6,
                    marginBottom: -6,
                  }}
                >
                  <div
                    onClick={() => onPageSelect(page.id)}
                    className="hover:shadow-lg"
                    style={{
                      width: 55,
                      height: 55,
                      background: page.color,
                      backgroundImage: "radial-gradient(circle, rgba(0, 0, 0, 0.15) 1.5px, transparent 1.5px)",
                      backgroundSize: "12px 12px",
                      border: isActive ? "2px solid #fff" : "1px solid var(--color-surface-border)",
                      borderRadius: 7,
                      cursor: "pointer",
                    }}
                    title={page.name}
                  />
                  {onDeletePage && !readOnly && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePage(page.id);
                      }}
                      className="absolute bg-red-500 hover:bg-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.5)] flex items-center justify-center border-none cursor-pointer hover:scale-110"
                      style={{ width: 22, height: 22, top: 0, right: 0, zIndex: 10 }}
                      aria-label="Delete Page"
                      title="Delete Page"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/icons/icon-trash.svg"
                        alt="Delete"
                        width={12}
                        height={12}
                        style={{ filter: "brightness(0) invert(1)" }}
                      />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
