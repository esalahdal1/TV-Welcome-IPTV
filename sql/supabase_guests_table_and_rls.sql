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

