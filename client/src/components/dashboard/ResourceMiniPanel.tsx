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
      className="flex shrink-0 flex-row sm:flex-col items-center justify-center sm:justify-start w-full sm:w-[87px] h-[87px] sm:h-auto sm:max-h-[min(70dvh,430px)]"
      style={{
        maxWidth: "min(calc(100vw - 90px), 430px)",
        background: "var(--color-surface)",
        border: "1px solid var(--color-surface-border)",
        borderRadius: 26,
      }}
    >
      <div className="flex flex-row sm:flex-col pt-0 pb-0 sm:pt-4 sm:pb-6 px-4 sm:px-0 h-[87px] sm:h-auto items-center w-full sm:w-[86px]">
        {/* ── Add Button ── */}
        <div className="flex flex-row sm:flex-col gap-2.5 items-center w-full sm:w-auto">
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
            className="flex flex-row sm:flex-col gap-2.5 items-center overflow-x-auto sm:overflow-x-visible overflow-y-visible sm:overflow-y-auto px-3 sm:px-0 py-0 sm:py-3 mx-0 sm:-my-3 w-full sm:w-auto h-full sm:h-auto"
            style={{ 
              maxHeight: "none",
              scrollbarWidth: "none", // Firefox
              msOverflowStyle: "none", // IE/Edge
            }}
          >
            <style jsx>{`
              div::-webkit-scrollbar {
                display: none;
              }
              @media (min-width: 640px) {
                div {
                  max-height: 339px !important;
                }
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
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onPageSelect(page.id)}
                    className="border-none hover:shadow-lg focus-visible:ring-2 focus-visible:ring-white"
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
                    aria-label={`Open ${page.name}`}
                  />
                  {onDeletePage && !readOnly && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePage(page.id);
                      }}
                      className="absolute flex cursor-pointer items-center justify-center rounded-full border-none bg-red-500 opacity-100 shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-all duration-200 hover:scale-110 hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
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
