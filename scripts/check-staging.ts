import { assertNoProhibitedData } from './staging-data-policy.ts';

const deploymentUrlName = process.env.DEPLOYMENT_WEB_URL
  ? 'DEPLOYMENT_WEB_URL'
  : 'STAGING_WEB_URL';
const webUrl = requiredEnvironment(deploymentUrlName);

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

async function checkWeb(): Promise<void> {
  const health = await fetch(`${webUrl}/health/ready`);
  assertEqual(health.status, 200, 'web readiness status');
  assertEqual(health.headers.get('cache-control'), 'no-store', 'cache control');
  assertEqual(
    health.headers.get('strict-transport-security'),
    'max-age=31536000; includeSubDomains',
    'HSTS',
  );
  assertEqual(health.headers.get('x-frame-options'), 'DENY', 'framing');
  assertEqual(
    health.headers.get('x-content-type-options'),
    'nosniff',
    'MIME sniffing',
  );
  assertEqual(
    health.headers.get('referrer-policy'),
    'no-referrer',
    'referrer policy',
  );
  if (
    !health.headers
      .get('content-security-policy')
      ?.includes("default-src 'self'")
  ) {
    throw new Error('CSP default-src protection is missing');
  }
  const cookiePolicy = await fetch(`${webUrl}/health/security`);
  assertEqual(cookiePolicy.status, 200, 'cookie policy status');
  const cookies = cookiePolicy.headers.getSetCookie();
  if (cookies.length === 0) {
    throw new Error('Secure cookie policy check emitted no cookie');
  }
  for (const cookie of cookies) {
    if (
      !/;\s*Secure/i.test(cookie) ||
      !/;\s*HttpOnly/i.test(cookie) ||
      !/;\s*SameSite=Strict/i.test(cookie)
    ) {
      throw new Error('A response cookie is missing secure attributes');
    }
  }

  const endpoint = `${webUrl}/api/v1/administration/school-workspaces`;
  const crossOrigin = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://untrusted.invalid',
      'x-prevcare-csrf': '1',
    },
    body: '{}',
  });
  assertEqual(crossOrigin.status, 403, 'cross-origin rejection');

  const schemaRejection = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: webUrl,
      'x-prevcare-csrf': '1',
    },
    body: JSON.stringify({ unexpected: true }),
  });
  assertEqual(schemaRejection.status, 400, 'schema rejection');

  const oversized = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: webUrl,
      'x-prevcare-csrf': '1',
    },
    body: JSON.stringify({ value: 'x'.repeat(70_000) }),
  });
  assertEqual(oversized.status, 413, 'request-size rejection');

  assertNoProhibitedData(
    [
      await health.text(),
      await cookiePolicy.text(),
      await crossOrigin.text(),
      await schemaRejection.text(),
      await oversized.text(),
    ].join('\n'),
    'Deployment response',
  );
}

await checkWeb();
console.log('Deployment HTTP security checks passed.');
