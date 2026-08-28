const owningModules = [
  'identity-access',
  'school-configuration',
  'intake-answers',
  'intake',
  'learning-progress',
  'records-governance',
  'operator-repair',
  'operational-readiness',
];

module.exports = {
  forbidden: [
    {
      name: 'domain-modules-are-portable',
      comment:
        'Owning modules cannot depend on HTTP, persistence, cloud, or browser code.',
      severity: 'error',
      from: { path: '^modules/' },
      to: {
        path: '^(apps/|packages/|fastify$|@fastify/|pg$|kysely$|firebase|@google-cloud/|@supabase/)',
      },
    },
    {
      name: 'browser-must-not-import-node-core',
      comment:
        'Browser UI cannot import Node builtins. Do not polyfill node:crypto.',
      severity: 'error',
      from: { path: '^src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'browser-must-not-import-node-crypto-modules',
      comment:
        'Browser UI cannot import owning modules that load Node builtins. Clinical answer labels live in modules/intake-answers.',
      severity: 'error',
      from: { path: '^src/' },
      to: {
        path: '^modules/(school-configuration|intake|learning-progress)/',
      },
    },
    ...owningModules.map((moduleName) => ({
      name: `${moduleName}-root-only`,
      comment: `Consumers must import ${moduleName} through its root index.`,
      severity: 'error',
      from: { pathNot: `^modules/${moduleName}/` },
      to: { path: `^modules/${moduleName}/(?!index\\.ts$)` },
    })),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: ['node_modules', 'dist'],
    tsConfig: { fileName: 'tsconfig.server.json' },
    tsPreCompilationDeps: true,
  },
};
