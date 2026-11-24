-- Stage 2 Migration: Room Cast PIN (auto-rotates on check-out/check-in),
-- Hotel Settings, and Safe PIN Verification RPCs.
-- Safe to run multiple times (idempotent).

create extension if not exists pgcrypto with schema extensions;

-- 1. Extend public.guests with cast_pin, preferred_lang, and timestamps
alter table public.guests
  add column if not exists cast_pin text not null default lpad((floor(random() * 9000 + 1000))::int::text, 4, '0'),
  add column if not exists preferred_lang text not null default 'ar',
  add column if not exists checked_in_at timestamptz null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.guests
  drop constraint if exists guests_preferred_lang_check;
alter table public.guests
  add constraint guests_preferred_lang_check check (preferred_lang in ('ar', 'en'));

-- Helper to generate a 4-digit PIN different from previous PIN
create or replace function public.generate_new_room_pin(p_old_pin text default null)
returns text
language plpgsql
as $$
declare
  v_pin text;
begin
  loop
    v_pin := lpad((floor(random() * 9000 + 1000))::int::text, 4, '0');
    exit when p_old_pin is null or v_pin <> p_old_pin;
  end loop;
  return v_pin;
end;
$$;

-- Trigger: automatically rotate cast_pin whenever guest changes or checks out (full_name -> '')
create or replace function public.guests_auto_rotate_pin_fn()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if (coalesce(new.full_name, '') is distinct from coalesce(old.full_name, ''))
     and (new.cast_pin is not distinct from old.cast_pin) then
    new.cast_pin := public.generate_new_room_pin(old.cast_pin);
    if coalesce(trim(new.full_name), '') <> '' then
      new.checked_in_at := now();
    else
      new.checked_in_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guests_auto_rotate_pin on public.guests;
create trigger trg_guests_auto_rotate_pin
before update on public.guests
for each row
execute function public.guests_auto_rotate_pin_fn();

-- RPC: Explicit Check-out / Rotate PIN for a room (clears guest name & generates fresh PIN)
create or replace function public.checkout_room_and_rotate_pin(p_room text)
returns table (room_number text, cast_pin text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_pin text;
begin
  select public.generate_new_room_pin(g.cast_pin)
    into v_new_pin
  from public.guests g
  where g.room_number = p_room;

  if v_new_pin is null then
    v_new_pin := public.generate_new_room_pin(null);
    insert into public.guests (room_number, full_name, cast_pin, checked_in_at, updated_at)
    values (p_room, '', v_new_pin, null, now());
  else
    update public.guests
       set full_name = '',
           cast_pin = v_new_pin,
           preferred_lang = 'ar',
           checked_in_at = null,
           updated_at = now()
     where guests.room_number = p_room;
  end if;

  return query select p_room, v_new_pin;
end;
$$;

grant execute on function public.checkout_room_and_rotate_pin(text) to anon, authenticated;

-- RPC: Verify room PIN for mobile guest portal (?guest=1&room=...&pin=...)
create or replace function public.verify_room_pin(p_room text, p_pin text)
returns table (valid boolean, room_number text, full_name text, preferred_lang text)
language sql
security definer
set search_path = public
as $$
  select
    (g.cast_pin = trim(coalesce(p_pin, ''))) as valid,
    g.room_number,
    g.full_name,
    g.preferred_lang
  from public.guests g
  where g.room_number = trim(coalesce(p_room, ''))
  limit 1;
$$;

grant execute on function public.verify_room_pin(text, text) to anon, authenticated;

-- 2. Hotel settings table (Wi-Fi, Reception ext, Breakfast, Checkout)
create table if not exists public.hotel_settings (
  id integer primary key default 1 check (id = 1),
  wifi_name text not null default 'Masaken_Guest',
  wifi_pass text not null default 'Masaken@2026',
  reception_ext text not null default '0 / 100',
  breakfast_hours text not null default '07:00 - 10:30',
  checkout_time text not null default '14:00',
  updated_at timestamptz not null default now()
);

insert into public.hotel_settings (id) values (1) on conflict (id) do nothing;

grant select on table public.hotel_settings to anon, authenticated;
alter table public.hotel_settings enable row level security;

drop policy if exists "allow_read_hotel_settings" on public.hotel_settings;
create policy "allow_read_hotel_settings"
on public.hotel_settings
for select
to anon, authenticated
using (true);

-- 3. Speed up room-specific request history lookups
create index if not exists tv_requests_room_created_idx
on public.tv_requests (room_number, created_at desc);

