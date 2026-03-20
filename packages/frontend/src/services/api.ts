import type { UploadResponse } from '@idp/shared';
import { redirectToMidway } from './midway.js';

const BASE = '/api';

export interface AuthUser {
  alias: string;
  email: string;
}

/** Fetch wrapper that auto-redirects to Midway on 401 */
export async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && window.location.hostname !== 'localhost') {
    redirectToMidway();
    return new Promise(() => {}); // page is redirecting
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

