import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the @qmailing/mcp-server package.
 *
 * <p>The Sonar gate the user runs against this repo measures coverage
 * across the whole tree, so the MCP package's tests need to land
 * under its own lcov bucket. Coverage thresholds are local-only —
 * Sonar's web-project gate excludes mcp/** (see qmailing-web's
 * sonar-project.properties) so the MCP package is metric-isolated.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // server.ts is the stdio bootstrap — its main() is exercised
      // by integration in real Claude Desktop, not by unit tests.
      exclude: ['src/server.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
