import type { PageData } from "./ResourceMiniPanel";

export interface SavedPageDayGroup {
  dateKey: string;
  label: string;
  pages: PageData[];
}

function getLocalDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCalendarDate(value: Date) {
  const day = String(value.getDate()).padStart(2, "0");
  return `${day} ${MONTH_LABELS[value.getMonth()]} ${value.getFullYear()}`;
}

export function formatSavedPageTimestamp(createdAt: string) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "Unknown creation time";

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(created);

  return `${formatCalendarDate(created)}  ${time}`;
}

export function getSavedPageDayLabel(createdAt: string, now = new Date()) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "Earlier";

  const todayKey = getLocalDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const createdKey = getLocalDateKey(created);

  if (createdKey === todayKey) return "Today";
  if (createdKey === getLocalDateKey(yesterday)) return "Yesterday";
  return formatCalendarDate(created);
}

export function groupSavedPagesByDay(pages: PageData[], now = new Date()): SavedPageDayGroup[] {
  const grouped = new Map<string, PageData[]>();

  for (const page of pages) {
    const created = new Date(page.createdAt);
    const dateKey = Number.isNaN(created.getTime()) ? "unknown" : getLocalDateKey(created);
    const current = grouped.get(dateKey) ?? [];
    current.push(page);
    grouped.set(dateKey, current);
  }

  return Array.from(grouped.entries())
    .map(([dateKey, groupedPages]) => {
      const sortedPages = [...groupedPages].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return {
        dateKey,
        label: getSavedPageDayLabel(sortedPages[0]?.createdAt ?? "", now),
        pages: sortedPages,
      };
    })
    .sort((a, b) => {
      const aTime = new Date(a.pages[0]?.createdAt ?? 0).getTime();
      const bTime = new Date(b.pages[0]?.createdAt ?? 0).getTime();
      return bTime - aTime;
    });
}
