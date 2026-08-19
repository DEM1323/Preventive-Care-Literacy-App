export function expireSecureOpaqueCookie(name: `__Host-${string}`): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
