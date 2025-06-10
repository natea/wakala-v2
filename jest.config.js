/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/backend', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  collectCoverageFrom: [
    'backend/**/*.{js,ts}',
    '!backend/**/*.d.ts',
    '!backend/**/node_modules/**',
    '!backend/**/__tests__/**',
    '!backend/**/*.test.ts',
    '!backend/**/*.spec.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/backend/shared/$1',
    '^@services/(.*)$': '<rootDir>/backend/services/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  clearMocks: true,
  restoreMocks: true,
  // London School TDD configuration
  testTimeout: 5000,
  maxWorkers: '50%',
};