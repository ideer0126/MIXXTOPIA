-- #46: monotonic per-writer counters make retries and concurrent devices idempotent.
-- Run after 0001_init.sql. Invoker rights retain the existing own-user RLS boundary.
alter table public.stats add column if not exists device_millis jsonb not null default '{}'::jsonb;
alter table public.stats add column if not exists remainder_ms integer not null default 0 check (remainder_ms between 0 and 999);
alter table public.stats add column if not exists collections jsonb not null default '{}'::jsonb;

create or replace function public.merge_stats(p_writer text, p_millis bigint, p_achievements jsonb)
returns setof public.stats
language plpgsql security invoker set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  collected jsonb;
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_writer is null or p_writer !~ '^[a-f0-9]{32}$'
    or p_millis is null or p_millis < 0 or p_millis > 3153600000000
    or p_achievements is null or jsonb_typeof(p_achievements) <> 'array' then
    raise exception 'Invalid statistics' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_achievements) a(id)
    where id is null or id not in ('first_star', 'first_clear', 'wish_keeper', 'journey_complete')) then
    raise exception 'Unknown achievement' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(distinct id order by id), '[]'::jsonb) into p_achievements
    from jsonb_array_elements(p_achievements) a(id);

  -- A star is counted once per level across all three canonical cloud saves.
  -- Store IDs, not percentages: future maps supply the denominator in the client.
  select coalesce(jsonb_object_agg(level_id, ids), '{}'::jsonb) into collected
  from (
    select level_id, jsonb_agg(distinct star_id order by star_id) as ids
    from public.saves s
    cross join lateral jsonb_each(case when jsonb_typeof(s.data->'stars') = 'object'
      and s.data->>'v' = '1' then s.data->'stars' else '{}'::jsonb end) l(level_id, stars)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(stars) = 'array'
      then stars else '[]'::jsonb end) a(star_id)
    where s.user_id = owner_id and level_id ~ '^[0-9]+$' and jsonb_typeof(star_id) = 'string'
    group by level_id
  ) levels;

  return query
  insert into public.stats as target (user_id, play_seconds, remainder_ms, achievements, device_millis, collections)
  values (owner_id, p_millis / 1000, p_millis % 1000, p_achievements, jsonb_build_object(p_writer, p_millis), collected)
  on conflict (user_id) do update set
    play_seconds = target.play_seconds + (target.remainder_ms + greatest(0,
      p_millis - coalesce((target.device_millis->>p_writer)::bigint, 0))) / 1000,
    remainder_ms = (target.remainder_ms + greatest(0,
      p_millis - coalesce((target.device_millis->>p_writer)::bigint, 0))) % 1000,
    device_millis = target.device_millis || jsonb_build_object(p_writer,
      greatest(p_millis, coalesce((target.device_millis->>p_writer)::bigint, 0))),
    achievements = (select coalesce(jsonb_agg(distinct id order by id), '[]'::jsonb)
      from jsonb_array_elements(target.achievements || p_achievements) a(id)),
    collections = collected
  returning target.*;
end;
$$;

revoke all on function public.merge_stats(text, bigint, jsonb) from public, anon;
grant execute on function public.merge_stats(text, bigint, jsonb) to authenticated;
notify pgrst, 'reload schema';
