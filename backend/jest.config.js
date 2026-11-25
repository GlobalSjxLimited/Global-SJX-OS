/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // sanitize-html >= 2.15 depends on ESM-only packages; let ts-jest transpile them to CommonJS for tests.
  transform: { '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: { allowJs: true, esModuleInterop: true, module: 'commonjs', target: 'ES2020', skipLibCheck: true } }] },
  transformIgnorePatterns: ['/node_modules/(?!(?:[^/]+/node_modules/)*(?:htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)/)'],
};
