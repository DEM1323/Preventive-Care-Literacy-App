import {
  createTelemetry,
  recordProviderChecks,
} from '../packages/observability/src/index.ts';
import {
  checkProviderProbes,
  createProviderProbes,
  providerConfigurationFromEnvironment,
} from '../packages/providers/src/index.ts';

const telemetry = createTelemetry((line) => console.log(line));
const results = await checkProviderProbes(
  createProviderProbes(providerConfigurationFromEnvironment()),
);
recordProviderChecks(telemetry, results);
if (results.some(({ status }) => status === 'error')) {
  throw new Error('Provider smoke checks failed');
}
