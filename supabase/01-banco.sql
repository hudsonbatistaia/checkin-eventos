-- =====================================================================
-- Check-in de Eventos — banco (schema "checkin")
-- Projeto Supabase: hb-sistemas (São Paulo)
-- Rodar inteiro no SQL Editor. Pode rodar de novo: não apaga dados.
--
-- Quem acessa o quê:
--   * Organização (login + cadastro em checkin.admins): cria e configura
--     eventos, listas, identidade, código de acesso, encerra e apaga.
--   * Tablets e painel (sem login): só com o link do evento + código de
--     6 dígitos. Veem os nomes, confirmam presença, cadastram na hora.
--     Código errado muitas vezes seguidas bloqueia aquele aparelho/rede
--     por 10 minutos.
--   * Ninguém lê nem escreve nas tabelas direto: só pelas funções abaixo.
-- =====================================================================

create schema if not exists checkin;

-- ---------- Tabelas ----------

-- Quem administra (cria e configura eventos).
create table if not exists checkin.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome    text not null
);

-- Um evento = uma recepção, um painel, um relatório.
create table if not exists checkin.eventos (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),   -- vai no link: /e/<slug>
  nome          text not null check (length(nome) between 2 and 120),
  subtitulo     text not null default '',          -- edição, cidade, slogan curto
  data          date,
  horario       text not null default '',          -- texto livre: "19h", "19h às 22h"
  local         text not null default '',
  boas_vindas   text not null default '',
  modo          text not null default 'recepcao' check (modo in ('recepcao', 'totem')),
  tema          jsonb not null default '{}'::jsonb, -- cores do evento
  codigo        text not null check (codigo ~ '^[0-9]{6}$'),
  encerrado_em  timestamptz,                        -- preenchido = só consulta
  resumo        jsonb,                              -- números guardados ao apagar os dados pessoais
  versao        bigint not null default 1,          -- muda quando listas ou configuração mudam
  marca         bigint not null default 0,          -- muda quando presenças mudam
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Arte e logo do evento (imagem já reduzida pelo navegador, em data URL).
create table if not exists checkin.imagens (
  evento_id  uuid not null references checkin.eventos(id) on delete cascade,
  tipo       text not null check (tipo in ('arte', 'logo')),
  conteudo   text not null,
  atualizado timestamptz not null default now(),
  primary key (evento_id, tipo)
);

-- Listas do evento: "confirmados" e "convidados" (uma de cada, fixas) e
-- quantas listas VIP quiser, com nome e comportamento configuráveis.
create table if not exists checkin.listas (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references checkin.eventos(id) on delete cascade,
  tipo          text not null check (tipo in ('confirmados', 'convidados', 'vip')),
  nome          text not null check (length(nome) between 1 and 60),
  cor           text not null default '#F6B04C' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  selo          boolean not null default true,      -- selo colorido no tablet
  destaque      text not null default 'card' check (destaque in ('bloco', 'card')),
  campo_extra   text not null default '',           -- nome do campo extra ("Troféu que entrega"); vazio = sem
  aba_relatorio boolean not null default true,
  ordem         integer not null default 0,
  arquivo       text not null default '',           -- última planilha enviada
  atualizado    timestamptz,
  criado_em     timestamptz not null default now()
);
create index if not exists listas_evento_idx on checkin.listas (evento_id);

-- Encerramento automático do check-in (horário marcado no cadastro do evento).
alter table checkin.eventos add column if not exists encerra_em timestamptz;
-- Evento aberto (sem lista prévia: todo mundo se cadastra na entrada) e campos pedidos no cadastro.
alter table checkin.eventos add column if not exists aberto boolean not null default false;
alter table checkin.eventos add column if not exists campos jsonb not null default '[{"chave":"empresa","obrigatorio":false}]'::jsonb;
alter table checkin.eventos add column if not exists lgpd_texto text not null default '';
-- Check-in pelo celular (QR dos convidados, só no evento aberto).
alter table checkin.eventos add column if not exists abre_em     timestamptz;                -- QR só funciona a partir daqui
alter table checkin.eventos add column if not exists qr_chave    text not null default substr(md5(gen_random_uuid()::text), 1, 16);
alter table checkin.eventos add column if not exists qr_rotativo boolean not null default false;  -- QR muda a cada minuto (só na tela cheia)
alter table checkin.eventos add column if not exists geo_ativo   boolean not null default false;  -- confere a distância do local
alter table checkin.eventos add column if not exists geo_lat     double precision;
alter table checkin.eventos add column if not exists geo_lng     double precision;
alter table checkin.eventos add column if not exists geo_raio    integer not null default 300;

-- Certificados de participação para quem teve presença confirmada.
alter table checkin.eventos add column if not exists certificado_ativo            boolean not null default false;
alter table checkin.eventos add column if not exists certificado_texto            text not null default 'Certificamos que {nome} participou do evento {evento}, realizado em {data}, com carga horária de {horas} horas.';
alter table checkin.eventos add column if not exists certificado_horas            numeric not null default 0;
alter table checkin.eventos add column if not exists certificado_libera_em        timestamptz;
alter table checkin.eventos add column if not exists certificado_emissor          text not null default '';
alter table checkin.eventos add column if not exists certificado_assinatura_nome  text not null default '';
alter table checkin.eventos add column if not exists certificado_assinatura_cargo text not null default '';
alter table checkin.eventos add column if not exists certificado_assinatura_imagem text not null default '';

create table if not exists checkin.certificados (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references checkin.eventos(id) on delete cascade,
  codigo        text not null unique,
  pessoa_id     uuid,
  tipo          text not null default 'avulso',
  nome          text not null,
  empresa       text not null default '',
  cpf           text not null default '',
  horas         numeric not null default 0,
  emitido_em    timestamptz not null default now()
);
create index if not exists cert_evento_idx on checkin.certificados (evento_id);
create index if not exists cert_codigo_idx on checkin.certificados (codigo);

create unique index if not exists listas_fixas_idx on checkin.listas (evento_id, tipo) where tipo <> 'vip';

-- Pessoas das listas. "grupo" liga linhas que são a mesma pessoa
-- (em listas diferentes): o check-in vale para o grupo.
create table if not exists checkin.pessoas (
  id        uuid primary key default gen_random_uuid(),
  evento_id uuid not null references checkin.eventos(id) on delete cascade,
  lista_id  uuid not null references checkin.listas(id) on delete cascade,
  grupo     text not null,
  nome      text not null,
  empresa   text not null default '',
  extra     text not null default '',
  busca     text not null default ''
);
create index if not exists pessoas_evento_idx on checkin.pessoas (evento_id, grupo);
create index if not exists pessoas_lista_idx on checkin.pessoas (lista_id);

-- Um check-in por pessoa (grupo) por evento: vale o primeiro tablet.
create table if not exists checkin.checkins (
  evento_id   uuid not null references checkin.eventos(id) on delete cascade,
  grupo       text not null,
  horario     timestamptz not null default now(),
  dispositivo text not null default '',
  primary key (evento_id, grupo)
);

-- Cadastrados na hora (não estavam em nenhuma lista).
create table if not exists checkin.avulsos (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references checkin.eventos(id) on delete cascade,
  nome        text not null,
  empresa     text not null default '',
  horario     timestamptz not null default now(),
  dispositivo text not null default ''
);
create index if not exists avulsos_evento_idx on checkin.avulsos (evento_id);
-- Dados do cadastro na entrada. NUNCA vão para os tablets: só para o relatório da organização.
alter table checkin.avulsos add column if not exists cpf          text not null default '';   -- só números
alter table checkin.avulsos add column if not exists nascimento   date;
alter table checkin.avulsos add column if not exists email        text not null default '';
alter table checkin.avulsos add column if not exists telefone     text not null default '';   -- só números
alter table checkin.avulsos add column if not exists extras       jsonb not null default '{}'::jsonb;  -- campos com nome livre
alter table checkin.avulsos add column if not exists consentiu_em timestamptz;              -- aceite do aviso de LGPD
create unique index if not exists avulsos_cpf_idx on checkin.avulsos (evento_id, cpf) where cpf <> '';

-- Códigos errados (para bloquear quem tenta adivinhar).
create table if not exists checkin.tentativas (
  id        bigint generated always as identity primary key,
  evento_id uuid not null references checkin.eventos(id) on delete cascade,
  ip        text not null,
  em        timestamptz not null default now()
);
create index if not exists tentativas_idx on checkin.tentativas (evento_id, ip, em);

-- Tentativas de check-in pelo celular (limite por celular/rede).
create table if not exists checkin.qr_registros (
  id        bigint generated always as identity primary key,
  evento_id uuid not null references checkin.eventos(id) on delete cascade,
  ip        text not null,
  ok        boolean not null default false,
  em        timestamptz not null default now()
);
create index if not exists qr_registros_idx on checkin.qr_registros (evento_id, ip, em);

