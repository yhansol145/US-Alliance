const path = require('path');

const root = __dirname;

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/core$': path.join(root, 'libs/core/src'),
    '^@app/core/(.*)$': path.join(root, 'libs/core/src/$1'),
    '^@app/utils$': path.join(root, 'libs/utils/src'),
    '^@app/utils/(.*)$': path.join(root, 'libs/utils/src/$1'),
  },
};
