export function initMidwayAuth(): null { return null; }
export function handleOidcCallback(): boolean { return false; }
export function hasValidToken(): boolean { return false; }
export function redirectToMidway(): void {
  console.error('Midway auth module not available in this distribution.');
}
export function clearToken(): void {}
