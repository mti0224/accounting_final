-- 在 Supabase Dashboard > SQL Editor 執行一次。
-- GitHub Pages 僅提供靜態前端；本 schema 支援真實帳號核准、登入次數與成績記錄。
-- 禁止將 service_role key 放入 GitHub Pages。
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null,
  role text not null default 'student' check (role in ('student','admin')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  login_count integer not null default 0 check (login_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null default 'exam' check (mode in ('exam','practice')),
  score integer not null check (score between 0 and 1000),
  passed boolean not null,
  answered integer not null,
  total integer not null check (total > 0),
  details jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint results_answered_range check (answered between 0 and total)
);

alter table public.results add column if not exists mode text not null default 'exam' check (mode in ('exam','practice'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 將已註冊但尚未寫入 profiles 的帳號補齊（不改變既有核准結果）。
insert into public.profiles(id, email, name)
select id, email, coalesce(raw_user_meta_data ->> 'name','')
from auth.users
on conflict(id) do nothing;

-- SECURITY DEFINER 避免 RLS 遞迴；函式不接受自訂使用者 ID。
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and status = 'approved'
  );
$$;

create or replace function public.record_login()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles
  set login_count = login_count + 1
  where id = auth.uid() and status = 'approved';
  if not found then
    raise exception 'Account is not approved';
  end if;
end;
$$;

create or replace function public.set_student_status(target_user uuid, next_status text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin permission required';
  end if;
  if next_status not in ('approved','rejected') then
    raise exception 'Invalid status';
  end if;
  update public.profiles set status = next_status
  where id = target_user and role = 'student';
  if not found then
    raise exception 'Student account not found';
  end if;
end;
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.record_login() from public;
revoke all on function public.set_student_status(uuid,text) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.record_login() to authenticated;
grant execute on function public.set_student_status(uuid,text) to authenticated;

alter table public.profiles enable row level security;
alter table public.results enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));

-- 普通使用者不能改動自己的 role/status/login_count，審核透過受保護的 RPC。
drop policy if exists results_read on public.results;
create policy results_read on public.results
for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists results_insert on public.results;
create policy results_insert on public.results
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'approved'
  )
);

create index if not exists results_user_date_idx on public.results(user_id, created_at desc);

-- 首位管理員須自行到 Authentication > Users 建立並驗證帳號，
-- 再在 SQL Editor 執行以下 SQL（取消註解）：
-- update public.profiles
-- set role = 'admin', status = 'approved'
-- where email = 'admin@powerbi.com.tw';
-- 管理員密碼只在 Supabase Auth 設定，請勿硬編碼到前端或公開 GitHub。
