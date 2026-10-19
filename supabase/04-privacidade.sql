-- =====================================================================
-- 04-privacidade.sql — correções de privacidade (19/10/2026)
-- Projeto Supabase: hb-sistemas. Rodar inteiro no SQL Editor (pode rodar de novo).
--
-- 1. O painel dos tablets (código do evento) deixa de receber CPF, telefone,
--    e-mail e localização de quem foi barrado pela localização.
-- 2. A localização da pessoa barrada deixa de ser guardada (fica só o motivo
--    e a distância) e as localizações já guardadas são apagadas.
-- 3. A busca pública do certificado nunca devolve CPF; achando só pelo nome,
--    pede o CPF completo antes de emitir; busca por pedaço de nome exige
--    4 letras e no máximo 6 resultados.
-- =====================================================================

-- apaga as localizações já guardadas
update checkin.bloqueios_geo set lat = null, lng = null, precisao = null
 where lat is not null or lng is not null or precisao is not null;

create or replace function checkin.convidado_checkin(p_slug text, p_passe text, p_nome text, p_empresa text, p_dados jsonb,
                                                     p_lat double precision default null, p_lng double precision default null,
                                                     p_precisao double precision default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  ev checkin.eventos;
  v bigint;
  v_ip text;
  reg bigint;
  r jsonb;
  campos jsonb;
  v_dist double precision;
  v_cpf text;
  v_tel text;
  v_email text;
begin
  select * into ev from checkin.eventos where slug = lower(btrim(coalesce(p_slug, '')));
  if not found then return jsonb_build_object('erro', 'evento'); end if;
  if not ev.aberto then return jsonb_build_object('erro', 'indisponivel'); end if;
  if checkin.encerramento(ev) is not null then return jsonb_build_object('erro', 'encerrado'); end if;
  if ev.abre_em is not null and ev.abre_em > now() then return jsonb_build_object('erro', 'antes', 'abre_em', ev.abre_em); end if;
  -- passe: dentro da validade e assinado com a chave atual
  begin v := split_part(coalesce(p_passe, ''), '.', 1)::bigint; exception when others then v := 0; end;
  if v < extract(epoch from now()) or coalesce(p_passe, '') <> checkin.passe_de(ev, v) then return jsonb_build_object('erro', 'passe'); end if;
  -- limite por rede: 60 check-ins (ou 150 tentativas) a cada 10 minutos.
  -- Alto de propósito: no Wi-Fi do evento (e em muitas operadoras) vários celulares
  -- saem pelo mesmo IP. A proteção principal é o CPF único, o QR e a localização.
  v_ip := checkin.ip();
  if (select count(*) filter (where ok) >= 60 or count(*) >= 150 from checkin.qr_registros
       where evento_id = ev.id and ip = v_ip and em > now() - interval '10 minutes') then
    return jsonb_build_object('erro', 'muitas');
  end if;
  insert into checkin.qr_registros (evento_id, ip) values (ev.id, v_ip) returning id into reg;

  -- localização: conta feita aqui (o celular nunca recebe as coordenadas do evento)
  if ev.geo_ativo then
    v_cpf := btrim(coalesce(p_dados->>'cpf', ''));
    v_tel := btrim(coalesce(p_dados->>'telefone', ''));
    v_email := btrim(coalesce(p_dados->>'email', ''));

    if p_lat is null or p_lng is null then
      insert into checkin.bloqueios_geo (evento_id, nome, empresa, cpf, telefone, email, dados, motivo, raio_permitido, ip)
      values (ev.id, coalesce(p_nome, ''), coalesce(p_empresa, ''), v_cpf, v_tel, v_email, coalesce(p_dados, '{}'::jsonb), 'sem_local', ev.geo_raio, v_ip);
      return jsonb_build_object('erro', 'sem_local');
    end if;

    if coalesce(p_precisao, 99999) > 1000 then
      insert into checkin.bloqueios_geo (evento_id, nome, empresa, cpf, telefone, email, dados, motivo, raio_permitido, ip)
      values (ev.id, coalesce(p_nome, ''), coalesce(p_empresa, ''), v_cpf, v_tel, v_email, coalesce(p_dados, '{}'::jsonb), 'local_impreciso', ev.geo_raio, v_ip);
      return jsonb_build_object('erro', 'local_impreciso');
    end if;

    v_dist := checkin.distancia(p_lat, p_lng, ev.geo_lat, ev.geo_lng);
    if v_dist > ev.geo_raio + least(p_precisao, 100) then
      insert into checkin.bloqueios_geo (evento_id, nome, empresa, cpf, telefone, email, dados, motivo, distancia_metros, raio_permitido, ip)
      values (ev.id, coalesce(p_nome, ''), coalesce(p_empresa, ''), v_cpf, v_tel, v_email, coalesce(p_dados, '{}'::jsonb), 'longe', round(v_dist::numeric, 1), ev.geo_raio, v_ip);
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

create or replace function checkin.obter_bloqueios_geo(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'nome', b.nome,
      'empresa', b.empresa,
      'cpf', b.cpf,
      'telefone', b.telefone,
      'email', b.email,
      'dados', b.dados,
      'motivo', b.motivo,
      'distancia_metros', b.distancia_metros,
      'raio_permitido', b.raio_permitido,
      'em', b.em
    ) order by b.em desc)
    from checkin.bloqueios_geo b
    where b.evento_id = p_id
  ), '[]'::jsonb);
