import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeployment } from '../scripts/check-deployment.mjs';
const config = {
  site: 'https://studyhub.test/',
  url: 'https://backend.test',
  key: 'fixture-key',
  email: 'fixture@example.test',
  password: 'fixture-password',
  version: '0.47.0',
};
function fixture({
  version = '0.47.0',
  unlimited = true,
  autoconfirm = false,
  login = true,
  cleanup = true,
  corsWide = false,
  buildCommit = null,
  aiStatus = 200,
  malformed = false,
} = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const address = new URL(url);
    calls.push(address.pathname + address.search);
    if (address.origin === 'https://studyhub.test') {
      assert.equal(init.headers, undefined, 'credentials must never go to the frontend');
      if (address.pathname === '/')
        return new Response('<script type="module" src="/assets/app.js"></script>');
      if (address.pathname === '/assets/app.js')
        return new Response('app()', { headers: { 'Content-Type': 'text/javascript' } });
      if (address.pathname === '/build-info.json')
        return Response.json({ version, commit: buildCommit });
    }
    if (address.pathname === '/functions/v1/material-analyze' && init.method === 'OPTIONS') {
      assert.equal(init.headers.Origin, 'https://studyhub-origin-check.invalid');
      return new Response(null, {
        status: corsWide ? 200 : 403,
        headers: corsWide ? { 'Access-Control-Allow-Origin': '*' } : {},
      });
    }
    if (address.pathname === '/functions/v1/material-analyze' && init.method === 'POST') {
      const input = JSON.parse(init.body);
      assert.match(input.source_hash, /^[a-f0-9]{64}$/);
      assert.ok(!input.text.includes(config.email));
      return Response.json(
        aiStatus === 200
          ? malformed
            ? {}
            : { kind: 'lecture', title: 'Synthetic fixture', confidence: 'high' }
          : { error: config.password },
        { status: aiStatus },
      );
    }
    assert.equal(init.headers.apikey, config.key);
    if (address.pathname === '/auth/v1/settings')
      return Response.json({ mailer_autoconfirm: autoconfirm });
    if (address.pathname === '/auth/v1/token')
      return Response.json(
        login ? { access_token: 'fixture-session-token' } : { message: 'fixture-password' },
        { status: login ? 200 : 400 },
      );
    if (address.pathname === '/auth/v1/user') return Response.json({ id: 'test-account' });
    if (address.pathname === '/rest/v1/rpc/material_intake_context')
      return Response.json({ courses: [] });
    if (address.pathname === '/rest/v1/rpc/material_ai_quota')
      return Response.json({ usage_unlimited: unlimited });
    if (address.pathname === '/auth/v1/logout') {
      assert.equal(address.search, '?scope=local');
      return new Response(null, { status: cleanup ? 204 : 500 });
    }
    throw Error('Unexpected destination');
  };
  return { fetcher, calls };
}
test('deployment check verifies frontend, existing Auth, migration and local logout without disclosing credentials', async () => {
  const { fetcher } = fixture();
  const result = await checkDeployment(config, fetcher);
  assert.equal(result.ready, true);
  const text = JSON.stringify(result);
  for (const value of [config.key, config.email, config.password, 'fixture-session-token'])
    assert.ok(!text.includes(value));
});
test('old frontend, unconfirmed migration and missing address are never labelled ready', async () => {
  for (const options of [
    { version: '0.46.0' },
    { unlimited: false },
    { autoconfirm: true },
    { cleanup: false },
    { corsWide: true },
  ]) {
    const { fetcher } = fixture(options);
    assert.equal((await checkDeployment(config, fetcher)).ready, false);
  }
  const { fetcher } = fixture();
  const result = await checkDeployment({ ...config, site: undefined }, fetcher);
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((c) => c.name === 'frontend').status, 'blocked');
});
test('failed test login leaks no provider response and does not attempt logout or publication', async () => {
  const { fetcher, calls } = fixture({ login: false });
  const result = await checkDeployment(config, fetcher);
  assert.equal(result.ready, false);
  assert.ok(!JSON.stringify(result).includes('fixture-password'));
  assert.ok(!calls.some((c) => c.includes('logout') || c.includes('/rpc/')));
});

test('optional assistant check sends only a synthetic fixture and never publishes material', async () => {
  const { fetcher, calls } = fixture();
  const result = await checkDeployment({ ...config, analyze: true }, fetcher);
  assert.equal(result.ready, true);
  assert.equal(result.checks.find((c) => c.name === 'assistant_fixture').status, 'passed');
  assert.ok(!calls.some((path) => path.includes('publish') || path.includes('storage')));
  for (const options of [{ aiStatus: 404 }, { aiStatus: 429 }, { malformed: true }]) {
    const { fetcher } = fixture(options);
    const result = await checkDeployment({ ...config, analyze: true }, fetcher);
    assert.equal(result.ready, false);
    assert.ok(!JSON.stringify(result).includes(config.password));
  }
});
test('deployment commit is checked when available, with no silent fallback for a stale build', async () => {
  const commit = 'a'.repeat(40);
  const good = fixture({ buildCommit: commit });
  assert.equal((await checkDeployment({ ...config, commit }, good.fetcher)).ready, true);
  const stale = fixture({ buildCommit: 'b'.repeat(40) });
  assert.equal((await checkDeployment({ ...config, commit }, stale.fetcher)).ready, false);
});
