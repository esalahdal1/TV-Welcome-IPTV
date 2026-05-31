create table if not exists public.guests (
  room_number text primary key,
  full_name text not null
);

grant select on table public.guests to anon, authenticated;

alter table public.guests enable row level security;

drop policy if exists "allow_read_guests" on public.guests;
create policy "allow_read_guests"
on public.guests
for select
to anon, authenticated
using (true);

create table if not exists public.tv_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  room_number text not null,
  request_type text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint tv_requests_status_check check (status in ('pending','done'))
);

create index if not exists tv_requests_status_created_at_idx
on public.tv_requests (status, created_at desc);

grant select, insert, update on table public.tv_requests to anon, authenticated;

alter table public.tv_requests enable row level security;

drop policy if exists "allow_read_requests" on public.tv_requests;
create policy "allow_read_requests"
on public.tv_requests
for select
to anon, authenticated
using (true);

drop policy if exists "allow_insert_requests" on public.tv_requests;
create policy "allow_insert_requests"
on public.tv_requests
for insert
to anon, authenticated
with check (true);

drop policy if exists "allow_update_requests" on public.tv_requests;
create policy "allow_update_requests"
on public.tv_requests
for update
to anon, authenticated
using (true)
with check (true);
