-- Stage 3 Migration: Staff Console Security (Server-Side PIN Verification RPCs)
-- + Tightened RLS for Guests, Notifications, Requests, and Hotel Settings.
-- Depends on: sql/supabase_guests_table_and_rls.sql & sql/supabase_stage2_room_pin_and_requests.sql
-- Safe to run multiple times (idempotent).

create extension if not exists pgcrypto with schema extensions;

-- 1. Staff PIN store (never exposed directly to anon/authenticated)
create table if not exists public.staff_auth (
  id integer primary key default 1 check (id = 1),
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

-- Default staff PIN is '1234' (SHA-256 hex). Change via staff_change_pin RPC from Settings tab.
insert into public.staff_auth (id, pin_hash)
values (
  1,
  encode(extensions.digest(convert_to('1234', 'utf8'), 'sha256'::text), 'hex')
)
on conflict (id) do nothing;

alter table public.staff_auth enable row level security;
revoke all on table public.staff_auth from anon, authenticated;

-- Helper: verify staff PIN (internal)
create or replace function public._is_valid_staff_pin(p_pin text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.staff_auth a
    where a.id = 1
      and a.pin_hash = encode(
        extensions.digest(convert_to(trim(coalesce(p_pin, '')), 'utf8'), 'sha256'::text),
        'hex'
      )
  );
$$;

-- Public RPC: Check staff login PIN
create or replace function public.staff_login(p_pin text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select public._is_valid_staff_pin(p_pin);
$$;
grant execute on function public.staff_login(text) to anon, authenticated;

-- Public RPC: Change staff PIN
create or replace function public.staff_change_pin(p_old_pin text, p_new_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clean text := trim(coalesce(p_new_pin, ''));
begin
  if not public._is_valid_staff_pin(p_old_pin) then
    raise exception 'INVALID_STAFF_PIN';
  end if;
  if length(v_clean) < 4 then
    raise exception 'PIN_TOO_SHORT';
  end if;
  update public.staff_auth
     set pin_hash = encode(extensions.digest(convert_to(v_clean, 'utf8'), 'sha256'::text), 'hex'),
         updated_at = now()
   where id = 1;
  return true;
end;
$$;
grant execute on function public.staff_change_pin(text, text) to anon, authenticated;

-- Public RPC: List rooms & pins (for Staff Console only)
create or replace function public.staff_list_guests(p_pin text)
returns table (
  room_number text,
  full_name text,
  cast_pin text,
  preferred_lang text,
  checked_in_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_valid_staff_pin(p_pin) then
    raise exception 'INVALID_STAFF_PIN';
  end if;
  return query
  select g.room_number, g.full_name, g.cast_pin, g.preferred_lang, g.checked_in_at, g.updated_at
  from public.guests g
  order by g.room_number asc;
end;
$$;
grant execute on function public.staff_list_guests(text) to anon, authenticated;

-- Public RPC: Check-in or update room guest (rotates cast_pin when guest changes)
create or replace function public.staff_checkin_guest(
  p_pin text,
  p_room text,
  p_full_name text,
  p_lang text default 'ar'
)
returns table (room_number text, full_name text, cast_pin text, preferred_lang text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room text := trim(coalesce(p_room, ''));
  v_name text := trim(coalesce(p_full_name, ''));
  v_lang text := case when lower(trim(coalesce(p_lang, 'ar'))) = 'en' then 'en' else 'ar' end;
  v_old_pin text;
  v_new_pin text;
begin
  if not public._is_valid_staff_pin(p_pin) then
    raise exception 'INVALID_STAFF_PIN';
  end if;
  if v_room = '' then
    raise exception 'ROOM_REQUIRED';
  end if;

  select g.cast_pin into v_old_pin from public.guests g where g.room_number = v_room;
  v_new_pin := public.generate_new_room_pin(v_old_pin);

  insert into public.guests (room_number, full_name, cast_pin, preferred_lang, checked_in_at, updated_at)
  values (v_room, v_name, v_new_pin, v_lang, case when v_name <> '' then now() else null end, now())
  on conflict (room_number) do update
    set full_name = excluded.full_name,
        cast_pin = v_new_pin,
        preferred_lang = excluded.preferred_lang,
        checked_in_at = case when excluded.full_name <> '' then now() else null end,
        updated_at = now();

  return query
  select g.room_number, g.full_name, g.cast_pin, g.preferred_lang
  from public.guests g
  where g.room_number = v_room;
end;
$$;
grant execute on function public.staff_checkin_guest(text, text, text, text) to anon, authenticated;

-- Public RPC: Check-out room guest (clears name & rotates cast_pin)
create or replace function public.staff_checkout_guest(p_pin text, p_room text)
returns table (room_number text, cast_pin text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room text := trim(coalesce(p_room, ''));
begin
  if not public._is_valid_staff_pin(p_pin) then
    raise exception 'INVALID_STAFF_PIN';
  end if;
  if v_room = '' then
    raise exception 'ROOM_REQUIRED';
  end if;
  return query select * from public.checkout_room_and_rotate_pin(v_room);
end;
$$;
grant execute on function public.staff_checkout_guest(text, text) to anon, authenticated;

-- Public RPC: Send notification from staff console
create or replace function public.staff_send_notification(p_pin text, p_room text, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_room text := nullif(trim(coalesce(p_room, '')), '');
  v_msg text := trim(coalesce(p_message, ''));
begin
  if not public._is_valid_staff_pin(p_pin) then
    raise exception 'INVALID_STAFF_PIN';
  end if;
  if v_msg = '' then
    raise exception 'MESSAGE_REQUIRED';
  end if;
  insert into public.tv_notifications (room_number, message)
  values (v_room, v_msg)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.staff_send_notification(text, text, text) to anon, authenticated;

-- Public RPC: List recent notifications (Staff Console)
create or replace function public.staff_list_notifications(p_pin text)
returns table (id uuid, room_number text, message text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_valid_staff_pin(p_pin) then
    raise exception 'INVALID_STAFF_PIN';
  end if;
  return query
  select n.id, n.room_number, n.message, n.created_at
  from public.tv_notifications n
  order by n.created_at desc
  limit 20;
end;
$$;
grant execute on function public.staff_list_notifications(text) to anon, authenticated;

-- Public RPC: Mark guest request done
create or replace function public.staff_complete_request(p_pin text, p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_valid_staff_pin(p_pin) then
    raise exception 'INVALID_STAFF_PIN';
  end if;
  update public.tv_requests
     set status = 'done',
         completed_at = now()
   where id = p_request_id;
  return found;
end;
$$;
grant execute on function public.staff_complete_request(text, uuid) to anon, authenticated;

-- Public RPC: Update Hotel Settings
create or replace function public.staff_update_hotel_settings(
  p_pin text,
  p_wifi_name text,
  p_wifi_pass text,
  p_reception_ext text,
  p_breakfast_hours text,
  p_checkout_time text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_valid_staff_pin(p_pin) then
    raise exception 'INVALID_STAFF_PIN';
  end if;
  insert into public.hotel_settings (id, wifi_name, wifi_pass, reception_ext, breakfast_hours, checkout_time, updated_at)
  values (1, p_wifi_name, p_wifi_pass, p_reception_ext, p_breakfast_hours, p_checkout_time, now())
  on conflict (id) do update
    set wifi_name = excluded.wifi_name,
        wifi_pass = excluded.wifi_pass,
        reception_ext = excluded.reception_ext,
        breakfast_hours = excluded.breakfast_hours,
        checkout_time = excluded.checkout_time,
        updated_at = now();
  return true;
end;
$$;
grant execute on function public.staff_update_hotel_settings(text, text, text, text, text, text) to anon, authenticated;

-- 2. Tighten RLS Policies so anonymous guests cannot forge staff writes
-- (Note: TVs and mobile portals still retain SELECT on guests/tv_notifications/hotel_settings
--  and SELECT+INSERT on tv_requests as required by the TV app & WebView.)

-- tv_notifications: disallow anonymous INSERT/UPDATE/DELETE (must use staff_send_notification RPC)
drop policy if exists tv_notifications_insert on public.tv_notifications;
revoke insert, update, delete on table public.tv_notifications from anon, authenticated;

-- tv_requests: disallow anonymous UPDATE/DELETE (must use staff_complete_request RPC)
drop policy if exists "allow_update_requests" on public.tv_requests;
revoke update, delete on table public.tv_requests from anon, authenticated;

-- guests: disallow anonymous INSERT/UPDATE/DELETE (must use staff_checkin_guest / staff_checkout_guest)
revoke insert, update, delete on table public.guests from anon, authenticated;

-- hotel_settings: disallow anonymous INSERT/UPDATE/DELETE (must use staff_update_hotel_settings)
revoke insert, update, delete on table public.hotel_settings from anon, authenticated;

