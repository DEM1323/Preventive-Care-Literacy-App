import type { ProviderName } from '../../observability/src/index.ts';

export type ProviderProbe = {
  name: ProviderName;
  check(): Promise<void>;
};

export type ProviderConfiguration = {
  projectId: string;
  kmsKeyResource: string;
  storageBucket: string;
  tasksQueueResource: string;
  schedulerJobResource: string;
  resendApiKey: string;
};

type FetchRequest = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function providerConfigurationFromEnvironment(): ProviderConfiguration {
  return {
    projectId: requiredEnvironment('GOOGLE_CLOUD_PROJECT'),
    kmsKeyResource: requiredEnvironment('KMS_KEY_RESOURCE'),
    storageBucket: requiredEnvironment('STORAGE_BUCKET'),
    tasksQueueResource: requiredEnvironment('TASKS_QUEUE_RESOURCE'),
    schedulerJobResource: requiredEnvironment('SCHEDULER_JOB_RESOURCE'),
    resendApiKey: requiredEnvironment('RESEND_API_KEY'),
  };
}

async function googleAccessToken(request: FetchRequest): Promise<string> {
  const response = await request(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'metadata-flavor': 'Google' } },
  );
  if (!response.ok) throw new Error('Provider authentication failed');
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('access_token' in body) ||
    typeof body.access_token !== 'string'
  ) {
    throw new Error('Provider authentication failed');
  }
  return body.access_token;
}

function googleProbe(
  name: ProviderName,
  url: string,
  request: FetchRequest,
): ProviderProbe {
  return {
    name,
    async check() {
      const accessToken = await googleAccessToken(request);
      const response = await request(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error('Provider smoke check failed');
    },
  };
}

export function createProviderProbes(
  configuration: ProviderConfiguration,
  request: FetchRequest = fetch,
): readonly ProviderProbe[] {
  const project = encodeURIComponent(configuration.projectId);
  const resourceUrl = (service: string, version: string, resource: string) =>
    `https://${service}.googleapis.com/${version}/${resource}`;

  return [
    googleProbe(
      'identity-platform',
      `https://identitytoolkit.googleapis.com/v2/projects/${project}/config`,
      request,
    ),
    googleProbe(
      'cloud-kms',
      resourceUrl('cloudkms', 'v1', configuration.kmsKeyResource),
      request,
    ),
    googleProbe(
      'cloud-storage',
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(configuration.storageBucket)}`,
      request,
    ),
    googleProbe(
      'cloud-tasks',
      resourceUrl('cloudtasks', 'v2', configuration.tasksQueueResource),
      request,
    ),
    googleProbe(
      'cloud-scheduler',
      resourceUrl('cloudscheduler', 'v1', configuration.schedulerJobResource),
      request,
    ),
    googleProbe(
      'cloud-translation',
      `https://translation.googleapis.com/v3/projects/${project}/locations/global/supportedLanguages`,
      request,
    ),
    {
      name: 'resend',
      async check() {
        const response = await request(
          'https://api.resend.com/domains?limit=1',
          {
            headers: { authorization: `Bearer ${configuration.resendApiKey}` },
          },
        );
        if (!response.ok) throw new Error('Provider smoke check failed');
      },
    },
  ];
}
