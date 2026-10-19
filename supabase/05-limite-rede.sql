-- =====================================================================
-- 05-limite-rede.sql — limite do check-in pelo celular por rede (19/10/2026)
-- Projeto Supabase: hb-sistemas. Rodar inteiro no SQL Editor (pode rodar de novo).
--
-- Antes: 3 check-ins (ou 15 tentativas) por IP a cada 10 minutos. No Wi-Fi do
-- evento todos os celulares saem pelo mesmo IP, então isso barrava gente de
-- verdade. Agora: 60 check-ins (ou 150 tentativas) por IP a cada 10 minutos.
-- Só muda a função checkin.convidado_checkin (o resto é igual ao 04).
-- =====================================================================

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

grant execute on function checkin.convidado_checkin(text, text, text, text, jsonb, double precision, double precision, double precision) to anon, authenticated;
