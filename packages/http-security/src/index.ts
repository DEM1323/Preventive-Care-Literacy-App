export function expireSecureOpaqueCookie(name: `__Host-${string}`): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

/**
 * Serializes an opaque, non-persistent session cookie: no Expires/Max-Age,
 * so the browser drops it when the session ends while the server remains
 * authoritative over validity.
 */
export function setSecureOpaqueCookie(
  name: `__Host-${string}`,
  value: string,
): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function readSecureOpaqueCookie(
  cookieHeader: string | undefined,
  name: `__Host-${string}`,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return undefined;
}