-- ---------- Segurança: nada direto nas tabelas ----------
alter table checkin.admins     enable row level security;
alter table checkin.eventos    enable row level security;
alter table checkin.imagens    enable row level security;
alter table checkin.listas     enable row level security;
alter table checkin.pessoas    enable row level security;
alter table checkin.checkins   enable row level security;
alter table checkin.avulsos    enable row level security;
alter table checkin.tentativas enable row level security;
alter table checkin.qr_registros enable row level security;
revoke all on all tables    in schema checkin from anon, authenticated;
revoke all on all sequences in schema checkin from anon, authenticated;
grant usage on schema checkin to anon, authenticated;

-- =====================================================================
-- Auxiliares (não liberadas para o site)
-- =====================================================================

-- Barra quem não está em checkin.admins (no SQL Editor, o dono do banco passa).
create or replace function checkin.exigir_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if session_user = 'authenticator'
     and not exists (select 1 from checkin.admins where user_id = auth.uid()) then
    raise exception 'Usuário sem permissão neste sistema.' using errcode = '42501';
  end if;
end $$;

-- Texto limpo e com tamanho máximo.
create or replace function checkin.txt(p text, p_max integer)
returns text language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), p_max);
$$;

-- Endereço de quem chamou (para o bloqueio por tentativas).
create or replace function checkin.ip()
returns text language plpgsql stable set search_path = '' as $$
declare h json;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null;
  end;
  return coalesce(nullif(btrim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-forwarded-for', ''), ',', 1)), ''), 'desconhecido');
end $$;

-- Novo código de 6 dígitos (aleatório forte, vindo do gerador de UUID).
create or replace function checkin.gerar_codigo()
returns text language sql volatile set search_path = '' as $$
  select lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
$$;

-- Link do evento: nome sem acento + 4 caracteres aleatórios (difícil de adivinhar).
create or replace function checkin.gerar_slug(p_nome text)
returns text language plpgsql volatile set search_path = '' as $$
declare base text;
begin
  base := translate(lower(coalesce(p_nome, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
  base := btrim(regexp_replace(base, '[^a-z0-9]+', '-', 'g'), '-');
  base := btrim(left(base, 50), '-');
  if base = '' then base := 'evento'; end if;
  return base || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
end $$;

-- Confere tema (cores) e devolve só o que é válido.
create or replace function checkin.tema_valido(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb := '{}'::jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return r; end if;
  foreach k in array array['fundo1', 'fundo2', 'destaque', 'destaque2'] loop
    if coalesce(p->>k, '') ~ '^#[0-9A-Fa-f]{6}$' then r := r || jsonb_build_object(k, upper(p->>k)); end if;
  end loop;
  return r;
end $$;

-- CPF com dígitos verificadores corretos.
create or replace function checkin.cpf_valido(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s integer; r integer; i integer;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::integer * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::integer then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::integer * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::integer;
end $$;

-- Campos do cadastro na entrada: fixos (empresa, cpf, nascimento, email, telefone)
-- e até 5 com nome livre (x1..x5). Devolve só o que é válido, sem repetir.
create or replace function checkin.campos_validos(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb := '[]'::jsonb; x jsonb; k text; vistos text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' then return r; end if;
  for x in select value from jsonb_array_elements(p) loop
    k := x->>'chave';
    if k is null or not (k = any (array['empresa', 'cpf', 'nascimento', 'email', 'telefone', 'x1', 'x2', 'x3', 'x4', 'x5'])) or k = any (vistos) then continue; end if;
    if k like 'x%' and checkin.txt(x->>'rotulo', 40) = '' then continue; end if;
    vistos := vistos || k;
    r := r || jsonb_build_array(jsonb_build_object('chave', k, 'obrigatorio', coalesce(x->>'obrigatorio', 'false') = 'true')
         || case when k like 'x%' then jsonb_build_object('rotulo', checkin.txt(x->>'rotulo', 40)) else '{}'::jsonb end);
  end loop;
  return r;
end $$;

-- Distância em metros entre dois pontos (fórmula de haversine).
create or replace function checkin.distancia(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- QR que muda a cada minuto: código do minuto, derivado da chave secreta do evento.
create or replace function checkin.qr_minuto()
returns bigint language sql stable set search_path = '' as $$
  select floor(extract(epoch from now()) / 60)::bigint;
$$;
create or replace function checkin.qr_token(ev checkin.eventos, p_minuto bigint)
returns text language sql stable set search_path = '' as $$
  select substr(md5(ev.qr_chave || ':' || p_minuto), 1, 12);
$$;
-- Passe de 20 minutos entregue ao abrir o QR (para dar tempo de preencher). Sem guardar nada:
-- "validade.assinatura", assinado com a chave secreta (trocar o QR invalida todos os passes).
create or replace function checkin.passe_de(ev checkin.eventos, p_validade bigint)
returns text language sql stable set search_path = '' as $$
  select p_validade || '.' || substr(md5(ev.qr_chave || ':passe:' || p_validade), 1, 20);
$$;

-- Quando o check-in foi encerrado: pelo botão "Encerrar" ou pelo horário marcado (se já passou).
-- Nulo = check-in aberto. Quem decide a hora é o servidor (o relógio do tablet não importa).
create or replace function checkin.encerramento(ev checkin.eventos)
returns timestamptz language sql stable set search_path = '' as $$
  select case when ev.encerrado_em is not null then ev.encerrado_em
              when ev.encerra_em is not null and ev.encerra_em <= now() then ev.encerra_em end;
$$;

-- Dados públicos do evento (o que o tablet mostra antes e depois do código).
create or replace function checkin.evento_json(ev checkin.eventos)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'slug', ev.slug, 'nome', ev.nome, 'subtitulo', ev.subtitulo, 'data', ev.data, 'horario', ev.horario,
    'local', ev.local, 'boas_vindas', ev.boas_vindas, 'modo', ev.modo, 'tema', ev.tema,
    'aberto', ev.aberto, 'campos', ev.campos, 'lgpd_texto', ev.lgpd_texto,
    'abre_em', ev.abre_em, 'geo', ev.geo_ativo, 'qr_rotativo', ev.qr_rotativo,
    'encerrado', checkin.encerramento(ev) is not null, 'encerramento', checkin.encerramento(ev), 'encerra_em', ev.encerra_em,
    'certificado_ativo', ev.certificado_ativo, 'certificado_horas', ev.certificado_horas,
    'certificado_libera_em', ev.certificado_libera_em, 'certificado_emissor', ev.certificado_emissor,
    'imagens', coalesce((select jsonb_object_agg(i.tipo, extract(epoch from i.atualizado)::bigint)
                           from checkin.imagens i where i.evento_id = ev.id), '{}'::jsonb));
$$;

-- Listas, pessoas e presenças de um evento (formato compacto).
create or replace function checkin.pacote(p_evento uuid, p_listas boolean, p_presencas boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := '{}'::jsonb;
begin
  if p_listas then
    r := r || jsonb_build_object(
      'listas', coalesce((select jsonb_agg(jsonb_build_object(
          'id', l.id, 'tipo', l.tipo, 'nome', l.nome, 'cor', l.cor, 'selo', l.selo, 'destaque', l.destaque,
          'campo_extra', l.campo_extra, 'aba_relatorio', l.aba_relatorio, 'ordem', l.ordem,
          'arquivo', l.arquivo, 'atualizado', l.atualizado) order by l.ordem, l.criado_em)
        from checkin.listas l where l.evento_id = p_evento), '[]'::jsonb),
      -- [id, lista, grupo, nome, empresa, extra, busca]
      'pessoas', coalesce((select jsonb_agg(jsonb_build_array(p.id, p.lista_id, p.grupo, p.nome, p.empresa, p.extra, p.busca))
        from checkin.pessoas p where p.evento_id = p_evento), '[]'::jsonb));
  end if;
  if p_presencas then
    r := r || jsonb_build_object(
      -- [grupo, horario, tablet]
      'checkins', coalesce((select jsonb_agg(jsonb_build_array(c.grupo, c.horario, c.dispositivo) order by c.horario)
        from checkin.checkins c where c.evento_id = p_evento), '[]'::jsonb),
      -- [id, nome, empresa, horario, tablet]
      'avulsos', coalesce((select jsonb_agg(jsonb_build_array(a.id, a.nome, a.empresa, a.horario, a.dispositivo) order by a.horario)
        from checkin.avulsos a where a.evento_id = p_evento), '[]'::jsonb));
  end if;
  return r;
end $$;

-- Confere link + código. Devolve {id, encerrado} ou {erro: evento|codigo|bloqueado}.
-- Não usa "raise" para que o registro do código errado fique gravado.
create or replace function checkin.acesso(p_slug text, p_codigo text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ev checkin.eventos; v_ip text;
begin
  select * into ev from checkin.eventos where slug = lower(btrim(coalesce(p_slug, '')));
  if not found then return jsonb_build_object('erro', 'evento'); end if;
  v_ip := checkin.ip();
  if (select count(*) from checkin.tentativas
       where evento_id = ev.id and ip = v_ip and em > now() - interval '10 minutes') >= 30 then
    return jsonb_build_object('erro', 'bloqueado');
  end if;
  if coalesce(btrim(p_codigo), '') <> ev.codigo then
    insert into checkin.tentativas (evento_id, ip) values (ev.id, v_ip);
    delete from checkin.tentativas where em < now() - interval '1 day';
    return jsonb_build_object('erro', 'codigo');
  end if;
  return jsonb_build_object('id', ev.id, 'encerrado', checkin.encerramento(ev) is not null);
end $$;

create or replace function checkin.mudou_listas(p_evento uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update checkin.eventos set versao = versao + 1, atualizado_em = now() where id = p_evento;
$$;
create or replace function checkin.mudou_presencas(p_evento uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update checkin.eventos set marca = marca + 1 where id = p_evento;
$$;

-- Cria as duas listas fixas de um evento.
create or replace function checkin.criar_listas_fixas(p_evento uuid)
returns void language sql volatile security definer set search_path = '' as $$
  insert into checkin.listas (evento_id, tipo, nome, ordem) values
    (p_evento, 'confirmados', 'Presença confirmada', 0),
    (p_evento, 'convidados', 'Sem confirmação', 1)
  on conflict do nothing;
$$;

-- =====================================================================
-- ORGANIZAÇÃO (precisa de login + checkin.admins)
-- =====================================================================

create or replace function checkin.sessao()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  return jsonb_build_object('nome', coalesce((select nome from checkin.admins where user_id = auth.uid()), 'Organização'));
end $$;

-- Lista de eventos, mais recentes primeiro.
create or replace function checkin.listar_eventos()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'nome', e.nome, 'subtitulo', e.subtitulo, 'data', e.data, 'horario', e.horario,
      'local', e.local, 'encerrado_em', checkin.encerramento(e), 'encerra_em', e.encerra_em, 'criado_em', e.criado_em, 'tema', e.tema,
      'pessoas', (select count(distinct p.grupo) from checkin.pessoas p where p.evento_id = e.id),
      'presentes', (select count(*) from checkin.checkins c where c.evento_id = e.id)
                 + (select count(*) from checkin.avulsos a where a.evento_id = e.id),
      'resumo', e.resumo,
      'tem_arte', exists (select 1 from checkin.imagens i where i.evento_id = e.id and i.tipo = 'arte'))
      order by e.data desc nulls last, e.criado_em desc)
    from checkin.eventos e), '[]'::jsonb);
end $$;

-- Tudo de um evento para a tela de configuração (inclui o código).
create or replace function checkin.obter_evento(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ev checkin.eventos;
begin
  perform checkin.exigir_admin();
  select * into ev from checkin.eventos where id = p_id;
  if not found then raise exception 'Evento não encontrado.'; end if;
  return checkin.evento_json(ev)
    || jsonb_build_object('id', ev.id, 'codigo', ev.codigo, 'encerrado_em', ev.encerrado_em, 'resumo', ev.resumo,
                          'versao', ev.versao, 'marca', ev.marca, 'criado_em', ev.criado_em,
                          'qr_chave', ev.qr_chave, 'geo_ativo', ev.geo_ativo, 'geo_lat', ev.geo_lat, 'geo_lng', ev.geo_lng, 'geo_raio', ev.geo_raio,
                          'certificado_texto', ev.certificado_texto,
                          'certificado_assinatura_nome', ev.certificado_assinatura_nome,
                          'certificado_assinatura_cargo', ev.certificado_assinatura_cargo,
                          'certificado_assinatura_imagem', ev.certificado_assinatura_imagem,
                          -- dados do cadastro na entrada (só a organização vê): [id, cpf, nascimento, email, telefone, extras, consentiu_em]
                          'cadastros', coalesce((select jsonb_agg(jsonb_build_array(a.id, a.cpf, a.nascimento, a.email, a.telefone, a.extras, a.consentiu_em))
                                                   from checkin.avulsos a where a.evento_id = ev.id), '[]'::jsonb))
    || checkin.pacote(ev.id, true, true);
end $$;

-- Aplica os campos de dados básicos de p_dados no evento.
create or replace function checkin.aplicar_dados(p_id uuid, p_dados jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_data date; v_encerra timestamptz; v_abre timestamptz; v_lat double precision; v_lng double precision;
  v_cert_libera timestamptz; v_cert_horas numeric; ev checkin.eventos;
begin
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados inválidos.'; end if;
  if p_dados ? 'nome' and length(checkin.txt(p_dados->>'nome', 120)) < 2 then
    raise exception 'Informe o nome do evento.';
  end if;
  if p_dados ? 'data' then
    begin v_data := nullif(p_dados->>'data', '')::date;
    exception when others then raise exception 'Data inválida.'; end;
  end if;
  if p_dados ? 'modo' and p_dados->>'modo' not in ('recepcao', 'totem') then raise exception 'Modo inválido.'; end if;
  if p_dados ? 'encerra_em' then
    begin v_encerra := nullif(p_dados->>'encerra_em', '')::timestamptz;
    exception when others then raise exception 'Horário de encerramento inválido.'; end;
  end if;
  if p_dados ? 'abre_em' then
    begin v_abre := nullif(p_dados->>'abre_em', '')::timestamptz;
    exception when others then raise exception 'Horário de abertura inválido.'; end;
  end if;
  if p_dados ? 'certificado_libera_em' then
    begin v_cert_libera := nullif(p_dados->>'certificado_libera_em', '')::timestamptz;
    exception when others then raise exception 'Horário de liberação de certificado inválido.'; end;
  end if;
  if p_dados ? 'certificado_horas' then
    begin v_cert_horas := coalesce(nullif(p_dados->>'certificado_horas', '')::numeric, 0);
    exception when others then raise exception 'Carga horária inválida.'; end;
    if v_cert_horas < 0 or v_cert_horas > 999 then raise exception 'Carga horária inválida.'; end if;
  end if;
  if p_dados ? 'geo_lat' or p_dados ? 'geo_lng' then
    begin v_lat := nullif(p_dados->>'geo_lat', '')::double precision; v_lng := nullif(p_dados->>'geo_lng', '')::double precision;
    exception when others then raise exception 'Coordenadas inválidas.'; end;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then raise exception 'Coordenadas inválidas.'; end if;
  end if;
  if p_dados ? 'geo_raio' and coalesce(p_dados->>'geo_raio', '') !~ '^[0-9]{2,5}$' then raise exception 'Raio inválido.'; end if;
  update checkin.eventos set
    nome                          = case when p_dados ? 'nome'        then checkin.txt(p_dados->>'nome', 120)        else nome end,
    subtitulo                     = case when p_dados ? 'subtitulo'   then checkin.txt(p_dados->>'subtitulo', 120)   else subtitulo end,
    data                          = case when p_dados ? 'data'        then v_data                                     else data end,
    horario                       = case when p_dados ? 'horario'     then checkin.txt(p_dados->>'horario', 40)      else horario end,
    local                         = case when p_dados ? 'local'       then checkin.txt(p_dados->>'local', 160)       else local end,
    boas_vindas                   = case when p_dados ? 'boas_vindas' then checkin.txt(p_dados->>'boas_vindas', 200) else boas_vindas end,
    modo                          = case when p_dados ? 'modo'        then p_dados->>'modo'                          else modo end,
    tema                          = case when p_dados ? 'tema'        then checkin.tema_valido(p_dados->'tema')      else tema end,
    encerra_em                    = case when p_dados ? 'encerra_em'  then v_encerra                                  else encerra_em end,
    aberto                        = case when p_dados ? 'aberto'      then coalesce(p_dados->>'aberto', 'false') = 'true' else aberto end,
    campos                        = case when p_dados ? 'campos'      then checkin.campos_validos(p_dados->'campos')  else campos end,
    lgpd_texto                    = case when p_dados ? 'lgpd_texto'  then left(btrim(coalesce(p_dados->>'lgpd_texto', '')), 600) else lgpd_texto end,
    abre_em                       = case when p_dados ? 'abre_em'     then v_abre                                     else abre_em end,
    qr_rotativo                   = case when p_dados ? 'qr_rotativo' then coalesce(p_dados->>'qr_rotativo', 'false') = 'true' else qr_rotativo end,
    geo_ativo                     = case when p_dados ? 'geo_ativo'   then coalesce(p_dados->>'geo_ativo', 'false') = 'true' else geo_ativo end,
    geo_lat                       = case when p_dados ? 'geo_lat'     then v_lat                                      else geo_lat end,
    geo_lng                       = case when p_dados ? 'geo_lng'     then v_lng                                      else geo_lng end,
    geo_raio                      = case when p_dados ? 'geo_raio'    then least(greatest((p_dados->>'geo_raio')::integer, 50), 5000) else geo_raio end,
    certificado_ativo             = case when p_dados ? 'certificado_ativo'             then coalesce(p_dados->>'certificado_ativo', 'false') = 'true' else certificado_ativo end,
    certificado_texto             = case when p_dados ? 'certificado_texto'             then left(btrim(coalesce(p_dados->>'certificado_texto', '')), 600) else certificado_texto end,
    certificado_horas             = case when p_dados ? 'certificado_horas'             then v_cert_horas else certificado_horas end,
    certificado_libera_em         = case when p_dados ? 'certificado_libera_em'         then v_cert_libera else certificado_libera_em end,
    certificado_emissor           = case when p_dados ? 'certificado_emissor'           then checkin.txt(p_dados->>'certificado_emissor', 120) else certificado_emissor end,
    certificado_assinatura_nome   = case when p_dados ? 'certificado_assinatura_nome'   then checkin.txt(p_dados->>'certificado_assinatura_nome', 100) else certificado_assinatura_nome end,
    certificado_assinatura_cargo  = case when p_dados ? 'certificado_assinatura_cargo'  then checkin.txt(p_dados->>'certificado_assinatura_cargo', 100) else certificado_assinatura_cargo end,
    certificado_assinatura_imagem = case when p_dados ? 'certificado_assinatura_imagem' then coalesce(p_dados->>'certificado_assinatura_imagem', '') else certificado_assinatura_imagem end
  where id = p_id;
  if not found then raise exception 'Evento não encontrado.'; end if;
  select * into ev from checkin.eventos where id = p_id;
  if ev.geo_ativo and (ev.geo_lat is null or ev.geo_lng is null) then
    raise exception 'Marque o local do evento para conferir a localização.';
  end if;
  perform checkin.mudou_listas(p_id);
end $$;

-- Cria um evento novo (já com as listas Confirmados e Convidados).
create or replace function checkin.criar_evento(p_dados jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_slug text;
begin
  perform checkin.exigir_admin();
  if length(checkin.txt(p_dados->>'nome', 120)) < 2 then raise exception 'Informe o nome do evento.'; end if;
  if (select count(*) from checkin.eventos) >= 500 then raise exception 'Limite de eventos atingido.'; end if;
  loop
    v_slug := checkin.gerar_slug(p_dados->>'nome');
    exit when not exists (select 1 from checkin.eventos where slug = v_slug);
  end loop;
  insert into checkin.eventos (slug, nome, codigo)
  values (v_slug, checkin.txt(p_dados->>'nome', 120), checkin.gerar_codigo())
  returning id into v_id;
  perform checkin.aplicar_dados(v_id, p_dados);
  perform checkin.criar_listas_fixas(v_id);
  return jsonb_build_object('id', v_id, 'slug', v_slug);
end $$;

create or replace function checkin.salvar_evento(p_id uuid, p_dados jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  perform checkin.aplicar_dados(p_id, p_dados);
end $$;

-- Arte ou logo. Conteúdo vazio/nulo = remover.
create or replace function checkin.salvar_imagem(p_id uuid, p_tipo text, p_conteudo text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  if p_tipo not in ('arte', 'logo') then raise exception 'Tipo de imagem inválido.'; end if;
  if not exists (select 1 from checkin.eventos where id = p_id) then raise exception 'Evento não encontrado.'; end if;
  if coalesce(p_conteudo, '') = '' then
    delete from checkin.imagens where evento_id = p_id and tipo = p_tipo;
  else
    if p_conteudo !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Imagem inválida.'; end if;
    if length(p_conteudo) > 1500000 then raise exception 'Imagem grande demais.'; end if;
    insert into checkin.imagens (evento_id, tipo, conteudo) values (p_id, p_tipo, p_conteudo)
    on conflict (evento_id, tipo) do update set conteudo = excluded.conteudo, atualizado = now();
  end if;
  perform checkin.mudou_listas(p_id);
end $$;

-- Troca o código de acesso (os tablets vão pedir o código novo).
create or replace function checkin.novo_codigo(p_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v text;
begin
  perform checkin.exigir_admin();
  v := checkin.gerar_codigo();
  update checkin.eventos set codigo = v where id = p_id;
  if not found then raise exception 'Evento não encontrado.'; end if;
  delete from checkin.tentativas where evento_id = p_id;
  perform checkin.mudou_listas(p_id);
  return v;
end $$;

-- Copia configuração, identidade e listas (sem pessoas nem presenças).
create or replace function checkin.duplicar_evento(p_id uuid, p_nome text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ev checkin.eventos; novo jsonb; v_id uuid;
begin
  perform checkin.exigir_admin();
  select * into ev from checkin.eventos where id = p_id;
  if not found then raise exception 'Evento não encontrado.'; end if;
  novo := checkin.criar_evento(jsonb_build_object('nome', coalesce(nullif(checkin.txt(p_nome, 120), ''), ev.nome || ' (cópia)'),
    'subtitulo', ev.subtitulo, 'horario', ev.horario, 'local', ev.local, 'boas_vindas', ev.boas_vindas,
    'modo', ev.modo, 'tema', ev.tema, 'aberto', ev.aberto, 'campos', ev.campos, 'lgpd_texto', ev.lgpd_texto,
    'qr_rotativo', ev.qr_rotativo, 'geo_ativo', ev.geo_ativo, 'geo_lat', ev.geo_lat, 'geo_lng', ev.geo_lng, 'geo_raio', ev.geo_raio,
    'certificado_ativo', ev.certificado_ativo, 'certificado_texto', ev.certificado_texto,
    'certificado_horas', ev.certificado_horas, 'certificado_emissor', ev.certificado_emissor,
    'certificado_assinatura_nome', ev.certificado_assinatura_nome, 'certificado_assinatura_cargo', ev.certificado_assinatura_cargo,
    'certificado_assinatura_imagem', ev.certificado_assinatura_imagem));
  v_id := (novo->>'id')::uuid;
  insert into checkin.imagens (evento_id, tipo, conteudo) select v_id, tipo, conteudo from checkin.imagens where evento_id = p_id;
  update checkin.listas n set nome = o.nome, cor = o.cor, selo = o.selo, destaque = o.destaque,
         campo_extra = o.campo_extra, aba_relatorio = o.aba_relatorio
    from checkin.listas o where o.evento_id = p_id and o.tipo = n.tipo and n.evento_id = v_id and o.tipo <> 'vip';
  insert into checkin.listas (evento_id, tipo, nome, cor, selo, destaque, campo_extra, aba_relatorio, ordem)
  select v_id, 'vip', nome, cor, selo, destaque, campo_extra, aba_relatorio, ordem
    from checkin.listas where evento_id = p_id and tipo = 'vip';
  return novo;
end $$;

-- Apaga o evento inteiro (configuração, listas, presenças). Não tem volta.
create or replace function checkin.excluir_evento(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  delete from checkin.eventos where id = p_id;
  if not found then raise exception 'Evento não encontrado.'; end if;
end $$;

-- Encerrar (só consulta) ou reabrir.
create or replace function checkin.encerrar_evento(p_id uuid, p_encerrar boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  update checkin.eventos set encerrado_em = case when p_encerrar then coalesce(encerrado_em, now()) else null end,
         encerra_em = case when p_encerrar then encerra_em else null end
   where id = p_id;
  if not found then raise exception 'Evento não encontrado.'; end if;
  perform checkin.mudou_listas(p_id);
end $$;

-- Apaga presenças e cadastros na hora (depois dos testes). As listas ficam.
create or replace function checkin.zerar_presencas(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  delete from checkin.checkins where evento_id = p_id;
  delete from checkin.avulsos where evento_id = p_id;
  perform checkin.mudou_presencas(p_id);
end $$;

-- LGPD: apaga nomes (listas, presenças, cadastros na hora) e guarda só os números.
create or replace function checkin.apagar_dados_pessoais(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  update checkin.eventos e set resumo = jsonb_build_object(
      'pessoas_nas_listas', (select count(distinct grupo) from checkin.pessoas where evento_id = e.id),
      'presentes_das_listas', (select count(*) from checkin.checkins c where c.evento_id = e.id
                                 and exists (select 1 from checkin.pessoas p where p.evento_id = e.id and p.grupo = c.grupo)),
      'cadastrados_na_hora', (select count(*) from checkin.avulsos where evento_id = e.id),
      'apagado_em', now())
   where id = p_id;
  if not found then raise exception 'Evento não encontrado.'; end if;
  delete from checkin.pessoas where evento_id = p_id;
  delete from checkin.checkins where evento_id = p_id;
  delete from checkin.avulsos where evento_id = p_id;
  delete from checkin.tentativas where evento_id = p_id;
  delete from checkin.qr_registros where evento_id = p_id;
  update checkin.listas set arquivo = '', atualizado = null where evento_id = p_id;
  perform checkin.mudou_listas(p_id);
  perform checkin.mudou_presencas(p_id);
end $$;

-- Troca o QR dos convidados: cartazes e passes antigos deixam de valer na hora.
create or replace function checkin.novo_qr_convidados(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  update checkin.eventos set qr_chave = substr(md5(gen_random_uuid()::text), 1, 16) where id = p_id;
  if not found then raise exception 'Evento não encontrado.'; end if;
  delete from checkin.qr_registros where evento_id = p_id;
end $$;

-- ---------- Listas ----------

-- Cria (sem id: lista VIP nova) ou altera uma lista.
create or replace function checkin.salvar_lista(p_evento uuid, p_dados jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_nome text;
begin
  perform checkin.exigir_admin();
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then raise exception 'Dados inválidos.'; end if;
  v_nome := checkin.txt(p_dados->>'nome', 60);
  if p_dados ? 'nome' and v_nome = '' then raise exception 'Informe o nome da lista.'; end if;
  if p_dados ? 'cor' and coalesce(p_dados->>'cor', '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Cor inválida.'; end if;
  if p_dados ? 'destaque' and p_dados->>'destaque' not in ('bloco', 'card') then raise exception 'Destaque inválido.'; end if;
  if nullif(p_dados->>'id', '') is null then
    if not exists (select 1 from checkin.eventos where id = p_evento) then raise exception 'Evento não encontrado.'; end if;
    if (select count(*) from checkin.listas where evento_id = p_evento and tipo = 'vip') >= 20 then
      raise exception 'Limite de 20 listas VIP por evento.';
    end if;
    if v_nome = '' then raise exception 'Informe o nome da lista.'; end if;
    insert into checkin.listas (evento_id, tipo, nome, ordem)
    values (p_evento, 'vip', v_nome, coalesce((select max(ordem) + 1 from checkin.listas where evento_id = p_evento), 2))
    returning id into v_id;
  else
    v_id := (p_dados->>'id')::uuid;
    if not exists (select 1 from checkin.listas where id = v_id and evento_id = p_evento) then
      raise exception 'Lista não encontrada.';
    end if;
  end if;
  update checkin.listas set
    nome          = case when p_dados ? 'nome'          then v_nome                                   else nome end,
    cor           = case when p_dados ? 'cor'           then upper(p_dados->>'cor')                   else cor end,
    selo          = case when p_dados ? 'selo'          then coalesce((p_dados->>'selo')::boolean, selo) else selo end,
    destaque      = case when p_dados ? 'destaque'      then p_dados->>'destaque'                     else destaque end,
    campo_extra   = case when p_dados ? 'campo_extra'   then checkin.txt(p_dados->>'campo_extra', 40) else campo_extra end,
    aba_relatorio = case when p_dados ? 'aba_relatorio' then coalesce((p_dados->>'aba_relatorio')::boolean, aba_relatorio) else aba_relatorio end,
    ordem         = case when p_dados ? 'ordem' and tipo = 'vip' then greatest(2, (p_dados->>'ordem')::integer) else ordem end
  where id = v_id;
  perform checkin.mudou_listas(p_evento);
  return v_id;
end $$;

-- Apaga uma lista VIP (as pessoas dela saem; presenças ficam).
create or replace function checkin.excluir_lista(p_lista uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_ev uuid;
begin
  perform checkin.exigir_admin();
  select evento_id into v_ev from checkin.listas where id = p_lista and tipo = 'vip';
  if not found then raise exception 'Só listas VIP podem ser apagadas.'; end if;
  delete from checkin.listas where id = p_lista;
  perform checkin.mudou_listas(v_ev);
end $$;

-- Valida uma pessoa vinda do site e devolve os campos limpos.
create or replace function checkin.pessoa_valida(x jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_nome text; v_grupo text;
begin
  v_nome := checkin.txt(x->>'nome', 120);
  v_grupo := coalesce(x->>'grupo', '');
  if length(v_nome) < 2 then raise exception 'Pessoa sem nome.'; end if;
  if v_grupo !~ '^[a-z0-9-]{1,80}$' then raise exception 'Identificador inválido para %.', v_nome; end if;
  return jsonb_build_object('grupo', v_grupo, 'nome', v_nome,
    'empresa', checkin.txt(x->>'empresa', 160), 'extra', checkin.txt(x->>'extra', 160),
    'busca', left(coalesce(x->>'busca', ''), 600));
end $$;

-- Substitui todas as pessoas de uma lista (envio de planilha).
-- p_regrupar: [{id, grupo}] de pessoas de OUTRAS listas que passaram a ser
-- a mesma pessoa de alguém desta lista (pares aprovados na conferência).
create or replace function checkin.salvar_pessoas(p_lista uuid, p_dados jsonb, p_arquivo text, p_regrupar jsonb default '[]'::jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_ev uuid; n integer; x jsonb;
begin
  perform checkin.exigir_admin();
  select evento_id into v_ev from checkin.listas where id = p_lista;
  if not found then raise exception 'Lista não encontrada.'; end if;
  if jsonb_typeof(p_dados) <> 'array' or jsonb_array_length(p_dados) > 5000 then
    raise exception 'Lista inválida ou grande demais (máximo de 5000 pessoas).';
  end if;
  delete from checkin.pessoas where lista_id = p_lista;
  insert into checkin.pessoas (evento_id, lista_id, grupo, nome, empresa, extra, busca)
  select v_ev, p_lista, v->>'grupo', v->>'nome', v->>'empresa', v->>'extra', v->>'busca'
    from jsonb_array_elements(p_dados) d, lateral (select checkin.pessoa_valida(d.value) v) t;
  get diagnostics n = row_count;
  if (select count(*) from checkin.pessoas where evento_id = v_ev) > 20000 then
    raise exception 'Limite de 20 mil pessoas por evento.';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_regrupar, '[]'::jsonb)) loop
    if coalesce(x->>'grupo', '') !~ '^[a-z0-9-]{1,80}$' then raise exception 'Identificador inválido.'; end if;
    update checkin.pessoas set grupo = x->>'grupo' where id = (x->>'id')::uuid and evento_id = v_ev;
  end loop;
  update checkin.listas set arquivo = checkin.txt(p_arquivo, 200), atualizado = case when n > 0 then now() end
   where id = p_lista;
  perform checkin.mudou_listas(v_ev);
  return n;
end $$;

-- Inclui uma pessoa digitada numa lista.
create or replace function checkin.adicionar_pessoa(p_lista uuid, p_dados jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_ev uuid; v jsonb; v_id uuid;
begin
  perform checkin.exigir_admin();
  select evento_id into v_ev from checkin.listas where id = p_lista;
  if not found then raise exception 'Lista não encontrada.'; end if;
  if (select count(*) from checkin.pessoas where evento_id = v_ev) >= 20000 then
    raise exception 'Limite de 20 mil pessoas por evento.';
  end if;
  v := checkin.pessoa_valida(p_dados);
  insert into checkin.pessoas (evento_id, lista_id, grupo, nome, empresa, extra, busca)
  values (v_ev, p_lista, v->>'grupo', v->>'nome', v->>'empresa', v->>'extra', v->>'busca')
  returning id into v_id;
  perform checkin.mudou_listas(v_ev);
  return v_id;
end $$;

-- Corrige uma pessoa (nome, empresa, campo extra, ligação com outra pessoa).
create or replace function checkin.editar_pessoa(p_id uuid, p_dados jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_ev uuid; v jsonb;
begin
  perform checkin.exigir_admin();
  select evento_id into v_ev from checkin.pessoas where id = p_id;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  v := checkin.pessoa_valida(p_dados);
  update checkin.pessoas set grupo = v->>'grupo', nome = v->>'nome', empresa = v->>'empresa',
         extra = v->>'extra', busca = v->>'busca'
   where id = p_id;
  perform checkin.mudou_listas(v_ev);
end $$;

create or replace function checkin.remover_pessoa(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_ev uuid;
begin
  perform checkin.exigir_admin();
  delete from checkin.pessoas where id = p_id returning evento_id into v_ev;
  if v_ev is null then raise exception 'Pessoa não encontrada.'; end if;
  perform checkin.mudou_listas(v_ev);
end $$;

-- =====================================================================
-- TABLETS E PAINEL (sem login: link + código)
-- Todas devolvem {erro: ...} em vez de falhar, para o site explicar.
-- =====================================================================

-- O que aparece antes do código (nome, cores, se tem arte). Sem nomes de pessoas.
create or replace function checkin.evento_publico(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ev checkin.eventos;
begin
  select * into ev from checkin.eventos where slug = lower(btrim(coalesce(p_slug, '')));
  if not found then return jsonb_build_object('erro', 'evento'); end if;
  return checkin.evento_json(ev);
end $$;

-- Arte ou logo do evento (público: é a identidade visual, sem dado pessoal).
create or replace function checkin.imagem(p_slug text, p_tipo text)
returns text language sql stable security definer set search_path = '' as $$
  select i.conteudo from checkin.imagens i join checkin.eventos e on e.id = i.evento_id
   where e.slug = lower(btrim(coalesce(p_slug, ''))) and i.tipo = p_tipo;
$$;

-- Busca o que mudou desde a última vez (o tablet chama a cada poucos segundos).
-- p_versao / p_marca = o que o aparelho já tem; só manda listas/presenças se mudaram.
create or replace function checkin.sincronizar(p_slug text, p_codigo text, p_versao bigint default 0, p_marca bigint default -1)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a jsonb; ev checkin.eventos; r jsonb;
begin
  a := checkin.acesso(p_slug, p_codigo);
  if a ? 'erro' then return a; end if;
  select * into ev from checkin.eventos where id = (a->>'id')::uuid;
  r := jsonb_build_object('ok', true, 'versao', ev.versao, 'marca', ev.marca, 'agora', now(),
                         'encerrado', checkin.encerramento(ev) is not null, 'encerramento', checkin.encerramento(ev));
  if p_versao is distinct from ev.versao then
    r := r || jsonb_build_object('evento', checkin.evento_json(ev)) || checkin.pacote(ev.id, true, false);
  end if;
  if p_marca is distinct from ev.marca then
    r := r || checkin.pacote(ev.id, false, true);
  end if;
  return r;
end $$;

create or replace function checkin.fazer_checkin(p_slug text, p_codigo text, p_grupo text, p_dispositivo text default '')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a jsonb; v_id uuid; h timestamptz; novo boolean;
begin
  a := checkin.acesso(p_slug, p_codigo);
  if a ? 'erro' then return a; end if;
  if (a->>'encerrado')::boolean then return jsonb_build_object('erro', 'encerrado'); end if;
  v_id := (a->>'id')::uuid;
  if not exists (select 1 from checkin.pessoas where evento_id = v_id and grupo = p_grupo) then
    return jsonb_build_object('erro', 'pessoa');
  end if;
  insert into checkin.checkins (evento_id, grupo, dispositivo)
  values (v_id, p_grupo, checkin.txt(p_dispositivo, 40))
  on conflict (evento_id, grupo) do nothing;
  novo := found;
  if novo then perform checkin.mudou_presencas(v_id); end if;
  select horario into h from checkin.checkins where evento_id = v_id and grupo = p_grupo;
  return jsonb_build_object('ok', true, 'horario', h, 'ja_existia', not novo);
end $$;

-- Cancela uma entrada (engano da recepção). Aceita várias chaves do mesmo grupo.
create or replace function checkin.desfazer_checkin(p_slug text, p_codigo text, p_grupos text[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a jsonb; v_id uuid;
begin
  a := checkin.acesso(p_slug, p_codigo);
  if a ? 'erro' then return a; end if;
  if (a->>'encerrado')::boolean then return jsonb_build_object('erro', 'encerrado'); end if;
  v_id := (a->>'id')::uuid;
  delete from checkin.checkins where evento_id = v_id and grupo = any (p_grupos);
  perform checkin.mudou_presencas(v_id);
  return jsonb_build_object('ok', true);
end $$;

-- Cadastro na entrada (quem não está em nenhuma lista). Confere os campos pedidos pelo evento,
-- o CPF (válido e sem repetir no evento) e o aceite do aviso de LGPD.
-- O cadastro em si (campos, CPF, LGPD). Usado pelos tablets e pelo celular.
create or replace function checkin.registrar_cadastro(ev checkin.eventos, p_nome text, p_empresa text, p_dispositivo text, p_dados jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  novo uuid; h timestamptz; c jsonb; k text; val text; rotulo text;
  v_cpf text := ''; v_nasc date; v_email text := ''; v_tel text := ''; v_extras jsonb := '{}'::jsonb;
  precisa boolean := false; ja timestamptz;
  ROTULOS constant jsonb := '{"empresa":"Empresa","cpf":"CPF","nascimento":"Data de nascimento","email":"E-mail","telefone":"Telefone"}';
begin
  if length(checkin.txt(p_nome, 120)) < 2 then return jsonb_build_object('erro', 'nome'); end if;
  if (select count(*) from checkin.avulsos where evento_id = ev.id) >= 5000 then return jsonb_build_object('erro', 'limite'); end if;
  p_dados := coalesce(p_dados, '{}'::jsonb);
  for c in select value from jsonb_array_elements(ev.campos) loop
    k := c->>'chave';
    rotulo := coalesce(c->>'rotulo', ROTULOS->>k, k);
    val := checkin.txt(case when k = 'empresa' then p_empresa when k like 'x%' then p_dados->'extras'->>k else p_dados->>k end, 160);
    if k <> 'empresa' then precisa := true; end if;
    if val = '' then
      if (c->>'obrigatorio')::boolean then return jsonb_build_object('erro', 'campo', 'campo', k, 'msg', 'Preencha: ' || rotulo || '.'); end if;
      continue;
    end if;
    if k = 'cpf' then
      v_cpf := regexp_replace(val, '\D', '', 'g');
      if not checkin.cpf_valido(v_cpf) then return jsonb_build_object('erro', 'campo', 'campo', k, 'msg', 'CPF inválido. Confira os números.'); end if;
    elsif k = 'nascimento' then
      begin v_nasc := val::date; exception when others then v_nasc := null; end;
      if v_nasc is null or v_nasc < date '1900-01-01' or v_nasc > current_date then
        return jsonb_build_object('erro', 'campo', 'campo', k, 'msg', 'Data de nascimento inválida.');
      end if;
    elsif k = 'email' then
      if val !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return jsonb_build_object('erro', 'campo', 'campo', k, 'msg', 'E-mail inválido.'); end if;
      v_email := lower(val);
    elsif k = 'telefone' then
      v_tel := regexp_replace(val, '\D', '', 'g');
      if length(v_tel) < 10 or length(v_tel) > 13 then return jsonb_build_object('erro', 'campo', 'campo', k, 'msg', 'Telefone inválido. Use DDD + número.'); end if;
    elsif k like 'x%' then
      v_extras := v_extras || jsonb_build_object(k, val);
    end if;
  end loop;
  -- Pede dado além de nome/empresa: precisa do aceite do aviso de LGPD.
  if precisa and coalesce(p_dados->>'consentiu', 'false') <> 'true' then return jsonb_build_object('erro', 'consentimento'); end if;
  if v_cpf <> '' then
    select horario into ja from checkin.avulsos where evento_id = ev.id and cpf = v_cpf;
    if found then return jsonb_build_object('erro', 'cpf_repetido', 'horario', ja); end if;
  end if;
  begin
    insert into checkin.avulsos (evento_id, nome, empresa, dispositivo, cpf, nascimento, email, telefone, extras, consentiu_em)
    values (ev.id, checkin.txt(p_nome, 120), checkin.txt(p_empresa, 160), checkin.txt(p_dispositivo, 40),
            v_cpf, v_nasc, v_email, v_tel, v_extras, case when precisa then now() end)
    returning id, horario into novo, h;
  exception when unique_violation then
    -- Dois tablets ao mesmo tempo com o mesmo CPF: vale o primeiro.
    select horario into ja from checkin.avulsos where evento_id = ev.id and cpf = v_cpf;
    return jsonb_build_object('erro', 'cpf_repetido', 'horario', ja);
  end;
  perform checkin.mudou_presencas(ev.id);
  return jsonb_build_object('ok', true, 'id', novo, 'horario', h);
end $$;

drop function if exists checkin.cadastrar_avulso(text, text, text, text, text);
create or replace function checkin.cadastrar_avulso(p_slug text, p_codigo text, p_nome text, p_empresa text,
                                                    p_dispositivo text default '', p_dados jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a jsonb; ev checkin.eventos;
begin
  a := checkin.acesso(p_slug, p_codigo);
  if a ? 'erro' then return a; end if;
  if (a->>'encerrado')::boolean then return jsonb_build_object('erro', 'encerrado'); end if;
  select * into ev from checkin.eventos where id = (a->>'id')::uuid;
  return checkin.registrar_cadastro(ev, p_nome, p_empresa, p_dispositivo, p_dados);
end $$;

create or replace function checkin.remover_avulso(p_slug text, p_codigo text, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a jsonb; v_id uuid;
begin
  a := checkin.acesso(p_slug, p_codigo);
  if a ? 'erro' then return a; end if;
  if (a->>'encerrado')::boolean then return jsonb_build_object('erro', 'encerrado'); end if;
  v_id := (a->>'id')::uuid;
  delete from checkin.avulsos where evento_id = v_id and id = p_id;
  perform checkin.mudou_presencas(v_id);
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- CHECK-IN PELO CELULAR (QR dos convidados, sem código da equipe)
-- =====================================================================

-- Tela cheia na entrada (com o código da equipe): o QR do momento.
create or replace function checkin.qr_atual(p_slug text, p_codigo text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a jsonb; ev checkin.eventos; m bigint;
begin
  a := checkin.acesso(p_slug, p_codigo);
  if a ? 'erro' then return a; end if;
  select * into ev from checkin.eventos where id = (a->>'id')::uuid;
  if not ev.aberto then return jsonb_build_object('erro', 'indisponivel'); end if;
  m := checkin.qr_minuto();
  return jsonb_build_object('ok', true, 'rotativo', ev.qr_rotativo, 'agora', now(),
    'k', case when ev.qr_rotativo then checkin.qr_token(ev, m) else ev.qr_chave end,
    'expira', case when ev.qr_rotativo then to_timestamp((m + 1) * 60) end,
    'encerrado', checkin.encerramento(ev) is not null, 'abre_em', ev.abre_em);
end $$;

-- Celular abriu o QR. Confere evento, horário e QR; entrega um passe de 20 min.
-- Com p_id (check-in já feito neste celular): devolve o comprovante, se ainda vale.
create or replace function checkin.convidado_abrir(p_slug text, p_k text, p_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ev checkin.eventos; m bigint; v bigint; av record;
begin
  select * into ev from checkin.eventos where slug = lower(btrim(coalesce(p_slug, '')));
  if not found then return jsonb_build_object('erro', 'evento'); end if;
  if p_id is not null then
    select nome, horario into av from checkin.avulsos where id = p_id and evento_id = ev.id;
    if found then
      return jsonb_build_object('ok', true, 'comprovante', jsonb_build_object('nome', av.nome, 'horario', av.horario),
        'certificado', case when ev.certificado_ativo then jsonb_build_object(
          'ativo', true, 'horas', ev.certificado_horas,
          'liberado', ev.certificado_libera_em is null or ev.certificado_libera_em <= now(),
          'libera_em', ev.certificado_libera_em) else null end);
    end if;
  end if;
  if not ev.aberto then return jsonb_build_object('erro', 'indisponivel'); end if;
  if checkin.encerramento(ev) is not null then return jsonb_build_object('erro', 'encerrado'); end if;
  if ev.abre_em is not null and ev.abre_em > now() then return jsonb_build_object('erro', 'antes', 'abre_em', ev.abre_em); end if;
  m := checkin.qr_minuto();
  if ev.qr_rotativo then
    if coalesce(p_k, '') not in (checkin.qr_token(ev, m), checkin.qr_token(ev, m - 1)) then return jsonb_build_object('erro', 'chave'); end if;
  elsif coalesce(p_k, '') <> ev.qr_chave then
    return jsonb_build_object('erro', 'chave');
  end if;
  v := extract(epoch from now() + interval '20 minutes')::bigint;
  return jsonb_build_object('ok', true, 'passe', checkin.passe_de(ev, v), 'geo', ev.geo_ativo);
end $$;

-- Check-in feito pelo próprio convidado no celular.
create or replace function checkin.convidado_checkin(p_slug text, p_passe text, p_nome text, p_empresa text, p_dados jsonb,
                                                     p_lat double precision default null, p_lng double precision default null,
                                                     p_precisao double precision default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ev checkin.eventos; v bigint; v_ip text; reg bigint; r jsonb; campos jsonb;
begin
  select * into ev from checkin.eventos where slug = lower(btrim(coalesce(p_slug, '')));
  if not found then return jsonb_build_object('erro', 'evento'); end if;
  if not ev.aberto then return jsonb_build_object('erro', 'indisponivel'); end if;
  if checkin.encerramento(ev) is not null then return jsonb_build_object('erro', 'encerrado'); end if;
  if ev.abre_em is not null and ev.abre_em > now() then return jsonb_build_object('erro', 'antes', 'abre_em', ev.abre_em); end if;
  -- passe: dentro da validade e assinado com a chave atual
  begin v := split_part(coalesce(p_passe, ''), '.', 1)::bigint; exception when others then v := 0; end;
  if v < extract(epoch from now()) or coalesce(p_passe, '') <> checkin.passe_de(ev, v) then return jsonb_build_object('erro', 'passe'); end if;
  -- limite por celular/rede: 3 check-ins (ou 15 tentativas) a cada 10 minutos
  v_ip := checkin.ip();
  if (select count(*) filter (where ok) >= 3 or count(*) >= 15 from checkin.qr_registros
       where evento_id = ev.id and ip = v_ip and em > now() - interval '10 minutes') then
    return jsonb_build_object('erro', 'muitas');
  end if;
  insert into checkin.qr_registros (evento_id, ip) values (ev.id, v_ip) returning id into reg;
  -- localização: conta feita aqui (o celular nunca recebe as coordenadas do evento)
  if ev.geo_ativo then
    if p_lat is null or p_lng is null then return jsonb_build_object('erro', 'sem_local'); end if;
    if coalesce(p_precisao, 99999) > 1000 then return jsonb_build_object('erro', 'local_impreciso'); end if;
    if checkin.distancia(p_lat, p_lng, ev.geo_lat, ev.geo_lng) > ev.geo_raio + least(p_precisao, 100) then
      return jsonb_build_object('erro', 'longe');
    end if;
  end if;
  -- no celular o CPF é sempre obrigatório (é o que impede cadastro repetido)
  campos := (select coalesce(jsonb_agg(case when c->>'chave' = 'cpf' then c || '{"obrigatorio": true}'::jsonb else c end), '[]'::jsonb)
               from jsonb_array_elements(ev.campos) c);
  if not exists (select 1 from jsonb_array_elements(campos) c where c->>'chave' = 'cpf') then
    campos := campos || '[{"chave": "cpf", "obrigatorio": true}]'::jsonb;
  end if;
  ev.campos := campos;
  r := checkin.registrar_cadastro(ev, p_nome, p_empresa, 'Celular (QR)', p_dados);
  if r ? 'ok' then
    update checkin.qr_registros set ok = true where id = reg;
    if ev.certificado_ativo then
      r := r || jsonb_build_object('certificado', jsonb_build_object(
        'ativo', true, 'horas', ev.certificado_horas,
        'liberado', ev.certificado_libera_em is null or ev.certificado_libera_em <= now(),
        'libera_em', ev.certificado_libera_em));
    end if;
  end if;
  return r;
end $$;

-- =====================================================================
-- CERTIFICADOS DE PARTICIPAÇÃO
-- =====================================================================

create or replace function checkin.norm(t text)
returns text language sql immutable as $$
  select lower(translate(btrim(coalesce(t, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'));
$$;

-- Busca e emissão de certificado para participante presente
create or replace function checkin.obter_certificado(p_slug text, p_chave text default '', p_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  ev checkin.eventos;
  v_liberado boolean;
  v_id uuid;
  v_nome text;
  v_empresa text := '';
  v_cpf text := '';
  v_tipo text := 'avulso';
  v_codigo text;
  v_chave_limpa text;
  v_horario timestamptz;
  v_sem_presenca text;
  v_opcoes jsonb;
  v_contagem integer;
begin
  select * into ev from checkin.eventos where slug = lower(btrim(coalesce(p_slug, '')));
  if not found then return jsonb_build_object('erro', 'evento'); end if;
  if not ev.certificado_ativo then return jsonb_build_object('erro', 'desativado'); end if;

  v_liberado := (ev.certificado_libera_em is null or ev.certificado_libera_em <= now());
  v_chave_limpa := btrim(coalesce(p_chave, ''));

  if p_id is not null then
    -- Busca direta por ID de quem confirmou presena
    select a.id, a.nome, a.empresa, coalesce(a.cpf, ''), a.horario, 'avulso'
      into v_id, v_nome, v_empresa, v_cpf, v_horario, v_tipo
      from checkin.avulsos a where a.id = p_id and a.evento_id = ev.id;
    if not found then
      select p.id, p.nome, p.empresa, '', c.horario, 'lista'
        into v_id, v_nome, v_empresa, v_cpf, v_horario, v_tipo
        from checkin.pessoas p
        join checkin.checkins c on c.evento_id = ev.id and c.grupo = p.grupo
       where p.id = p_id and p.evento_id = ev.id limit 1;
    end if;
  elsif length(v_chave_limpa) > 0 then
    -- 1. Cdigo do certificado (CERT-...)
    if upper(v_chave_limpa) like 'CERT-%' then
      select pessoa_id, tipo, nome, empresa, cpf
        into v_id, v_tipo, v_nome, v_empresa, v_cpf
        from checkin.certificados
       where evento_id = ev.id and upper(codigo) = upper(v_chave_limpa)
       limit 1;
    end if;

    -- 2. CPF com 11 dgitos
    if v_id is null and regexp_replace(v_chave_limpa, '\D', '', 'g') ~ '^[0-9]{11}$' then
      select a.id, a.nome, a.empresa, coalesce(a.cpf, ''), a.horario, 'avulso'
        into v_id, v_nome, v_empresa, v_cpf, v_horario, v_tipo
        from checkin.avulsos a
       where a.evento_id = ev.id and a.cpf = regexp_replace(v_chave_limpa, '\D', '', 'g')
       limit 1;
    end if;

    -- 3. Nome exato (comparao normalizada sem acentos)
    if v_id is null then
      select a.id, a.nome, a.empresa, coalesce(a.cpf, ''), a.horario, 'avulso'
        into v_id, v_nome, v_empresa, v_cpf, v_horario, v_tipo
        from checkin.avulsos a
       where a.evento_id = ev.id and checkin.norm(a.nome) = checkin.norm(v_chave_limpa)
       limit 1;
    end if;

    if v_id is null then
      select p.id, p.nome, p.empresa, '', c.horario, 'lista'
        into v_id, v_nome, v_empresa, v_cpf, v_horario, v_tipo
        from checkin.pessoas p
        join checkin.checkins c on c.evento_id = ev.id and c.grupo = p.grupo
       where p.evento_id = ev.id and checkin.norm(p.nome) = checkin.norm(v_chave_limpa)
       limit 1;
    end if;

    -- 4. Nome parcial (contm) entre quem teve presena confirmada
    if v_id is null and length(checkin.norm(v_chave_limpa)) >= 2 then
      select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'nome', q.nome, 'empresa', q.empresa, 'cpf', q.cpf, 'horario', q.horario, 'tipo', q.tipo)), '[]'::jsonb),
             count(*)
        into v_opcoes, v_contagem
        from (
          select a.id, a.nome, a.empresa, coalesce(a.cpf, '') as cpf, a.horario, 'avulso' as tipo
            from checkin.avulsos a
           where a.evento_id = ev.id and checkin.norm(a.nome) like '%' || checkin.norm(v_chave_limpa) || '%'
          union all
          select distinct on (p.grupo) p.id, p.nome, p.empresa, '' as cpf, c.horario, 'lista' as tipo
            from checkin.pessoas p
            join checkin.checkins c on c.evento_id = ev.id and c.grupo = p.grupo
           where p.evento_id = ev.id and checkin.norm(p.nome) like '%' || checkin.norm(v_chave_limpa) || '%'
        ) q;

      if v_contagem = 1 then
        v_id := (v_opcoes->0->>'id')::uuid;
        v_nome := v_opcoes->0->>'nome';
        v_empresa := coalesce(v_opcoes->0->>'empresa', '');
        v_cpf := coalesce(v_opcoes->0->>'cpf', '');
        v_tipo := v_opcoes->0->>'tipo';
        v_horario := (v_opcoes->0->>'horario')::timestamptz;
      elsif v_contagem > 1 then
        return jsonb_build_object('ok', true, 'multiplos', true, 'opcoes', v_opcoes);
      end if;
    end if;

    -- 5. Se no encontrou entre os presentes, verifica se a pessoa estava na lista mas NO fez check-in
    if v_id is null then
      select p.nome into v_sem_presenca
        from checkin.pessoas p
       where p.evento_id = ev.id
         and (checkin.norm(p.nome) = checkin.norm(v_chave_limpa) or checkin.norm(p.nome) like '%' || checkin.norm(v_chave_limpa) || '%')
       limit 1;

      if v_sem_presenca is not null then
        return jsonb_build_object('erro', 'sem_presenca', 'nome', v_sem_presenca);
      end if;
    end if;
  end if;

  if v_id is null then
    return jsonb_build_object('erro', 'nao_encontrado');
  end if;

  v_codigo := 'CERT-' || upper(substr(ev.slug, 1, 4)) || '-' || upper(substr(md5(v_id::text || ev.id::text), 1, 8));

  insert into checkin.certificados (evento_id, codigo, pessoa_id, tipo, nome, empresa, cpf, horas)
  values (ev.id, v_codigo, v_id, v_tipo, v_nome, v_empresa, v_cpf, ev.certificado_horas)
  on conflict (codigo) do update set nome = excluded.nome, empresa = excluded.empresa, horas = excluded.horas;

  if not v_liberado then
    return jsonb_build_object('ok', true, 'liberado', false, 'libera_em', ev.certificado_libera_em,
                              'nome', v_nome, 'evento', ev.nome, 'codigo', v_codigo);
  end if;

  return jsonb_build_object(
    'ok', true, 'liberado', true,
    'id', v_id, 'nome', v_nome, 'empresa', v_empresa,
    'evento', ev.nome, 'subtitulo', ev.subtitulo, 'data', ev.data, 'horario', ev.horario, 'local', ev.local,
    'horas', ev.certificado_horas, 'emissor', ev.certificado_emissor, 'texto', ev.certificado_texto,
    'assinatura_nome', ev.certificado_assinatura_nome, 'assinatura_cargo', ev.certificado_assinatura_cargo,
    'assinatura_imagem', ev.certificado_assinatura_imagem,
    'codigo', v_codigo, 'horario_checkin', v_horario, 'tema', ev.tema,
    'cpf_parcial', case when length(v_cpf) = 11 then substr(v_cpf, 1, 3) || '.***.***-**' else '' end,
    'precisa_confirmar_cpf', (length(v_cpf) = 11 and not (length(regexp_replace(v_chave_limpa, '\D', '', 'g')) = 11)),
    'digitos_esperados', substr(v_cpf, 1, 3)
  );
end $$;

-- Validação pública do QR de autenticidade impresso no certificado
create or replace function checkin.validar_certificado(p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cert checkin.certificados;
  ev checkin.eventos;
begin
  select * into cert from checkin.certificados where codigo = upper(btrim(coalesce(p_codigo, '')));
  if not found then
    return jsonb_build_object('ok', true, 'valido', false);
  end if;
  select * into ev from checkin.eventos where id = cert.evento_id;
  return jsonb_build_object(
    'ok', true, 'valido', true,
    'codigo', cert.codigo,
    'nome', cert.nome,
    'empresa', cert.empresa,
    'horas', cert.horas,
    'emitido_em', cert.emitido_em,
    'evento', ev.nome,
    'data', ev.data
  );
end $$;

-- Lista de todos os presentes para impressão / lote da organização
create or replace function checkin.obter_presentes_certificado(p_evento_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  ev checkin.eventos;
begin
  perform checkin.exigir_admin();
  select * into ev from checkin.eventos where id = p_evento_id;
  if not found then raise exception 'Evento não encontrado.'; end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'nome', q.nome, 'empresa', q.empresa, 'cpf', q.cpf,
      'horario', q.horario, 'tipo', q.tipo,
      'codigo', 'CERT-' || upper(substr(ev.slug, 1, 4)) || '-' || upper(substr(md5(q.id::text || ev.id::text), 1, 8))
    ) order by q.nome), '[]'::jsonb)
    from (
      select a.id, a.nome, a.empresa, coalesce(a.cpf, '') as cpf, a.horario, 'avulso' as tipo
        from checkin.avulsos a where a.evento_id = ev.id
      union all
      select distinct on (p.grupo) p.id, p.nome, p.empresa, '' as cpf, c.horario, 'lista' as tipo
        from checkin.pessoas p
        join checkin.checkins c on c.evento_id = ev.id and c.grupo = p.grupo
       where p.evento_id = ev.id
    ) q
  );
end $$;

-- =====================================================================
-- Permissões das funções
-- =====================================================================
revoke all on all functions in schema checkin from public, anon, authenticated;

-- organização (login; e cada função confere checkin.admins)
grant execute on function checkin.sessao()                                   to authenticated;
grant execute on function checkin.listar_eventos()                           to authenticated;
grant execute on function checkin.obter_evento(uuid)                         to authenticated;
grant execute on function checkin.criar_evento(jsonb)                        to authenticated;
grant execute on function checkin.salvar_evento(uuid, jsonb)                 to authenticated;
grant execute on function checkin.salvar_imagem(uuid, text, text)            to authenticated;
grant execute on function checkin.novo_codigo(uuid)                          to authenticated;
grant execute on function checkin.duplicar_evento(uuid, text)                to authenticated;
grant execute on function checkin.excluir_evento(uuid)                       to authenticated;
grant execute on function checkin.encerrar_evento(uuid, boolean)             to authenticated;
grant execute on function checkin.zerar_presencas(uuid)                      to authenticated;
grant execute on function checkin.apagar_dados_pessoais(uuid)                to authenticated;
grant execute on function checkin.salvar_lista(uuid, jsonb)                  to authenticated;
grant execute on function checkin.excluir_lista(uuid)                        to authenticated;
grant execute on function checkin.salvar_pessoas(uuid, jsonb, text, jsonb)   to authenticated;
grant execute on function checkin.adicionar_pessoa(uuid, jsonb)              to authenticated;
grant execute on function checkin.editar_pessoa(uuid, jsonb)                 to authenticated;
grant execute on function checkin.remover_pessoa(uuid)                       to authenticated;
grant execute on function checkin.novo_qr_convidados(uuid)                   to authenticated;

-- tablets e painel (link + código)
grant execute on function checkin.evento_publico(text)                       to anon, authenticated;
grant execute on function checkin.imagem(text, text)                         to anon, authenticated;
grant execute on function checkin.sincronizar(text, text, bigint, bigint)    to anon, authenticated;
grant execute on function checkin.fazer_checkin(text, text, text, text)      to anon, authenticated;
grant execute on function checkin.desfazer_checkin(text, text, text[])       to anon, authenticated;
grant execute on function checkin.cadastrar_avulso(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function checkin.remover_avulso(text, text, uuid)           to anon, authenticated;
grant execute on function checkin.qr_atual(text, text)                       to anon, authenticated;
grant execute on function checkin.convidado_abrir(text, text, uuid)          to anon, authenticated;
grant execute on function checkin.convidado_checkin(text, text, text, text, jsonb, double precision, double precision, double precision) to anon, authenticated;
grant execute on function checkin.obter_presentes_certificado(uuid) to authenticated;
grant execute on function checkin.obter_certificado(text, text, uuid) to anon, authenticated;
grant execute on function checkin.validar_certificado(text) to anon, authenticated;

select 'Banco do check-in de eventos pronto' as resultado;

