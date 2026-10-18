-- =====================================================================
-- 02-usuarios.sql
-- Integração de Acessos: Check-in de Eventos + Portal Geral HbOne
-- Projeto Supabase: hb-sistemas (São Paulo)
--
-- O que este script faz:
-- 1. Garante o acesso do Hudson (hudson@hbone.com.br) como admin do Check-in.
-- 2. Atualiza o catálogo do Portal Geral com o link oficial checkin.hbone.com.br.
-- 3. Conecta a gestão de usuários do Portal: quem for marcado com a caixinha
--    "Check-in de Eventos" (ou for Admin Geral) ganha acesso imediato.
-- =====================================================================

-- 1. Libera o Hudson imediatamente
insert into checkin.admins (user_id, nome)
select id, 'Hudson'
  from auth.users where email = 'hudson@hbone.com.br'
on conflict (user_id) do update set nome = excluded.nome;

-- 2. Atualiza o catálogo do Portal Geral
create schema if not exists portal;
create table if not exists portal.sistemas (
  codigo text primary key,
  nome text not null,
  descricao text,
  url text not null,
  ordem int not null default 0,
  ativo boolean not null default true
);
create table if not exists portal.usuarios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null unique,
  admin_geral boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create table if not exists portal.permissoes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sistema text not null,
  papel text not null default 'consulta',
  criado_em timestamptz not null default now(),
  unique(user_id, sistema)
);

insert into portal.sistemas (codigo, nome, descricao, url, ordem, ativo)
values (
  'checkin',
  'Check-in de Eventos',
  'Criação e gestão de eventos, listas de convidados, totens e certificados.',
  'https://checkin.hbone.com.br',
  4,
  true
)
on conflict (codigo) do update set
  nome = excluded.nome,
  descricao = excluded.descricao,
  url = excluded.url,
  ordem = excluded.ordem,
  ativo = excluded.ativo;

-- 3. Atualiza a função de sincronização do Portal para incluir o checkin
create or replace function portal.sincronizar_perfis(p_user_id uuid, p_sistema text, p_papel text, p_conceder boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
begin
  select nome into v_nome from portal.usuarios where user_id = p_user_id;
  if v_nome is null then
    v_nome := 'Usuário';
  end if;

  -- Sincroniza Contratos (se a tabela existir)
  if p_sistema = 'contratos' then
    if p_conceder then
      begin
        insert into contratos.perfis (user_id, papel, nome)
        values (p_user_id, case when p_papel = 'admin' then 'admin' else 'consulta' end, v_nome)
        on conflict (user_id) do update set papel = excluded.papel, nome = excluded.nome;
      exception when undefined_table then null;
      end;
    else
      begin
        delete from contratos.perfis where user_id = p_user_id;
      exception when undefined_table then null;
      end;
    end if;
  end if;

  -- Sincroniza Viabilidade (se a tabela existir)
  if p_sistema = 'viabilidade' then
    if p_conceder then
      begin
        insert into viabilidade.perfis (user_id, papel, nome)
        values (p_user_id, case when p_papel = 'admin' then 'admin' else 'consulta' end, v_nome)
        on conflict (user_id) do update set papel = excluded.papel, nome = excluded.nome;
      exception when undefined_table then null;
      end;
    else
      begin
        delete from viabilidade.perfis where user_id = p_user_id;
      exception when undefined_table then null;
      end;
    end if;
  end if;

  -- Sincroniza Check-in de Eventos
  if p_sistema = 'checkin' then
    if p_conceder then
      begin
        insert into checkin.admins (user_id, nome)
        values (p_user_id, v_nome)
        on conflict (user_id) do update set nome = excluded.nome;
      exception when undefined_table then null;
      end;
    else
      begin
        delete from checkin.admins where user_id = p_user_id;
      exception when undefined_table then null;
      end;
    end if;
  end if;
end $$;

-- 4. Atualiza aplicar_acessos para incluir 'checkin'
create or replace function portal.aplicar_acessos(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
  v_ativo boolean;
  v_sis   text;
begin
  select admin_geral, ativo into v_admin, v_ativo
    from portal.usuarios where user_id = p_user_id;

  if v_admin is null then
    return;
  end if;

  foreach v_sis in array array['contratos', 'viabilidade', 'checkin'] loop
    if v_ativo and v_admin then
      perform portal.sincronizar_perfis(p_user_id, v_sis, 'admin', true);
    elsif v_ativo and exists (
      select 1 from portal.permissoes where user_id = p_user_id and sistema = v_sis
    ) then
      perform portal.sincronizar_perfis(p_user_id, v_sis, 'consulta', true);
    else
      perform portal.sincronizar_perfis(p_user_id, v_sis, '', false);
    end if;
  end loop;
end $$;

-- 5. Aplica a todos os usuários atuais do Portal
do $$
declare
  u record;
begin
  for u in select user_id from portal.usuarios loop
    perform portal.aplicar_acessos(u.user_id);
  end loop;
end $$;

-- 6. Conferência de quem tem acesso ao Check-in agora
select a.user_id, u.email, a.nome
  from checkin.admins a
  join auth.users u on u.id = a.user_id
 order by u.email;
