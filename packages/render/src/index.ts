type FetchRequest = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

type RenderDeploy = {
  id?: unknown;
  status?: unknown;
  image?: { ref?: unknown; sha?: unknown };
};

const failedStatuses = new Set([
  'build_failed',
  'canceled',
  'deactivated',
  'pre_deploy_failed',
  'update_failed',
]);

function expectedDigest(imageRef: string): string {
  const separator = imageRef.lastIndexOf('@');
  const digest = separator >= 0 ? imageRef.slice(separator + 1) : '';
  if (!/^sha256:[a-f0-9]+$/.test(digest)) {
    throw new Error('A digest-pinned image reference is required');
  }
  return digest;
}

function normalizeDigest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

async function renderRequest(
  request: FetchRequest,
  apiKey: string,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await request(url, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Render deployment request failed');
  const text = await response.text();
  return text.length > 0 ? JSON.parse(text) : undefined;
}

function deploysFrom(value: unknown): RenderDeploy[] {
  if (!Array.isArray(value)) {
    throw new Error('Render deployment returned an invalid response');
  }
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const deploy = 'deploy' in entry ? entry.deploy : entry;
    return typeof deploy === 'object' && deploy !== null
      ? [deploy as RenderDeploy]
      : [];
  });
}

async function listDeploys(
  request: FetchRequest,
  apiKey: string,
  serviceUrl: string,
): Promise<RenderDeploy[]> {
  return deploysFrom(
    await renderRequest(request, apiKey, `${serviceUrl}/deploys?limit=20`, {
      method: 'GET',
    }),
  );
}

function digestReference(deployment: RenderDeploy): string | undefined {
  if (
    typeof deployment.image?.ref !== 'string' ||
    normalizeDigest(deployment.image.sha) === undefined
  ) {
    return undefined;
  }
  const digest = normalizeDigest(deployment.image.sha)!;
  const ref = deployment.image.ref;
  const slash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  const repository = ref.includes('@')
    ? ref.slice(0, ref.lastIndexOf('@'))
    : colon > slash
      ? ref.slice(0, colon)
      : ref;
  return `${repository}@${digest}`;
}

export async function getLatestLiveRenderImage(options: {
  apiKey: string;
  serviceId: string;
  request?: FetchRequest;
}): Promise<string | undefined> {
  const request = options.request ?? fetch;
  const serviceUrl = `https://api.render.com/v1/services/${encodeURIComponent(options.serviceId)}`;
  const deployments = await listDeploys(request, options.apiKey, serviceUrl);
  return digestReference(
    deployments.find(({ status }) => status === 'live') ?? {},
  );
}

export async function deployRenderService(options: {
  apiKey: string;
  serviceId: string;
  imageRef: string;
  request?: FetchRequest;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{ deployId: string; digest: string }> {
  const digest = expectedDigest(options.imageRef);
  const request = options.request ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const serviceUrl = `https://api.render.com/v1/services/${encodeURIComponent(options.serviceId)}`;
  const previousIds = new Set(
    (await listDeploys(request, options.apiKey, serviceUrl))
      .map(({ id }) => id)
      .filter((id): id is string => typeof id === 'string'),
  );
  const created = await renderRequest(
    request,
    options.apiKey,
    `${serviceUrl}/deploys`,
    {
      method: 'POST',
      body: JSON.stringify({ imageUrl: options.imageRef }),
    },
  );
  let deployId =
    typeof created === 'object' &&
    created !== null &&
    'id' in created &&
    typeof created.id === 'string'
      ? created.id
      : undefined;

  for (let attempt = 0; !deployId && attempt < 60; attempt += 1) {
    const queued = await listDeploys(request, options.apiKey, serviceUrl);
    deployId = queued.find(
      ({ id }) => typeof id === 'string' && !previousIds.has(id),
    )?.id as string | undefined;
    if (!deployId) await sleep(1_000);
  }
  if (!deployId) throw new Error('Render deployment was not queued');

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const deployment = (await renderRequest(
      request,
      options.apiKey,
      `${serviceUrl}/deploys/${encodeURIComponent(deployId)}`,
      { method: 'GET' },
    )) as RenderDeploy;
    if (deployment.status === 'live') {
      if (normalizeDigest(deployment.image?.sha) !== digest) {
        throw new Error('Render deployed an unexpected artifact digest');
      }
      return { deployId, digest };
    }
    if (
      typeof deployment.status === 'string' &&
      failedStatuses.has(deployment.status)
    ) {
      throw new Error('Render deployment failed');
    }
    await sleep(5_000);
  }

  throw new Error('Render deployment timed out');
}

export async function deployRenderTopology(
  options: {
    apiKey: string;
    webServiceId: string;
    workerServiceId: string;
    imageRef: string;
    verify?: () => Promise<void>;
  },
  dependencies: {
    currentImage?: typeof getLatestLiveRenderImage;
    deploy?: typeof deployRenderService;
  } = {},
): Promise<{
  web: { deployId: string; digest: string };
  worker: { deployId: string; digest: string };
}> {
  const currentImage = dependencies.currentImage ?? getLatestLiveRenderImage;
  const deploy = dependencies.deploy ?? deployRenderService;
  const previousWebImage = await currentImage({
    apiKey: options.apiKey,
    serviceId: options.webServiceId,
  });
  const previousWorkerImage = await currentImage({
    apiKey: options.apiKey,
    serviceId: options.workerServiceId,
  });
  const web = await deploy({
    apiKey: options.apiKey,
    serviceId: options.webServiceId,
    imageRef: options.imageRef,
  });
  let workerDeployed = false;
  try {
    const worker = await deploy({
      apiKey: options.apiKey,
      serviceId: options.workerServiceId,
      imageRef: options.imageRef,
    });
    workerDeployed = true;
    await options.verify?.();
    return { web, worker };
  } catch {
    if (workerDeployed && previousWorkerImage) {
      await deploy({
        apiKey: options.apiKey,
        serviceId: options.workerServiceId,
        imageRef: previousWorkerImage,
      });
    }
    if (previousWebImage) {
      await deploy({
        apiKey: options.apiKey,
        serviceId: options.webServiceId,
        imageRef: previousWebImage,
      });
    }
    throw new Error('Render topology verification failed; rollback completed');
  }
}

export async function runRenderJob(options: {
  apiKey: string;
  serviceId: string;
  startCommand: string;
  request?: FetchRequest;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{ jobId: string }> {
  const request = options.request ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const serviceUrl = `https://api.render.com/v1/services/${encodeURIComponent(options.serviceId)}`;
  const created = await renderRequest(
    request,
    options.apiKey,
    `${serviceUrl}/jobs`,
    {
      method: 'POST',
      body: JSON.stringify({ startCommand: options.startCommand }),
    },
  );
  if (
    typeof created !== 'object' ||
    created === null ||
    !('id' in created) ||
    typeof created.id !== 'string'
  ) {
    throw new Error('Render job returned an invalid response');
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const job = await renderRequest(
      request,
      options.apiKey,
      `${serviceUrl}/jobs/${encodeURIComponent(created.id)}`,
      { method: 'GET' },
    );
    if (typeof job !== 'object' || job === null || !('status' in job)) {
      throw new Error('Render job returned an invalid response');
    }
    if (job.status === 'succeeded') return { jobId: created.id };
    if (job.status === 'failed' || job.status === 'canceled') {
      throw new Error('Render provider smoke job failed');
    }
    await sleep(5_000);
  }
  throw new Error('Render provider smoke job timed out');
}
