/* Check-in de Eventos — link do evento (/e/<evento>): código de acesso, recepção (equipe ou totem) e sincronização. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const C = window.Comum, { esc, norm, nomePadrao, bonita, hhmm } = C;
  const sb = window.supabase.createClient(window.CONFIG.supabaseUrl, window.CONFIG.supabaseKey, { db: { schema: "checkin" }, auth: { persistSession: false } });

  /* ================= Endereço, código e aparelho ================= */
  const SLUG = decodeURIComponent(location.pathname.split("/")[2] || "").toLowerCase();
  const K = (k) => `checkin:${SLUG}:${k}`;
  const ler = (k) => { try { return localStorage.getItem(K(k)) || ""; } catch { return ""; } };
  const gravar = (k, v) => { try { if (v == null || v === "") localStorage.removeItem(K(k)); else localStorage.setItem(K(k), v); } catch { /* sem armazenamento: vale só nesta visita */ } };
  // QR code da equipe traz o código no link (?c=): guarda e tira do endereço.
  const doLink = new URLSearchParams(location.search).get("c");
  if (doLink) { gravar("codigo", doLink.trim()); history.replaceState(null, "", location.pathname + location.hash); }
  let codigo = ler("codigo");
  let dispositivo = ler("aparelho");

  /* ================= Estado ================= */
  let evento = null, versao = 0, marca = -1;
  let listas = [], pessoasBrutas = [], checkins = [], avulsos = [];
  let loaded = false, somenteConsulta = false, appAberto = false;
  // Encerramento: o servidor decide; o tablet acompanha o relógio do servidor para trocar de tela na hora.
  let desvio = 0, encerradoServidor = false, encerramento = null;
  let grupos = new Map(), slugToGrupo = new Map(), presenca = new Map();
  const totem = () => evento && evento.modo === "totem";

  /* ================= Telas de entrada ================= */
  function aviso(titulo, texto) {
    $("telaAviso").hidden = false; $("telaCodigo").hidden = true;
    $("avisoTitulo").textContent = titulo; $("avisoTexto").textContent = texto || "";
    mostrarApp(false);
  }
  function mostrarCodigo(msg) {
    pararSync();
    $("telaAviso").hidden = true; $("telaCodigo").hidden = false;
    mostrarApp(false);
    $("codigoNome").textContent = evento ? evento.nome : "";
    $("codigoInfo").textContent = evento ? [evento.subtitulo, C.dataExtenso(evento.data), evento.local].filter(Boolean).join(" · ") : "";
    $("codigoErro").textContent = msg || "";
    $("campoCodigo").value = "";
    $("campoCodigo").focus();
  }
  function mostrarApp(sim) {
    appAberto = sim;
    for (const id of ["topo", "faixa"]) $(id).hidden = !sim;
    if (!sim) { for (const id of ["v-recepcao", "v-painel", "v-certificado", "v-validar", "consultaAviso", "offline", "telaEncerrado", "avisoEncerra"]) $(id).hidden = true; return; }
    $("telaAviso").hidden = true; $("telaCodigo").hidden = true;
    route();
    verificarHorario();
  }

  $("formCodigo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tentativa = $("campoCodigo").value.replace(/\D/g, "");
    if (tentativa.length !== 6) { $("codigoErro").textContent = "O código tem 6 números."; return; }
    $("btnCodigo").disabled = true; $("codigoErro").textContent = "";
    try {
      const { data, error } = await sb.rpc("sincronizar", { p_slug: SLUG, p_codigo: tentativa, p_versao: 0, p_marca: -1 });
      if (error) throw error;
      if (data.erro === "codigo") { $("codigoErro").textContent = "Código incorreto. Confira com a organização."; $("campoCodigo").select(); return; }
      if (data.erro) return tratarErroAcesso(data.erro);
      codigo = tentativa; gravar("codigo", codigo);
      aplicar(data);
      abrir();
    } catch {
      $("codigoErro").textContent = "Sem conexão com o servidor. Verifique a internet.";
    } finally { $("btnCodigo").disabled = false; }
  });

  function tratarErroAcesso(erro) {
    if (erro === "evento") { gravar("codigo", ""); aviso("Evento não encontrado", "Este link não existe mais. Confira com a organização."); return; }
    if (erro === "bloqueado") { mostrarCodigo("Muitas tentativas com código errado neste aparelho. Aguarde 10 minutos."); return; }
    // Código trocado pela organização (ou errado).
    codigo = ""; gravar("codigo", "");
    mostrarCodigo(appAberto || loaded ? "O código do evento mudou. Peça o novo código à organização." : "");
  }

  /* ================= Evento: tema, textos e imagens ================= */
  function aplicarEvento() {
    const v = C.aplicarTema(document.documentElement, evento.tema);
    $("corTema").content = v["--fundo2"];
    document.title = evento.nome + " · Check-in";
    document.body.classList.toggle("totem", totem());
    $("heroNome").textContent = evento.nome;
    $("heroSub").textContent = [evento.subtitulo, C.dataExtenso(evento.data), evento.horario, evento.local].filter(Boolean).join(" · ");
    $("q").placeholder = totem() ? "Digite seu nome" : "Nome ou empresa";
    $("q").setAttribute("aria-label", totem() ? "Digite seu nome" : "Buscar por nome ou empresa");
    $("addTxt").textContent = totem() ? "Não encontrei meu nome" : "Cadastrar agora";
    $("totemChamada").hidden = !totem();
    $("nav").hidden = totem();
    $("navCertificado").hidden = totem() || !evento.certificado_ativo;
    ajustarModoAberto();
    carregarImagens();
  }
  const imagensPedidas = {};
  async function carregarImagens() {
    for (const tipo of ["arte", "logo"]) {
      const ts = evento.imagens && evento.imagens[tipo];
      const alvos = tipo === "arte" ? ["arte", "codigoArte", "encArte", "qrArte"] : ["logo"];
      if (!ts) { alvos.forEach((id) => { $(id).hidden = true; }); if (tipo === "arte") $("heroTitulo").hidden = false; continue; }
      if (imagensPedidas[tipo] === ts) continue;
      imagensPedidas[tipo] = ts;
      let url = "";
      try { const c = JSON.parse(ler("img-" + tipo) || "{}"); if (c.ts === ts) url = c.url; } catch { /* sem cópia guardada */ }
      if (!url) {
        try { const r = await sb.rpc("imagem", { p_slug: SLUG, p_tipo: tipo }); url = r.data || ""; if (url) gravar("img-" + tipo, JSON.stringify({ ts, url })); }
        catch { imagensPedidas[tipo] = null; }
      }
      alvos.forEach((id) => { $(id).hidden = !url; if (url) $(id).src = url; });
      if (tipo === "arte") $("heroTitulo").hidden = !!url;
    }
  }

  /* ================= Sincronização ================= */
  function aplicar(d) {
    let mudou = false;
    if (d.evento) {
      evento = d.evento; aplicarEvento();
      listas = (d.listas || []).slice().sort((a, b) => a.ordem - b.ordem);
      pessoasBrutas = d.pessoas || [];
      mudou = true;
    }
    if (d.checkins) {
      checkins = d.checkins.map(([grupo, horario, disp]) => ({ grupo, horario, dispositivo: disp }));
      avulsos = d.avulsos.map(([id, nome, empresa, horario, disp]) => ({ id, nome: nomePadrao(nome), empresa, horario, dispositivo: disp }));
      mudou = true;
    }
    versao = d.versao; marca = d.marca;
    if (d.agora) desvio = Date.parse(d.agora) - Date.now();
    if ("encerrado" in d) { encerradoServidor = !!d.encerrado; encerramento = d.encerramento || null; }
    else if (d.evento) { encerradoServidor = !!d.evento.encerrado; encerramento = d.evento.encerramento || null; }
    verificarHorario();
    if (mudou) {
      loaded = true; derive();
      // Configuração mudou (ex.: virou totem): refaz cabeçalho e tela.
      if (d.evento) route(); else render();
    }
  }
  let sincronizando = false, timer = null, rodando = false;
  async function sincronizar() {
    if (sincronizando || !codigo) return;
    sincronizando = true;
    try {
      const { data, error } = await sb.rpc("sincronizar", { p_slug: SLUG, p_codigo: codigo, p_versao: versao, p_marca: marca });
      if (error) throw error;
      if (data.erro) { tratarErroAcesso(data.erro); return; }
      aplicar(data);
      setLive(true);
    } catch {
      setLive(false, navigator.onLine ? "Reconectando…" : "Sem internet");
    } finally { sincronizando = false; }
  }
  function agendar() {
    clearTimeout(timer);
    if (!rodando) return;
    timer = setTimeout(async () => { await sincronizar(); agendar(); }, document.hidden ? 15000 : 3000);
  }
  function pararSync() { rodando = false; clearTimeout(timer); }
  function abrir() {
    mostrarApp(true);
    rodando = true; setLive(true); agendar();
    if (!dispositivo && view() !== "qr") pedirDev();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && rodando) { sincronizar(); agendar(); } });
  function setLive(ok, txt) {
    $("live").classList.toggle("off", !ok);
    $("liveTxt").textContent = txt || (ok ? "Online" : "Reconectando…");
    $("offline").hidden = !appAberto || ok;
  }
  window.addEventListener("online", () => { $("offline").hidden = true; if (rodando) sincronizar(); });
  window.addEventListener("offline", () => { setLive(false, "Sem internet"); if (appAberto) $("offline").hidden = false; });

  /* ================= Pessoas (grupos = mesma pessoa em várias listas) ================= */
  let M = window.Presenca.montar([], [], [], []);   // grupos, presença e membros das listas
  function derive() {
    M = window.Presenca.montar(listas, pessoasBrutas, checkins, avulsos);
    grupos = M.grupos; slugToGrupo = M.slugToGrupo; presenca = M.presenca;
  }
  const empresaTxt = window.Presenca.empresaTxt;
  const ESTRELA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5C12.9 8.6 15.4 11.1 21.5 12 15.4 12.9 12.9 15.4 12 21.5 11.1 15.4 8.6 12.9 2.5 12 8.6 11.1 11.1 8.6 12 2.5Z" fill="currentColor"/></svg>';
  const comSelo = (g) => (g ? g.vips.filter((l) => l.selo) : []);
  const selos = (g) => comSelo(g).map((l) => `<span class="selo" style="--cor:${l.cor};--sobre-cor:${C.sobre(C.hexRgb(l.cor))}">${ESTRELA}${esc(l.nome)}</span>`).join("");
  function faixa(g) {
    const cores = comSelo(g).map((l) => l.cor);
    if (!cores.length) return { classe: "", estilo: "" };
    const passo = 100 / cores.length;
    const grad = cores.length === 1 ? cores[0] : `linear-gradient(180deg, ${cores.map((c, i) => `${c} ${i * passo}% ${(i + 1) * passo}%`).join(", ")})`;
    return { classe: " vip", estilo: ` style="--faixa:${grad};--cor1:${cores[0]}"` };
  }
  const extras = (g) => g.extras.filter((x) => x.lista.selo).map((x) => `<div class="x">${esc(x.lista.campo_extra)}: ${esc(x.valor)}</div>`).join("");

  /* ================= Navegação ================= */
  const VIEWS = { recepcao: 1, painel: 1, qr: 1, certificado: 1, validar: 1 };
  const view = () => { const v = location.hash.slice(1).split("&")[0]; return VIEWS[v] ? v : "recepcao"; };
  function route() {
    if (!appAberto) return;
    const v = view();
    const fechada = v === "recepcao" && somenteConsulta;
    $("v-recepcao").hidden = v !== "recepcao" || fechada;
    $("v-painel").hidden = v !== "painel";
    $("v-certificado").hidden = v !== "certificado";
    $("v-validar").hidden = v !== "validar";
    $("telaEncerrado").hidden = !fechada;
    $("v-qr").hidden = v !== "qr";
    if (v === "qr") atualizarQr(); else clearTimeout(qrTimer);
    if (v === "certificado") renderTelaCertificado();
    if (v === "validar") renderTelaValidar();
    $("consultaAviso").hidden = !(somenteConsulta && v === "painel");
    document.querySelectorAll(".nav a").forEach((a) => { if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    document.body.dataset.view = v;
    if (v !== "recepcao") document.body.classList.remove("typing");
    const titulo = v === "painel" ? ["Painel de presença", evento.nome]
      : v === "certificado" ? ["Certificados", evento.nome]
      : v === "validar" ? ["Validação de Certificado", evento.nome]
      : totem() ? [evento.nome, "Confirme sua presença"]
      : ["Recepção", evento.nome];
    $("viewTitle").textContent = titulo[0]; $("viewSub").textContent = titulo[1];
    $("deviceChip").hidden = v !== "recepcao" || totem();
    render();
  }
  window.addEventListener("hashchange", route);
  function render() {
    if (!appAberto) return;
    if (view() === "recepcao") renderRecepcao(); else if (view() === "painel") renderPainel();
  }

  /* ================= Recepção ================= */
  function destacar(texto, termos) {
    const n = norm(texto), orig = String(texto);
    for (const t of termos) {
      const i = n.indexOf(t);
      if (i >= 0 && t.length > 1 && n.length === orig.length) return esc(orig.slice(0, i)) + "<mark>" + esc(orig.slice(i, i + t.length)) + "</mark>" + esc(orig.slice(i + t.length));
    }
    return esc(orig);
  }
  let cancelArmado = null, cancelTimer = null;
  function botaoCancelar(chave) {
    const armado = cancelArmado === chave;
    return `<button class="cancel${armado ? " armed" : ""}" type="button" data-cancel="${esc(chave)}">${armado ? "Toque de novo para cancelar" : "Cancelar entrada"}</button>`;
  }
  function renderRecepcao() {
    $("rIn").textContent = presenca.size + avulsos.length;
    $("rOf").textContent = loaded ? "" : "· carregando lista…";
    const q = norm($("q").value);
    $("qClear").hidden = !q;
    document.body.classList.toggle("typing", q.length > 0);
    const ul = $("results");
    const minimo = totem() ? 3 : 2;
    if (q.length < minimo) { ul.innerHTML = ""; renderRecentes(); return; }
    $("recent").hidden = true;
    if (!loaded) { ul.innerHTML = '<li class="empty">Carregando lista…</li>'; return; }
    const termos = q.split(" ").filter(Boolean);
    // Quem ainda não chegou vem primeiro.
    const todos = [...grupos.values()].filter((g) => termos.every((t) => g.busca.includes(t)))
      .sort((a, b) => (presenca.has(a.grupo) - presenca.has(b.grupo)) || (b.confirmou - a.confirmou) || a.nome.localeCompare(b.nome, "pt-BR"));
    const LIMITE = totem() ? 8 : 30;
    const achados = todos.slice(0, LIMITE);
    const avs = totem() ? [] : avulsos.filter((a) => termos.every((t) => norm(a.nome + " " + a.empresa).includes(t)));
    if (!achados.length && !avs.length) {
      ul.innerHTML = totem()
        ? '<li class="empty"><strong>Não encontramos esse nome.</strong>Confira a grafia ou toque em "Não encontrei meu nome".</li>'
        : '<li class="empty"><strong>Ninguém encontrado.</strong>Confira a grafia ou use <b>Cadastrar agora</b>.</li>';
      return;
    }
    ul.innerHTML = achados.map((g) => itemRecepcao(g, termos)).join("") +
      avs.map((a) => `<li class="res done">
        <div><div class="n">${destacar(a.nome, termos)}</div><div class="c">${esc(bonita(a.empresa))}</div><div class="tags"><span class="tag walk">Cadastrado na hora</span></div></div>
        <div class="arrived"><span class="ok">✓ Chegou ${hhmm(a.horario)}</span><span class="dev">${esc(a.dispositivo)}</span>${botaoCancelar("a:" + a.id)}</div></li>`).join("") +
      (todos.length > LIMITE ? `<li class="more">Mostrando ${LIMITE} de ${todos.length}. ${totem() ? "Digite o nome completo." : "Digite mais letras do nome ou da empresa."}</li>` : "");
  }
  function itemRecepcao(g, termos) {
    const p = presenca.get(g.grupo), f = faixa(g);
    if (totem()) {
      return `<li class="res${p ? " done" : ""}${f.classe}"${f.estilo}>
        <div><div class="n">${destacar(g.nome, termos)}</div><div class="c">${esc(empresaTxt(g))}</div></div>
        ${p ? '<div class="arrived"><span class="ok">✓ Presença confirmada</span></div>'
            : (somenteConsulta ? "" : `<button class="go" type="button" data-go="${esc(g.grupo)}">Sou eu</button>`)}</li>`;
    }
    const tags = selos(g) + (g.convidado && !g.confirmou && !g.vips.length ? '<span class="tag inv">Sem confirmação</span>' : "");
    return `<li class="res${p ? " done" : ""}${f.classe}"${f.estilo}>
      <div><div class="n">${destacar(g.nome, termos)}</div><div class="c">${destacar(empresaTxt(g), termos)}</div>${extras(g)}${tags ? `<div class="tags">${tags}</div>` : ""}</div>
      ${p ? `<div class="arrived"><span class="ok">✓ Chegou ${hhmm(p.horario)}</span><span class="dev">${esc(p.dispositivo)}</span>${botaoCancelar("g:" + g.grupo)}</div>`
          : (somenteConsulta ? '<span class="nao-veio">Não compareceu</span>' : `<button class="go" type="button" data-go="${esc(g.grupo)}">Confirmar</button>`)}</li>`;
  }
  const chegadasOrdenadas = () => window.Presenca.chegadas(M);
  function renderRecentes() {
    if (totem()) { $("recent").hidden = true; return; }
    const ult = chegadasOrdenadas().slice(0, 8);
    $("recent").hidden = !ult.length;
    $("recentList").innerHTML = ult.map((x) => {
      const f = faixa(x.g);
      return `<li class="${f.classe.trim()}"${f.estilo}><span class="t tabnum">${hhmm(x.horario)}</span><div><div>${esc(x.nome)}${selos(x.g)}</div><div class="c">${esc(x.empresa)}</div></div><span class="d">${esc(x.dispositivo)}</span>${botaoCancelar(x.tipo + ":" + x.id)}</li>`;
    }).join("");
  }
  $("q").addEventListener("input", renderRecepcao);
  $("qClear").addEventListener("click", () => { $("q").value = ""; renderRecepcao(); $("q").focus(); });

  /* ---------- Chamadas que gravam ---------- */
  async function gravarNoBanco(funcao, args) {
    try {
      const { data, error } = await sb.rpc(funcao, { p_slug: SLUG, p_codigo: codigo, ...args });
      if (error) return { erro: "rede" };
      if (data && data.erro) {
        if (data.erro === "encerrado") { encerradoServidor = true; verificarHorario(); toast("O check-in foi encerrado.", null, true); }
        else if (data.erro === "codigo" || data.erro === "evento" || data.erro === "bloqueado") tratarErroAcesso(data.erro);
        return data;
      }
      return data || { ok: true };
    } catch { return { erro: "rede" }; }
  }
  async function confirmar(gid, botao) {
    const g = grupos.get(gid);
    if (!g) return;
    if (botao) { botao.disabled = true; botao.textContent = "Confirmando…"; }
    const r = await gravarNoBanco("fazer_checkin", { p_grupo: gid, p_dispositivo: dispositivo });
    if (r.erro) {
      if (botao) { botao.disabled = false; botao.textContent = totem() ? "Sou eu" : "Confirmar"; }
      if (r.erro === "rede") toast(`Não foi possível confirmar <b>${esc(g.nome)}</b>. Verifique a internet e tente de novo.`, null, true);
      else if (r.erro === "pessoa") { toast(`<b>${esc(g.nome)}</b> saiu da lista. Atualizando…`, null, true); versao = 0; sincronizar(); }
      return;
    }
    if (!r.ja_existia) checkins.push({ grupo: gid, horario: r.horario || new Date().toISOString(), dispositivo });
    derive(); render();
    if (totem()) { boasVindas(g.nome, g, r.ja_existia); return; }
    if (r.ja_existia) toast(`<b>${esc(g.nome)}</b> já tinha chegado às ${hhmm(r.horario)}.`);
    else {
      toast(`Presença confirmada: <b>${esc(g.nome)}</b>`, async () => {
        const chaves = (presenca.get(gid) || { chaves: [gid] }).chaves;
        const d = await gravarNoBanco("desfazer_checkin", { p_grupos: chaves });
        if (d.erro) { toast("Não foi possível desfazer. Use \"Cancelar entrada\".", null, true); return; }
        checkins = checkins.filter((c) => !chaves.includes(c.grupo)); derive(); render();
      });
      $("q").select();
    }
  }
  $("results").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) confirmar(b.dataset.go, b); });

  // Cancelar entrada: 1º toque arma (5 s), 2º toque cancela.
  $("v-recepcao").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cancel]");
    if (!b) return;
    const chave = b.dataset.cancel;
    clearTimeout(cancelTimer);
    if (cancelArmado !== chave) {
      cancelArmado = chave; renderRecepcao();
      cancelTimer = setTimeout(() => { cancelArmado = null; renderRecepcao(); }, 5000);
      return;
    }
    cancelArmado = null;
    b.disabled = true; b.textContent = "Cancelando…";
    const tipo = chave.slice(0, 1), id = chave.slice(2);
    let nome = "", r;
    if (tipo === "a") {
      nome = (avulsos.find((a) => a.id === id) || {}).nome || "";
      r = await gravarNoBanco("remover_avulso", { p_id: id });
      if (!r.erro) avulsos = avulsos.filter((a) => a.id !== id);
    } else {
      nome = (grupos.get(id) || {}).nome || "";
      const chaves = (presenca.get(id) || { chaves: [id] }).chaves;
      r = await gravarNoBanco("desfazer_checkin", { p_grupos: chaves });
      if (!r.erro) checkins = checkins.filter((c) => !chaves.includes(c.grupo));
    }
    derive(); render();
    if (r.erro === "rede") toast(`Não foi possível cancelar a entrada de <b>${esc(nome)}</b>. Verifique a internet e tente de novo.`, null, true);
    else if (!r.erro) toast(`Entrada de <b>${esc(nome)}</b> cancelada.`);
  });

  /* ================= Painel ================= */
  const P = window.Presenca;
  const rgba = (hex, a) => { const c = C.hexRgb(hex); return `rgba(${c.join(", ")}, ${a})`; };
  // Selos do painel: todas as listas VIP (inclusive as sem selo no tablet).
  const selosPainel = (g) => (g ? g.vips.map((l) => `<span class="selo" style="--cor:${l.cor};--sobre-cor:${C.sobre(C.hexRgb(l.cor))}">${esc(l.nome)}</span>`).join("") : "");
  function corTexto(cor) {
    const t = { ...C.TEMA_PADRAO, ...(evento.tema || {}) };
    const media = C.misturar(C.hexRgb(t.fundo1), C.hexRgb(t.fundo2), 0.5);
    return C.rgbHex(C.ajustarContraste(C.hexRgb(cor), media, 3.5));
  }
  const vistos = new Set();
  let desfazerArmado = null;
  const abertos = new Set();   // cards com "Ver nomes" aberto
  function guardarRolagem() {
    const r = {};
    document.querySelectorAll("#v-painel [data-rola]").forEach((el) => { r[el.dataset.rola] = el.scrollTop; });
    return r;
  }
  function voltarRolagem(r) {
    document.querySelectorAll("#v-painel [data-rola]").forEach((el) => { if (r[el.dataset.rola]) el.scrollTop = r[el.dataset.rola]; });
  }
  function renderPainel() {
    const rolagem = guardarRolagem();
    const n = P.numeros(M);
    $("kIn").textContent = n.total;
    const pct = Math.round(n.pct * 100);
    $("kBar").style.width = pct + "%";
    $("kPct").innerHTML = n.conf.length ? `<span>${pct}%</span> de quem confirmou já chegou` : "Sem lista de presença confirmada";
    $("kSub").textContent = `${n.confIn.length} de ${n.conf.length} confirmações · ${n.semConf.length} sem confirmação · ${M.avulsos.length} ${M.avulsos.length === 1 ? "cadastro" : "cadastros"} na hora`;
    $("kConf").innerHTML = `${n.confIn.length} <small>de ${n.conf.length}</small>`;
    $("kAus").textContent = n.conf.length - n.confIn.length;
    $("kInv").textContent = n.semConf.length;
    $("kWalk").textContent = M.avulsos.length;
    const faltamTit = somenteConsulta ? "Confirmaram e não vieram" : "Confirmaram e faltam chegar";
    $("kAusTit").textContent = faltamTit; $("tituloFaltam").textContent = faltamTit;
    $("kConfTit").textContent = "Confirmaram e vieram"; $("kInvTit").textContent = "Vieram sem confirmar"; $("kWalkTit").textContent = "Cadastros na hora";
    $("kBar").parentElement.hidden = false;
    let porEmpresa = null;
    if (aberto()) {
      // Sem lista: chegadas por meia hora, pico e empresas.
      const todas = P.chegadas(M), agora = agoraServidor();
      const ult = todas.filter((x) => agora - Date.parse(x.horario) <= 30 * 60000).length;
      const faixas = new Map();
      todas.forEach((x) => { const d = new Date(x.horario), k = `${String(d.getHours()).padStart(2, "0")}:${d.getMinutes() < 30 ? "00" : "30"}`; faixas.set(k, (faixas.get(k) || 0) + 1); });
      const pico = [...faixas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      const fimFaixa = (k) => { const [h, mi] = k.split(":").map(Number), t = h * 60 + mi + 29; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
      porEmpresa = new Map();
      todas.forEach((x) => { const e = (x.empresa || "").trim() || "(sem empresa)"; const k = norm(e); const atual = porEmpresa.get(k) || { nome: e, n: 0 }; atual.n++; porEmpresa.set(k, atual); });
      $("kPct").innerHTML = `<span>${ult}</span> ${ult === 1 ? "chegada" : "chegadas"} na última meia hora`;
      $("kBar").parentElement.hidden = true;
      $("kSub").textContent = pico ? `Pico: ${pico[0]} – ${fimFaixa(pico[0])} (${pico[1]} ${pico[1] === 1 ? "chegada" : "chegadas"})` : "Nenhuma chegada ainda";
      $("kConfTit").textContent = "Presentes"; $("kConf").textContent = n.total;
      $("kAusTit").textContent = "Na última meia hora"; $("kAus").textContent = ult;
      $("kInvTit").textContent = "Horário de pico"; $("kInv").textContent = pico ? pico[0] : "—";
      $("kWalkTit").textContent = "Empresas diferentes"; $("kWalk").textContent = [...porEmpresa.keys()].filter((k) => k !== "(sem empresa)").length;
      $("tituloFaltam").textContent = "Por empresa";
    }

    // Listas VIP: blocos grandes e cards
    const vips = M.listas.filter((l) => l.tipo === "vip");
    $("blocos").innerHTML = vips.filter((l) => l.destaque === "bloco").map((l) => {
      const it = P.itensDaLista(M, l);
      const dentro = it.filter((i) => i.horario).sort((a, b) => String(b.horario).localeCompare(String(a.horario)));
      const fora = it.filter((i) => !i.horario).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      const li = (i, ok) => `<li class="${ok ? "chegou" : "falta"}"><span class="st" aria-hidden="true">${ok ? "✓" : "!"}</span>
        <span class="n">${esc(i.nome)}</span><span class="c">${ok ? `<b>chegou ${hhmm(i.horario)}</b>` : (somenteConsulta ? "não veio" : "ainda não chegou")}${i.empresa ? " · " + esc(i.empresa) : ""}</span>
        ${i.extra && l.campo_extra ? `<span class="ent">${esc(l.campo_extra)}: ${esc(i.extra)}</span>` : ""}</li>`;
      const corpo = !it.length ? `<p class="fin-empty">Nenhum nome nesta lista.</p>`
        : (dentro.length ? `<div class="fin-group"><h3>Já chegaram (${dentro.length})</h3><ul class="fin-grid">${dentro.map((i) => li(i, true)).join("")}</ul></div>` : "")
          + (fora.length ? `<div class="fin-group"><h3>${somenteConsulta ? "Não vieram" : "Faltam chegar"} (${fora.length})</h3><ul class="fin-grid">${fora.map((i) => li(i, false)).join("")}</ul></div>` : `<p class="fin-all">Todos já chegaram.</p>`);
      return `<section class="bloco" data-lista="${l.id}" style="--cor:${l.cor};--cor-suave:${rgba(l.cor, 0.16)};--cor-texto:${corTexto(l.cor)}" aria-label="${esc(l.nome)}">
        <div class="fin-head"><div><span class="fin-eyebrow">Lista VIP</span><h2>${esc(l.nome)}</h2></div>
          <div class="fin-num tabnum"><b>${dentro.length}</b><span>de ${it.length}</span></div></div>
        <div class="meter fin-meter"><span style="width:${it.length ? Math.round(dentro.length / it.length * 100) : 0}%"></span></div>
        <div class="fin-body" data-rola="b-${l.id}">${corpo}</div></section>`;
    }).join("");
    $("cards").innerHTML = vips.filter((l) => l.destaque !== "bloco").map((l) => {
      const it = P.itensDaLista(M, l);
      const dentro = it.filter((i) => i.horario).sort((a, b) => String(b.horario).localeCompare(String(a.horario)));
      const fora = it.filter((i) => !i.horario).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      return `<div class="cat" data-lista="${l.id}" style="--cor:${l.cor}">
        <div class="head"><h3>${esc(l.nome)}</h3><span class="num tabnum">${dentro.length} <small>de ${it.length}</small></span></div>
        <div class="meter"><span style="width:${it.length ? Math.round(dentro.length / it.length * 100) : 0}%"></span></div>
        ${it.length ? `<details data-card="${l.id}"${abertos.has(l.id) ? " open" : ""}><summary>Ver nomes</summary><ul class="mini">
          ${dentro.map((i) => `<li><span>${esc(i.nome)}</span><span class="in tabnum">${hhmm(i.horario)}</span></li>`).join("")}
          ${fora.map((i) => `<li class="out"><span>${esc(i.nome)}</span><span>${somenteConsulta ? "não veio" : "falta"}</span></li>`).join("")}
        </ul></details>` : `<p class="note">Nenhum nome nesta lista.</p>`}</div>`;
    }).join("");
    $("cards").hidden = !$("cards").children.length;
    document.querySelectorAll("#blocos .fin-body").forEach((el) => el.classList.toggle("rola", el.scrollHeight > el.clientHeight + 4));

    // Chegaram e faltam chegar
    const q = norm($("pq").value);
    const passa = (nome, emp) => !q || norm(nome + " " + emp).includes(q);
    const chegaram = P.chegadas(M).filter((x) => passa(x.nome, x.empresa));
    const faltam = n.conf.filter((g) => !presenca.has(g.grupo) && passa(g.nome, empresaTxt(g))).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    $("cIn").textContent = chegaram.length; $("cOut").textContent = faltam.length;
    $("listIn").innerHTML = chegaram.length ? chegaram.map((x) => {
      const chave = x.tipo + ":" + x.id;
      const novo = vistos.size && !vistos.has(chave) ? " fresh" : "";
      const tag = x.tipo === "a" ? (aberto() ? "" : '<span class="tag walk">na hora</span>') : (x.g && !x.g.confirmou && !x.g.vips.length ? '<span class="tag unconf">sem confirmação</span>' : "");
      return `<li class="row${novo}"><div><div class="n">${esc(x.nome)} ${selosPainel(x.g)}${tag}</div><div class="c">${esc(x.empresa)}</div></div>
        <div><div class="t tabnum">${hhmm(x.horario)}</div><div class="d">${esc(x.dispositivo)}</div>
        <button class="undo${desfazerArmado === chave ? " armed" : ""}" type="button" data-undo="${esc(chave)}">${desfazerArmado === chave ? "Confirmar desfazer" : "Desfazer"}</button></div></li>`;
    }).join("") : `<li class="none">${q ? "Ninguém com esse filtro." : "Ninguém chegou ainda."}</li>`;
    $("listOut").innerHTML = faltam.length
      ? faltam.map((g) => `<li class="row"><div><div class="n">${esc(g.nome)} ${selosPainel(g)}</div><div class="c">${esc(empresaTxt(g))}</div></div><span></span></li>`).join("")
      : `<li class="none">${q ? "Ninguém com esse filtro." : n.conf.length ? "Todos que confirmaram já chegaram." : "Sem lista de presença confirmada."}</li>`;
    if (porEmpresa) {
      const lista = [...porEmpresa.values()].filter((e) => passa(e.nome, "")).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"));
      $("cOut").textContent = lista.length;
      $("listOut").innerHTML = lista.length ? lista.map((e) => `<li class="row"><div><div class="n">${esc(C.bonita(e.nome))}</div></div><div class="t tabnum">${e.n}</div></li>`).join("")
        : `<li class="none">${q ? "Nenhuma empresa com esse filtro." : "Ninguém chegou ainda."}</li>`;
    }
    P.chegadas(M).forEach((x) => vistos.add(x.tipo + ":" + x.id));
    voltarRolagem(rolagem);
    carregarBloqueiosPainel();
  }
  $("pq").addEventListener("input", renderPainel);
  $("cards").addEventListener("toggle", (e) => { const d = e.target.closest("[data-card]"); if (d) { if (d.open) abertos.add(d.dataset.card); else abertos.delete(d.dataset.card); } }, true);
  window.addEventListener("resize", () => { if (view() === "painel") document.querySelectorAll("#blocos .fin-body").forEach((el) => el.classList.toggle("rola", el.scrollHeight > el.clientHeight + 4)); });
  // Desfazer no painel: 1º toque arma, 2º desfaz.
  $("listIn").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-undo]");
    if (!b) return;
    const chave = b.dataset.undo;
    if (desfazerArmado !== chave) { desfazerArmado = chave; renderPainel(); setTimeout(() => { if (desfazerArmado === chave) { desfazerArmado = null; renderPainel(); } }, 5000); return; }
    desfazerArmado = null; b.disabled = true;
    const tipo = chave.slice(0, 1), id = chave.slice(2);
    let r;
    if (tipo === "a") { r = await gravarNoBanco("remover_avulso", { p_id: id }); if (!r.erro) avulsos = avulsos.filter((a) => a.id !== id); }
    else {
      const chaves = (presenca.get(id) || { chaves: [id] }).chaves;
      r = await gravarNoBanco("desfazer_checkin", { p_grupos: chaves });
      if (!r.erro) checkins = checkins.filter((c) => !chaves.includes(c.grupo));
    }
    derive(); render();
    if (r.erro === "rede") toast("Não foi possível desfazer. Verifique a internet e tente de novo.", null, true);
  });
  $("exportBtn").addEventListener("click", async () => {
    const b = $("exportBtn"), txt = b.textContent;
    b.disabled = true; b.textContent = "Gerando relatório…";
    try { const nome = await window.Relatorio.baixar(evento, M); toast(`Relatório gerado: <b>${esc(nome)}</b>`); }
    catch (e) { toast("Não foi possível gerar o relatório: " + esc(e.message || e), null, true); }
    finally { b.disabled = false; b.textContent = txt; }
  });

  /* ================= Bloqueios por GPS no Painel ================= */
  let carregarBloqTimer = null;
  async function carregarBloqueiosPainel() {
    if (!codigo || !SLUG) return;
    const kpi = $("kpiBloq"), sec = $("secBloqueios");
    if (!kpi || !sec) return;

    try {
      const resp = await sb.rpc("bloqueios_geo_painel", { p_slug: SLUG, p_codigo: codigo });
      if (resp.error || (resp.data && resp.data.erro)) return;
      const bloqueios = resp.data || [];
      const total = bloqueios.length;

      $("kBloq").textContent = total;
      $("cBloq").textContent = total;

      if (total > 0 || (evento && evento.geo_ativo)) {
        kpi.hidden = false;
        sec.hidden = total === 0;
      } else {
        kpi.hidden = true;
        sec.hidden = true;
      }

      if (total === 0) {
        $("listBloqueios").innerHTML = `<li class="none">Nenhuma tentativa bloqueada até o momento.</li>`;
        return;
      }

      $("listBloqueios").innerHTML = bloqueios.map((b) => {
        const hora = b.em ? new Date(b.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
        const distStr = b.distancia_metros != null ? (b.distancia_metros >= 1000 ? `${(b.distancia_metros / 1000).toFixed(1)} km` : `${Math.round(b.distancia_metros)} m`) : "—";
        const mot = b.motivo === "longe" ? `Fora do local (${distStr})` : (b.motivo === "sem_local" ? "Sem GPS / Negou" : "Sinal impreciso");
        const contatos = [b.empresa, b.cpf ? `CPF: ${b.cpf}` : null, b.telefone].filter(Boolean).join(" · ");
        const link = b.lat != null && b.lng != null ? `<a href="https://www.google.com/maps?q=${b.lat},${b.lng}" target="_blank" rel="noopener" style="font-size:12px;color:var(--destaque);text-decoration:underline;">Ver mapa</a>` : "";

        return `<li class="row">
          <div>
            <div class="n">${esc(b.nome || "Não informado")} <span class="selo" style="--cor:#DC2626;--sobre-cor:#FFF;background:#DC2626;color:#FFF;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;">${mot}</span></div>
            ${contatos ? `<div class="c">${esc(contatos)}</div>` : ""}
          </div>
          <div style="text-align:right;">
            <div class="t tabnum" style="color:#DC2626;">${hora}</div>
            <div>${link}</div>
          </div>
        </li>`;
      }).join("");
    } catch (_) {}
  }

  if ($("btnRecarregarBloqPainel")) {
    $("btnRecarregarBloqPainel").addEventListener("click", () => {
      carregarBloqueiosPainel();
      toast("Lista de bloqueios atualizada.");
    });
  }

  /* ================= Tela cheia do QR dos convidados ================= */
  let qrTimer = null, qrK = null;
  async function atualizarQr() {
    clearTimeout(qrTimer);
    if (view() !== "qr" || !appAberto) return;
    const avisoQr = (t) => { $("qrAviso").textContent = t || ""; $("qrAviso").hidden = !t; };
    try {
      const { data, error } = await sb.rpc("qr_atual", { p_slug: SLUG, p_codigo: codigo });
      if (error) throw error;
      if (data.erro === "indisponivel") { $("qrImagem").innerHTML = ""; qrK = null; avisoQr("O check-in pelo celular é só para evento aberto."); return; }
      if (data.erro) { tratarErroAcesso(data.erro); return; }
      if (data.agora) desvio = Date.parse(data.agora) - Date.now();
      const url = `${location.origin}/q/${SLUG}/${data.k}`;
      if (data.k !== qrK) {
        qrK = data.k;
        const qr = window.qrcode(0, "M"); qr.addData(url); qr.make();
        $("qrImagem").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      }
      $("qrLink").textContent = data.rotativo ? "O código muda a cada minuto." : url.replace(/^https?:\/\//, "");
      if (data.encerrado) avisoQr("Check-in encerrado");
      else if (data.abre_em && Date.parse(data.abre_em) > agoraServidor()) avisoQr(`O check-in pelo celular abre às ${hhmm(data.abre_em)}`);
      else avisoQr("");
      let proximo = 30000;
      $("qrTempo").hidden = !data.rotativo;
      if (data.rotativo) {
        const resta = Math.max(0, Date.parse(data.expira) - agoraServidor());
        const barra = $("qrBarra");
        barra.style.transition = "none"; barra.style.width = Math.min(100, resta / 600) + "%";
        requestAnimationFrame(() => requestAnimationFrame(() => { barra.style.transition = `width ${resta}ms linear`; barra.style.width = "0%"; }));
        proximo = resta + 1200;
      }
      qrTimer = setTimeout(atualizarQr, Math.max(2000, proximo));
    } catch {
      avisoQr("Sem conexão: o QR pode estar vencido.");
      qrTimer = setTimeout(atualizarQr, 5000);
    }
  }

  /* ---------- Aviso rápido ---------- */
  let toastTimer;
  function toast(html, desfazer, erro) {
    $("toastMsg").innerHTML = html;
    $("toast").classList.toggle("err", !!erro);
    $("toastBtn").hidden = !desfazer;
    $("toastBtn").onclick = desfazer ? async () => { $("toast").hidden = true; await desfazer(); } : null;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, desfazer ? 8000 : 5000);
  }

  /* ---------- Boas-vindas (totem) ---------- */
  let bvTimer;
  function boasVindas(nome, g, jaEstava) {
    const primeiro = String(nome).split(" ")[0];
    $("bvNome").textContent = `Boas-vindas, ${primeiro}!`;
    $("bvTexto").textContent = jaEstava ? "Sua presença já estava confirmada." : (evento.boas_vindas || "Sua presença está confirmada.");
    $("bvSelos").innerHTML = g ? selos(g) : "";
    $("boasvindas").hidden = false;
    $("q").value = ""; renderRecepcao();
    clearTimeout(bvTimer);
    bvTimer = setTimeout(fecharBoasVindas, 6000);
  }
  function fecharBoasVindas() { clearTimeout(bvTimer); $("boasvindas").hidden = true; $("q").focus(); }
  $("boasvindas").addEventListener("click", fecharBoasVindas);

  /* ---------- Cadastro na entrada: "Cadastrar agora", "Não encontrei meu nome" e evento aberto ---------- */
  let dupAck = false;
  const aberto = () => !!(evento && evento.aberto);
  const camposDoEvento = () => (evento && Array.isArray(evento.campos) ? evento.campos : [{ chave: "empresa", obrigatorio: false }]);
  const textoSalvar = () => (aberto() ? "Fazer check-in" : totem() ? "Confirmar presença" : "Cadastrar e confirmar presença");
  const valores = () => window.Formulario.valores($("aCampos"));
  let assinaturaCampos = "";
  // Monta os campos pedidos pelo evento (refaz só se a configuração mudou, sem perder o que já foi digitado).
  function montarFormulario() {
    const campos = camposDoEvento();
    const assinatura = JSON.stringify(campos) + "|" + (evento.lgpd_texto || "") + "|" + evento.nome;
    if (assinatura === assinaturaCampos) return;
    assinaturaCampos = assinatura;
    const antes = valores();
    $("aCampos").innerHTML = window.Formulario.html(campos);
    window.Formulario.restaurar($("aCampos"), antes);
    $("aLgpd").hidden = !C.precisaConsentimento(campos);
    $("aLgpdTexto").textContent = evento.lgpd_texto || C.textoLgpdPadrao(evento.nome);
  }
  window.Formulario.ligarMascaras($("aCampos"));
  function erroForm(msg, campo) {
    $("aErr").textContent = msg; $("aErr").hidden = false;
    if (campo) { campo.classList.add("invalido"); campo.focus(); }
  }
  // Lê e confere o formulário (o banco confere de novo).
  const coletar = () => window.Formulario.coletar({ nome: $("aNome"), area: $("aCampos"), campos: camposDoEvento(), consente: $("aConsente"), exigirSobrenome: aberto() });
  function textosCadastro() {
    $("addTitle").textContent = aberto() ? (totem() ? "Seus dados" : "Novo check-in") : totem() ? "Não encontrei meu nome" : "Cadastrar agora";
    $("addTexto").textContent = aberto()
      ? (totem() ? "Preencha para confirmar sua presença." : "Preencha os dados de quem está chegando.")
      : totem() ? "Preencha seus dados para confirmar sua presença." : "Para quem chegou e não está em nenhuma lista. A presença já fica confirmada.";
    $("addSave").textContent = textoSalvar();
    $("addCancel").textContent = aberto() ? "Limpar" : "Cancelar";
  }
  function limparCadastro() {
    $("addForm").reset(); dupAck = false;
    $("aDup").hidden = true; $("aErr").hidden = true;
    $("addForm").querySelectorAll(".invalido").forEach((i) => i.classList.remove("invalido"));
    textosCadastro();
  }
  function abrirCadastro() {
    const q = $("q").value.trim();
    montarFormulario(); limparCadastro();
    if (/[a-z]{2}/i.test(q)) $("aNome").value = q;
    $("addStage").hidden = false; $("aNome").focus();
  }
  // Evento aberto: o formulário fica fixo na recepção (não é janela).
  function ajustarModoAberto() {
    const sim = aberto(), stage = $("addStage");
    document.body.classList.toggle("aberto", sim);
    if (sim && stage.parentElement !== $("v-recepcao")) { $("v-recepcao").insertBefore(stage, $("totemChamada").nextSibling); limparCadastro(); }
    if (!sim && stage.parentElement !== document.body) { document.body.appendChild(stage); stage.hidden = true; }
    montarFormulario();
    if (sim) { stage.hidden = false; textosCadastro(); }
    $("totemChamada").textContent = sim ? "Faça seu check-in" : "Digite seu nome para confirmar sua presença";
    if (sim && !totem()) $("q").placeholder = "Conferir quem já entrou (nome ou empresa)";
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-add]")) abrirCadastro(); });
  $("addCancel").addEventListener("click", () => { if (aberto()) { limparCadastro(); $("aNome").focus(); } else $("addStage").hidden = true; });
  $("aNome").addEventListener("input", () => { dupAck = false; $("aDup").hidden = true; $("aNome").classList.remove("invalido"); $("addSave").textContent = textoSalvar(); });
  $("aDup").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    if (!aberto()) $("addStage").hidden = true; else limparCadastro();
    confirmar(b.dataset.pick, null);
  });
  const parecidos = window.Presenca.parecidos;
  $("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("aErr").hidden = true;
    const f = coletar();
    if (f.erro) { erroForm(f.erro, f.foco); return; }
    const { nome, empresa, dados } = f;
    // Nome parecido com alguém da lista (no totem do evento aberto não mostra nomes de outras pessoas).
    if (!dupAck && !(totem() && aberto())) {
      const n = norm(nome);
      const sim = [...grupos.values()].filter((g) => norm(g.nome) === n || parecidos(g.nome, nome)).slice(0, 5);
      const simA = totem() ? [] : avulsos.filter((a) => norm(a.nome) === n || parecidos(a.nome, nome)).slice(0, 3);
      if (sim.length || simA.length) {
        const botao = totem() ? "Sou eu" : "É esta pessoa: confirmar";
        $("aDup").innerHTML = `<strong>${totem() ? "Talvez seu nome já esteja na lista:" : "Essa pessoa pode já estar na lista:"}</strong><ul>${sim.map((g) => {
          const p = presenca.get(g.grupo);
          return `<li><span>${esc(g.nome)}${g.empresas.length ? " · " + esc(empresaTxt(g)) : ""}</span>${p ? `<span>${totem() ? "presença já confirmada" : "chegou às " + hhmm(p.horario)}</span>` : `<button type="button" data-pick="${esc(g.grupo)}">${botao}</button>`}</li>`;
        }).join("")}${simA.map((a) => `<li><span>${esc(a.nome)}${a.empresa ? " · " + esc(a.empresa) : ""}</span><span>cadastro às ${hhmm(a.horario)}</span></li>`).join("")}</ul><span>${totem() ? 'Se não for você, toque em "Confirmar mesmo assim".' : 'Se for outra pessoa, toque em "Cadastrar mesmo assim".'}</span>`;
        $("aDup").hidden = false; dupAck = true;
        $("addSave").textContent = totem() ? "Confirmar mesmo assim" : "Cadastrar mesmo assim";
        return;
      }
    }
    $("addSave").disabled = true;
    const r = await gravarNoBanco("cadastrar_avulso", { p_nome: nome, p_empresa: empresa, p_dispositivo: dispositivo, p_dados: dados });
    $("addSave").disabled = false;
    if (r.erro) {
      const campo = (k) => $("aCampos").querySelector(`[data-campo="${k}"]`);
      const msg = window.Formulario.mensagemErro(r, false);
      const foco = r.erro === "campo" ? campo(r.campo) : r.erro === "consentimento" ? $("aConsente") : r.erro === "cpf_repetido" ? campo("cpf") : r.erro === "nome" ? $("aNome") : null;
      if (msg) erroForm(msg, foco);
      else if (!aberto()) $("addStage").hidden = true;
      return;
    }
    avulsos.push({ id: r.id, nome: nomePadrao(nome), empresa, horario: r.horario || new Date().toISOString(), dispositivo });
    if (aberto()) limparCadastro(); else $("addStage").hidden = true;
    $("q").value = "";
    derive(); render();
    if (totem()) { boasVindas(nomePadrao(nome), null, false); return; }
    toast(`Check-in feito: <b>${esc(nomePadrao(nome))}</b>`, async () => {
      const d = await gravarNoBanco("remover_avulso", { p_id: r.id });
      if (d.erro) { toast("Não foi possível desfazer. Use \"Cancelar entrada\".", null, true); return; }
      avulsos = avulsos.filter((a) => a.id !== r.id); derive(); render();
    });
    if (aberto()) $("aNome").focus();
  });

  /* ================= Aparelho ================= */
  function mostrarDev() { $("deviceName").textContent = dispositivo || "sem nome"; }
  function pedirDev() { $("devInput").value = dispositivo; $("devStage").hidden = false; $("devInput").focus(); }
  $("deviceEdit").addEventListener("click", pedirDev);
  $("devForm").addEventListener("submit", (e) => {
    e.preventDefault();
    dispositivo = $("devInput").value.trim().slice(0, 30) || "Tablet";
    gravar("aparelho", dispositivo);
    mostrarDev(); $("devStage").hidden = true; $("q").focus();
  });
  $("devSair").addEventListener("click", () => {
    gravar("codigo", ""); codigo = "";
    $("devStage").hidden = true;
    mostrarCodigo("Você saiu do evento neste aparelho.");
  });

  /* ================= Check-in encerrado (botão ou horário marcado) ================= */
  const agoraServidor = () => Date.now() + desvio;
  function verificarHorario() {
    if (!evento) return;
    const limite = evento.encerra_em ? Date.parse(evento.encerra_em) : null;
    const passou = limite != null && agoraServidor() >= limite;
    aplicarModo(encerradoServidor || passou);
    const hora = encerramento ? hhmm(encerramento) : (passou ? hhmm(evento.encerra_em) : "");
    $("encTexto").innerHTML = hora ? `O check-in deste evento foi encerrado às <b>${hora}</b>. O painel de presença continua disponível.`
      : "O check-in deste evento foi encerrado. O painel de presença continua disponível.";
    $("consultaAviso").innerHTML = `<b>Check-in encerrado${hora ? " às " + hora : ""}.</b> Somente consulta: o painel e o relatório continuam disponíveis.`;
    // Aviso 15 minutos antes.
    const faltam = limite != null ? limite - agoraServidor() : null;
    const avisar = appAberto && !somenteConsulta && faltam != null && faltam > 0 && faltam <= 15 * 60000;
    $("avisoEncerra").hidden = !avisar;
    if (avisar) $("avisoEncerra").innerHTML = `O check-in encerra às <b>${hhmm(evento.encerra_em)}</b> (${faltam < 60000 ? "em menos de 1 minuto" : "em " + Math.ceil(faltam / 60000) + " min"}).`;
  }
  setInterval(verificarHorario, 5000);
  function aplicarModo(consulta) {
    if (consulta === somenteConsulta) return;
    somenteConsulta = consulta;
    document.body.classList.toggle("consulta", consulta);
    if (consulta) { $("addStage").hidden = true; $("boasvindas").hidden = true; }
    route();
  }

  /* ================= Tela sempre acesa ================= */
  let wakeLock = null;
  async function manterAcesa() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
    catch { /* navegador recusou: segue normal */ }
  }
  document.addEventListener("visibilitychange", manterAcesa);
  document.addEventListener("click", manterAcesa, { once: true });

  /* ================= Certificados e Validação ================= */
  let certDadosAtual = null;
  let certPendente = null;

  function mostrarModalCertificado(dados) {
    const papel = $("certContainer");
    papel.innerHTML = C.gerarHtmlCertificado(dados);
    const imp = $("impressaoCert");
    imp.innerHTML = C.gerarHtmlCertificado(dados);
    if (window.qrcode && dados.codigo) {
      const urlValidar = `${location.origin}/e/${SLUG}#validar&cod=${encodeURIComponent(dados.codigo)}`;
      const qr = window.qrcode(0, "M");
      qr.addData(urlValidar); qr.make();
      const svg = qr.createSvgTag(3, 0);
      const q1 = papel.querySelector(".cert-qr"); if (q1) q1.innerHTML = svg;
      const q2 = imp.querySelector(".cert-qr"); if (q2) q2.innerHTML = svg;
    }
    $("modalCert").hidden = false;
    $("btnFecharCert").onclick = () => { $("modalCert").hidden = true; };
    $("btnImprimirCert").onclick = () => {
      const estilo = document.createElement("style");
      estilo.id = "estiloPrintCert";
      estilo.textContent = "@page { size: A4 landscape; margin: 0; }";
      document.head.appendChild(estilo);

      const tituloAntes = document.title;
      const evNome = dados.evento || (evento && evento.nome) || "Evento";
      const nomePessoa = dados.nome || "Participante";
      const carga = dados.horas != null && dados.horas !== "" ? `${dados.horas}h` : "4h";
      const nomeArquivo = `Certificado - ${evNome} - ${nomePessoa} - ${carga}`.replace(/[\\/:*?"<>|]/g, " ");
      document.title = nomeArquivo;
      window.print();
      setTimeout(() => {
        document.title = tituloAntes;
        const st = $("estiloPrintCert");
        if (st) st.remove();
      }, 2000);
    };
  }

  function mostrarResultadoCertificado(r) {
    certDadosAtual = r;
    $("certResNome").textContent = C.nomePadrao(r.nome);
    $("certResultado").hidden = false;

    if (r.liberado) {
      $("certResMsg").textContent = "Presença confirmada! Seu certificado está pronto para emissão.";
      $("btnVerCertPublico").hidden = false;
      $("btnVerCertPublico").onclick = () => mostrarModalCertificado(r);
      $("btnZapCertPublico").innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.41a8.165 8.165 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.24-.74-.66-1.24-1.48-1.39-1.73-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.32-.02-.45-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.23.25-.87.85-.87 2.07s.89 2.4 1.02 2.57c.13.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.12-.22-.19-.47-.32"/></svg> Enviar link para o meu WhatsApp`;
      $("btnZapCertPublico").onclick = () => {
        const link = `${location.origin}/e/${SLUG}#certificado&id=${r.id}`;
        const texto = `Olá! Aqui está o link para você baixar seu certificado do evento "${evento.nome}":\n${link}`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`, "_blank");
      };
    } else {
      const quandoTxt = r.libera_em ? C.quandoCurto(r.libera_em) : "após o evento";
      $("certResMsg").textContent = "Presença confirmada! O certificado estará liberado para download " + quandoTxt + ".";
      $("btnVerCertPublico").hidden = true;
      $("btnZapCertPublico").innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.41a8.165 8.165 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.24-.74-.66-1.24-1.48-1.39-1.73-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.32-.02-.45-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.23.25-.87.85-.87 2.07s.89 2.4 1.02 2.57c.13.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.12-.22-.19-.47-.32"/></svg> Salvar link no meu WhatsApp`;
      $("btnZapCertPublico").onclick = () => {
        const link = `${location.origin}/e/${SLUG}#certificado&id=${r.codigo}`;
        const texto = `Olá! Aqui está o link para você baixar seu certificado do evento "${evento.nome}" (liberado a partir de ${quandoTxt}):\n${link}`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`, "_blank");
      };
    }
  }

  async function buscarCertificado(args) {
    const btn = $("btnBuscarCert");
    btn.disabled = true; btn.textContent = "Consultando…";
    $("certErro").hidden = true;
    $("certResultado").hidden = true;
    const boxMult = $("certMultiplos");
    if (boxMult) boxMult.hidden = true;
    const boxSeg = $("certSeguranca");
    if (boxSeg) boxSeg.hidden = true;

    try {
      const resp = await sb.rpc("obter_certificado", { p_slug: SLUG, ...args });
      if (resp.error) throw resp.error;
      const r = resp.data;

      if (!r || r.erro === "nao_encontrado") {
        $("certErro").textContent = "Nenhum participante encontrado com esse número de CPF ou nome. Confira se digitou corretamente.";
        $("certErro").hidden = false;
        return;
      }
      if (r.erro === "sem_presenca") {
        $("certErro").innerHTML = `Encontramos o cadastro de <b>${C.esc(C.nomePadrao(r.nome))}</b>, mas a presença não foi confirmada na entrada.<br><small class="suave">O certificado só é emitido para quem compareceu e fez o check-in no evento.</small>`;
        $("certErro").hidden = false;
        return;
      }
      if (r.erro === "desativado") {
        $("certErro").textContent = "A emissão de certificados não está ativada para este evento.";
        $("certErro").hidden = false;
        return;
      }
      if (r.erro) throw new Error(r.erro);

      if (r.multiplos && r.opcoes && r.opcoes.length) {
        const lista = $("certListaMultiplos");
        if (lista && boxMult) {
          lista.innerHTML = r.opcoes.map((op) => `
            <button class="btn" type="button" style="text-align:left; justify-content:space-between; padding:12px 16px; border-radius:12px; background:var(--superficie-2); color:var(--tinta); display:flex; align-items:center; width:100%; border:1px solid var(--linha);" data-id="${op.id}">
              <span><b>${C.esc(C.nomePadrao(op.nome))}</b>${op.empresa ? `<br><small class="suave">${C.esc(op.empresa)}</small>` : ""}</span>
              <span style="font-weight:700; color:var(--destaque);">Emitir ›</span>
            </button>
          `).join("");
          lista.querySelectorAll("button").forEach((b) => {
            b.addEventListener("click", () => {
              buscarCertificado({ p_id: b.dataset.id });
            });
          });
          boxMult.hidden = false;
        }
        return;
      }

      // Barreira de segurança antifraude: confirma 3 dígitos do CPF se buscou por nome
      if (r.precisa_confirmar_cpf && r.digitos_esperados && boxSeg) {
        certPendente = r;
        boxSeg.hidden = false;
        $("certSegurancaMsg").innerHTML = `Para garantir a privacidade de <b>${C.esc(C.nomePadrao(r.nome))}</b>, confirme os <b>3 primeiros dígitos</b> do CPF cadastrado (${r.cpf_parcial || "***.***.***-**"}):`;
        $("campoConfirmaDigitos").value = "";
        $("certSegurancaErro").hidden = true;
        $("campoConfirmaDigitos").focus();
        return;
      }

      mostrarResultadoCertificado(r);
    } catch (e) {
      $("certErro").textContent = "Não foi possível consultar no momento. Tente de novo em instantes.";
      $("certErro").hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = "Consultar";
    }
  }

  // Confirmação de segurança dos 3 dígitos
  if ($("btnConfirmarSeguranca")) {
    $("btnConfirmarSeguranca").addEventListener("click", () => {
      if (!certPendente) return;
      const dig = $("campoConfirmaDigitos").value.replace(/\D/g, "");
      if (dig !== certPendente.digitos_esperados) {
        $("certSegurancaErro").textContent = "Os 3 dígitos informados não conferem com o CPF deste participante.";
        $("certSegurancaErro").hidden = false;
        $("campoConfirmaDigitos").focus();
        return;
      }
      $("certSeguranca").hidden = true;
      mostrarResultadoCertificado(certPendente);
      certPendente = null;
    });
  }

  // Alternador de busca CPF x Nome
  let buscaPorCpf = true;
  if ($("btnAlternarTipoBusca")) {
    $("btnAlternarTipoBusca").addEventListener("click", () => {
      buscaPorCpf = !buscaPorCpf;
      const inp = $("campoBuscaCert");
      inp.value = "";
      $("certErro").hidden = true;
      $("certResultado").hidden = true;
      if ($("certMultiplos")) $("certMultiplos").hidden = true;
      if ($("certSeguranca")) $("certSeguranca").hidden = true;
      if (buscaPorCpf) {
        $("certSubtituloBusca").textContent = "Digite seu CPF para emitir seu certificado com segurança.";
        inp.placeholder = "000.000.000-00";
        inp.inputMode = "numeric";
        $("btnAlternarTipoBusca").textContent = "Buscar por nome completo ›";
      } else {
        $("certSubtituloBusca").textContent = "Digite seu nome completo como cadastrado no evento.";
        inp.placeholder = "Seu nome completo";
        inp.inputMode = "text";
        $("btnAlternarTipoBusca").textContent = "‹ Voltar para busca por CPF";
      }
      inp.focus();
    });
  }
  if ($("campoBuscaCert")) {
    $("campoBuscaCert").addEventListener("input", (e) => {
      if (buscaPorCpf) {
        e.target.value = C.mascaraCpf(e.target.value);
      }
    });
  }

  function renderTelaCertificado() {
    $("certEventoNome").textContent = evento ? evento.nome : "Certificado";
    $("certEventoInfo").textContent = evento ? [evento.subtitulo, C.dataExtenso(evento.data), evento.local].filter(Boolean).join(" · ") : "";
    const p = new URLSearchParams(location.hash.slice(location.hash.indexOf("&") + 1));
    const autoId = p.get("id");
    const autoCpf = p.get("cpf");
    if (autoId) {
      buscarCertificado(autoId.startsWith("CERT-") ? { p_chave: autoId } : { p_id: autoId });
    } else if (autoCpf) {
      $("campoBuscaCert").value = autoCpf;
      buscarCertificado({ p_chave: autoCpf });
    }
  }

  $("formBuscaCert").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("campoBuscaCert").value.trim();
    if (!q) return;
    buscarCertificado({ p_chave: q });
  });

  function renderTelaValidar() {
    const p = new URLSearchParams(location.hash.slice(location.hash.indexOf("&") + 1));
    const cod = p.get("cod") || "";
    if (!cod) {
      $("valCheck").textContent = "!";
      $("valTitulo").textContent = "Código não informado";
      $("valMsg").textContent = "Escaneie o QR Code no certificado impresso ou acesse com o link de validação.";
      $("valDetalhes").hidden = true;
      return;
    }
    $("valTitulo").textContent = "Validando certificado…";
    $("valMsg").textContent = "";
    sb.rpc("validar_certificado", { p_codigo: cod }).then(({ data, error }) => {
      if (error || !data || !data.valido) {
        $("valCheck").textContent = "✕";
        $("valTitulo").textContent = "Certificado Não Encontrado";
        $("valMsg").textContent = "Este código de certificado não consta como autêntico no sistema deste evento.";
        $("valDetalhes").hidden = true;
      } else {
        $("valCheck").textContent = "✓";
        $("valTitulo").textContent = "Certificado Autêntico";
        $("valMsg").textContent = "Este certificado é oficial e foi emitido pelo sistema de check-in.";
        $("valNome").textContent = C.nomePadrao(data.nome);
        $("valEvento").textContent = data.evento;
        $("valHoras").textContent = (data.horas || 0) + " horas";
        $("valData").textContent = data.emitido_em ? new Date(data.emitido_em).toLocaleDateString("pt-BR") : "";
        $("valCodigo").textContent = data.codigo;
        $("valDetalhes").hidden = false;
      }
    }).catch(() => {
      $("valTitulo").textContent = "Sem conexão";
      $("valMsg").textContent = "Verifique a internet e tente de novo.";
    });
  }

  /* ================= Início ================= */
  async function iniciar() {
    mostrarDev();
    if (!SLUG) { aviso("Link incompleto", "Confira o link com a organização."); return; }
    let pub;
    try {
      const r = await sb.rpc("evento_publico", { p_slug: SLUG });
      if (r.error) throw r.error;
      pub = r.data;
    } catch {
      aviso("Sem conexão", "Não foi possível falar com o servidor. Tentando de novo…");
      setTimeout(iniciar, 5000);
      return;
    }
    if (pub.erro) { aviso("Evento não encontrado", "Confira o link com a organização."); return; }
    evento = pub; aplicarEvento();
    if (view() === "certificado" || view() === "validar") {
      mostrarApp(true);
      return;
    }
    if (!codigo) { mostrarCodigo(); return; }
    try {
      const { data, error } = await sb.rpc("sincronizar", { p_slug: SLUG, p_codigo: codigo, p_versao: 0, p_marca: -1 });
      if (error) throw error;
      if (data.erro) { tratarErroAcesso(data.erro); return; }
      aplicar(data);
      abrir();
    } catch {
      aviso("Sem conexão", "Não foi possível carregar a lista. Tentando de novo…");
      setTimeout(iniciar, 5000);
    }
  }
  manterAcesa();
  iniciar();
})();
