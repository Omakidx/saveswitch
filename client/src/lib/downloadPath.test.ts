// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from 'bun:test';

import { getDownloadPath, getOwnerDownloadPath, isValidXoomsharePathCode } from './downloadPath';

describe('download paths', () => {
  const resourceId = '11111111-1111-4111-8111-111111111111';
  const pathCode = 'xoomshare_path-123';

  test('keeps ordinary download links identifier-only', () => {
    expect(getDownloadPath(resourceId)).toBe(`/link/download/${resourceId}`);
  });

  test('adds a valid Xoomshare path code only as an encoded query parameter', () => {
    expect(getDownloadPath(resourceId, pathCode)).toBe(
      `/link/download/${resourceId}?xoomshare=${encodeURIComponent(pathCode)}`,
    );
  });

  test('rejects malformed and out-of-range Xoomshare path codes', () => {
    expect(isValidXoomsharePathCode('too-short')).toBe(false);
    expect(isValidXoomsharePathCode('xoomshare path code')).toBe(false);
    expect(getDownloadPath(resourceId, 'xoomshare path code')).toBe(`/link/download/${resourceId}`);
  });

  test('keeps authenticated owner downloads on the API host', () => {
    expect(getOwnerDownloadPath(resourceId, 'https://api.example.com')).toBe(
      `https://api.example.com/resources/${resourceId}/download`,
    );
    expect(getOwnerDownloadPath(resourceId, 'https://api.example.com/', true)).toBe(
      `https://api.example.com/resources/${resourceId}/download?disposition=inline`,
    );
  });
});
