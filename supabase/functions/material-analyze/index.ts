import {createMaterialHandler} from './handler.ts';
Deno.serve(createMaterialHandler({key:Deno.env.get('GEMINI_API_KEY'),model:Deno.env.get('GEMINI_MODEL'),url:Deno.env.get('SUPABASE_URL')||'',anonKey:Deno.env.get('SUPABASE_ANON_KEY')||''}));
