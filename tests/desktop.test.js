import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Script, runInNewContext } from 'node:vm';
import { test } from 'node:test';

test('desktop backend preparation retains authentication and template helpers', () => {
  const build = readFileSync(new URL('../build_exe.mjs', import.meta.url), 'utf8');
  const serverCode = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  // Run the real source preparation without cleaning dist or invoking build tools.
  const preparation = build.slice(build.indexOf('const patchedHeader ='), build.indexOf('const patchedPath ='));
  const prepared = runInNewContext(preparation + '\nfinalCode;', { serverCode, console, process });
  new Script(prepared);
  const routes = new Map();
  const app = { locals: {}, use() {}, get() {}, put() {}, patch() {}, delete() {},
    post(path, ...handlers) { routes.set(path, handlers); }, listen() { return { on() {} }; } };
  const nativeRequire = createRequire(import.meta.url);
  const express = Object.assign(() => app, { static: () => () => {}, json: () => () => {} });
  const context = {
    require(name) {
      if (name === 'express') return express;
      if (name === 'pg') return { Pool: class {} };
      if (name === 'dotenv') return { config() {} };
      return nativeRequire(name);
    },
    process: { ...process, env: { ADMIN_PASSWORD: 'desktop-test' } },
    __dirname: fileURLToPath(new URL('..', import.meta.url)),
    console: { log() {}, error() {} }, Buffer
  };
  const helpers = runInNewContext(prepared + '\n({ isValidSession, resolveTemplatePath });', context);
  let token;
  routes.get('/api/login')[0]({ body: { password: 'desktop-test' } }, { cookie(name, value) { token = value; }, json() {} });
  assert.equal(helpers.isValidSession(token), true);
  assert.match(helpers.resolveTemplatePath('template.xlsx'), /template\.xlsx$/);
});
