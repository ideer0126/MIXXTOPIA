-- MIXXTOPIA · 云存档后端初始化
-- Issue #42（父任务 #22）；规格见 docs/ACCOUNT_SYSTEM.md §8、docs/GAME_DESIGN.md §10
--
-- 目标：三张表（profiles / saves / stats）+ RLS + 注册自动建档触发器。
-- 特性：幂等——可在 Supabase SQL Editor 反复执行，不会报「已存在」。
--
-- 安全模型（A2：前端手写 fetch 直连，不引 SDK）：
--   1. anon key（新界面叫 publishable key，`sb_publishable_...`）是公开的，
--      会写进 js/cloud-config.js 并提交到仓库，它本身不构成权限；
--   2. 真正的边界是 RLS：三表全部 enable，策略只授给 authenticated 且限定
--      auth.uid() = 本人，anon 既无策略也无表权限；
--   3. service_role / `sb_secret_...` 绝不能进前端（绕过全部 RLS）。
--
-- 存档位 `data` 与 GAME_DESIGN.md §10 的存档位结构同构（去掉 slot 与 updatedAt；
-- updatedAt 由本表 updated_at 列承担）。上传时不要把 updatedAt 写进 data；
-- 下载时须先把 updated_at 转成本地毫秒时间戳写入 updatedAt，再调用
-- SaveStore.writeSlot()——normalizeSlot() 不会从 updated_at 补齐该字段。
-- 本地存档位不保存 version；逐档同步基线见 mixxtopia.cloud.v1（§9）。
-- 除时间字段外，双向直传、不做字段映射。

-- 注意：脚本里**不写** begin/commit。
--   - `supabase db push` / CLI 会对每个迁移文件自动包一层事务；
--   - Supabase SQL Editor 自己也会开事务，脚本里再写 begin/commit 会报
--     「there is already a transaction in progress」并整体回滚（踩过一次）。
--   幂等性由 `if not exists` / `drop ... if exists` 保证，重复执行安全。

-- ---------------------------------------------------------------------------
-- 1) 账户资料：一行一个账号，由注册触发器自动创建（客户端没有 insert 权限）
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nickname   text
             check (nickname is null or char_length(nickname) between 1 and 16),
  avatar     text not null default 'muse-1',
  prefs      jsonb not null default '{"sound": true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 头像只约束「形状」，不约束「集合」：
--   集合会随美术扩展（六位缪斯 × 各关妆造、玩家形象、黑羊彩蛋…，#13 未开始），
--   写死在 CHECK 里等于以后每加一个头像都要迁移。白名单放前端（js/data.js 的
--   GAME.avatarPresets，见 #44），DB 只挡非法字符与超长，渲染时未知 id 回退默认头像。
--   用 drop-if-exists + add 保证对新库、旧库、重复执行都成立。
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check
  check (avatar ~ '^[a-z0-9][a-z0-9-]{0,31}$');

-- ---------------------------------------------------------------------------
-- 2) 云存档：一账号最多 3 档，一档一行；version 做乐观锁
--    本地存档位不保存 version；逐档同步基线存 mixxtopia.cloud.v1
--    （version / localUpdatedAt / cloudUpdatedAt，见 ACCOUNT_SYSTEM.md §9）。
--    写入约定（#45）：
--      insert 首档：POST /rest/v1/saves
--                  Prefer: return=representation
--                  body { user_id, slot, version: 1, data }
--      覆盖已有档：PATCH /rest/v1/saves?user_id=eq.<uid>&slot=eq.<1-3>&version=eq.<基线 version>
--                  Prefer: return=representation
--                  body { version: 期望值 + 1, data }
--                  （无基线时先 GET 当前 version；updated_at 由触发器维护，无需传）
--      返回数组长度 1 = 更新成功；0 = 版本冲突（HTTP 仍可能是 200）。
--      返回行含 version / updated_at，写回 mixxtopia.cloud.v1 的该档基线。
--      冲突时重新拉取云端元数据，让玩家逐档选择（见 ACCOUNT_SYSTEM.md §9）。
-- ---------------------------------------------------------------------------
create table if not exists public.saves (
  user_id    uuid not null references auth.users (id) on delete cascade,
  slot       smallint not null check (slot between 1 and 3),
  version    integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  data       jsonb not null,
  primary key (user_id, slot)
);

-- ---------------------------------------------------------------------------
-- 3) 统计：游玩时长 / 成就 / 收集率（#46 写入，可后置）
-- ---------------------------------------------------------------------------
create table if not exists public.stats (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  play_seconds bigint not null default 0 check (play_seconds >= 0),
  achievements jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4) updated_at 自动维护
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists saves_touch_updated_at on public.saves;
create trigger saves_touch_updated_at
  before update on public.saves
  for each row execute function public.touch_updated_at();

drop trigger if exists stats_touch_updated_at on public.stats;
create trigger stats_touch_updated_at
  before update on public.stats
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5) 注册即建档：auth.users 插入后自动补一行 profiles
--    security definer 让函数以创建者身份写入，客户端因此不需要 profiles 的 insert 权限
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, 'NSWER')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 6) RLS：全部开启，策略只给 authenticated 且限本人
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.saves    enable row level security;
alter table public.stats    enable row level security;

-- profiles：读自己 + 改自己；不开放 insert（由触发器建档）/ delete（随 auth.users 级联）
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- saves：本人 4 类操作全开（删档要走 delete，见 #8 的删除存档）
drop policy if exists saves_own on public.saves;
create policy saves_own on public.saves
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- stats：同上
drop policy if exists stats_own on public.stats;
create policy stats_own on public.stats
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7) 表权限：只给 authenticated 且只给需要的动作
--    Supabase 对 public schema 有默认授权（anon/authenticated/service_role），
--    这里先全部收回再精确授出——RLS 之外的第二道锁，anon 连表都不该看得见。
-- ---------------------------------------------------------------------------
revoke all on public.profiles from anon, authenticated, public;
revoke all on public.saves    from anon, authenticated, public;
revoke all on public.stats    from anon, authenticated, public;

grant select, update                 on public.profiles to authenticated;
grant select, insert, update, delete on public.saves    to authenticated;
grant select, insert, update         on public.stats    to authenticated;

-- 让 PostgREST 立刻刷新 schema cache（有些环境不会自动推送；这条没副作用）
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 自检（建完后手动跑一遍，期望结果写在注释里）
-- ---------------------------------------------------------------------------
-- 1) RLS 已开：
--    select relname, relrowsecurity from pg_class
--     where relname in ('profiles','saves','stats');
--    期望：三行 relrowsecurity = true
--
-- 2) 策略齐全（4 条：profiles 2 + saves 1 + stats 1）：
--    select tablename, policyname, roles, cmd from pg_policies
--     where schemaname = 'public' order by tablename;
--
-- 3) anon 无表权限（期望 0 行）：
--    select table_name, privilege_type from information_schema.role_table_grants
--     where grantee = 'anon' and table_schema = 'public';
--
-- 4) 越权用例（在 REST 层验证，需要两个真实账号的 access_token）：
--    curl "$BASE/rest/v1/saves?select=slot" -H "apikey: $PUBLISHABLE"
--    → 未登录应返回 [] 或 401，绝不返回他人数据
