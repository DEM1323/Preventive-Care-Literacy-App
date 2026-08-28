function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const origin = requiredEnvironment('PRODUCTION_ORIGIN').replace(/\/$/, '');
const expectedArtifactDigest = requiredEnvironment('EXPECTED_ARTIFACT_DIGEST');
const operatorToken = requiredEnvironment('OPERATOR_PROVISIONING_TOKEN');

async function expectStatus(
  response: Response,
  expected: number,
  label: string,
): Promise<Response> {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}`);
  }
  return response;
}

const build = await expectStatus(
  await fetch(`${origin}/health/build`),
  200,
  'build identity',
);
const identity = (await build.json()) as { artifactDigest?: unknown };
if (identity.artifactDigest !== expectedArtifactDigest) {
  throw new Error(
    'deployed artifact digest does not match the production build',
  );
}

for (const path of ['/operator', '/staff/sign-in', '/student/invitation']) {
  const page = await expectStatus(await fetch(`${origin}${path}`), 200, path);
  const contentType = page.headers.get('content-type') ?? '';
  if (!contentType.startsWith('text/html')) {
    throw new Error(`${path} did not return the application`);
  }
}

const signIn = await expectStatus(
  await fetch(`${origin}/api/v1/auth/operator/sign-in`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-prevcare-csrf': '1',
    },
    body: JSON.stringify({ token: operatorToken }),
  }),
  200,
  'operator sign-in',
);
const operatorCookie = signIn.headers.get('set-cookie')?.split(';', 1)[0];
if (!operatorCookie) throw new Error('operator sign-in returned no session');

await expectStatus(
  await fetch(`${origin}/api/v1/operator/workspaces`, {
    headers: { cookie: operatorCookie },
  }),
  200,
  'operator workspace catalog',
);
await expectStatus(
  await fetch(`${origin}/api/v1/auth/operator/sign-out`, {
    method: 'POST',
    headers: {
      cookie: operatorCookie,
      origin,
      'x-prevcare-csrf': '1',
    },
  }),
  200,
  'operator sign-out',
);

console.log('Production application checks passed.');
