const XOOMSHARE_PATH_CODE_PATTERN = /^[A-Za-z0-9_-]{12,48}$/;

export function isValidXoomsharePathCode(value: string): boolean {
  return XOOMSHARE_PATH_CODE_PATTERN.test(value);
}

export function getDownloadPath(resourceId: string, xoomsharePathCode?: string) {
  const path = `/link/download/${encodeURIComponent(resourceId)}`;
  if (!xoomsharePathCode || !isValidXoomsharePathCode(xoomsharePathCode)) return path;

  return `${path}?xoomshare=${encodeURIComponent(xoomsharePathCode)}`;
}

export function getOwnerDownloadPath(resourceId: string, apiBase: string, inline = false) {
  const url = new URL(`/resources/${encodeURIComponent(resourceId)}/download`, `${apiBase.replace(/\/$/, '')}/`);
  if (inline) url.searchParams.set('disposition', 'inline');
  return url.toString();
}
