export default {
  paths: ['test/features/**/*.feature'],
  // `require` (et non `import`) : les steps sont transpilés par ts-node en CommonJS.
  require: ['test/steps/**/*.steps.ts'],
  requireModule: ['ts-node/register'],
  format: ['progress-bar', 'summary'],
  formatOptions: { snippetInterface: 'async-await' },
};
