/* Check-in de Eventos — check-in pelo celular do próprio convidado (/q/<evento>/<chave do QR>).
   Só faz o próprio check-in: não recebe nomes de ninguém, nem a lista, nem as coordenadas do evento. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const C = window.Comum, F = window.Formulario;
  const sb = window.supabase.createClient(window.CONFIG.supabaseUrl, window.CONFIG.supabaseKey, { db: { schema: "checkin" }, auth: { persistSession: false } });
  const partes = location.pathname.split("/");
  const SLUG = decodeURIComponent(partes[2] || "").toLowerCase(), K = decodeURIComponent(partes[3] || "");
  const CHAVE = `checkin:${SLUG}:comprovante`;
  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch { return null; } };
  const gravar = (v) => { try { if (v) localStorage.setItem(CHAVE, JSON.stringify(v)); else localStorage.removeItem(CHAVE); } catch { /* sem armazenamento */ } };

  let evento = null, passe = "", pedeLocal = false, campos = [];

  function tela(qual) {
    $("cAviso").hidden = qual !== "aviso";
    $("cForm").hidden = qual !== "form";
    $("cOk").hidden = qual !== "ok";
  }
  function aviso(titulo, texto) { $("cAvisoTit").textContent = titulo; $("cAvisoTxt").textContent = texto || ""; tela("aviso"); }
  const quando = (iso) => {
    const d = new Date(iso), hoje = new Date();
    return (d.toDateString() === hoje.toDateString() ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} `) + "às " + C.hhmm(iso);
  };
  const RECEPCAO = "Faça o check-in na recepção do evento.";
  function erroAbertura(r) {
    if (r.erro === "chave") return aviso("QR code vencido", evento && evento.qr_rotativo
      ? "Este QR code muda a cada minuto. Escaneie de novo o QR que está na entrada do evento."
      : "Este QR code não vale mais. Escaneie o QR code atual do evento ou procure a recepção.");
    if (r.erro === "antes") return aviso("O check-in ainda não abriu", `O check-in pelo celular abre ${quando(r.abre_em)}.`);
    if (r.erro === "encerrado") return aviso("Check-in encerrado", "O check-in deste evento já foi encerrado.");
    if (r.erro === "indisponivel") return aviso("Check-in pelo celular indisponível", RECEPCAO);
    if (r.erro === "evento") return aviso("Evento não encontrado", "Confira o QR code com a organização.");
    return aviso("Não foi possível continuar", RECEPCAO);
  }

  /* ---------- Comprovante e Certificado ---------- */
  let relogio = null;

  function mostrarModalCertificado(dados) {
    const papel = $("certContainer");
    papel.innerHTML = C.gerarHtmlCertificado(dados);
    const imp = $("impressaoCert");
    imp.innerHTML = C.gerarHtmlCertificado(dados);

    // QR de autenticidade
    if (window.qrcode && dados.codigo) {
      const urlValidar = `${location.origin}/e/${SLUG}#validar&cod=${encodeURIComponent(dados.codigo)}`;
      const qr = window.qrcode(0, "M");
      qr.addData(urlValidar); qr.make();
      const svg = qr.createSvgTag(3, 0);
      const q1 = papel.querySelector(".cert-qr"); if (q1) q1.innerHTML = svg;
      const q2 = imp.querySelector(".cert-qr"); if (q2) q2.innerHTML = svg;
    }

    $("modalCert").hidden = false;
    $("btnImprimirCert").onclick = () => {
      const tituloAntes = document.title;
      const evNome = dados.evento || (evento && evento.nome) || "Evento";
      const nomePessoa = dados.nome || "Participante";
      const carga = dados.horas != null && dados.horas !== "" ? `${dados.horas}h` : "4h";
      const nomeArquivo = `Certificado - ${evNome} - ${nomePessoa} - ${carga}`.replace(/[\\/:*?"<>|]/g, " ");
      document.title = nomeArquivo;
      let estiloPrint = document.getElementById("estiloPrintCert");
      if (!estiloPrint) {
        estiloPrint = document.createElement("style");
        estiloPrint.id = "estiloPrintCert";
        estiloPrint.textContent = "@page { size: A4 landscape; margin: 0; }";
        document.head.appendChild(estiloPrint);
      }
      window.print();
      setTimeout(() => {
        document.title = tituloAntes;
        if (estiloPrint && estiloPrint.parentNode) estiloPrint.parentNode.removeChild(estiloPrint);
      }, 2000);
    };
  }

  function comprovante(c) {
    $("okNome").textContent = C.nomePadrao(c.nome);
    const d = new Date(c.horario);
    $("okHora").textContent = `Check-in às ${C.hhmm(c.horario)} de ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    tela("ok");
    // Relógio correndo: mostra que é a tela de verdade, não um print antigo.
    const tic = () => { $("okRelogio").textContent = new Date().toLocaleTimeString("pt-BR"); };
    tic(); clearInterval(relogio); relogio = setInterval(tic, 1000);

    // Certificado e WhatsApp
    const certAtivo = (c.certificado && c.certificado.ativo) || (evento && evento.certificado_ativo);
    if (certAtivo) {
      const liberaEm = (c.certificado && c.certificado.libera_em) || (evento && evento.certificado_libera_em);
      const liberado = c.certificado && "liberado" in c.certificado ? c.certificado.liberado : (!liberaEm || new Date(liberaEm) <= new Date());
      $("compCert").hidden = false;

      if (liberado) {
        $("compCertMsg").textContent = "Seu certificado está liberado para download.";
        $("btnBaixarCert").hidden = false;
        $("btnZapCert").innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.41a8.165 8.165 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.24-.74-.66-1.24-1.48-1.39-1.73-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.32-.02-.45-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.23.25-.87.85-.87 2.07s.89 2.4 1.02 2.57c.13.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.12-.22-.19-.47-.32"/></svg> Enviar link para o meu WhatsApp`;
      } else {
        $("compCertMsg").textContent = "Estará liberado para download " + (liberaEm ? C.quandoCurto(liberaEm) : "após o evento") + ".";
        $("btnBaixarCert").hidden = true;
        $("btnZapCert").innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.41a8.165 8.165 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.24-.74-.66-1.24-1.48-1.39-1.73-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.32-.02-.45-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.23.25-.87.85-.87 2.07s.89 2.4 1.02 2.57c.13.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.12-.22-.19-.47-.32"/></svg> Salvar link no meu WhatsApp`;
      }

      $("btnZapCert").onclick = () => {
        const link = `${location.origin}/e/${SLUG}#certificado&id=${c.id}`;
        const quandoTxt = liberaEm ? C.quandoCurto(liberaEm) : "breve";
        const texto = `Olá! Aqui está o link para você baixar seu certificado do evento "${evento.nome}" (liberado a partir de ${quandoTxt}):\n${link}`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`, "_blank");
      };

      $("btnBaixarCert").onclick = async () => {
        const btn = $("btnBaixarCert");
        btn.disabled = true;
        btn.textContent = "Carregando certificado…";
        try {
          const resp = await sb.rpc("obter_certificado", { p_slug: SLUG, p_id: c.id });
          if (resp.error) throw resp.error;
          const r = resp.data;
          if (!r || !r.ok || !r.liberado) throw new Error("Certificado ainda não liberado.");
          mostrarModalCertificado(r);
        } catch (err) {
          alert(err.message || "Não foi possível carregar o certificado.");
        } finally {
          btn.disabled = false;
          btn.textContent = "Baixar meu Certificado (PDF)";
        }
      };
    } else {
      $("compCert").hidden = true;
    }
  }

  /* ---------- Localização ---------- */
  function localizacao() {
    return new Promise((ok, falha) => {
      if (!navigator.geolocation) return falha(new Error("sem"));
      navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy }),
        (e) => falha(e), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }

  /* ---------- Envio ---------- */
  const erroForm = (msg, foco) => { $("aErr").textContent = msg; $("aErr").hidden = false; if (foco) { foco.classList.add("invalido"); foco.focus(); } };
  const campo = (k) => $("aCampos").querySelector(`[data-campo="${k}"]`);
  F.ligarMascaras($("aCampos"));
  $("cForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("aErr").hidden = true;
    const f = F.coletar({ nome: $("aNome"), area: $("aCampos"), campos, consente: $("aConsente"), exigirSobrenome: true });
    if (f.erro) { erroForm(f.erro, f.foco); return; }
    const botao = $("cEnviar");
    botao.disabled = true;
    let local = { lat: null, lng: null, precisao: null };
    if (pedeLocal) {
      botao.textContent = "Confirmando sua localização…";
      try { local = await localizacao(); }
      catch {
        try {
          await sb.rpc("convidado_checkin", {
            p_slug: SLUG, p_passe: passe, p_nome: f.nome, p_empresa: f.empresa, p_dados: f.dados,
            p_lat: null, p_lng: null, p_precisao: null
          });
        } catch (_) {}
        botao.disabled = false; botao.textContent = "Fazer check-in";
        aviso("Não foi possível confirmar que você está no local", "Verifique se a localização do celular está ligada e permitida para o navegador, e escaneie o QR de novo. Ou " + RECEPCAO.charAt(0).toLowerCase() + RECEPCAO.slice(1));
        return;
      }
    }
    botao.textContent = "Enviando…";
    let r;
    try {
      const resp = await sb.rpc("convidado_checkin", { p_slug: SLUG, p_passe: passe, p_nome: f.nome, p_empresa: f.empresa, p_dados: f.dados,
        p_lat: local.lat, p_lng: local.lng, p_precisao: local.precisao });
      if (resp.error) throw resp.error;
      r = resp.data;
    } catch { r = { erro: "rede" }; }
    botao.disabled = false; botao.textContent = "Fazer check-in";
    if (r.ok) {
      const c = { id: r.id, nome: f.nome, horario: r.horario, certificado: r.certificado };
      gravar(c); comprovante(c);
      return;
    }
    if (r.erro === "longe" || r.erro === "sem_local") return aviso("Você precisa estar no local do evento", "Não foi possível confirmar que você está no local. " + RECEPCAO);
    if (r.erro === "local_impreciso") return aviso("Localização imprecisa", "Ative a \"localização exata\" do celular para o navegador e escaneie o QR de novo. Ou " + RECEPCAO.charAt(0).toLowerCase() + RECEPCAO.slice(1));
    if (r.erro === "muitas") return erroForm("Muitos check-ins a partir desta rede. Aguarde alguns minutos ou faça o check-in na recepção.");
    if (r.erro === "passe") return aviso("O tempo para preencher acabou", "Escaneie o QR code de novo para fazer o check-in.");
    if (r.erro === "rede") return erroForm("Sem conexão. Verifique a internet e tente de novo.");
    if (["antes", "encerrado", "indisponivel", "evento"].includes(r.erro)) return erroAbertura(r);
    const foco = r.erro === "campo" ? campo(r.campo) : r.erro === "consentimento" ? $("aConsente") : r.erro === "cpf_repetido" ? campo("cpf") : null;
    erroForm(F.mensagemErro(r, true), foco);
  });

  /* ---------- Início ---------- */
  async function iniciar() {
    let pub;
    try { const r = await sb.rpc("evento_publico", { p_slug: SLUG }); if (r.error) throw r.error; pub = r.data; }
    catch { $("cNome").textContent = "Check-in"; aviso("Sem conexão", "Verifique a internet e escaneie o QR de novo."); return; }
    if (!pub || pub.erro) { $("cNome").textContent = "Check-in"; aviso("Evento não encontrado", "Confira o QR code com a organização."); return; }
    evento = pub;
    const v = C.aplicarTema(document.documentElement, evento.tema);
    $("corTema").content = v["--fundo2"];
    document.title = evento.nome + " · Check-in";
    $("cNome").textContent = evento.nome;
    $("cInfo").textContent = [C.dataExtenso(evento.data), evento.local].filter(Boolean).join(" · ");
    if (evento.imagens && evento.imagens.arte) {
      sb.rpc("imagem", { p_slug: SLUG, p_tipo: "arte" }).then((r) => { if (r.data) { $("cArte").src = r.data; $("cArte").hidden = false; } }).catch(() => {});
    }
    // Já fez check-in neste celular? Mostra o comprovante (se ainda vale).
    const salvo = ler();
    let r;
    try {
      if (salvo && salvo.id) {
        const c = (await sb.rpc("convidado_abrir", { p_slug: SLUG, p_k: K, p_id: salvo.id })).data;
        if (c && c.comprovante) { comprovante({ ...c.comprovante, id: salvo.id, certificado: c.certificado }); return; }
        gravar(null);
      }
      const resp = await sb.rpc("convidado_abrir", { p_slug: SLUG, p_k: K, p_id: null });
      if (resp.error) throw resp.error;
      r = resp.data;
    } catch { aviso("Sem conexão", "Verifique a internet e escaneie o QR de novo."); return; }
    if (!r.ok) { erroAbertura(r); return; }
    passe = r.passe; pedeLocal = !!r.geo;
    campos = F.camposCom(evento.campos, { cpfObrigatorio: true });
    $("aCampos").innerHTML = F.html(campos);
    $("aLgpdTexto").textContent = (evento.lgpd_texto || C.textoLgpdPadrao(evento.nome)) +
      (pedeLocal ? " Minha localização é usada só para confirmar que estou no local e não é guardada." : "");
    $("cGeoAviso").hidden = !pedeLocal;
    tela("form");
  }
  iniciar();
})();
