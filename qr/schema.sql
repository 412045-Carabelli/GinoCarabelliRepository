-- =============================================================================
-- QRs dinámicos con activación — esquema para Supabase (Postgres)
-- Correr completo en: Supabase Studio > SQL Editor. Es idempotente (se puede
-- volver a correr; no borra datos).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Helpers internos (no expuestos a anon)
-- -----------------------------------------------------------------------------

-- Solo http/https, con host, sin espacios ni caracteres de control, <= 2048.
-- Esto descarta javascript:, data:, file:, etc.
create or replace function public._url_valida(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    length(p_url) <= 2048
    and p_url ~* '^https?://[^[:space:][:cntrl:]/?#]+([/?#][^[:space:][:cntrl:]]*)?$',
    false
  );
$$;

-- Normaliza el código de activación: sin guiones/espacios, en mayúsculas.
create or replace function public._hash_activacion(p_activacion text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      upper(regexp_replace(coalesce(p_activacion, ''), '[^A-Za-z0-9]', '', 'g')),
      'sha256'
    ),
    'hex'
  );
$$;

-- -----------------------------------------------------------------------------
-- Tabla
-- -----------------------------------------------------------------------------
create table if not exists public.qrs (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique
                       check (codigo ~ '^[A-Z0-9]{6,16}$'),   -- el que va en el QR
  activacion_hash    text not null,                            -- sha256 (hex) del código de activación
  url_destino        text
                       check (url_destino is null or public._url_valida(url_destino)),
  activo             boolean not null default false,           -- true una vez activado
  habilitado         boolean not null default true,            -- false = desactivado remotamente
  escaneos           integer not null default 0,
  intentos_fallidos  integer not null default 0,               -- rate limit por código
  bloqueado_hasta    timestamptz,
  creado_en          timestamptz not null default now(),
  activado_en        timestamptz,
  ultimo_escaneo_en  timestamptz,
  lote               text
);

create index if not exists qrs_lote_idx on public.qrs (lote);

-- -----------------------------------------------------------------------------
-- Seguridad: RLS activado y sin acceso directo para anon/authenticated.
-- (service_role y el owner de las funciones ignoran RLS.)
-- -----------------------------------------------------------------------------
alter table public.qrs enable row level security;
revoke all on table public.qrs from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- resolver_qr(p_codigo) -> { estado, url_destino }
-- estado: no_existe | sin_activar | deshabilitado | ok
-- Si es ok, cuenta el escaneo.
-- -----------------------------------------------------------------------------
create or replace function public.resolver_qr(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_codigo text := upper(coalesce(p_codigo, ''));
  v_url    text;
  v_activo boolean;
  v_hab    boolean;
begin
  if v_codigo !~ '^[A-Z0-9]{6,16}$' then
    return jsonb_build_object('estado', 'no_existe', 'url_destino', null);
  end if;

  select url_destino, activo, habilitado
    into v_url, v_activo, v_hab
    from public.qrs
   where codigo = v_codigo;

  if not found then
    return jsonb_build_object('estado', 'no_existe', 'url_destino', null);
  elsif not v_hab then
    return jsonb_build_object('estado', 'deshabilitado', 'url_destino', null);
  elsif not v_activo or v_url is null then
    return jsonb_build_object('estado', 'sin_activar', 'url_destino', null);
  end if;

  update public.qrs
     set escaneos = escaneos + 1,
         ultimo_escaneo_en = now()
   where codigo = v_codigo;

  return jsonb_build_object('estado', 'ok', 'url_destino', v_url);
end;
$$;

-- -----------------------------------------------------------------------------
-- _guardar_url: lógica común de activar_qr / editar_qr.
-- Siempre devuelve {ok: true|false} sin distinguir la causa del fallo.
-- Rate limit por código: 5 intentos fallidos => bloqueo de 15 minutos.
-- (Devuelve en lugar de lanzar excepción para que el contador se persista.)
-- -----------------------------------------------------------------------------
create or replace function public._guardar_url(
  p_codigo     text,
  p_activacion text,
  p_url        text,
  p_modo       text   -- 'activar' | 'editar'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_max_intentos constant int := 5;
  c_bloqueo      constant interval := interval '15 minutes';
  v_codigo text := upper(coalesce(p_codigo, ''));
  v_fallo  constant jsonb := jsonb_build_object('ok', false);
  v_q      public.qrs;
begin
  if v_codigo !~ '^[A-Z0-9]{6,16}$'
     or length(coalesce(p_activacion, '')) > 64
     or not public._url_valida(p_url) then
    return v_fallo;
  end if;

  select * into v_q from public.qrs where codigo = v_codigo for update;

  if not found
     or not v_q.habilitado
     or (p_modo = 'activar' and v_q.activo)
     or (p_modo = 'editar' and not v_q.activo)
     or (v_q.bloqueado_hasta is not null and v_q.bloqueado_hasta > now()) then
    return v_fallo;
  end if;

  if v_q.activacion_hash <> public._hash_activacion(p_activacion) then
    update public.qrs
       set intentos_fallidos = case when intentos_fallidos + 1 >= c_max_intentos
                                    then 0 else intentos_fallidos + 1 end,
           bloqueado_hasta   = case when intentos_fallidos + 1 >= c_max_intentos
                                    then now() + c_bloqueo else bloqueado_hasta end
     where id = v_q.id;
    return v_fallo;
  end if;

  update public.qrs
     set url_destino       = p_url,
         activo            = true,
         activado_en       = case when p_modo = 'activar' then now() else activado_en end,
         intentos_fallidos = 0,
         bloqueado_hasta   = null
   where id = v_q.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.activar_qr(p_codigo text, p_activacion text, p_url text)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select public._guardar_url(p_codigo, p_activacion, p_url, 'activar');
$$;

create or replace function public.editar_qr(p_codigo text, p_activacion text, p_url text)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select public._guardar_url(p_codigo, p_activacion, p_url, 'editar');
$$;

-- -----------------------------------------------------------------------------
-- Permisos de las funciones: por defecto Postgres da EXECUTE a PUBLIC (y
-- Supabase además a anon/authenticated). Se cierra todo y se abren solo las tres.
-- -----------------------------------------------------------------------------
revoke all on function public._url_valida(text)                     from public, anon, authenticated;
revoke all on function public._hash_activacion(text)                from public, anon, authenticated;
revoke all on function public._guardar_url(text, text, text, text)  from public, anon, authenticated;
revoke all on function public.resolver_qr(text)                     from public, anon, authenticated;
revoke all on function public.activar_qr(text, text, text)          from public, anon, authenticated;
revoke all on function public.editar_qr(text, text, text)           from public, anon, authenticated;

grant execute on function public.resolver_qr(text)            to anon;
grant execute on function public.activar_qr(text, text, text) to anon;
grant execute on function public.editar_qr(text, text, text)  to anon;
