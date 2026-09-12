const TEST_DATABASE_SENTINEL = "DEVILS_TOYS_TEST_DATABASE_ISOLATED";

/**
 * Vitest may be invoked from the repository root, where it does not otherwise
 * discover the server workspace's setup file. Refuse to open any database until
 * that setup has explicitly marked the process as isolated.
 */
export function refuseUnisolatedTestDatabase(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.VITEST && environment[TEST_DATABASE_SENTINEL] !== "1") {
    throw new Error(
      "Refusing to open The Devil's Toys database: Vitest is running without server/src/test-setup.ts. " +
        "Run server tests with 'npm run test:server -- <test-file>'."
    );
  }
}

export function markTestDatabaseIsolated(environment: NodeJS.ProcessEnv = process.env) {
  environment[TEST_DATABASE_SENTINEL] = "1";
}
