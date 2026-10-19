import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

// Default checks only read configuration, with a disposable Auth session and local sign-out.
// --ai additionally sends one synthetic fixture to the deployed assistant; it publishes no material.
// Never include response bodies, credentials, account names or raw errors in a report.
export async function checkDeployment(config, fetcher = fetch) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const request = (url, init = {}) =>
    fetcher(url, {
      ...init,
      signal: init.signal || AbortSignal.timeout(15000),
      redirect: 'error',
    });
  if (!config.site) add('frontend', 'blocked', 'Не задан опубликованный адрес StudyHub.');
  else {
    let frontendConfirmed = false;
    try {
      const site = new URL(config.site);
      if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash)
        throw Error('invalid_site');
      if (!site.pathname.endsWith('/')) site.pathname += '/';
      const page = await request(site.href, { cache: 'no-store' });
      const html = await page.text();
      const entry = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
      if (!page.ok || !entry) throw Error('missing_entry');
      const script = new URL(entry, site);
      if (script.origin !== site.origin) throw Error('foreign_entry');
      const asset = await request(script.href, { cache: 'no-store' });
      if (!asset.ok || !/javascript/.test(asset.headers.get('content-type') || ''))
        throw Error('invalid_entry');
      frontendConfirmed = true;
      add('frontend', 'passed', 'HTML и стартовый JavaScript доступны по HTTPS.');
      const info = await request(new URL('build-info.json', site).href, { cache: 'no-store' });
      const release = info.ok ? await info.json() : null;
      if (!release || !/^\d+\.\d+\.\d+$/.test(release.version || ''))
        add('release', 'failed', 'Нет корректных сведений о развёрнутой сборке.');
      else
        add(
          'release',
          release.version === config.version && (!config.commit || release.commit === config.commit)
            ? 'passed'
            : 'failed',
          release.version === config.version && (!config.commit || release.commit === config.commit)
            ? config.commit
              ? 'Опубликованы ожидаемые версия и коммит.'
              : 'Версия совпала; коммит не проверялся.'
            : 'Опубликованная версия или коммит отличаются от проверяемых.',
        );
    } catch {
      add(
        frontendConfirmed ? 'release' : 'frontend',
        'failed',
        'Не удалось подтвердить загрузку сайта и его сборки.',
      );
    }
  }
  if (!config.url || !config.key) {
    add('supabase', 'blocked', 'Отсутствуют публичные параметры Supabase.');
    return { ready: false, checks };
  }
  let base;
  try {
    const url = new URL(config.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('invalid_url');
    base = url.origin;
  } catch {
    add('supabase', 'failed', 'Неверный публичный HTTPS-адрес Supabase.');
    return { ready: false, checks };
  }
  const headers = { apikey: config.key, 'Content-Type': 'application/json' };
  try {
    const response = await request(base + '/auth/v1/settings', { headers });
    const settings = response.ok ? await response.json() : null;
    add(
      'email_confirmation',
      settings?.mailer_autoconfirm === false ? 'passed' : 'failed',
      settings?.mailer_autoconfirm === false
        ? 'Подтверждение email включено; доставка письма не проверялась.'
        : 'Не подтверждена настройка подтверждения email.',
    );
  } catch {
    add('email_confirmation', 'failed', 'Auth settings недоступны.');
  }
  try {
    const origin = 'https://studyhub-origin-check.invalid';
    const response = await request(base + '/functions/v1/material-analyze', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type',
      },
    });
    const allow = response.headers.get('access-control-allow-origin');
    const restricted = response.status === 403 && allow !== '*' && allow !== origin;
    add(
      'ai_cors',
      restricted ? 'passed' : 'failed',
      restricted
        ? 'Посторонний Origin отклонён.'
        : response.status === 404
          ? 'Адрес material-analyze вернул HTTP 404; CORS функции проверить нельзя.'
          : 'Не подтверждён точный CORS: настройте ALLOWED_ORIGINS и разверните material-analyze.',
    );
  } catch {
    add('ai_cors', 'failed', 'Не удалось проверить preflight edge-функции.');
  }
  if (!config.email || !config.password) {
    add('existing_account', 'blocked', 'Не задана отдельная тестовая учётная запись.');
    return { ready: false, checks };
  }
  let token;
  let authenticated = false;
  try {
    const response = await request(base + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    const session = response.ok ? await response.json() : null;
    if (typeof session?.access_token !== 'string' || !session.access_token)
      throw Error('login_failed');
    token = session.access_token;
    const authHeaders = { ...headers, Authorization: 'Bearer ' + token };
    const identity = await request(base + '/auth/v1/user', { headers: authHeaders });
    if (!identity.ok) throw Error('identity_failed');
    authenticated = true;
    add('existing_account', 'passed', 'Вход существующего тестового аккаунта подтверждён.');
    const context = await request(base + '/rest/v1/rpc/material_intake_context', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    });
    if (context.status === 401 || context.status === 403)
      add(
        'ai_policy',
        'blocked',
        'Тестовый аккаунт не имеет права публикации; нужна отдельная проверка назначенного преподавателя.',
      );
    else if (!context.ok)
      add('ai_policy', 'failed', 'Контекст публикации недоступен; проверьте миграции базы.');
    else {
      const response = await request(base + '/rest/v1/rpc/material_ai_quota', {
        method: 'POST',
        headers: authHeaders,
        body: '{}',
      });
      const policy = response.ok ? await response.json() : null;
      add(
        'ai_policy',
        policy?.usage_unlimited === true ? 'passed' : 'failed',
        policy?.usage_unlimited === true
          ? 'SQL-политика v0.47 без квот StudyHub применена.'
          : 'Политика v0.47 не подтверждена: примените StudyHub_update_v0.47.sql в правильном проекте.',
      );
      if (config.analyze) {
        try {
          const scopes = await context.json();
          const course = Array.isArray(scopes.courses) ? scopes.courses[0]?.id : null;
          const text =
            'Учебная лекция. Тема: основы финансового анализа. Цель занятия — изучить доходы, расходы и финансовый результат. Это синтетический документ для проверки StudyHub, не пользовательский материал.';
          const result = await request(base + '/functions/v1/material-analyze', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              source_hash: createHash('sha256').update(text).digest('hex'),
              name: 'StudyHub-readiness-fixture.txt',
              mime: 'text/plain',
              text,
              excerpted: false,
              scopeCourse: course || null,
              scopeGroup: null,
            }),
            signal: AbortSignal.timeout(65000),
          });
          const analysis = result.ok ? await result.json() : null;
          const valid =
            analysis &&
            ['lecture', 'presentation', 'material', 'book', 'assignment', 'unknown'].includes(
              analysis.kind,
            ) &&
            typeof analysis.title === 'string' &&
            ['low', 'medium', 'high'].includes(analysis.confidence);
          add(
            'assistant_fixture',
            valid ? 'passed' : 'failed',
            valid
              ? 'Развёрнутый помощник обработал синтетический документ; материал не публиковался.'
              : result.status === 429
                ? 'Помощник вернул 429; повторные запросы автоматически не отправлялись.'
                : 'Серверный анализ не подтверждён (HTTP ' +
                  result.status +
                  '); проверьте функцию и серверный ключ Gemini.',
          );
        } catch {
          add(
            'assistant_fixture',
            'failed',
            'Серверный анализ не завершился; пользовательские документы не отправлялись.',
          );
        }
      }
    }
  } catch {
    add(
      authenticated ? 'ai_policy' : 'existing_account',
      'failed',
      'Не удалось подтвердить тестовый вход и чтение настроек.',
    );
  } finally {
    if (token) {
      try {
        const response = await request(base + '/auth/v1/logout?scope=local', {
          method: 'POST',
          headers: { ...headers, Authorization: 'Bearer ' + token },
        });
        add(
          'test_session_cleanup',
          response.ok ? 'passed' : 'failed',
          response.ok
            ? 'Временная тестовая сессия закрыта.'
            : 'Не удалось подтвердить закрытие временной сессии.',
        );
      } catch {
        add('test_session_cleanup', 'failed', 'Закрытие тестовой сессии не подтверждено.');
      }
    }
  }
  return { ready: checks.every((check) => check.status === 'passed'), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  let commit;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    /* ZIP checkout: compare version only. */
  }
  const result = await checkDeployment({
    site: process.env.STUDYHUB_SITE_URL,
    url: process.env.VITE_SUPABASE_URL,
    key: process.env.VITE_SUPABASE_ANON_KEY,
    email: process.env.STUDYHUB_TEST_EMAIL,
    password: process.env.STUDYHUB_TEST_PASSWORD,
    version,
    commit,
    analyze: process.argv.includes('--ai'),
  });
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/deployment.json', JSON.stringify(result, null, 2) + '\n');
  console.table(result.checks);
  process.exitCode = result.ready ? 0 : 2;
}
