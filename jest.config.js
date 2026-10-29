module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: { jsx: 'react', esModuleInterop: true, strict: true, target: 'ES2020', module: 'commonjs' }, diagnostics: { warnOnly: false } }],
  },
  testMatch: ['<rootDir>/__tests__/**/*.test.(ts|tsx|js)'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__mocks__/react-native.ts',
    '^react-native/Libraries/Types/CodegenTypes$': '<rootDir>/__mocks__/codegen-types.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/specs/**',
    '!src/index.ts',
    '!src/ui/**',
    '!src/debug/DebugScreen.tsx',
    '!src/debug/SyncDashboard.tsx',
  ],
  coverageThreshold: {
    global: { branches: 60, functions: 70, lines: 70, statements: 70 },
  },
};
