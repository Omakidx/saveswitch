export type DashboardToastType = "error" | "success" | "info";

export interface DashboardToast {
  id: string;
  message: string;
  type: DashboardToastType;
}

export const MAX_VISIBLE_DASHBOARD_TOASTS = 2;

export function toastKey(message: string, type: DashboardToastType) {
  return `${type}:${message.trim().toLocaleLowerCase()}`;
}

export function enqueueDashboardToast(
  current: DashboardToast[],
  next: DashboardToast,
  maxVisible = MAX_VISIBLE_DASHBOARD_TOASTS,
) {
  return [...current, next].slice(-Math.max(1, maxVisible));
}
