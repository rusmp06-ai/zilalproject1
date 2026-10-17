import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { geminiRequest, validateAnalysis, type Course } from './contract.ts';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};
const reply = (status: number, message: string, quota?: unknown) =>
  new Response(JSON.stringify({ error: message, quota }), { status, headers: cors });
export function createMaterialHandler(
  config: { key?: string; model?: string; url: string; anonKey: string; serviceKey?: string },
  fetcher: typeof fetch = fetch,
) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return reply(405, 'Используйте POST.');
    const key = config.key;
    if (!key)
      return reply(503, 'ИИ ещё не подключён. Владелец должен настроить Gemini на сервере.');
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ')) return reply(401, 'Войдите в аккаунт.');
    if (!config.serviceKey) return reply(503, 'Не настроена серверная авторизация помощника.');
    const admin = createClient(config.url, config.serviceKey, {
      global: { fetch: fetcher },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let reservation: string | null = null;
    let quota: Record<string, number> | undefined;
    const complete = async (result: unknown = null, pause = 0) => {
      if (reservation)
        await admin.rpc('finish_material_analysis', {
          p_id: reservation,
          p_result: result,
          p_pause: pause,
        });
    };
    const api = createClient(config.url, config.anonKey, {
      global: { headers: { Authorization: auth }, fetch: fetcher },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const { data: user, error: authError } = await api.auth.getUser(auth.slice(7));
      if (authError || !user.user) return reply(401, 'Войдите в аккаунт заново.');
      const { data: context, error: contextError } = await api.rpc('material_intake_context');
      if (contextError)
        return reply(403, 'Нет прав на добавление материалов или требуется SQL v0.30.');
      // Bound the actual streamed body; Content-Length is not trusted.
      const reader = req.body?.getReader();
      if (!reader) return reply(400, 'Нет документа.');
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 14500000) {
          await reader.cancel();
          return reply(413, 'Документ слишком большой для анализа.');
        }
        chunks.push(value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      const input = JSON.parse(new TextDecoder().decode(body));
      if (
        typeof input.source_hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(input.source_hash) ||
        typeof input.name !== 'string' ||
        input.name.length > 240 ||
        typeof input.excerpted !== 'boolean'
      )
        return reply(400, 'Неверный документ.');
      const supported = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'];
      if (!supported.includes(input.mime)) return reply(400, 'Формат анализа не поддерживается.');
      if (input.mime === 'text/plain') {
        if (
          typeof input.text !== 'string' ||
          !input.text.trim() ||
          input.text.length > 12000 ||
          input.data
        )
          return reply(400, 'Неверный текст.');
      } else {
        if (
          typeof input.data !== 'string' ||
          input.text ||
          input.data.length > 13981016 ||
          !input.data.length ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)
        )
          return reply(400, 'Неверный файл.');
        const bytes = Uint8Array.from(atob(input.data), (c) => c.charCodeAt(0));
        if (bytes.length > 10485760) return reply(413, 'Файл больше 10 МБ.');
        if (input.mime === 'application/pdf') {
          try {
            const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
            if (pdf.getPageCount() > 3)
              return reply(400, 'Для анализа отправьте первые 3 страницы.');
          } catch {
            return reply(400, 'PDF повреждён или защищён паролем.');
          }
        }
      }
      let courses: Course[] = context.courses;
      if (input.scopeCourse) {
        const selected = courses.find((c) => c.id === input.scopeCourse);
        if (!selected) return reply(403, 'Дисциплина недоступна.');
        courses = courses.filter((c) => c.group_id === selected.group_id);
      }
      if (input.scopeGroup) {
        if (
          !courses.some((c) => c.group_id === input.scopeGroup) &&
          !context.groups.some((g: { id: string }) => g.id === input.scopeGroup)
        )
          return reply(403, 'Группа недоступна.');
        courses = courses.filter((c) => c.group_id === input.scopeGroup);
      }
      const model = config.model || 'gemini-2.5-flash';
      if (!/^[a-zA-Z0-9.\-]+$/.test(model)) return reply(503, 'Неверная настройка модели.');
      if (courses.length > 200) return reply(400, 'Уточните группу перед анализом.');
      const normalized = [...courses].sort((a, b) => a.id.localeCompare(b.id));
      const identity = JSON.stringify({
        version: 2,
        model,
        source_hash: input.source_hash,
        mime: input.mime,
        text: input.text || null,
        data: input.data || null,
        excerpted: input.excerpted,
        courses: normalized,
      });
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)),
        ),
      ]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      const { data: claim, error: claimError } = await admin.rpc('claim_material_analysis', {
        p_user: user.user.id,
        p_key: hash,
      });
      if (claimError || !claim)
        return reply(
          503,
          'Не удалось проверить бюджет ИИ. Требуется SQL v0.31; заполните поля вручную.',
        );
      quota = claim.quota;
      if (claim.status === 'cached')
        return new Response(
          JSON.stringify({
            ...validateAnalysis(claim.analysis, courses, input.excerpted),
            cached: true,
            quota,
          }),
          { headers: cors },
        );
      if (claim.status === 'busy')
        return reply(
          409,
          'Этот документ уже анализируется. Повторите позже; дополнительный запрос не отправлен.',
          quota,
        );
      if (claim.status !== 'claimed')
        return reply(
          429,
          'Лимит StudyHub временно исчерпан. Сохранённые результаты доступны; новые поля можно заполнить вручную.',
          quota,
        );
      reservation = claim.reservation;
      const generation = geminiRequest(input, courses, model);
      generation.generationConfig.maxOutputTokens = claim.quota.max_output;
      const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
      // countTokens does not generate a second answer: it prevents an oversized paid/token request.
      const count = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            generateContentRequest: { model: 'models/' + model, ...generation },
          }),
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(15000)]),
        },
      );
      if (!count.ok) {
        await complete(null, count.status === 429 ? 120 : 0);
        return reply(
          count.status === 429 ? 429 : 502,
          'Не удалось проверить токены Gemini. Генерация не запускалась; заполните поля вручную.',
          quota,
        );
      }
      const tokens = (await count.json()).totalTokens;
      const { data: allowed, error: meterError } = await admin.rpc('meter_material_analysis', {
        p_id: reservation,
        p_input: Number.isInteger(tokens) ? tokens : 0,
      });
      if (meterError || !allowed) {
        await complete();
        return reply(
          422,
          'Фрагмент превышает бюджет токенов или проверка недоступна. Сократите документ либо заполните поля вручную.',
          quota,
        );
      }
      const response = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(generation),
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(45000)]),
        },
      );
      if (!response.ok) {
        await complete(null, response.status === 429 ? 120 : 0);
        return reply(
          response.status === 429 ? 429 : 502,
          response.status === 429
            ? 'Gemini исчерпал квоту. Запрос не повторяется автоматически; заполните поля вручную.'
            : 'Gemini недоступен. Автоматического повтора нет; заполните поля вручную.',
          quota,
        );
      }
      const result = await response.json();
      const candidate = result.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') {
        await complete();
        return reply(
          422,
          'ИИ не смог уверенно обработать документ. Заполните поля вручную.',
          quota,
        );
      }
      const raw = candidate.content?.parts
        ?.filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought)
        .map((p: { text: string }) => p.text)
        .join('');
      const analysis = validateAnalysis(JSON.parse(raw), courses, input.excerpted);
      await complete(analysis);
      const { data: fresh } = await admin.rpc('material_ai_quota_for', { p_user: user.user.id });
      return new Response(JSON.stringify({ ...analysis, cached: false, quota: fresh || quota }), {
        headers: cors,
      });
    } catch {
      await complete();
      return reply(
        422,
        'Не удалось безопасно проанализировать документ. Оригинал сохранён; поля можно заполнить вручную.',
      );
    }
  };
}