end $$;

create or replace function checkin.bloqueios_geo_painel(p_slug text, p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a jsonb;
  v_id uuid;
begin
  a := checkin.acesso(p_slug, p_codigo);
  if a ? 'erro' then return a; end if;
  v_id := (a->>'id')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'nome', b.nome,
      'empresa', b.empresa,
      'motivo', b.motivo,
      'distancia_metros', b.distancia_metros,
      'raio_permitido', b.raio_permitido,
      'em', b.em
    ) order by b.em desc)
    from checkin.bloqueios_geo b
    where b.evento_id = v_id
  ), '[]'::jsonb);
end $$;

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
  v_prova boolean := false;   -- achou pelo id (celular), pelo código CERT ou pelo CPF completo
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
    v_prova := v_id is not null;
  elsif length(v_chave_limpa) > 0 then
    -- 1. Cdigo do certificado (CERT-...)
    if upper(v_chave_limpa) like 'CERT-%' then
      select pessoa_id, tipo, nome, empresa, cpf
        into v_id, v_tipo, v_nome, v_empresa, v_cpf
        from checkin.certificados
       where evento_id = ev.id and upper(codigo) = upper(v_chave_limpa)
       limit 1;
      v_prova := v_id is not null;
    end if;

    -- 2. CPF com 11 dgitos
    if v_id is null and regexp_replace(v_chave_limpa, '\D', '', 'g') ~ '^[0-9]{11}$' then
      select a.id, a.nome, a.empresa, coalesce(a.cpf, ''), a.horario, 'avulso'
        into v_id, v_nome, v_empresa, v_cpf, v_horario, v_tipo
        from checkin.avulsos a
       where a.evento_id = ev.id and a.cpf = regexp_replace(v_chave_limpa, '\D', '', 'g')
       limit 1;
      v_prova := v_id is not null;
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
    if v_id is null and length(checkin.norm(v_chave_limpa)) >= 4 then
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
      elsif v_contagem > 6 then
        return jsonb_build_object('erro', 'muitos');
      elsif v_contagem > 1 then
        -- Nunca devolve CPF nem id: a pessoa escolhe o nome e prova com o CPF (quando houver).
        return jsonb_build_object('ok', true, 'multiplos', true, 'opcoes',
          (select jsonb_agg(jsonb_build_object('nome', o->>'nome', 'empresa', o->>'empresa', 'pede_cpf', length(coalesce(o->>'cpf', '')) = 11))
             from jsonb_array_elements(v_opcoes) o));
      end if;
    end if;

    -- 5. Se no encontrou entre os presentes, verifica se a pessoa estava na lista mas NO fez check-in
    if v_id is null then
      select p.nome into v_sem_presenca
        from checkin.pessoas p
       where p.evento_id = ev.id and checkin.norm(p.nome) = checkin.norm(v_chave_limpa)
       limit 1;

      if v_sem_presenca is not null then
        return jsonb_build_object('erro', 'sem_presenca', 'nome', v_sem_presenca);
      end if;
    end if;
  end if;

  if v_id is null then
    return jsonb_build_object('erro', 'nao_encontrado');
  end if;

  if not v_prova and length(v_cpf) = 11 then
    return jsonb_build_object('ok', true, 'precisa_cpf', true, 'nome', v_nome);
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
    'cpf_parcial', case when length(v_cpf) = 11 then substr(v_cpf, 1, 3) || '.***.***-**' else '' end
  );
end $$;

revoke all on function checkin.obter_bloqueios_geo(uuid) from public, anon;
grant execute on function checkin.obter_bloqueios_geo(uuid) to authenticated;
grant execute on function checkin.bloqueios_geo_painel(text, text) to anon, authenticated;
grant execute on function checkin.obter_certificado(text, text, uuid) to anon, authenticated;
grant execute on function checkin.convidado_checkin(text, text, text, text, jsonb, double precision, double precision, double precision) to anon, authenticated;

select 'Correções de privacidade aplicadas' as resultado,
       (select count(*) from checkin.bloqueios_geo where lat is not null) as localizacoes_guardadas;
