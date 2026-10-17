import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createSqlTestDatabase } from './sql-fixture.mjs';
test('usage quotas are removed while cache, duplicate and server-only protections remain', async () => {
  const db = await createSqlTestDatabase();
  try {
    for (const file of (await readdir('supabase/migrations'))
      .filter((n) => n.endsWith('.sql'))
      .sort())
      await db.exec(
        (await readFile('supabase/migrations/' + file, 'utf8')).replace(
          'create extension if not exists pgcrypto;',
          '',
        ),
      );
    await db.exec(await readFile('supabase/migrations/202610170025_ai_unlimited.sql', 'utf8'));
    const user = '00000000-0000-0000-0000-000000009001';
    await db.exec(
      `insert into auth.users(id) values('${user}'); insert into public.profiles(id,full_name) values('${user}','AI policy test'); update public.material_ai_limits set user_daily=1,project_daily=1,rpm=1,tpm=10000,max_input=1,blocked_until=now()+interval '1 hour';`,
    );
    for (let i = 0; i < 25; i++) {
      const key = i.toString(16).padStart(64, '0');
      const claim = (
        await db.query('select public.claim_material_analysis($1,$2) claim', [user, key])
      ).rows[0].claim;
      assert.equal(claim.status, 'claimed');
      assert.equal(claim.quota.usage_unlimited, true);
      assert.equal(claim.quota.user_remaining, null);
      assert.equal(
        (await db.query('select public.claim_material_analysis($1,$2) claim', [user, key])).rows[0]
          .claim.status,
        'busy',
      );
      assert.equal(
        (await db.query('select public.meter_material_analysis($1,16000) ok', [claim.reservation]))
          .rows[0].ok,
        true,
      );
      await db.query('select public.finish_material_analysis($1,$2)', [
        claim.reservation,
        { kind: 'lecture', title: 'Saved' },
      ]);
      assert.equal(
        (await db.query('select public.claim_material_analysis($1,$2) claim', [user, key])).rows[0]
          .claim.status,
        'cached',
      );
    }
    await db.exec('set role authenticated');
    await assert.rejects(
      db.query('select public.claim_material_analysis($1,$2)', [user, 'a'.repeat(64)]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
