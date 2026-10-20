-- =====================================================================
-- 06-zerar-bloqueios.sql — "Zerar presenças" também limpa os bloqueios (19/10/2026)
-- Projeto Supabase: hb-sistemas. Rodar inteiro no SQL Editor (pode rodar de novo).
--
-- O 03-bloqueios-geo.sql não trazia esta função, então no ar o botão "Zerar
-- presenças" deixava os bloqueios por localização. Agora apaga também esses
-- bloqueios e o contador de check-ins pelo celular por rede.
-- =====================================================================

-- Apaga presenças, cadastros na hora, bloqueios por localização e o contador
-- do check-in pelo celular (depois dos testes). As listas ficam.
create or replace function checkin.zerar_presencas(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform checkin.exigir_admin();
  delete from checkin.checkins where evento_id = p_id;
  delete from checkin.avulsos where evento_id = p_id;
  delete from checkin.bloqueios_geo where evento_id = p_id;
  delete from checkin.qr_registros where evento_id = p_id;
  perform checkin.mudou_presencas(p_id);
end $$;

grant execute on function checkin.zerar_presencas(uuid) to authenticated;
