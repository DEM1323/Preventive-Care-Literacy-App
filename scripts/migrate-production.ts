process.env.DEPLOYMENT_ENVIRONMENT = 'production';
await import('./migrate-staging.ts');
