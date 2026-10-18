/* Check-in de Eventos — área da organização: eventos, dados, identidade, acesso e operação. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const C = window.Comum, esc = C.esc;
  const sb = window.supabase.createClient(window.CONFIG.supabaseUrl, window.CONFIG.supabaseKey, {
    db: { schema: "checkin" },
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true },
  });

  /* ================= Utilidades ================= */
  async function rpc(nome, args) {
    let r;
    try { r = await sb.rpc(nome, args || {}); }
    catch (e) { throw new Error(window.Acesso.traduzir(e)); }
    if (r.error) {
      if (/jwt|token/i.test(r.error.message || "")) { window.location.reload(); }
      throw new Error(window.Acesso.traduzir(r.error));
    }
    return r.data;
  }
  let toastTimer;
  function toast(msg, erro) {
    const t = $("toast");
    t.textContent = msg; t.classList.toggle("erro", !!erro); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, erro ? 7000 : 3500);
  }
  // Janela com formulário. "validar" recebe o formulário e devolve o valor (ou lança erro para mostrar).
  function janela({ titulo, corpo, ok = "OK", perigo = false, validar }) {
    return new Promise((fim) => {
      $("janelaTitulo").textContent = titulo;
      $("janelaCorpo").innerHTML = corpo || "";
      $("janelaErro").hidden = true;
      $("janelaOk").textContent = ok;
      $("janelaOk").classList.toggle("perigo", perigo);
      $("janelaOk").disabled = false;
      $("janela").hidden = false;
      const primeiro = $("janelaCorpo").querySelector("input");
      (primeiro || $("janelaOk")).focus();
      if (primeiro && primeiro.select) primeiro.select();
      const fechar = (v) => { $("janela").hidden = true; $("janelaForm").onsubmit = null; $("janelaCancelar").onclick = null; document.removeEventListener("keydown", tecla); fim(v); };
      const tecla = (e) => { if (e.key === "Escape") fechar(null); };
      document.addEventListener("keydown", tecla);
      $("janelaCancelar").onclick = () => fechar(null);
      $("janelaForm").onsubmit = async (e) => {
        e.preventDefault();
        $("janelaOk").disabled = true;
        // Funções do banco sem retorno devolvem null: isso também é "deu certo" (só Cancelar devolve null).
        try { const v = validar ? await validar($("janelaForm")) : true; fechar(v == null || v === "" ? true : v); }
        catch (err) { $("janelaErro").textContent = err.message; $("janelaErro").hidden = false; $("janelaOk").disabled = false; }
      };
    });
  }
  const confirmarDigitando = (titulo, texto, palavra, ok) => janela({
    titulo, ok, perigo: true,
    corpo: `<p>${texto}</p><label>Para confirmar, digite <b>${palavra}</b><input id="jPalavra" autocomplete="off" spellcheck="false"></label>`,
    validar: () => { if ($("jPalavra").value.trim().toUpperCase() !== palavra) throw new Error(`Digite ${palavra} para confirmar.`); return true; },
  });
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); toast("Copiado."); }
    catch { toast("Não foi possível copiar. Selecione e copie manualmente.", true); }
  }
  const linkEvento = (ev, tela, comCodigo) => `${location.origin}/e/${ev.slug}${comCodigo ? "?c=" + ev.codigo : ""}${tela ? "#" + tela : ""}`;
  const fundoTema = (tema) => { const t = { ...C.TEMA_PADRAO, ...(tema || {}) }; return `linear-gradient(118deg, ${t.fundo1}, ${t.fundo2})`; };

  /* ================= Navegação ================= */
  let evento = null;            // evento aberto (obter_evento)
  const sujo = { dados: false, identidade: false, certificados: false };
  const temAlteracoes = () => sujo.dados || sujo.identidade || sujo.certificados;
  let hashAnterior = location.hash, ignorarHash = false;

  function rota() {
    const m = location.hash.match(/^#\/evento\/([0-9a-f-]{36})(?:\/(\w+))?/);
    return m ? { tela: "evento", id: m[1], aba: m[2] || "dados" } : { tela: "eventos" };
  }
  async function navegar() {
    if (ignorarHash) { ignorarHash = false; return; }
    const r = rota(), antes = hashAnterior;
    const saindoDoEvento = evento && (r.tela !== "evento" || r.id !== evento.id);
    if (saindoDoEvento && temAlteracoes()) {
      const sair = await janela({ titulo: "Sair sem salvar?", corpo: "<p>Há alterações que ainda não foram salvas neste evento.</p>", ok: "Sair sem salvar", perigo: true });
      if (!sair) { ignorarHash = true; location.hash = antes; return; }
    }
    hashAnterior = location.hash;
    if (r.tela === "eventos") { evento = null; sujo.dados = sujo.identidade = sujo.certificados = false; mostrarEventos(); return; }
    if (!evento || evento.id !== r.id) {
      sujo.dados = sujo.identidade = sujo.certificados = false;
      window.Listas.limparEstado();
      if (!(await carregarEvento(r.id))) return;
    }
    mostrarAba(r.aba);
  }
  window.addEventListener("hashchange", navegar);
  window.addEventListener("beforeunload", (e) => { if (temAlteracoes()) { e.preventDefault(); e.returnValue = ""; } });

  /* ================= Lista de eventos ================= */
  async function mostrarEventos() {
    $("telaEvento").hidden = true; $("telaEventos").hidden = false;
    document.title = "Eventos · Check-in de Eventos";
    $("eventosCarregando").hidden = false;
    let lista = [];
    try { lista = await rpc("listar_eventos"); }
    catch (e) { $("eventosCarregando").hidden = true; toast("Não foi possível carregar os eventos: " + e.message, true); return; }
    $("eventosCarregando").hidden = true;
    $("eventosVazio").hidden = lista.length > 0;
    $("listaEventos").innerHTML = lista.map((ev) => {
      const info = [C.dataCurta(ev.data), ev.horario, ev.local].filter(Boolean).join(" · ");
      const status = ev.encerrado_em ? '<span class="status encerrado">Encerrado</span>' : "";
      const nums = ev.resumo
        ? `<span>Dados pessoais apagados</span>`
        : `<span><b>${ev.pessoas}</b> nas listas</span><span><b>${ev.presentes}</b> presentes</span>`;
      return `<li class="evento">
        <div class="evento-capa" style="background:${fundoTema(ev.tema)}">${status}<span class="data">${esc(C.dataExtenso(ev.data) || "Sem data")}</span></div>
        <div class="evento-corpo">
          <h2><a href="#/evento/${ev.id}">${esc(ev.nome)}</a></h2>
          ${ev.subtitulo ? `<span class="suave">${esc(ev.subtitulo)}</span>` : ""}
          ${info ? `<span class="dica">${esc(info)}</span>` : ""}
          <div class="evento-nums">${nums}</div>
        </div></li>`;
    }).join("");
  }
  $("btnNovo").addEventListener("click", async () => {
    const novo = await janela({
      titulo: "Novo evento", ok: "Criar evento",
      corpo: `<p>O resto (identidade, listas, acesso) você configura em seguida.</p>
        <label>Nome do evento<input id="jNome" maxlength="120" required></label>
        <label>Data<input id="jData" type="date"></label>`,
      validar: async () => {
        const nome = $("jNome").value.trim();
        if (nome.length < 2) throw new Error("Informe o nome do evento.");
        return rpc("criar_evento", { p_dados: { nome, data: $("jData").value || null } });
      },
    });
    if (novo) { toast("Evento criado."); location.hash = `#/evento/${novo.id}/dados`; }
  });

  /* ================= Um evento ================= */
  async function carregarEvento(id) {
    try { evento = await rpc("obter_evento", { p_id: id }); }
    catch (e) { toast("Não foi possível abrir o evento: " + e.message, true); location.hash = "#/"; return false; }
    preencherCabecalho();
    preencherDados();
    prepararIdentidade();
    preencherAcesso();
    preencherOperacao();
    preencherCertificados();
    $("telaEventos").hidden = true; $("telaEvento").hidden = false;
    return true;
  }
  function preencherCabecalho() {
    $("evNome").textContent = evento.nome;
    document.title = evento.nome + " · Check-in de Eventos";
    $("evInfo").textContent = [C.dataExtenso(evento.data), evento.horario, evento.local].filter(Boolean).join(" · ") || "Sem data definida";
    $("evAmostra").style.background = fundoTema(evento.tema);
    $("evStatus").textContent = evento.encerrado
      ? "Check-in encerrado" + (evento.encerramento ? " às " + C.hhmm(evento.encerramento) : "")
      : "Aberto" + (evento.encerra_em ? " · encerra " + quandoCurto(evento.encerra_em) : "");
    $("evStatus").classList.toggle("encerrado", !!evento.encerrado);
    $("evAbrirRecepcao").href = linkEvento(evento, "recepcao", true);
    $("evAbrirPainel").href = linkEvento(evento, "painel", true);
  }
  function mostrarAba(aba) {
    if (!$("aba-" + aba)) aba = "dados";
    document.querySelectorAll(".abas a").forEach((a) => {
      a.href = `#/evento/${evento.id}/${a.dataset.aba}`;
      if (a.dataset.aba === aba) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.querySelectorAll(".aba").forEach((s) => { s.hidden = s.id !== "aba-" + aba; });
    if (aba === "identidade") { carregarImagensSalvas(); ajustarPrevia(); }
    if (aba === "dados" || aba === "operacao") atualizarEncerramento().catch(() => {});
    if (aba === "acesso") preencherQrConvidados();
    if (aba === "convidados" || aba === "vip") window.Listas.mostrar(aba);
    if (aba === "certificados") {
      atualizarInfoLiberaCert();
      atualizarPreviaCertificado();
      atualizarLoteCertificados();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- Dados ---------- */
  const CAMPOS = { dNome: "nome", dSubtitulo: "subtitulo", dData: "data", dHorario: "horario", dLocal: "local", dBoasVindas: "boas_vindas" };
  function marcar(qual, valor, estadoId) {
    sujo[qual] = valor;
    const el = $(estadoId);
    if (el) {
      el.textContent = valor ? "Alterações não salvas" : "";
      el.className = "estado" + (valor ? " pendente" : "");
    }
    if (qual === "certificados" && $("certEstadoBaixo")) {
      $("certEstadoBaixo").textContent = valor ? "Alterações não salvas" : "";
      $("certEstadoBaixo").className = "estado" + (valor ? " pendente" : "");
    }
  }
  // "2027-05-20T21:00" (campo do navegador, hora local) <-> horário com fuso
  const p2 = (n) => String(n).padStart(2, "0");
  function paraCampo(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  const doCampo = (v) => (v ? new Date(v).toISOString() : "");
  function quandoCurto(iso) {
    const d = new Date(iso), hoje = new Date();
    const dia = d.toDateString() === hoje.toDateString() ? "hoje" : `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
    return `${dia} às ${C.hhmm(iso)}`;
  }
  function infoEncerra() {
    const v = $("dEncerra").value, el = $("dEncerraInfo");
    el.className = "dica estado-encerra";
    if (!v) { el.textContent = "Sem horário: o check-in só encerra pelo botão da aba Operação."; return; }
    const falta = new Date(v).getTime() - Date.now();
    if (falta <= 0) { el.textContent = "Esse horário já passou: ao salvar, o check-in fica encerrado."; el.classList.add("passou"); return; }
    const h = Math.floor(falta / 3600000), m = Math.ceil((falta % 3600000) / 60000);
    el.textContent = `Encerra ${quandoCurto(new Date(v).toISOString())} (daqui a ${h ? h + " h " : ""}${m} min). Os tablets avisam 15 minutos antes.`;
  }
  $("dEncerra").addEventListener("input", infoEncerra);
  $("dEncerraEvento").addEventListener("click", () => {
    if (!$("dData").value) { toast("Preencha a data do evento primeiro.", true); $("dData").focus(); return; }
    const hora = ($("dEncerra").value.split("T")[1]) || "22:00";
    $("dEncerra").value = $("dData").value + "T" + hora;
    infoEncerra(); marcar("dados", true, "dEstado"); $("dEncerra").focus();
  });
  $("dEncerraLimpar").addEventListener("click", () => { $("dEncerra").value = ""; infoEncerra(); marcar("dados", true, "dEstado"); });
  setInterval(() => { if (!$("aba-dados").hidden) infoEncerra(); }, 30000);
  // Horário marcado passou com a tela aberta: atualiza o status sem ir ao banco.
  setInterval(() => {
    if (!evento || evento.encerrado || !evento.encerra_em || Date.parse(evento.encerra_em) > Date.now()) return;
    evento.encerrado = true; evento.encerramento = evento.encerra_em;
    preencherCabecalho(); preencherOperacao();
  }, 15000);
  /* ---------- Cadastro na entrada: campos e LGPD ---------- */
  function linhaFixa(chave, c) {
    return `<div class="campo-linha" data-chave="${chave}">
      <label class="marcar"><input type="checkbox" data-pedir${c ? " checked" : ""}> <span>${C.ROTULOS[chave]}</span></label>
      <label class="marcar obrig"><input type="checkbox" data-obrig${c && c.obrigatorio ? " checked" : ""}${c ? "" : " disabled"}> <span>obrigatório</span></label></div>`;
  }
  function linhaLivre(chave, c) {
    return `<div class="campo-linha" data-chave="${chave}">
      <input data-rotulo maxlength="40" placeholder="Nome do campo (ex.: Cargo, Cidade)" value="${esc(c ? c.rotulo : "")}" aria-label="Nome do campo">
      <label class="marcar obrig"><input type="checkbox" data-obrig${c && c.obrigatorio ? " checked" : ""}> <span>obrigatório</span></label>
      <button class="botao link pequeno perigo-texto" type="button" data-remover-campo>remover</button></div>`;
  }
  function preencherCampos() {
    const campos = evento.campos || [{ chave: "empresa", obrigatorio: false }];
    const por = new Map(campos.map((c) => [c.chave, c]));
    $("camposFixos").innerHTML = C.CAMPOS_FIXOS.map((k) => linhaFixa(k, por.get(k))).join("");
    $("camposLivres").innerHTML = campos.filter((c) => /^x\d$/.test(c.chave)).map((c) => linhaLivre(c.chave, c)).join("");
    $("btnCampoLivre").hidden = $("camposLivres").children.length >= 5;
    $("dLgpd").value = evento.lgpd_texto || "";
    $("dLgpd").placeholder = C.textoLgpdPadrao(evento.nome);
  }
  function lerCampos() {
    const out = [];
    document.querySelectorAll("#camposFixos .campo-linha").forEach((l) => {
      if (l.querySelector("[data-pedir]").checked) out.push({ chave: l.dataset.chave, obrigatorio: l.querySelector("[data-obrig]").checked });
    });
    document.querySelectorAll("#camposLivres .campo-linha").forEach((l) => {
      const rotulo = l.querySelector("[data-rotulo]").value.trim();
      if (rotulo) out.push({ chave: l.dataset.chave, rotulo, obrigatorio: l.querySelector("[data-obrig]").checked });
    });
    return out;
  }
  $("camposFixos").addEventListener("change", (e) => {
    const pedir = e.target.closest("[data-pedir]");
    if (!pedir) return;
    const obrig = pedir.closest(".campo-linha").querySelector("[data-obrig]");
    obrig.disabled = !pedir.checked; if (!pedir.checked) obrig.checked = false;
  });
  $("btnCampoLivre").addEventListener("click", () => {
    const usados = new Set([...document.querySelectorAll("#camposLivres .campo-linha")].map((l) => l.dataset.chave));
    const livre = ["x1", "x2", "x3", "x4", "x5"].find((k) => !usados.has(k));
    if (!livre) return;
    $("camposLivres").insertAdjacentHTML("beforeend", linhaLivre(livre, null));
    $("btnCampoLivre").hidden = $("camposLivres").children.length >= 5;
    $("camposLivres").lastElementChild.querySelector("[data-rotulo]").focus();
    marcar("dados", true, "dEstado");
  });
  $("camposLivres").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remover-campo]");
    if (!b) return;
    b.closest(".campo-linha").remove();
    $("btnCampoLivre").hidden = false;
    marcar("dados", true, "dEstado");
  });
  $("btnLgpdPadrao").addEventListener("click", () => { $("dLgpd").value = C.textoLgpdPadrao($("dNome").value || evento.nome); marcar("dados", true, "dEstado"); });

  function preencherDados() {
    for (const [id, campo] of Object.entries(CAMPOS)) $(id).value = evento[campo] || "";
    document.querySelectorAll('input[name="tipo"]').forEach((r) => { r.checked = r.value === (evento.aberto ? "aberto" : "lista"); });
    preencherCampos();
    $("dEncerra").value = paraCampo(evento.encerra_em);
    infoEncerra();
    document.querySelectorAll('input[name="modo"]').forEach((r) => { r.checked = r.value === evento.modo; });
    marcar("dados", false, "dEstado");
  }
  $("formDados").addEventListener("input", () => marcar("dados", true, "dEstado"));
  $("formDados").addEventListener("submit", async (e) => {
    e.preventDefault();
    const dados = {};
    for (const [id, campo] of Object.entries(CAMPOS)) dados[campo] = $(id).value.trim();
    dados.data = dados.data || null;
    dados.encerra_em = doCampo($("dEncerra").value);
    dados.aberto = (document.querySelector('input[name="tipo"]:checked') || {}).value === "aberto";
    dados.campos = lerCampos();
    dados.lgpd_texto = $("dLgpd").value.trim();
    dados.modo = (document.querySelector('input[name="modo"]:checked') || {}).value || "recepcao";
    if (dados.nome.length < 2) { toast("Informe o nome do evento.", true); $("dNome").focus(); return; }
    $("dSalvar").disabled = true;
    try {
      await rpc("salvar_evento", { p_id: evento.id, p_dados: dados });
      Object.assign(evento, dados);
      await atualizarEncerramento();
      marcar("dados", false, "dEstado");
      $("dEstado").textContent = "Salvo ✓"; $("dEstado").className = "estado salvo";
      preencherCabecalho(); enviarPrevia();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { toast("Não foi possível salvar: " + err.message, true); }
    finally { $("dSalvar").disabled = false; }
  });

  /* ---------- Identidade ---------- */
  let tema = {}, imagens = {}, cores = [];
  // imagens[tipo] = { url, mudou, carregada }
  function prepararIdentidade() {
    tema = { ...C.TEMA_PADRAO, ...(evento.tema || {}) };
    imagens = { arte: { url: null, mudou: false, carregada: !evento.imagens.arte }, logo: { url: null, mudou: false, carregada: !evento.imagens.logo } };
    cores = [];
    $("paleta").hidden = true;
    $("imgErro").hidden = true;
    mostrarCores(); mostrarImagens();
    marcar("identidade", false, "iEstado");
  }
  async function carregarImagensSalvas() {
    for (const tipo of ["arte", "logo"]) {
      const im = imagens[tipo];
      if (im.carregada) continue;
      im.carregada = true;
      try {
        im.url = await rpc("imagem", { p_slug: evento.slug, p_tipo: tipo });
        if (tipo === "arte" && im.url) { cores = await window.Imagens.paleta(im.url); mostrarPaleta(); }
      } catch { im.carregada = false; }
      mostrarImagens();
    }
  }
  function mostrarImagens() {
    document.querySelectorAll(".imagem-campo").forEach((box) => {
      const im = imagens[box.dataset.tipo], img = box.querySelector("img");
      img.hidden = !im.url; if (im.url) img.src = im.url; else img.removeAttribute("src");
      box.querySelector(".imagem-vazia").hidden = !!im.url;
      box.querySelector("[data-remover]").hidden = !im.url;
    });
    enviarPrevia();
  }
  function mostrarCores() {
    document.querySelectorAll("[data-cor]").forEach((inp) => {
      inp.value = tema[inp.dataset.cor].toLowerCase();
      inp.closest(".cor").querySelector("code").textContent = tema[inp.dataset.cor];
    });
    enviarPrevia();
  }
  function mostrarPaleta() {
    const lista = cores.filter((c) => c.peso > 0.004).slice(0, 12);
    $("paleta").hidden = !lista.length;
    $("paletaCores").innerHTML = lista.map((c) => `<button type="button" data-hex="${c.hex}" style="background:${c.hex}" title="${c.hex}" aria-label="Cor ${c.hex}"></button>`).join("");
  }
  document.querySelectorAll("[data-cor]").forEach((inp) => inp.addEventListener("input", () => {
    tema[inp.dataset.cor] = inp.value.toUpperCase();
    marcar("identidade", true, "iEstado");
    mostrarCores();
  }));
  document.querySelectorAll(".imagem-campo").forEach((box) => {
    const tipo = box.dataset.tipo;
    box.querySelector("input[type=file]").addEventListener("change", async (e) => {
      const arq = e.target.files[0]; e.target.value = "";
      if (!arq) return;
      $("imgErro").hidden = true;
      try {
        const r = await window.Imagens.reduzir(arq, tipo === "arte" ? 1600 : 600, tipo === "logo" && arq.type === "image/png");
        imagens[tipo] = { url: r.url, mudou: true, carregada: true };
        if (tipo === "arte") {
          cores = await window.Imagens.paleta(r.url);
          tema = window.Imagens.sugerirTema(cores);
          mostrarPaleta(); mostrarCores();
          toast("Cores sugeridas a partir da arte. Ajuste se quiser.");
        }
        marcar("identidade", true, "iEstado");
        mostrarImagens();
      } catch (err) { $("imgErro").textContent = err.message; $("imgErro").hidden = false; }
    });
    box.querySelector("[data-remover]").addEventListener("click", () => {
      imagens[tipo] = { url: null, mudou: true, carregada: true };
      if (tipo === "arte") { cores = []; $("paleta").hidden = true; }
      marcar("identidade", true, "iEstado");
      mostrarImagens();
    });
  });
  $("btnSugerir").addEventListener("click", () => {
    if (!cores.length) return;
    tema = window.Imagens.sugerirTema(cores);
    marcar("identidade", true, "iEstado"); mostrarCores();
  });
  // Menu "usar esta cor como"
  let corEscolhida = null;
  $("paletaCores").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hex]");
    if (!b) return;
    corEscolhida = b.dataset.hex;
    const r = b.getBoundingClientRect(), m = $("menuCor");
    m.hidden = false;
    m.style.left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - m.offsetWidth - 8) + "px";
    m.style.top = window.scrollY + r.bottom + 6 + "px";
    m.querySelector("button").focus();
    e.stopPropagation();
  });
  $("menuCor").addEventListener("click", (e) => {
    const b = e.target.closest("[data-usar]");
    if (!b || !corEscolhida) return;
    tema[b.dataset.usar] = corEscolhida;
    $("menuCor").hidden = true;
    marcar("identidade", true, "iEstado"); mostrarCores();
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#menuCor")) $("menuCor").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("menuCor").hidden = true; });

  $("iSalvar").addEventListener("click", async () => {
    $("iSalvar").disabled = true; $("iEstado").textContent = "Salvando…"; $("iEstado").className = "estado";
    try {
      for (const tipo of ["arte", "logo"]) {
        if (!imagens[tipo].mudou) continue;
        await rpc("salvar_imagem", { p_id: evento.id, p_tipo: tipo, p_conteudo: imagens[tipo].url || "" });
        imagens[tipo].mudou = false;
      }
      await rpc("salvar_evento", { p_id: evento.id, p_dados: { tema } });
      evento.tema = { ...tema };
      evento.imagens = { ...(imagens.arte.url ? { arte: 1 } : {}), ...(imagens.logo.url ? { logo: 1 } : {}) };
      marcar("identidade", false, "iEstado");
      $("iEstado").textContent = "Salvo ✓"; $("iEstado").className = "estado salvo";
      preencherCabecalho();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      $("iEstado").textContent = ""; toast("Não foi possível salvar a identidade: " + err.message, true);
    } finally { $("iSalvar").disabled = false; }
  });

  // Prévia do tablet (página previa.html dentro da moldura)
  let previaPronta = false, buscando = false;
  function enviarPrevia() {
    if (!previaPronta || !evento) return;
    $("previa").contentWindow.postMessage({
      previa: true, tema, arte: imagens.arte && imagens.arte.url, logo: imagens.logo && imagens.logo.url, buscando,
      evento: { nome: $("dNome").value || evento.nome, subtitulo: $("dSubtitulo").value, data: $("dData").value, modo: (document.querySelector('input[name="modo"]:checked') || {}).value },
      vips: (evento.listas || []).filter((l) => l.tipo === "vip"),
    }, location.origin);
  }
  window.addEventListener("message", (e) => { if (e.origin === location.origin && e.data && e.data.previaPronta) { previaPronta = true; enviarPrevia(); } });
  function ajustarPrevia() {
    const caixa = document.querySelector(".tablet");
    const escala = (caixa.clientWidth - 28) / 1024;
    $("previa").style.transform = `scale(${escala})`;
  }
  new ResizeObserver(ajustarPrevia).observe(document.querySelector(".tablet"));
  document.querySelectorAll("[data-previa]").forEach((b) => b.addEventListener("click", () => {
    buscando = b.dataset.previa === "busca";
    document.querySelectorAll("[data-previa]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    enviarPrevia();
  }));

  /* ---------- Acesso ---------- */
  function qrSvg(texto) {
    const qr = window.qrcode(0, "M");
    qr.addData(texto); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }
  function preencherAcesso() {
    $("aLink").textContent = linkEvento(evento);
    $("aCodigo").textContent = evento.codigo;
    $("aQr").innerHTML = qrSvg(linkEvento(evento, "", true));
    preencherQrConvidados();
  }

  /* ---------- QR dos convidados (check-in pelo celular) ---------- */
  const linkConvidado = () => `${location.origin}/q/${evento.slug}/${evento.qr_chave}`;
  function lerCoord(t) {
    const m = String(t || "").replace(/[()]/g, "").match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
    if (!m) return null;
    const lat = parseFloat(m[1].replace(",", ".")), lng = parseFloat(m[2].replace(",", "."));
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }
  function mostrarMapa() {
    const c = lerCoord($("qcCoord").value);
    $("qcMapa").hidden = !c;
    if (c) $("qcMapa").href = `https://www.google.com/maps?q=${c.lat},${c.lng}`;
  }
  function preencherQrConvidados() {
    const aberto = !!evento.aberto;
    $("qcSo").hidden = aberto; $("qcConteudo").hidden = !aberto;
    if (!aberto) return;
    $("qcAbre").value = paraCampo(evento.abre_em);
    $("qcRotativo").checked = !!evento.qr_rotativo;
    $("qcGeo").checked = !!evento.geo_ativo;
    $("qcCoord").value = evento.geo_lat != null ? `${evento.geo_lat}, ${evento.geo_lng}` : "";
    $("qcRaio").value = String([100, 200, 300, 500, 1000, 2000].includes(evento.geo_raio) ? evento.geo_raio : 300);
    $("qcLocalInfo").textContent = "";
    $("qcEstado").textContent = ""; $("qcEstado").className = "estado";
    mostrarMapa(); mostrarQrConvidados();
  }
  function mostrarQrConvidados() {
    const rot = $("qcRotativo").checked;
    $("qcGeoCampos").hidden = !$("qcGeo").checked;
    $("qcTela").href = linkEvento(evento, "qr", true);
    for (const id of ["qcA4", "qcA5", "qcCopiar"]) $(id).disabled = rot;
    if (rot) {
      $("qcQr").innerHTML = "O QR muda a cada minuto e aparece só na tela cheia.";
      $("qcQr").classList.add("vazio");
      $("qcQrNota").textContent = "Abra a tela cheia num tablet ou TV na entrada do evento.";
    } else {
      $("qcQr").classList.remove("vazio");
      $("qcQr").innerHTML = qrSvg(linkConvidado());
      $("qcQrNota").textContent = linkConvidado().replace(/^https?:\/\//, "");
    }
  }
  const qcMudou = () => { $("qcEstado").textContent = "Alterações não salvas"; $("qcEstado").className = "estado pendente"; mostrarQrConvidados(); };
  ["qcAbre", "qcRotativo", "qcGeo", "qcRaio"].forEach((id) => $(id).addEventListener("change", qcMudou));
  $("qcCoord").addEventListener("input", () => { mostrarMapa(); qcMudou(); });
  $("qcAbreLimpar").addEventListener("click", () => { $("qcAbre").value = ""; qcMudou(); });
  $("qcMeuLocal").addEventListener("click", () => {
    if (!navigator.geolocation) { toast("Este navegador não informa a localização.", true); return; }
    $("qcLocalInfo").textContent = "Buscando sua localização…";
    navigator.geolocation.getCurrentPosition((p) => {
      $("qcCoord").value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`;
      $("qcLocalInfo").textContent = `precisão de ~${Math.round(p.coords.accuracy)} m`;
      mostrarMapa(); qcMudou();
    }, () => { $("qcLocalInfo").textContent = ""; toast("Não foi possível obter sua localização. Permita o acesso ou cole as coordenadas.", true); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  async function atualizarQrDados() {
    const d = await rpc("obter_evento", { p_id: evento.id });
    for (const k of ["abre_em", "qr_rotativo", "geo_ativo", "geo_lat", "geo_lng", "geo_raio", "qr_chave"]) evento[k] = d[k];
    preencherQrConvidados();
  }
  $("qcSalvar").addEventListener("click", async () => {
    const geo = $("qcGeo").checked, c = lerCoord($("qcCoord").value);
    if (geo && !c) { toast("Informe o local do evento (latitude, longitude) para conferir a localização.", true); $("qcCoord").focus(); return; }
    const dados = { abre_em: doCampo($("qcAbre").value), qr_rotativo: $("qcRotativo").checked, geo_ativo: geo, geo_raio: +$("qcRaio").value };
    if (c) { dados.geo_lat = c.lat; dados.geo_lng = c.lng; }
    $("qcSalvar").disabled = true;
    try {
      await rpc("salvar_evento", { p_id: evento.id, p_dados: dados });
      await atualizarQrDados();
      $("qcEstado").textContent = "Salvo ✓"; $("qcEstado").className = "estado salvo";
    } catch (e) { toast("Não foi possível salvar: " + e.message, true); }
    finally { $("qcSalvar").disabled = false; }
  });
  $("qcCopiar").addEventListener("click", () => copiar(linkConvidado()));
  $("qcTrocar").addEventListener("click", async () => {
    const ok = await janela({
      titulo: "Trocar o QR dos convidados?", ok: "Trocar QR", perigo: true,
      corpo: "<p>Os cartazes já impressos deixam de funcionar na hora, e quem estiver preenchendo precisa escanear de novo. Use se o QR vazou.</p>",
      validar: () => rpc("novo_qr_convidados", { p_id: evento.id }),
    });
    if (ok === null) return;
    await atualizarQrDados();
    toast("QR trocado. Imprima os cartazes de novo.");
  });
  async function imprimirCartaz(formato) {
    if (!imagens.arte || !imagens.arte.carregada) await carregarImagensSalvas();
    const arte = imagens.arte && imagens.arte.url;
    const info = [C.dataExtenso(evento.data), evento.horario, evento.local].filter(Boolean).join(" · ");
    const um = `<div class="cartaz ${formato}">
      ${arte ? `<img class="arte" src="${arte}" alt="">` : ""}
      <h1>${esc(evento.nome)}</h1>${info ? `<p class="info">${esc(info)}</p>` : ""}
      <p class="chamada">Faça seu check-in pelo celular</p>
      <div class="qr">${qrSvg(linkConvidado())}</div>
      <ol><li>1. Aponte a câmera do celular</li><li>2. Preencha seus dados</li><li>3. Mostre o comprovante na entrada</li></ol>
      <p class="link">${esc(linkConvidado())}</p></div>`;
    $("impressao").innerHTML = formato === "a5" ? um + um : um;
    setTimeout(() => window.print(), 300);
  }
  $("qcA4").addEventListener("click", () => imprimirCartaz("a4"));
  $("qcA5").addEventListener("click", () => imprimirCartaz("a5"));
  document.querySelectorAll("[data-copiar]").forEach((b) => b.addEventListener("click", () => copiar($(b.dataset.copiar).textContent)));
  $("btnNovoCodigo").addEventListener("click", async () => {
    const novo = await janela({
      titulo: "Trocar código de acesso?", ok: "Trocar código", perigo: true,
      corpo: "<p>Os tablets e painéis já abertos vão pedir o código novo. O QR code impresso também deixa de valer.</p>",
      validar: () => rpc("novo_codigo", { p_id: evento.id }),
    });
    if (!novo) return;
    evento.codigo = novo;
    preencherAcesso(); preencherCabecalho();
    toast("Código trocado: " + novo);
  });
  $("btnImprimir").addEventListener("click", () => {
    $("impressao").innerHTML = `<h1>${esc(evento.nome)}</h1><p>Acesso da equipe · aponte a câmera do tablet</p>
      <div class="qr-imp">${qrSvg(linkEvento(evento, "", true))}</div>
      <p>${esc(linkEvento(evento))}</p><p>Código</p><div class="cod">${esc(evento.codigo)}</div>`;
    window.print();
  });

  /* ---------- Operação ---------- */
  $("btnRelatorio").addEventListener("click", async () => {
    const btn = $("btnRelatorio"), txt = btn.textContent;
    btn.disabled = true; btn.textContent = "Gerando relatório…";
    try {
      // Busca os dados mais recentes (presenças podem ter mudado desde que a tela abriu).
      const d = await rpc("obter_evento", { p_id: evento.id });
      const m = window.Presenca.montar(d.listas, d.pessoas, d.checkins, d.avulsos);
      const nome = await window.Relatorio.baixar(d, m, { cadastros: d.cadastros });   // com CPF e contatos (só a organização)
      toast("Relatório gerado: " + nome);
    } catch (e) { toast("Não foi possível gerar o relatório: " + e.message, true); }
    finally { btn.disabled = false; btn.textContent = txt; }
  });
  // Busca de novo só o estado do encerramento (o horário marcado pode ter passado).
  async function atualizarEncerramento() {
    const d = await rpc("obter_evento", { p_id: evento.id });
    for (const k of ["encerra_em", "encerrado", "encerramento", "encerrado_em"]) evento[k] = d[k];
    preencherCabecalho(); preencherOperacao();
  }
  function preencherOperacao() {
    const enc = !!evento.encerrado;
    const porHorario = enc && !evento.encerrado_em && !!evento.encerra_em;
    const hora = evento.encerramento ? " às " + C.hhmm(evento.encerramento) : "";
    $("opEncTitulo").textContent = enc ? "Reabrir check-in" : "Encerrar check-in agora";
    $("opEncTexto").textContent = enc
      ? `O check-in está encerrado${hora}${porHorario ? " (horário marcado)" : ""}: os tablets mostram "Check-in encerrado" e o painel está só para consulta. Reabrir apaga o horário marcado e os tablets voltam a confirmar presenças. Para só ganhar mais tempo, use "Adiar horário".`
      : `Os tablets passam a mostrar "Check-in encerrado" e param de confirmar e cadastrar; o painel e o relatório continuam. Pode reabrir depois.${evento.encerra_em ? ` Encerramento automático marcado para ${quandoCurto(evento.encerra_em)} (aba Dados).` : ""}`;
    $("btnEncerrar").textContent = enc ? "Reabrir check-in" : "Encerrar check-in";
    $("btnAdiar").hidden = !enc || !!evento.encerrado_em;
  }
  $("btnEncerrar").addEventListener("click", async () => {
    const enc = !evento.encerrado;
    const ok = await janela({
      titulo: enc ? "Encerrar o check-in agora?" : "Reabrir o check-in?", ok: enc ? "Encerrar" : "Reabrir",
      corpo: enc ? "<p>Os tablets passam a mostrar \"Check-in encerrado\" e não confirmam mais presenças. O painel continua.</p>"
        : "<p>Os tablets voltam a confirmar presenças. O horário de encerramento marcado é apagado.</p>",
      validar: () => rpc("encerrar_evento", { p_id: evento.id, p_encerrar: enc }),
    });
    if (ok === null) return;
    await carregarEvento(evento.id); mostrarAba("operacao");
    toast(enc ? "Check-in encerrado." : "Check-in reaberto.");
  });
  $("btnAdiar").addEventListener("click", async () => {
    const sugestao = paraCampo(new Date(Date.now() + 30 * 60000).toISOString());
    const ok = await janela({
      titulo: "Adiar o encerramento", ok: "Adiar e reabrir",
      corpo: `<p>Os tablets voltam a confirmar presenças até o novo horário.</p><label>Novo horário de encerramento<input id="jEncerra" type="datetime-local" value="${sugestao}"></label>`,
      validar: async () => {
        const v = $("jEncerra").value;
        if (!v || new Date(v).getTime() <= Date.now()) throw new Error("Escolha um horário no futuro.");
        await rpc("salvar_evento", { p_id: evento.id, p_dados: { encerra_em: doCampo(v) } });
      },
    });
    if (ok === null) return;
    await carregarEvento(evento.id); mostrarAba("operacao");
    toast("Encerramento adiado: o check-in está aberto de novo.");
  });
  $("btnDuplicar").addEventListener("click", async () => {
    const novo = await janela({
      titulo: "Duplicar evento", ok: "Duplicar",
      corpo: `<p>Copia identidade, dados e listas VIP. Pessoas e presenças não são copiadas.</p><label>Nome do novo evento<input id="jNome" maxlength="120" value="${esc(evento.nome + " (cópia)")}"></label>`,
      validar: () => rpc("duplicar_evento", { p_id: evento.id, p_nome: $("jNome").value.trim() }),
    });
    if (novo) { toast("Evento duplicado."); location.hash = `#/evento/${novo.id}/dados`; }
  });
  $("btnZerar").addEventListener("click", async () => {
    const ok = await confirmarDigitando("Zerar presenças?", "Apaga todas as presenças e cadastros na hora deste evento, em todos os tablets. As listas continuam.", "ZERAR", "Zerar presenças");
    if (!ok) return;
    try { await rpc("zerar_presencas", { p_id: evento.id }); toast("Presenças zeradas."); await carregarEvento(evento.id); mostrarAba("operacao"); }
    catch (e) { toast("Não foi possível zerar: " + e.message, true); }
  });
  $("btnApagarDados").addEventListener("click", async () => {
    const ok = await confirmarDigitando("Apagar dados pessoais?", "Apaga os nomes de todas as listas, as presenças e os cadastros na hora. Ficam só os números. Baixe o relatório antes: não tem volta.", "APAGAR", "Apagar dados pessoais");
    if (!ok) return;
    try { await rpc("apagar_dados_pessoais", { p_id: evento.id }); toast("Dados pessoais apagados."); await carregarEvento(evento.id); mostrarAba("operacao"); }
    catch (e) { toast("Não foi possível apagar: " + e.message, true); }
  });
  $("btnExcluir").addEventListener("click", async () => {
    const ok = await confirmarDigitando("Excluir o evento?", `Apaga <b>${esc(evento.nome)}</b> por completo: configuração, identidade, listas e presenças. O link deixa de funcionar. Não tem volta.`, "EXCLUIR", "Excluir evento");
    if (!ok) return;
    try { await rpc("excluir_evento", { p_id: evento.id }); sujo.dados = sujo.identidade = sujo.certificados = false; evento = null; toast("Evento excluído."); location.hash = "#/"; }
    catch (e) { toast("Não foi possível excluir: " + e.message, true); }
  });

  /* ---------- Certificados ---------- */
  let certAssinaturaBase64 = "";

  function preencherCertificados() {
    $("certAtivo").checked = !!evento.certificado_ativo;
    $("camposCertificado").hidden = !evento.certificado_ativo;
    $("certLiberaEm").value = paraCampo(evento.certificado_libera_em);
    $("certHoras").value = evento.certificado_horas != null && evento.certificado_horas !== "" ? evento.certificado_horas : 4;
    $("certEmissor").value = evento.certificado_emissor || "";
    $("certTexto").value = evento.certificado_texto || "Certificamos que {nome} participou do evento {evento}, realizado em {data}, com carga horária de {horas} horas.";
    $("certAssinaturaNome").value = evento.certificado_assinatura_nome || "";
    $("certAssinaturaCargo").value = evento.certificado_assinatura_cargo || "";

    certAssinaturaBase64 = evento.certificado_assinatura_imagem || "";
    if (certAssinaturaBase64) {
      $("certAssinaturaImg").src = certAssinaturaBase64;
      $("certAssinaturaImg").hidden = false;
      $("btnRemoverAssinatura").hidden = false;
    } else {
      $("certAssinaturaImg").removeAttribute("src");
      $("certAssinaturaImg").hidden = true;
      $("btnRemoverAssinatura").hidden = true;
    }

    atualizarInfoLiberaCert();
    atualizarPreviaCertificado();
    atualizarLoteCertificados();
    marcar("certificados", false, "certEstado");
  }

  function atualizarInfoLiberaCert() {
    const v = $("certLiberaEm").value, el = $("certLiberaInfo");
    el.className = "dica estado-encerra";
    if (!v) {
      el.textContent = "Sem horário definido: o certificado fica liberado para download assim que a presença for confirmada.";
      return;
    }
    const falta = new Date(v).getTime() - Date.now();
    if (falta <= 0) {
      el.textContent = "Já liberado: este horário já passou. Os participantes com presença confirmada já podem baixar seus certificados.";
      el.classList.add("passou");
      return;
    }
    const h = Math.floor(falta / 3600000), m = Math.ceil((falta % 3600000) / 60000);
    el.textContent = `Liberará ${quandoCurto(new Date(v).toISOString())} (daqui a ${h ? h + " h " : ""}${m} min). Quem tentar baixar antes verá aviso com contagem regressiva e opção de guardar o link no WhatsApp.`;
  }

  function atualizarPreviaCertificado() {
    const dadosPrevia = {
      nome: "Hudson Batista",
      evento: (evento && evento.nome) || "Nome do Evento",
      data: (evento && evento.data) || null,
      horas: $("certHoras").value || 4,
      emissor: $("certEmissor").value.trim() || "SISTEMA FIEAM / IEL",
      texto: $("certTexto").value.trim(),
      assinatura_nome: $("certAssinaturaNome").value.trim() || "Hudson Batista",
      assinatura_cargo: $("certAssinaturaCargo").value.trim() || "Coordenação de Eventos",
      assinatura_imagem: certAssinaturaBase64,
      codigo: "CERT-DEMO-2026"
    };

    const container = $("certPreviaArea");
    container.innerHTML = C.gerarHtmlCertificado(dadosPrevia);

    if (window.qrcode && evento) {
      const qr = window.qrcode(0, "M");
      qr.addData(`${location.origin}/e/${evento.slug}#validar&cod=${encodeURIComponent(dadosPrevia.codigo)}`);
      qr.make();
      const svg = qr.createSvgTag(3, 0);
      const q = container.querySelector(".cert-qr");
      if (q) q.innerHTML = svg;
    }
  }

  function atualizarLoteCertificados() {
    if (!evento) return;
    const m = window.Presenca.montar(evento.listas, evento.pessoas, evento.checkins, evento.avulsos);
    const totalPresentes = m.presentes || 0;
    $("certLoteInfo").textContent = `Total de participantes com presença confirmada até o momento: ${totalPresentes} pessoa(s).`;
    $("btnBaixarTodosCert").disabled = totalPresentes === 0;
  }

  $("certAtivo").addEventListener("change", (e) => {
    $("camposCertificado").hidden = !e.target.checked;
    marcar("certificados", true, "certEstado");
    atualizarPreviaCertificado();
  });
  $("certLiberaEm").addEventListener("input", () => {
    atualizarInfoLiberaCert();
    marcar("certificados", true, "certEstado");
  });
  $("certLiberaAgora").addEventListener("click", () => {
    $("certLiberaEm").value = paraCampo(new Date().toISOString());
    atualizarInfoLiberaCert();
    marcar("certificados", true, "certEstado");
  });
  $("certLiberaEncerra").addEventListener("click", () => {
    if (evento && evento.encerra_em) {
      $("certLiberaEm").value = paraCampo(evento.encerra_em);
    } else if ($("dEncerra").value) {
      $("certLiberaEm").value = $("dEncerra").value;
    } else {
      toast("Defina primeiro o horário de encerramento na aba Dados.", true);
      return;
    }
    atualizarInfoLiberaCert();
    marcar("certificados", true, "certEstado");
  });
  $("certLiberaLimpar").addEventListener("click", () => {
    $("certLiberaEm").value = "";
    atualizarInfoLiberaCert();
    marcar("certificados", true, "certEstado");
  });

  $("formCertificado").addEventListener("input", (e) => {
    if (e.target.id !== "certLiberaEm") {
      marcar("certificados", true, "certEstado");
      atualizarPreviaCertificado();
    }
  });

  document.querySelectorAll("#aba-certificados [data-tag]").forEach((b) => {
    b.addEventListener("click", () => {
      const tag = b.dataset.tag;
      const t = $("certTexto");
      const ini = t.selectionStart != null ? t.selectionStart : t.value.length;
      const fim = t.selectionEnd != null ? t.selectionEnd : t.value.length;
      t.value = t.value.substring(0, ini) + tag + t.value.substring(fim);
      t.focus();
      t.setSelectionRange(ini + tag.length, ini + tag.length);
      marcar("certificados", true, "certEstado");
      atualizarPreviaCertificado();
    });
  });

  $("btnEscolherAssinatura").addEventListener("click", () => $("certAssinaturaArquivo").click());
  $("certAssinaturaArquivo").addEventListener("change", async (e) => {
    const arq = e.target.files[0]; e.target.value = "";
    if (!arq) return;
    try {
      const r = await window.Imagens.reduzir(arq, 400, true);
      certAssinaturaBase64 = r.url;
      $("certAssinaturaImg").src = r.url;
      $("certAssinaturaImg").hidden = false;
      $("btnRemoverAssinatura").hidden = false;
      marcar("certificados", true, "certEstado");
      atualizarPreviaCertificado();
      toast("Assinatura carregada.");
    } catch (err) {
      toast("Erro ao carregar assinatura: " + err.message, true);
    }
  });
  $("btnRemoverAssinatura").addEventListener("click", () => {
    certAssinaturaBase64 = "";
    $("certAssinaturaImg").removeAttribute("src");
    $("certAssinaturaImg").hidden = true;
    $("btnRemoverAssinatura").hidden = true;
    marcar("certificados", true, "certEstado");
    atualizarPreviaCertificado();
  });

  $("formCertificado").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn1 = $("btnSalvarCert"), btn2 = $("btnSalvarCertBaixo");
    if (btn1) btn1.disabled = true;
    if (btn2) btn2.disabled = true;
    const dados = {
      certificado_ativo: $("certAtivo").checked,
      certificado_libera_em: doCampo($("certLiberaEm").value),
      certificado_horas: parseFloat($("certHoras").value) || 0,
      certificado_emissor: $("certEmissor").value.trim(),
      certificado_texto: $("certTexto").value.trim(),
      certificado_assinatura_nome: $("certAssinaturaNome").value.trim(),
      certificado_assinatura_cargo: $("certAssinaturaCargo").value.trim(),
      certificado_assinatura_imagem: certAssinaturaBase64
    };
    try {
      await rpc("salvar_evento", { p_id: evento.id, p_dados: dados });
      Object.assign(evento, dados);
      marcar("certificados", false, "certEstado");
      $("certEstado").textContent = "Salvo ✓";
      $("certEstado").className = "estado salvo";
      if ($("certEstadoBaixo")) {
        $("certEstadoBaixo").textContent = "Salvo ✓";
        $("certEstadoBaixo").className = "estado salvo";
      }
      toast("Configurações do certificado salvas com sucesso.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast("Não foi possível salvar: " + err.message, true);
    } finally {
      if (btn1) btn1.disabled = false;
      if (btn2) btn2.disabled = false;
    }
  });

  $("btnBaixarTodosCert").addEventListener("click", async () => {
    const btn = $("btnBaixarTodosCert"), txt = btn.textContent;
    btn.disabled = true; btn.textContent = "Preparando certificados para impressão…";
    try {
      const presentes = await rpc("obter_presentes_certificado", { p_evento_id: evento.id });
      if (!presentes || !presentes.length) {
        toast("Nenhuma presença confirmada para emitir certificados.", true);
        return;
      }

      const config = {
        evento: evento.nome,
        data: evento.data,
        horas: evento.certificado_horas || $("certHoras").value || 0,
        emissor: evento.certificado_emissor || $("certEmissor").value.trim() || "SISTEMA FIEAM / IEL",
        texto: evento.certificado_texto || $("certTexto").value.trim(),
        assinatura_nome: evento.certificado_assinatura_nome || $("certAssinaturaNome").value.trim(),
        assinatura_cargo: evento.certificado_assinatura_cargo || $("certAssinaturaCargo").value.trim(),
        assinatura_imagem: evento.certificado_assinatura_imagem || certAssinaturaBase64
      };

      const htmls = presentes.map((p) => {
        return C.gerarHtmlCertificado({
          ...config,
          nome: p.nome,
          codigo: p.codigo
        });
      }).join("");

      const imp = $("impressao");
      imp.innerHTML = `<div class="impressao-certificados">${htmls}</div>`;

      if (window.qrcode) {
        imp.querySelectorAll(".cert-qr").forEach((el) => {
          const cod = el.dataset.qr;
          if (!cod) return;
          const qr = window.qrcode(0, "M");
          qr.addData(`${location.origin}/e/${evento.slug}#validar&cod=${encodeURIComponent(cod)}`);
          qr.make();
          el.innerHTML = qr.createSvgTag(3, 0);
        });
      }

      setTimeout(() => {
        const tituloAntes = document.title;
        const evNome = evento.nome || "Evento";
        const carga = (evento.certificado_horas != null && evento.certificado_horas !== "") ? `${evento.certificado_horas}h` : `${$("certHoras").value || 0}h`;
        const nomeArquivo = `Certificados - ${evNome} - ${carga}`.replace(/[\\/:*?"<>|]/g, " ");
        document.title = nomeArquivo;
        window.print();
        setTimeout(() => { document.title = tituloAntes; }, 2000);
        btn.disabled = false;
        btn.textContent = txt;
      }, 500);
    } catch (err) {
      toast("Não foi possível preparar os certificados: " + err.message, true);
      btn.disabled = false;
      btn.textContent = txt;
    }
  });

  /* ================= Listas (js/admin-listas.js) ================= */
  // Busca de novo só listas e pessoas (sem mexer no que está sendo editado nas outras abas).
  async function recarregarListas() {
    const d = await rpc("obter_evento", { p_id: evento.id });
    evento.listas = d.listas; evento.pessoas = d.pessoas; evento.versao = d.versao;
    enviarPrevia();
  }
  window.Listas.iniciar({ rpc, janela, toast, confirmarDigitando, evento: () => evento, recarregarListas });

  /* ================= Início ================= */
  window.Acesso.garantir(sb).then(() => navegar());
})();
