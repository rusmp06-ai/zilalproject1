import { createMaterialHandler } from './handler.ts';
Deno.serve(
  createMaterialHandler({
    allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    key: Deno.env.get('GEMINI_API_KEY'),
    model: Deno.env.get('GEMINI_MODEL'),
    url: Deno.env.get('SUPABASE_URL') || '',
    anonKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
  }),
);
