const owningModules = [
  'identity-access',
  'school-configuration',
  'intake',
  'learning-progress',
  'records-governance',
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
        path: '^(apps/|packages/|fastify$|@fastify/|pg$|kysely$|firebase|@google-cloud/)',
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
