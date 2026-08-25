export type PlaywrightSessionCookie = {
  name: string;
  value: string;
  url: string;
  httpOnly: true;
  secure: true;
  sameSite: 'Strict';
};

export function sessionCookiesForOrigin(
  cookieHeader: string | undefined,
  origin: string,
): PlaywrightSessionCookie[] {
  if (!cookieHeader) return [];
  const url = new URL(origin);
  if (url.protocol !== 'https:') {
    throw new Error('session cookies require an HTTPS origin');
  }
  return cookieHeader.split('; ').flatMap((pair) => {
    const separator = pair.indexOf('=');
    if (separator === -1) return [];
    const cookie: PlaywrightSessionCookie = {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: url.origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    };
    return [cookie];
  });
}
