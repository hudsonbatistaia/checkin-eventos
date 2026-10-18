/* Check-in de Eventos — abas "Convidados" e "Listas VIP" da organização:
   enviar planilha (escolhendo colunas), conferir repetidos, digitar, editar e configurar listas VIP. */
window.Listas = (() => {
  "use strict";
  const C = window.Comum, L = window.Lista, esc = C.esc;
  const $ = (id) => document.getElementById(id);
  let O = null;                 // ferramentas da organização (admin.js)
  const envios = new Map();     // lista -> estado do envio de planilha em andamento
  const abertas = new Map();    // lista -> área aberta ("nomes")
  let abaAtual = "convidados";

  const CORES = ["#F6B04C", "#38C6E3", "#D46BE8", "#7B6BEF", "#46E6CB", "#FF7A59", "#E84A5F", "#3DDC84", "#FFD23F", "#4F7CFF"];
  const DESCRICAO = {
    confirmados: "Quem confirmou presença. É a base do painel: \"presentes\" e \"ainda não chegaram\".",
    convidados: "Pessoas convidadas que não confirmaram. Servem para a recepção reconhecer quem chega sem ter confirmado.",
  };
  const ESTRELA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5C12.9 8.6 15.4 11.1 21.5 12 15.4 12.9 12.9 15.4 12 21.5 11.1 15.4 8.6 12.9 2.5 12 8.6 11.1 11.1 8.6 12 2.5Z" fill="currentColor"/></svg>';

  /* ---------- Dados do evento ---------- */
  const ev = () => O.evento();
  const lista = (id) => ev().listas.find((l) => l.id === id);
  // pessoas: [id, lista, grupo, nome, empresa, extra, busca]
  const pessoas = () => ev().pessoas.map((p) => ({ id: p[0], lista: p[1], grupo: p[2], nome: p[3], empresa: p[4], extra: p[5] }));
  const pessoasDa = (id) => pessoas().filter((p) => p.lista === id);
  const nomeLista = (id) => (lista(id) || {}).nome || "";
  const quando = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const selo = (l) => `<span class="selo-amostra" style="background:${l.cor};color:${C.sobre(C.hexRgb(l.cor))}">${ESTRELA}${esc(l.nome)}</span>`;

  let xlsxPronto = null;
  function carregarXLSX() {
    if (!xlsxPronto) xlsxPronto = new Promise((ok, falha) => {
      const s = document.createElement("script");
      s.src = "/vendor/xlsx.bundle.js";
      s.onload = ok;
      s.onerror = () => { xlsxPronto = null; falha(new Error("Não foi possível carregar o leitor de planilhas. Verifique a internet.")); };
      document.head.appendChild(s);
    });
    return xlsxPronto;
  }

  /* ================= Desenho dos cartões ================= */
  function mostrar(aba) {
    abaAtual = aba || abaAtual;
    if (abaAtual === "convidados") {
      $("listasFixas").innerHTML = ev().listas.filter((l) => l.tipo !== "vip").map(cartao).join("");
    } else {
      const vips = ev().listas.filter((l) => l.tipo === "vip");
      $("vipVazio").hidden = vips.length > 0;
      $("listasVip").innerHTML = vips.map(cartao).join("");
    }
    // Reabre o que estava aberto (envio em andamento ou tabela de nomes).
    for (const [id, est] of envios) if (lista(id) && document.querySelector(`[data-lista="${id}"]`)) desenharEnvio(id, est);
    for (const [id] of abertas) if (lista(id) && document.querySelector(`[data-lista="${id}"]`)) desenharNomes(id);
  }

  function cartao(l) {
    const n = pessoasDa(l.id).length;
    const vip = l.tipo === "vip";
    const info = n
      ? `<b>${n}</b> ${n === 1 ? "pessoa" : "pessoas"}${l.arquivo ? ` · planilha "${esc(l.arquivo)}"` : ""}${l.atualizado ? ` em ${quando(l.atualizado)}` : ""}`
      : "Nenhum nome ainda";
    return `<section class="cartao lista" data-lista="${l.id}">
      <div class="lista-topo">
        ${vip ? `<span class="lista-cor" style="background:${l.cor}" aria-hidden="true"></span>` : ""}
        <div class="lista-titulo"><h2>${esc(l.nome)}</h2><p class="dica" data-info>${info}</p></div>
        ${vip ? "" : `<button class="botao link pequeno" type="button" data-renomear>Renomear</button>`}
      </div>
      ${vip ? configVip(l) : `<p class="suave">${DESCRICAO[l.tipo]}</p>`}
      <div class="linha-botoes">
        <label class="botao primario pequeno"><input type="file" accept=".xlsx,.xlsm,.xls,.csv" hidden data-enviar>Enviar planilha</label>
        <button class="botao pequeno" type="button" data-incluir>Incluir nome</button>
        <button class="botao pequeno" type="button" data-ver aria-expanded="${abertas.has(l.id)}">${abertas.has(l.id) ? "Fechar nomes" : `Ver nomes${n ? ` (${n})` : ""}`}</button>
        <button class="botao link pequeno" type="button" data-modelo>Baixar modelo Excel</button>
        ${n ? `<button class="botao link pequeno perigo-texto" type="button" data-limpar>Apagar todos os nomes</button>` : ""}
      </div>
      <div class="lista-area" data-area></div>
    </section>`;
  }

  function configVip(l) {
    const id = l.id;
    return `<details class="lista-config"${l._aberta ? " open" : ""}>
      <summary>Configuração da lista ${selo(l)}${l.selo ? "" : ' <span class="dica">· sem selo no tablet</span>'}${l.destaque === "bloco" ? ' <span class="dica">· bloco no painel</span>' : ""}</summary>
      <form class="config" data-config autocomplete="off" novalidate>
        <label>Nome da lista<input name="nome" maxlength="60" value="${esc(l.nome)}" required></label>
        <div class="campo-cor">
          <span class="rotulo">Cor</span>
          <div class="cores-prontas">
            <input type="color" name="cor" value="${l.cor.toLowerCase()}" aria-label="Escolher outra cor">
            ${CORES.map((c) => `<button type="button" data-cor-pronta="${c}" style="background:${c}" aria-label="Cor ${c}"${c === l.cor ? ' aria-pressed="true"' : ""}></button>`).join("")}
          </div>
        </div>
        <label class="marcar"><input type="checkbox" name="selo"${l.selo ? " checked" : ""}> <span><b>Mostrar selo colorido na recepção</b><span class="dica">Desligue para listas sigilosas: a lista aparece só no painel e no relatório.</span></span></label>
        <fieldset class="opcoes">
          <legend>No painel</legend>
          <label><input type="radio" name="destaque-${id}" value="bloco"${l.destaque === "bloco" ? " checked" : ""}> <span><b>Bloco grande no topo</b><span class="dica">Para quem é essencial na cerimônia (ex.: finalistas, autoridades).</span></span></label>
          <label><input type="radio" name="destaque-${id}" value="card"${l.destaque !== "bloco" ? " checked" : ""}> <span><b>Card simples</b><span class="dica">"X de Y chegaram", com os nomes ao abrir.</span></span></label>
        </fieldset>
        <label>Campo extra <span class="dica">opcional · ex.: Troféu que entrega, Mesa, Cargo</span><input name="extra" maxlength="40" value="${esc(l.campo_extra)}"></label>
        <label class="marcar"><input type="checkbox" name="aba"${l.aba_relatorio ? " checked" : ""}> <span><b>Aba própria no relatório Excel</b></span></label>
        <div class="linha-botoes">
          <button class="botao primario pequeno" type="submit">Salvar configuração</button>
          <span class="estado" data-estado></span>
          <button class="botao link pequeno perigo-texto fim" type="button" data-excluir-lista>Apagar esta lista</button>
        </div>
      </form>
    </details>`;
  }

  /* ================= Ações nos cartões ================= */
  function cliques(e) {
    const cart = e.target.closest("[data-lista]");
    if (!cart) return;
    const id = cart.dataset.lista, l = lista(id);
    const b = (sel) => e.target.closest(sel);
    if (b("[data-renomear]")) return renomear(l);
    if (b("[data-incluir]")) return incluir(l);
    if (b("[data-modelo]")) return baixarModelo(l);
    if (b("[data-limpar]")) return limpar(l);
    if (b("[data-excluir-lista]")) return excluirLista(l);
    if (b("[data-ver]")) { if (abertas.has(id)) abertas.delete(id); else { abertas.set(id, ""); envios.delete(id); } return mostrar(); }
    const pronta = b("[data-cor-pronta]");
    if (pronta) { const f = cart.querySelector("[data-config]"); f.cor.value = pronta.dataset.corPronta.toLowerCase(); f.dispatchEvent(new Event("input", { bubbles: true })); return; }
    if (b("[data-cancelar-envio]")) { envios.delete(id); return mostrar(); }
    if (b("[data-salvar-envio]")) return salvarEnvio(id);
    const ed = b("[data-editar]");
    if (ed) return editar(l, ed.dataset.editar);
    const rm = b("[data-remover]");
    if (rm) return remover(l, rm.dataset.remover);
  }

  async function renomear(l) {
    const ok = await O.janela({
      titulo: "Renomear lista", ok: "Salvar",
      corpo: `<label>Nome da lista<input id="jNome" maxlength="60" value="${esc(l.nome)}"></label>`,
      validar: async () => {
        const nome = $("jNome").value.trim();
        if (!nome) throw new Error("Informe o nome da lista.");
        await O.rpc("salvar_lista", { p_evento: ev().id, p_dados: { id: l.id, nome } });
      },
    });
    if (ok) { await O.recarregarListas(); mostrar(); O.toast("Lista renomeada."); }
  }

  /* ---------- Configuração da lista VIP ---------- */
  function lerConfig(form, l) {
    return {
      id: l.id, nome: form.nome.value.trim(), cor: form.cor.value.toUpperCase(), selo: form.selo.checked,
      destaque: (form.querySelector(`input[name="destaque-${l.id}"]:checked`) || {}).value || "card",
      campo_extra: form.extra.value.trim(), aba_relatorio: form.aba.checked,
    };
  }
  function aoMudarConfig(e) {
    const form = e.target.closest("[data-config]");
    if (!form) return;
    const l = lista(form.closest("[data-lista]").dataset.lista);
    const c = lerConfig(form, l);
    form.querySelectorAll("[data-cor-pronta]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.corPronta === c.cor)));
    const amostra = form.closest("details").querySelector("summary .selo-amostra");
    amostra.outerHTML = selo({ ...l, nome: c.nome || l.nome, cor: c.cor });
    const est = form.querySelector("[data-estado]");
    est.textContent = "Alterações não salvas"; est.className = "estado pendente";
  }
  async function salvarConfig(e) {
    const form = e.target.closest("[data-config]");
    if (!form) return;
    e.preventDefault();
    const l = lista(form.closest("[data-lista]").dataset.lista);
    const c = lerConfig(form, l);
    if (!c.nome) { O.toast("Informe o nome da lista.", true); form.nome.focus(); return; }
    const est = form.querySelector("[data-estado]");
    try {
      await O.rpc("salvar_lista", { p_evento: ev().id, p_dados: c });
      await O.recarregarListas();
      lista(l.id)._aberta = true;
      mostrar();
      const novo = document.querySelector(`[data-lista="${l.id}"] [data-estado]`);
      if (novo) { novo.textContent = "Salvo ✓"; novo.className = "estado salvo"; }
    } catch (err) { est.textContent = ""; O.toast("Não foi possível salvar: " + err.message, true); }
  }
  async function novaVip() {
    const usadas = new Set(ev().listas.map((l) => l.cor));
    const cor = CORES.find((c) => !usadas.has(c)) || CORES[0];
    let novoId = null;
    const ok = await O.janela({
      titulo: "Nova lista VIP", ok: "Criar lista",
      corpo: `<p>Depois você escolhe cor, selo, destaque no painel e campo extra.</p><label>Nome da lista<input id="jNome" maxlength="60" placeholder="Ex.: Autoridades, Finalistas, Palestrantes"></label>`,
      validar: async () => {
        const nome = $("jNome").value.trim();
        if (!nome) throw new Error("Informe o nome da lista.");
        if (ev().listas.some((l) => C.norm(l.nome) === C.norm(nome))) throw new Error("Já existe uma lista com esse nome.");
        novoId = await O.rpc("salvar_lista", { p_evento: ev().id, p_dados: { nome, cor } });
      },
    });
    if (!ok) return;
    await O.recarregarListas();
    const l = lista(novoId);
    if (l) l._aberta = true;
    mostrar();
    O.toast("Lista criada. Configure e envie os nomes.");
  }
  async function excluirLista(l) {
    const n = pessoasDa(l.id).length;
    const ok = await O.confirmarDigitando("Apagar a lista?", `Apaga a lista <b>${esc(l.nome)}</b>${n ? ` e os ${n} nomes dela` : ""}. Presenças já marcadas continuam (de quem também está em outra lista).`, "APAGAR", "Apagar lista");
    if (!ok) return;
    try { await O.rpc("excluir_lista", { p_lista: l.id }); envios.delete(l.id); abertas.delete(l.id); await O.recarregarListas(); mostrar(); O.toast("Lista apagada."); }
    catch (err) { O.toast("Não foi possível apagar: " + err.message, true); }
  }

  /* ---------- Modelo Excel ---------- */
  async function baixarModelo(l) {
    try { await carregarXLSX(); } catch (err) { O.toast(err.message, true); return; }
    const X = window.XLSX;
    const cab = ["Nome", "Empresa"].concat(l.campo_extra ? [l.campo_extra] : []);
    const ws = X.utils.aoa_to_sheet([cab]);
    const estilo = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0E8A94" } } };
    cab.forEach((_, i) => { ws[X.utils.encode_cell({ r: 0, c: i })].s = JSON.parse(JSON.stringify(estilo)); });
    ws["!cols"] = cab.map((_, i) => ({ wch: i === 0 ? 40 : 34 }));
    const ajuda = X.utils.aoa_to_sheet([
      ["Como preencher"], [""],
      ["• Preencha a primeira aba: uma pessoa por linha, a partir da linha 2."],
      ["• Nome é obrigatório. Empresa" + (l.campo_extra ? ` e ${l.campo_extra}` : "") + " são opcionais."],
      ["• Pode colocar vários nomes na mesma célula, um por linha (Alt+Enter)."],
      ['• O cargo depois de " - " é ignorado (ex.: "Ana Souza - Diretora").'],
      ["• Se a sua planilha tiver outras colunas ou outros títulos, tudo bem: ao enviar, você escolhe as colunas."],
    ]);
    ajuda["!cols"] = [{ wch: 100 }];
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Nomes");
    X.utils.book_append_sheet(wb, ajuda, "Como preencher");
    X.writeFile(wb, `modelo-${C.slug(l.nome) || "lista"}.xlsx`);
  }

  /* ================= Enviar planilha ================= */
  async function escolheuArquivo(e) {
    const inp = e.target.closest("[data-enviar]");
    if (!inp) return;
    const id = inp.closest("[data-lista]").dataset.lista, arq = inp.files[0];
    inp.value = "";
    if (!arq) return;
    abertas.delete(id);
    try {
      await carregarXLSX();
      const wb = window.XLSX.read(await arq.arrayBuffer(), { type: "array" });
      const est = { arquivo: arq.name, wb, aba: wb.SheetNames[0] };
      lerAba(id, est);
      envios.set(id, est);
      mostrar();
      const area = document.querySelector(`[data-lista="${id}"] [data-area]`);
      if (area) area.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      O.toast("Não foi possível ler a planilha: " + (err.message || err), true);
    }
  }
  function lerAba(id, est) {
    const ws = est.wb.Sheets[est.aba];
    est.linhas = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, blankrows: true });
    est.cab = L.acharCabecalho(est.linhas);
    est.col = L.sugerirColunas(est.linhas[est.cab] || [], lista(id).campo_extra);
  }
  const letra = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function opcoesColuna(titulos, escolhida, opcional) {
    const n = Math.max(titulos.length, 1);
    let html = opcional ? `<option value="-1"${escolhida < 0 ? " selected" : ""}>— nenhuma —</option>` : (escolhida < 0 ? '<option value="-1" selected>— escolha —</option>' : "");
    for (let i = 0; i < n; i++) html += `<option value="${i}"${i === escolhida ? " selected" : ""}>${letra(i)} · ${esc(String(titulos[i] || "(sem título)").slice(0, 40))}</option>`;
    return html;
  }

  function desenharEnvio(id, est) {
    const l = lista(id);
    const area = document.querySelector(`[data-lista="${id}"] [data-area]`);
    if (!area) return;
    const titulos = est.linhas[est.cab] || [];
    // Prepara as pessoas com as colunas atuais.
    let resumo = "", tabela = "", paresHtml = "", pronto = false;
    if (est.col.nome >= 0) {
      const lido = L.lerPessoas(est.linhas, est.cab, est.col);
      const outros = pessoas().filter((p) => p.lista !== id).map((p) => ({ ...p, nomeLista: nomeLista(p.lista) }));
      const env = L.prepararEnvio(lido.pessoas, outros, pessoasDa(id));
      est.env = env;
      // Mantém as escolhas da organização nos pares ao redesenhar.
      est.marcados = est.marcados || new Map();
      const atual = pessoasDa(id).length;
      const ligadas = env.pessoas.filter((p) => p.ligadaA).length;
      const avisos = [];
      if (lido.semNome) avisos.push(`${lido.semNome} ${lido.semNome === 1 ? "linha sem nome foi ignorada" : "linhas sem nome foram ignoradas"}`);
      if (env.repetidos) avisos.push(`${env.repetidos} ${env.repetidos === 1 ? "nome repetido na planilha foi juntado" : "nomes repetidos na planilha foram juntados"}`);
      if (ligadas) avisos.push(`${ligadas} já ${ligadas === 1 ? "está" : "estão"} em outra lista (com o mesmo nome) e ${ligadas === 1 ? "foi ligada" : "foram ligadas"}: a presença vale para as duas`);
      resumo = `<p class="envio-total"><b>${env.pessoas.length}</b> ${env.pessoas.length === 1 ? "pessoa encontrada" : "pessoas encontradas"}${atual ? ` · a lista tem hoje ${atual}` : ""}</p>
        ${avisos.length ? `<ul class="envio-avisos">${avisos.map((a) => `<li>${a}</li>`).join("")}</ul>` : ""}
        ${atual && env.pessoas.length < atual * 0.6 ? `<p class="alerta"><b>Atenção:</b> a planilha tem bem menos nomes que a lista atual. Confira se é o arquivo certo: ao salvar, a lista é substituída.</p>` : ""}
        ${!env.pessoas.length ? `<p class="alerta">Nenhum nome encontrado. Confira a linha dos títulos e a coluna do nome.</p>` : ""}`;
      tabela = env.pessoas.length ? `<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Nome</th><th>Empresa</th>${l.campo_extra ? `<th>${esc(l.campo_extra)}</th>` : ""}</tr></thead><tbody>
        ${env.pessoas.slice(0, 6).map((p) => `<tr><td>${esc(p.nome)}</td><td>${esc(p.empresa)}</td>${l.campo_extra ? `<td>${esc(p.extra)}</td>` : ""}</tr>`).join("")}
        </tbody></table></div>${env.pessoas.length > 6 ? `<p class="dica">Mostrando 6 de ${env.pessoas.length}.</p>` : ""}` : "";
      if (env.pares.length) {
        paresHtml = `<div class="pares"><p><b>Podem ser a mesma pessoa</b> (${env.pares.length}). Marque quando for: a presença de uma vale para a outra.</p>
          <ul>${env.pares.map((par, i) => {
            const k = par.novo.s + "|" + (par.alvo.id || par.alvo.s);
            const marcado = est.marcados.has(k) ? est.marcados.get(k) : par.sugerido;
            const onde = par.origem === "outra" ? `lista ${esc(par.alvo.nomeLista)}` : "nesta planilha";
            return `<li><label><input type="checkbox" data-par="${i}" data-chave="${esc(k)}"${marcado ? " checked" : ""}>
              <span><b>${esc(par.novo.nome)}</b>${par.novo.empresa ? ` · ${esc(par.novo.empresa)}` : ""} <span class="dica">(nesta planilha)</span><br>
              ↔ <b>${esc(par.alvo.nome)}</b>${par.alvo.empresa ? ` · ${esc(par.alvo.empresa)}` : ""} <span class="dica">(${onde})</span></span></label></li>`;
          }).join("")}</ul></div>`;
      }
      pronto = env.pessoas.length > 0;
    } else {
      resumo = `<p class="alerta">Escolha qual coluna tem o <b>nome</b> das pessoas.</p>`;
    }
    const linhasCab = est.linhas.slice(0, 15).map((ln, i) => `<option value="${i}"${i === est.cab ? " selected" : ""}>Linha ${i + 1}: ${esc((ln || []).filter((c) => String(c).trim()).join(" · ").slice(0, 50) || "(vazia)")}</option>`).join("");
    area.innerHTML = `<div class="envio" data-envio>
      <div class="envio-topo"><h3>Planilha "${esc(est.arquivo)}"</h3><button class="botao link pequeno" type="button" data-cancelar-envio>Cancelar</button></div>
      <div class="envio-colunas">
        ${est.wb.SheetNames.length > 1 ? `<label>Aba<select data-sel="aba">${est.wb.SheetNames.map((n) => `<option${n === est.aba ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>` : ""}
        <label>Títulos das colunas estão na<select data-sel="cab">${linhasCab}</select></label>
        <label>Coluna do nome <span class="obrig" title="obrigatória">*</span><select data-sel="nome">${opcoesColuna(titulos, est.col.nome, false)}</select></label>
        <label>Coluna da empresa<select data-sel="empresa">${opcoesColuna(titulos, est.col.empresa, true)}</select></label>
        ${l.campo_extra ? `<label>Coluna "${esc(l.campo_extra)}"<select data-sel="extra">${opcoesColuna(titulos, est.col.extra, true)}</select></label>` : ""}
      </div>
      ${resumo}${tabela}${paresHtml}
      <div class="linha-botoes">
        <button class="botao primario" type="button" data-salvar-envio${pronto ? "" : " disabled"}>Salvar ${pronto ? est.env.pessoas.length : ""} ${pronto && est.env.pessoas.length === 1 ? "pessoa" : "pessoas"} em "${esc(l.nome)}"</button>
        <span class="dica">Substitui os nomes atuais desta lista. Presenças já marcadas continuam.</span>
      </div>
    </div>`;
  }
  function aoMudarEnvio(e) {
    const sel = e.target.closest("[data-sel]");
    const par = e.target.closest("[data-par]");
    const cart = e.target.closest("[data-lista]");
    if (!cart || (!sel && !par)) return;
    const id = cart.dataset.lista, est = envios.get(id);
    if (!est) return;
    if (par) { est.marcados.set(par.dataset.chave, par.checked); return; }
    const v = sel.value;
    if (sel.dataset.sel === "aba") { est.aba = v; lerAba(id, est); }
    else if (sel.dataset.sel === "cab") { est.cab = +v; est.col = L.sugerirColunas(est.linhas[est.cab] || [], lista(id).campo_extra); }
    else est.col[sel.dataset.sel] = +v;
    desenharEnvio(id, est);
  }
  async function salvarEnvio(id) {
    const est = envios.get(id), l = lista(id);
    if (!est || !est.env) return;
    const area = document.querySelector(`[data-lista="${id}"] [data-area]`);
    const aprovados = est.env.pares.filter((_, i) => { const cx = area.querySelector(`[data-par="${i}"]`); return cx && cx.checked; });
    const dados = L.finalizarEnvio(est.env.pessoas, aprovados);
    const btn = area.querySelector("[data-salvar-envio]");
    btn.disabled = true; btn.textContent = "Salvando…";
    try {
      const n = await O.rpc("salvar_pessoas", { p_lista: id, p_dados: dados, p_arquivo: est.arquivo, p_regrupar: [] });
      envios.delete(id);
      await O.recarregarListas();
      mostrar();
      O.toast(`Lista "${l.nome}" atualizada: ${n} ${n === 1 ? "pessoa" : "pessoas"}.`);
    } catch (err) {
      btn.disabled = false; btn.textContent = `Salvar em "${l.nome}"`;
      O.toast("Não foi possível salvar: " + err.message, true);
    }
  }

  /* ================= Nomes (ver, incluir, editar, remover) ================= */
  function desenharNomes(id) {
    const l = lista(id);
    const area = document.querySelector(`[data-lista="${id}"] [data-area]`);
    if (!area) return;
    const filtro = abertas.get(id) || "";
    const todas = pessoas();
    const porGrupo = new Map();
    todas.forEach((p) => { if (!porGrupo.has(p.grupo)) porGrupo.set(p.grupo, new Set()); porGrupo.get(p.grupo).add(p.lista); });
    const q = C.norm(filtro);
    const minhas = pessoasDa(id).filter((p) => !q || C.norm(p.nome + " " + p.empresa + " " + p.extra).includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const LIMITE = 300;
    const tambem = (p) => [...porGrupo.get(p.grupo)].filter((x) => x !== id).map(nomeLista).join(", ");
    area.innerHTML = `<div class="nomes">
      <input type="search" class="busca-nomes" data-filtro placeholder="Buscar nesta lista" value="${esc(filtro)}" aria-label="Buscar nesta lista">
      ${minhas.length ? `<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Nome</th><th>Empresa</th>${l.campo_extra ? `<th>${esc(l.campo_extra)}</th>` : ""}<th>Também em</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>
        ${minhas.slice(0, LIMITE).map((p) => `<tr><td>${esc(p.nome)}</td><td>${esc(p.empresa)}</td>${l.campo_extra ? `<td>${esc(p.extra)}</td>` : ""}<td class="dica">${esc(tambem(p))}</td>
          <td class="acoes"><button class="botao link pequeno" type="button" data-editar="${p.id}">Editar</button><button class="botao link pequeno perigo-texto" type="button" data-remover="${p.id}">Remover</button></td></tr>`).join("")}
      </tbody></table></div>${minhas.length > LIMITE ? `<p class="dica">Mostrando ${LIMITE} de ${minhas.length}. Use a busca.</p>` : ""}`
      : `<p class="dica">${q ? "Ninguém com essa busca." : "Nenhum nome nesta lista."}</p>`}
    </div>`;
  }
  function aoFiltrar(e) {
    const f = e.target.closest("[data-filtro]");
    if (!f) return;
    const id = f.closest("[data-lista]").dataset.lista;
    abertas.set(id, f.value);
    const pos = f.selectionStart;
    desenharNomes(id);
    const novo = document.querySelector(`[data-lista="${id}"] [data-filtro]`);
    novo.focus(); novo.setSelectionRange(pos, pos);
  }

  function camposPessoa(l, p) {
    return `<label>Nome<input id="jNome" maxlength="120" value="${esc(p ? p.nome : "")}"></label>
      <label>Empresa <span class="dica">opcional</span><input id="jEmpresa" maxlength="160" value="${esc(p ? p.empresa : "")}"></label>
      ${l.campo_extra ? `<label>${esc(l.campo_extra)} <span class="dica">opcional</span><input id="jExtra" maxlength="160" value="${esc(p ? p.extra : "")}"></label>` : ""}`;
  }
  const lerPessoa = () => ({
    nome: L.nomeLimpo($("jNome").value) || $("jNome").value.trim(),
    empresa: $("jEmpresa").value.replace(/\s+/g, " ").trim(),
    extra: $("jExtra") ? $("jExtra").value.replace(/\s+/g, " ").trim() : "",
  });

  async function incluir(l) {
    let dados = null;
    const ok = await O.janela({
      titulo: `Incluir em "${l.nome}"`, ok: "Incluir", corpo: camposPessoa(l, null),
      validar: () => {
        dados = lerPessoa();
        if (dados.nome.length < 2) throw new Error("Informe o nome.");
        if (pessoasDa(l.id).some((p) => L.slug(p.nome) === L.slug(dados.nome))) throw new Error("Esse nome já está nesta lista.");
        return true;
      },
    });
    if (!ok) return;
    // Mesma pessoa em outra lista? Nome igual liga sozinho; parecido, a organização decide.
    const outros = pessoas().filter((p) => p.lista !== l.id);
    const s = L.slug(dados.nome);
    const igual = outros.find((p) => L.slug(p.nome) === s);
    let grupo = igual ? igual.grupo : s, aviso = igual ? ` Ligada a "${igual.nome}" (${nomeLista(igual.lista)}).` : "";
    if (!igual) {
      const vistos = new Set();
      const parecidas = outros.filter((p) => L.parecidos(p.nome, dados.nome) && !vistos.has(p.grupo) && vistos.add(p.grupo)).slice(0, 6);
      if (parecidas.length) {
        const escolha = await O.janela({
          titulo: "É a mesma pessoa?", ok: "Continuar",
          corpo: `<p>Há nomes parecidos em outras listas. Se for a mesma pessoa, a presença vale para as duas.</p>
            <div class="escolhas">${parecidas.map((p, i) => `<label class="marcar"><input type="radio" name="jLigar" value="${esc(p.grupo)}"${i === 0 && C.norm(p.empresa) === C.norm(dados.empresa) && dados.empresa ? " checked" : ""}> <span><b>${esc(p.nome)}</b>${p.empresa ? " · " + esc(p.empresa) : ""} <span class="dica">(${esc(nomeLista(p.lista))})</span></span></label>`).join("")}
            <label class="marcar"><input type="radio" name="jLigar" value=""> <span><b>Não, é outra pessoa</b></span></label></div>`,
          validar: () => {
            const r = document.querySelector('input[name="jLigar"]:checked');
            if (!r) throw new Error("Escolha uma opção.");
            return { grupo: r.value };
          },
        });
        if (!escolha) return;
        if (escolha.grupo) { grupo = escolha.grupo; const alvo = parecidas.find((p) => p.grupo === grupo); aviso = ` Ligada a "${alvo.nome}" (${nomeLista(alvo.lista)}).`; }
      }
    }
    try {
      await O.rpc("adicionar_pessoa", { p_lista: l.id, p_dados: { ...dados, grupo, busca: L.norm(dados.nome + " " + dados.empresa) } });
      abertas.set(l.id, abertas.get(l.id) || "");
      await O.recarregarListas(); mostrar();
      O.toast(`"${dados.nome}" incluída.${aviso}`);
    } catch (err) { O.toast("Não foi possível incluir: " + err.message, true); }
  }
  async function editar(l, pid) {
    const p = pessoasDa(l.id).find((x) => x.id === pid);
    if (!p) return;
    const ok = await O.janela({
      titulo: "Editar pessoa", ok: "Salvar", corpo: camposPessoa(l, p),
      validar: async () => {
        const d = lerPessoa();
        if (d.nome.length < 2) throw new Error("Informe o nome.");
        // O grupo continua o mesmo: a presença e as ligações com outras listas não se perdem.
        await O.rpc("editar_pessoa", { p_id: pid, p_dados: { ...d, grupo: p.grupo, busca: L.norm(d.nome + " " + d.empresa) } });
      },
    });
    if (ok) { await O.recarregarListas(); mostrar(); O.toast("Pessoa atualizada."); }
  }
  async function remover(l, pid) {
    const p = pessoasDa(l.id).find((x) => x.id === pid);
    if (!p) return;
    const ok = await O.janela({
      titulo: "Remover da lista?", ok: "Remover", perigo: true,
      corpo: `<p>Remove <b>${esc(p.nome)}</b> da lista "${esc(l.nome)}". Se a pessoa estiver em outra lista, continua lá.</p>`,
      validar: () => O.rpc("remover_pessoa", { p_id: pid }),
    });
    if (ok) { await O.recarregarListas(); mostrar(); O.toast("Pessoa removida."); }
  }
  async function limpar(l) {
    const n = pessoasDa(l.id).length;
    const ok = await O.janela({
      titulo: "Apagar todos os nomes?", ok: `Apagar ${n} nomes`, perigo: true,
      corpo: `<p>Apaga os ${n} nomes da lista "${esc(l.nome)}". A lista e a configuração continuam; presenças já marcadas também.</p>`,
      validar: () => O.rpc("salvar_pessoas", { p_lista: l.id, p_dados: [], p_arquivo: "", p_regrupar: [] }),
    });
    if (ok) { abertas.delete(l.id); await O.recarregarListas(); mostrar(); O.toast("Nomes apagados."); }
  }

  /* ================= Início ================= */
  function iniciar(org) {
    O = org;
    for (const id of ["listasFixas", "listasVip"]) {
      const el = $(id);
      el.addEventListener("click", cliques);
      el.addEventListener("change", escolheuArquivo);
      el.addEventListener("change", aoMudarEnvio);
      el.addEventListener("input", aoMudarConfig);
      el.addEventListener("input", aoFiltrar);
      el.addEventListener("submit", salvarConfig);
    }
    $("btnNovaVip").addEventListener("click", novaVip);
  }
  // Ao trocar de evento, esquece envios e tabelas abertas.
  function limparEstado() { envios.clear(); abertas.clear(); }
  return { iniciar, mostrar, limparEstado };
})();
