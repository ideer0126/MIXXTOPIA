#!/usr/bin/env node
'use strict';
// Optional real PostgreSQL engine check. No server, credentials or runtime dependency.
// npm install --prefix /tmp/mixx-db --no-save @electric-sql/pglite
// MIXX_PGLITE_MODULE=/tmp/mixx-db/node_modules/@electric-sql/pglite node tools/test-stats-db.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PGlite } = require(process.env.MIXX_PGLITE_MODULE || '@electric-sql/pglite');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const w1 = 'a'.repeat(32), w2 = 'b'.repeat(32);
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;`);
    const init = fs.readFileSync(path.join(__dirname, '../supabase/migrations/0001_init.sql'), 'utf8');
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/0002_stats.sql'), 'utf8');
    await db.exec(init); await db.exec(migration);
    await db.query('insert into auth.users values ($1), ($2)', [A, B]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${A}';`);
    const merge = async (writer, seconds, achievements = []) => (await db.query(
      'select * from public.merge_stats($1, $2, $3)', [writer, Math.round(seconds * 1000), JSON.stringify(achievements)])).rows[0];
    const initial = await merge(w1, 10, ['first_star', 'first_star']);
    assert.equal(initial.play_seconds, 10); assert.deepEqual(initial.achievements, ['first_star']);
    assert.equal((await merge(w1, 10)).play_seconds, 10);
    assert.equal((await merge(w1, 5)).play_seconds, 10);
    assert.equal((await merge(w2, 7, ['first_clear'])).play_seconds, 17);
    await merge(w2, 7.75);
    const total = await merge(w1, 12.5, ['first_star']);
    assert.equal(total.play_seconds, 20); assert.equal(total.remainder_ms, 250);
    assert.deepEqual(total.achievements, ['first_clear', 'first_star']);
    console.log('  ✓ insert / duplicate / stale retry / separate writers / achievement union');
    const save = stars => JSON.stringify({ v: 1, stars });
    await db.query('insert into public.saves(user_id,slot,data) values($1,1,$2),($1,2,$3)',
      [A, save({ 1: ['s1', 's2'], 2: ['t1'] }), save({ 1: ['s1'], 2: ['t2'] })]);
    assert.deepEqual((await merge(w1, 12)).collections, { 1: ['s1', 's2'], 2: ['t1', 't2'] });
    await db.query('update public.saves set data=$1 where slot=2', [JSON.stringify({ v: 1, stars: { 3: 'bad', invalid: ['ignored'] } })]);
    assert.deepEqual((await merge(w1, 12)).collections, { 1: ['s1', 's2'], 2: ['t1'] });
    console.log('  ✓ canonical cloud collection / cross-slot deduplication / malformed data');
    for (const args of [[w1, -1, []], ['invalid', 1, []], [w1, 1, {}], [w1, 1, ['unknown']], [w1, 1, [null]]]) {
      await assert.rejects(merge(...args));
    }
    console.log('  ✓ invalid counters / writers / achievement payloads rejected');
    await db.exec(`set request.jwt.claim.sub = '${B}';`);
    assert.equal((await db.query('select * from public.stats where user_id=$1', [A])).rows.length, 0);
    assert.equal((await db.query('update public.stats set play_seconds=99 where user_id=$1 returning *', [A])).rows.length, 0);
    await db.query('insert into public.stats(user_id,play_seconds) values ($1,40)', [B]);
    const b = await merge(w1, 3);
    assert.equal(b.user_id, B); assert.equal(b.play_seconds, 43); assert.deepEqual(b.collections, {});
    console.log('  ✓ invoker RLS / A cannot read or update B / RPC binds auth.uid()');
    await db.exec('reset role;');
    const security = (await db.query("select prosecdef from pg_proc where proname='merge_stats'")).rows[0];
    assert.equal(security.prosecdef, false);
    await db.exec(migration);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${A}';`);
    assert.equal((await merge(w1, 12)).play_seconds, 20);
    await db.exec("set request.jwt.claim.sub = ''; ");
    await assert.rejects(merge(w1, 1));
    await db.exec('reset role; set role anon;');
    await assert.rejects(merge(w1, 1));
    console.log('  ✓ migration rerun preserves totals / no elevated privileges / anon denied');
    await db.exec('reset role;');
    await db.query('delete from auth.users where id=$1', [A]);
    assert.equal((await db.query('select * from public.stats where user_id=$1', [A])).rows.length, 0);
    console.log('  ✓ account deletion cascades to statistics');
    console.log('全部通过：6 组 PostgreSQL 检查');
  } finally { await db.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
