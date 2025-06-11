// Jest setup file for global test configuration
import { jest } from '@jest/globals';

// Set test environment variables
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'error'; // Reduce log noise during tests

// Global test timeout
jest.setTimeout(10000);

// Mock external services
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    colorize: jest.fn(),
    simple: jest.fn(),
  },
  transports: {
    Console: jest.fn(),
  },
}));

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});