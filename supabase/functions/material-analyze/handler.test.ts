import { createMaterialHandler } from './handler.ts';
const assert = (ok: unknown, message = 'assertion failed') => {
  if (!ok) throw Error(message);
};
const course = {
  id: 'allowed-course',
  title: 'Economics',
  group_id: 'g',
  group_name: 'Group',
  kinds: ['lecture'],
};
const config = {
  url: 'https://test.supabase.co',
  anonKey: 'test-anon',
  key: 'test-gemini-key',
  serviceKey: 'test-server-key',
};
const good = {
  kind: 'lecture',
  title: 'Demand',
  course_id: course.id,
  topic: 'Demand',
  description: 'Study supply and demand',
  confidence: 'high',
  reason: 'Lecture heading',
  evidence: ['Lecture 1'],
};
function harness(
  options: {
    auth?: boolean;
    quota?: boolean;
    provider?: number;
    model?: unknown;
    finish?: string;
    context?: boolean;
    tokens?: number;
    countStatus?: number;
  } = {},
) {
  let calls = 0,
    charges = 0,
    counts = 0,
    currentKey = '',
    paused = false;
  const cache = new Map<string, unknown>();
  let contextCourse = { ...course };
  const quota = () => ({
    user_remaining: 5 - charges,
    project_remaining: 20 - charges,
    user_daily: 5,
    project_daily: 20,
    max_input: 8000,
    max_output: 2048,
    rpm: 2,
    tpm: 12000,
    tokens_remaining: 12000,
    minute_remaining: 2,
    retry_after_seconds: paused ? 120 : 0,
  });
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (address.includes('/auth/v1/user'))
      return Response.json(
        options.auth === false
          ? { message: 'Invalid token' }
          : { id: 'teacher', aud: 'authenticated', email: 'test@example.test' },
        { status: options.auth === false ? 401 : 200 },
      );
    if (address.includes('/rest/v1/rpc/material_intake_context'))
      return Response.json(
        options.context === false
          ? { message: 'Publisher required' }
          : { courses: [contextCourse], groups: [{ id: 'g', name: 'Group' }] },
        { status: options.context === false ? 403 : 200 },
      );
    if (address.includes('/rest/v1/rpc/claim_material_analysis')) {
      assert(new Headers(init?.headers).get('apikey') === config.serviceKey);
      currentKey = body.p_key;
      if (cache.has(currentKey))
        return Response.json({ status: 'cached', analysis: cache.get(currentKey), quota: quota() });
      if (options.quota === false || paused)
        return Response.json({ status: 'limited', quota: quota() });
      charges++;
      return Response.json({ status: 'claimed', reservation: 'reservation', quota: quota() });
    }
    if (address.includes('/rest/v1/rpc/meter_material_analysis'))
      return Response.json(body.p_input > 0 && body.p_input <= 8000);
    if (address.includes('/rest/v1/rpc/finish_material_analysis')) {
      if (body.p_result) cache.set(currentKey, body.p_result);
      if (body.p_pause) paused = true;
      return Response.json(null);
    }
    if (address.includes('/rest/v1/rpc/material_ai_quota_for')) return Response.json(quota());
    if (address.endsWith(':countTokens')) {
      counts++;
      assert(body.generateContentRequest.systemInstruction);
      return Response.json(
        { totalTokens: options.tokens ?? 500 },
        { status: options.countStatus || 200 },
      );
    }
    if (address.endsWith(':generateContent')) {
      calls++;
      assert(new Headers(init?.headers).get('x-goog-api-key') === config.key);
      assert(!address.includes(config.key));
      assert(body.systemInstruction.parts[0].text.includes('недоверенные'));
      assert(body.generationConfig.maxOutputTokens === 2048);
      return Response.json(
        {
          candidates: [
            {
              finishReason: options.finish || 'STOP',
              content: { parts: [{ text: JSON.stringify(options.model || good) }] },
            },
          ],
        },
        { status: options.provider || 200 },
      );
    }
    throw Error('Unexpected network ' + address);
  };
  return {
    handle: createMaterialHandler(config, fetcher),
    counts: () => ({ calls, charges, counts }),
    changeContext: () => {
      contextCourse = { ...contextCourse, title: 'New discipline title' };
    },
  };
}
function request(overrides: Record<string, unknown> = {}, token = true) {
  return new Request('https://example.test/material-analyze', {
    method: 'POST',
    headers: token ? { authorization: 'Bearer test-token' } : {},
    body: JSON.stringify({
      source_hash: 'a'.repeat(64),
      name: 'lecture.txt',
      mime: 'text/plain',
      text: 'Lecture 1. Demand',
      excerpted: false,
      scopeCourse: null,
      scopeGroup: null,
      ...overrides,
    }),
  });
}
Deno.test('one generation with token preflight and bounded output', async () => {
  const h = harness();
  const r = await h.handle(request());
  assert(r.status === 200);
  const a = await r.json();
  assert(a.title === 'Demand' && a.course_id === course.id && !a.cached);
  assert(h.counts().calls === 1 && h.counts().charges === 1 && h.counts().counts === 1);
});
Deno.test(
  'same file, including rename, reuses cache without Google or another charge',
  async () => {
    const h = harness();
    await h.handle(request());
    const r = await h.handle(request({ name: 'renamed.txt' }));
    assert((await r.json()).cached);
    assert(h.counts().calls === 1 && h.counts().counts === 1 && h.counts().charges === 1);
  },
);
Deno.test('different file or changed course context invalidates cache', async () => {
  const h = harness();
  await h.handle(request());
  await h.handle(request({ source_hash: 'b'.repeat(64) }));
  h.changeContext();
  await h.handle(request());
  assert(h.counts().calls === 3);
});
Deno.test('auth, scope, invalid hash and oversized text stop before provider calls', async () => {
  for (const [options, req, status] of [
    [{}, request({}, false), 401],
    [{ auth: false }, request(), 401],
    [{ context: false }, request(), 403],
    [{}, request({ text: 'x'.repeat(12001) }), 400],
    [{}, request({ source_hash: 'invalid' }), 400],
    [{}, request({ scopeCourse: 'forbidden' }), 403],
  ] as const) {
    const h = harness(options);
    assert((await h.handle(req)).status === status);
    assert(h.counts().calls === 0 && h.counts().counts === 0);
  }
});
Deno.test('budget and token caps prevent generation', async () => {
  for (const o of [{ quota: false }, { tokens: 8001 }, { countStatus: 503 }]) {
    const h = harness(o);
    const r = await h.handle(request());
    assert(r.status === 429 || r.status === 422 || r.status === 502);
    assert(h.counts().calls === 0);
  }
});
Deno.test('429 causes a shared pause, without automatic retries', async () => {
  const h = harness({ provider: 429 });
  assert((await h.handle(request())).status === 429);
  assert((await h.handle(request({ source_hash: 'b'.repeat(64) }))).status === 429);
  assert(h.counts().calls === 1 && h.counts().counts === 1);
});
Deno.test('model ids and responses remain untrusted', async () => {
  const h = harness({ model: { ...good, course_id: 'forbidden' } });
  assert((await (await h.handle(request())).json()).course_id === null);
  for (const o of [
    { model: { ...good, title: 'x'.repeat(201) } },
    { model: { ...good, kind: 'execute_sql' } },
    { finish: 'MAX_TOKENS' },
  ])
    assert((await harness(o).handle(request())).status === 422);
});
Deno.test('missing server key returns setup message', async () => {
  const r = await createMaterialHandler({ ...config, key: undefined })(request());
  assert(r.status === 503);
  assert((await r.json()).error.includes('настроить Gemini'));
});
