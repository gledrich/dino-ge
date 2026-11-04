/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
  testEnvironment: "jsdom",
  transform: {
    "^.+.tsx?$": ["ts-jest",{
      tsconfig: {
        esModuleInterop: true,
        types: ['jest', 'node']
      }
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/built/",
    "/e2e/"
  ],
  testMatch: [
    "**/__tests__/**/*.[jt]s?(x)",
    "**/?(*.)+(test).[jt]s?(x)"
  ],
};
