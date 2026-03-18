import type { UploadResponse } from '@idp/shared';

const BASE = '/api';

export interface AuthUser {
  alias: string;
  email: string;
}

export async function getCurrentUser(): Promise<AuthUser> {
  const res = await fetch(`${BASE}/auth/me`);
  if (!res.ok) throw new Error('Not authenticated');
  return res.json() as Promise<AuthUser>;
}

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
  }

  return res.json() as Promise<UploadResponse>;
}

