import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createSqlTestDatabase } from './sql-fixture.mjs';
import { renderBundles } from '../scripts/sql-bundles.mjs';
const queries = {
  functions: `select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`,
  columns: `select table_name,column_name,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
  constraints: `select t.relname,c.conname,pg_get_constraintdef(c.oid) definition from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' order by 1,2`,
  policies: `select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by 1,2`,
  indexes: `select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by 1,2`,
  tables: `select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`,
  triggers: `select c.relname,t.tgname,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by 1,2`,
};
async function schema(paths) {
  const db = await createSqlTestDatabase();
  try {
    for (const path of paths)
      await db.exec(
        (await readFile(path, 'utf8')).replace(
          'create extension if not exists pgcrypto;',
          '-- PGlite has built-in UUID/SHA256',
        ),
      );
    const snapshot = {};
    for (const [name, query] of Object.entries(queries))
      snapshot[name] = (await db.query(query)).rows;
    return snapshot;
  } finally {
    await db.close();
  }
}
test('all downloadable SQL is generated exactly from canonical migrations', async () => {
  for (const [name, expected] of await renderBundles())
    assert.equal(await readFile('supabase/' + name, 'utf8'), expected, name);
});
test('canonical migrations and repeatable SQL Editor upgrade have the same schema, rights and functions', async () => {
  const paths = (await readdir('supabase/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((n) => 'supabase/migrations/' + n);
  const canonical = await schema(paths);
  const manual = await schema([
    ...paths.slice(0, 10),
    'supabase/StudyHub_upgrade_latest.sql',
    'supabase/StudyHub_upgrade_latest.sql',
  ]);
  assert.deepEqual(manual, canonical);
});
