// Unit tests only: it/ holds the post-deploy integration tests (node:test, run by
// .github/workflows/integration-tests.yml) and cloudflare/ the Worker.
module.exports = {
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/it/', '<rootDir>/cloudflare/'],
};
