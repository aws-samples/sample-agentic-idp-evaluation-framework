import type { UploadResponse } from '@idp/shared';

const BASE = '/api';

export interface AuthUser {
  alias: string;
  email: string;
}

/** Fetch wrapper that auto-refreshes Midway token on 401 and retries once. */
export async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && import.meta.env.VITE_AUTH_PROVIDER === 'midway') {
    try {
      const { hasValidToken, redirectToMidway } = await import('@idp/midway');
      if (!hasValidToken()) {
        redirectToMidway();
      }
    } catch {
      // midway module not available
    }
  }
  return res;
}

export async function getCurrentUser(): Promise<AuthUser> {
  const res = await authedFetch(`${BASE}/auth/me`);
  if (!res.ok) {
    throw new Error('Not authenticated');
  }
  return res.json() as Promise<AuthUser>;
}

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await authedFetch(`${BASE}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
  }

  return res.json() as Promise<UploadResponse>;
}

