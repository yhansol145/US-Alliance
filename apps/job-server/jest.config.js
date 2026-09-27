module.exports = {
  displayName: 'job-server',
  preset: '../../jest.preset.js',
  rootDir: '.',
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageDirectory: '../../coverage/apps/job-server',
};
