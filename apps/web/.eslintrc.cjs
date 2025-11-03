module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: ['../../packages/config/eslint/base.cjs'],
  parserOptions: { ecmaFeatures: { jsx: true } }
};

