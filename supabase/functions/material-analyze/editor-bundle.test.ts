function assert(value: unknown): asserts value {
  if (!value) throw Error('Editor bundle check failed');
}
Deno.test(
  'generated editor deployment boots the same CORS and setup handling without server credentials',
  async () => {
    const variables = [
      'ALLOWED_ORIGINS',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];
    const previous = new Map(variables.map((name) => [name, Deno.env.get(name)]));
    const serve = Deno.serve;
    let handler: ((request: Request) => Promise<Response>) | undefined;
    try {
      for (const name of variables) Deno.env.delete(name);
      Deno.env.set('ALLOWED_ORIGINS', 'https://studyhub.test');
      Deno.serve = ((...args: unknown[]) => {
        handler = args.at(-1) as typeof handler;
        return {} as ReturnType<typeof Deno.serve>;
      }) as typeof Deno.serve;
      await import('../../StudyHub_material_analyze.js');
      assert(handler);
      const allowed = await handler(
        new Request('https://edge.test', {
          method: 'OPTIONS',
          headers: { Origin: 'https://studyhub.test' },
        }),
      );
      assert(allowed.status === 200);
      assert(allowed.headers.get('Access-Control-Allow-Origin') === 'https://studyhub.test');
      const foreign = await handler(
        new Request('https://edge.test', {
          method: 'OPTIONS',
          headers: { Origin: 'https://foreign.test' },
        }),
      );
      assert(foreign.status === 403);
      assert(foreign.headers.get('Access-Control-Allow-Origin') !== '*');
      const setup = await handler(new Request('https://edge.test', { method: 'POST' }));
      assert(setup.status === 503);
    } finally {
      Deno.serve = serve;
      for (const [name, value] of previous)
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
    }
  },
);
