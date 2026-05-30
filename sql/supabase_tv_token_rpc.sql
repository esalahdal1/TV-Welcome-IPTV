create extension if not exists pgcrypto;

create table if not exists public.tv_welcome (
  room_number text primary key,
  welcome_text text not null
);

create table if not exists public.tv_tokens (
  room_number text primary key references public.tv_welcome(room_number) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  active boolean not null default true
);

alter table public.tv_welcome enable row level security;
alter table public.tv_tokens enable row level security;

revoke all on table public.tv_tokens from anon, authenticated;

create or replace function public.get_tv_welcome(p_room text, p_token text)
returns table (room_number text, welcome_text text)
language sql
security definer
set search_path = public, extensions
as $$
  select w.room_number, w.welcome_text
  from public.tv_welcome w
  join public.tv_tokens t on t.room_number = w.room_number
  where w.room_number = p_room
    and t.active = true
    and t.token_hash = encode(
      extensions.digest(convert_to(p_token, 'utf8'), 'sha256'::text),
      'hex'
    );
$$;

grant execute on function public.get_tv_welcome(text, text) to anon, authenticated;

