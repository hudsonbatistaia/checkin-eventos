/* Check-in de Eventos — relatório de presença em Excel (.xlsx com abas e formatação).
   Usado pelo painel (tablets) e pela área da organização. Precisa de /vendor/xlsx.bundle.js. */
(function (root) {
  "use strict";
  const C = root.Comum, P = root.Presenca;

  let pronto = null;
  function carregarXLSX() {
    if (root.XLSX) return Promise.resolve();
    if (!pronto) pronto = new Promise((ok, falha) => {
      const s = document.createElement("script");
      s.src = "/vendor/xlsx.bundle.js";
      s.onload = ok;
      s.onerror = () => { pronto = null; falha(new Error("Não foi possível carregar o gerador de planilhas. Verifique a internet.")); };
      document.head.appendChild(s);
    });
    return pronto;
  }

  // Número de série do Excel a partir da hora LOCAL do aparelho (sem depender de fuso no arquivo).
  function serialExcel(iso) {
    const d = new Date(iso);
    return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000;
  }
  const hex = (h) => String(h || "").replace("#", "").toUpperCase();
  const clara = (cor, t) => hex(C.rgbHex(C.misturar(C.hexRgb(cor), [255, 255, 255], t)));

  // extra.cadastros (só a organização tem): [id, cpf, nascimento, email, telefone, extras, consentiu_em]
  function gerar(evento, m, extra) {
    const X = root.XLSX;
    const aberto = !!evento.aberto;
    const cad = new Map(((extra && extra.cadastros) || []).map((c) => [c[0], c]));
    // Colunas do cadastro na entrada: só no relatório da organização (o do painel não recebe esses dados).
    const camposExtras = cad.size ? (evento.campos || []).filter((c) => c.chave !== "empresa") : [];
    const comAceite = cad.size && C.precisaConsentimento(evento.campos);
    const dataBR = (iso) => { const mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return mt ? `${mt[3]}/${mt[2]}/${mt[1]}` : ""; };
    function valorCampo(id, c) {
      const r = cad.get(id);
      if (!r) return "";
      if (c.chave === "cpf") return r[1] ? C.mascaraCpf(r[1]) : "";
      if (c.chave === "nascimento") return dataBR(r[2]);
      if (c.chave === "email") return r[3] || "";
      if (c.chave === "telefone") return r[4] ? C.mascaraTelefone(r[4]) : "";
      return (r[5] || {})[c.chave] || "";
    }
    const aceite = (id) => { const r = cad.get(id); return r && r[6] ? new Date(r[6]).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; };
    const tema = { ...C.TEMA_PADRAO, ...(evento.tema || {}) };
    // Cor principal do relatório: o fundo do evento, escurecido até ler bem no branco.
    const forte = hex(C.rgbHex(C.ajustarContraste(C.hexRgb(tema.fundo1), [255, 255, 255], 5)));
    const COR = { forte, fundo: clara("#" + forte, 0.9), linha: "D3DDE6", texto: "1B2733", suave: "5A6E84", ok: "DDF6EE", falta: "FBE3DC" };
    const borda = { top: { style: "thin", color: { rgb: COR.linha } }, bottom: { style: "thin", color: { rgb: COR.linha } }, left: { style: "thin", color: { rgb: COR.linha } }, right: { style: "thin", color: { rgb: COR.linha } } };
    const E = {
      titulo: { font: { name: "Calibri", sz: 16, bold: true, color: { rgb: COR.forte } } },
      sub: { font: { name: "Calibri", sz: 10, italic: true, color: { rgb: COR.suave } } },
      secao: { font: { name: "Calibri", sz: 12, bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: COR.forte } } },
      cab: { font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: COR.forte } }, alignment: { vertical: "center", horizontal: "center", wrapText: true }, border: borda },
      cel: { font: { name: "Calibri", sz: 11, color: { rgb: COR.texto } }, alignment: { vertical: "center" }, border: borda },
      rot: { font: { name: "Calibri", sz: 11, color: { rgb: COR.texto } }, fill: { fgColor: { rgb: COR.fundo } }, border: borda },
      val: { font: { name: "Calibri", sz: 12, bold: true, color: { rgb: COR.forte } }, alignment: { horizontal: "right" }, border: borda },
    };
    // Cada célula com cópia própria do estilo: a biblioteca grava o formato numérico no objeto de estilo
    // (estilo compartilhado fazia números saírem como % ou hora).
    const copia = (cell) => (cell && cell.s ? { ...cell, s: JSON.parse(JSON.stringify(cell.s)) } : cell);
    const comFundo = (estilo, rgb) => (rgb ? { ...estilo, fill: { fgColor: { rgb } } } : estilo);

    function aba(titulo, subtitulo, cabecalho, linhas, larguras, corDaLinha) {
      const ws = {};
      const put = (r, c, cell) => { ws[X.utils.encode_cell({ r, c })] = copia(cell); };
      put(0, 0, { t: "s", v: titulo, s: E.titulo });
      put(1, 0, { t: "s", v: subtitulo, s: E.sub });
      cabecalho.forEach((h, c) => put(3, c, { t: "s", v: h, s: E.cab }));
      linhas.forEach((l, i) => {
        const fundo = corDaLinha ? corDaLinha(l, i) : null;
        l.valores.forEach((v, c) => {
          const s = comFundo(E.cel, fundo), centro = { ...s, alignment: { horizontal: "center" } };
          if (v && typeof v === "object" && v.hora) put(4 + i, c, { t: "n", v: serialExcel(v.hora), z: "hh:mm", s: centro });
          else if (v && typeof v === "object" && v.data) put(4 + i, c, { t: "n", v: Math.floor(serialExcel(v.data)), z: "dd/mm/yyyy", s: centro });
          else if (v && typeof v === "object" && "pct" in v) put(4 + i, c, { t: "n", v: v.pct, z: "0%", s: centro });
          else if (typeof v === "number") put(4 + i, c, { t: "n", v, s: centro });
          else put(4 + i, c, { t: "s", v: v == null ? "" : String(v), s });
        });
      });
      const ultima = 3 + Math.max(linhas.length, 1);
      ws["!ref"] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ultima, c: cabecalho.length - 1 } });
      if (linhas.length) ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: ultima, c: cabecalho.length - 1 } }) };
      ws["!cols"] = larguras.map((w) => ({ wch: w }));
      ws["!rows"] = [{ hpt: 24 }, {}, {}, { hpt: 22 }];
      return ws;
    }

    const agora = new Date();
    const geradoEm = `Gerado em ${agora.toLocaleDateString("pt-BR")} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    const n = P.numeros(m);
    const vips = m.listas.filter((l) => l.tipo === "vip");
    const perfil = (g) => (g.vips.length ? g.vips.map((l) => l.nome).join(" / ") : g.confirmou ? "Presença confirmada" : "Sem confirmação");
    const situacao = (g) => (g.confirmou ? "Confirmou presença" : g.vips.length ? "Lista VIP" : "Veio sem confirmar");
    const corPessoa = (g) => (g && g.vips.length ? clara(g.vips[0].cor, 0.82) : null);

    // ---- Presentes, em ordem de chegada
    const presentes = n.todos.filter((g) => m.presenca.has(g.grupo)).map((g) => {
      const p = m.presenca.get(g.grupo);
      return { g, nome: g.nome, empresa: P.empresaTxt(g), perfil: perfil(g), situacao: situacao(g), horario: p.horario, tablet: p.dispositivo || "" };
    }).concat(m.avulsos.map((a) => ({ g: null, id: a.id, nome: a.nome, empresa: C.bonita(a.empresa), perfil: "—", situacao: aberto ? "Check-in na entrada" : "Cadastro na hora", horario: a.horario, tablet: a.dispositivo || "" })))
      .sort((a, b) => String(a.horario).localeCompare(String(b.horario)));
    const ausentes = n.conf.filter((g) => !m.presenca.has(g.grupo)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    // ---- Chegadas por meia hora e por tablet
    const faixas = new Map();
    presentes.forEach((p) => {
      const d = new Date(p.horario), k = `${String(d.getHours()).padStart(2, "0")}:${d.getMinutes() < 30 ? "00" : "30"}`;
      faixas.set(k, (faixas.get(k) || 0) + 1);
    });
    const faixasOrd = [...faixas.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const fimFaixa = (k) => { const [h, mi] = k.split(":").map(Number); const t = h * 60 + mi + 29; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
    const pico = faixasOrd.reduce((a, b) => (b[1] > (a ? a[1] : -1) ? b : a), null);
    const tablets = new Map();
    presentes.forEach((p) => { const t = p.tablet || "(sem nome)"; tablets.set(t, (tablets.get(t) || 0) + 1); });

    // ---- Resumo (blocos de indicadores)
    const ws = {}; const put = (r, c, cell) => { ws[X.utils.encode_cell({ r, c })] = copia(cell); };
    put(0, 0, { t: "s", v: `${evento.nome} — Relatório de presença`, s: E.titulo });
    const info = [C.dataExtenso(evento.data), evento.local].filter(Boolean).join(" · ");
    put(1, 0, { t: "s", v: geradoEm + (info ? " · " + info : ""), s: E.sub });
    let r = 3;
    const secao = (t) => { for (let c = 0; c < 3; c++) put(r, c, { t: "s", v: c ? "" : t, s: E.secao }); r++; };
    const linha = (rot, val, extra) => {
      put(r, 0, { t: "s", v: rot, s: E.rot });
      put(r, 1, val && typeof val === "object" && val.t ? val : { t: typeof val === "number" ? "n" : "s", v: val, s: E.val });
      if (extra != null) put(r, 2, { t: "s", v: extra, s: E.cel });
      r++;
    };
    secao("Presença geral");
    linha("Total de presentes", n.total);
    if (aberto) {
      linha("Check-ins na entrada", m.avulsos.length);
      const peloCelular = m.avulsos.filter((a) => a.dispositivo === "Celular (QR)").length;
      if (peloCelular) linha("Pelo celular (QR)", peloCelular);
      if (n.total - m.avulsos.length) linha("Das listas VIP", n.total - m.avulsos.length);
    } else {
      linha("Confirmaram e vieram", n.confIn.length, `de ${n.conf.length} que confirmaram`);
      linha("Comparecimento de quem confirmou", { t: "n", v: n.pct, z: "0%", s: E.val });
      linha("Confirmaram e não vieram", ausentes.length);
      linha("Vieram sem confirmar", n.semConf.length);
      linha("Cadastros na hora", m.avulsos.length);
    }
    r++;
    if (vips.length) {
      secao("Listas VIP");
      vips.forEach((l) => { const it = P.itensDaLista(m, l); linha(`${l.nome} presentes`, it.filter((i) => i.horario).length, `de ${it.length}`); });
      r++;
    }
    secao("Horários");
    if (presentes.length) {
      linha("Primeira chegada", { t: "n", v: serialExcel(presentes[0].horario), z: "hh:mm", s: E.val });
      linha("Última chegada", { t: "n", v: serialExcel(presentes[presentes.length - 1].horario), z: "hh:mm", s: E.val });
      if (pico) linha("Horário de pico", `${pico[0]} – ${fimFaixa(pico[0])}`, `${pico[1]} chegadas`);
    } else linha("Nenhuma chegada registrada", "");
    r++;
    secao("Chegadas por meia hora");
    ["Faixa", "Chegadas", "Acumulado"].forEach((h, c) => put(r, c, { t: "s", v: h, s: E.cab })); r++;
    let acum = 0;
    faixasOrd.forEach(([k, q]) => { acum += q; put(r, 0, { t: "s", v: `${k} – ${fimFaixa(k)}`, s: E.rot }); put(r, 1, { t: "n", v: q, s: E.val }); put(r, 2, { t: "n", v: acum, s: { ...E.cel, alignment: { horizontal: "right" } } }); r++; });
    r++;
    secao("Presenças por tablet");
    ["Tablet", "Presenças", "% do total"].forEach((h, c) => put(r, c, { t: "s", v: h, s: E.cab })); r++;
    [...tablets.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, q]) => {
      put(r, 0, { t: "s", v: t, s: E.rot }); put(r, 1, { t: "n", v: q, s: E.val });
      put(r, 2, { t: "n", v: presentes.length ? q / presentes.length : 0, z: "0%", s: { ...E.cel, alignment: { horizontal: "center" } } }); r++;
    });
    ws["!ref"] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: 2 } });
    ws["!cols"] = [{ wch: 40 }, { wch: 16 }, { wch: 24 }];
    ws["!rows"] = [{ hpt: 24 }];

    // ---- Por empresa
    const emp = new Map();
    const reg = (e) => { const k = C.norm(e || "(sem empresa)"); if (!emp.has(k)) emp.set(k, { nome: C.bonita(e) || "(sem empresa)", conf: 0, confIn: 0, presentes: 0 }); return emp.get(k); };
    n.todos.forEach((g) => { const e = reg(g.empresas[0] || ""); if (g.confirmou) { e.conf++; if (m.presenca.has(g.grupo)) e.confIn++; } if (m.presenca.has(g.grupo)) e.presentes++; });
    m.avulsos.forEach((a) => { reg(a.empresa).presentes++; });
    const empresas = [...emp.values()].filter((e) => e.conf || e.presentes).sort((a, b) => (b.presentes - a.presentes) || a.nome.localeCompare(b.nome, "pt-BR"));

    // ---- Monta o arquivo (nomes de aba: até 31 caracteres, sem : \ / ? * [ ], sem repetir)
    const wb = X.utils.book_new();
    const usados = new Set();
    const nomeAba = (s) => {
      let base = String(s).replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Lista";
      let nome = base, i = 2;
      while (usados.has(nome.toLowerCase())) nome = base.slice(0, 28) + " " + i++;
      usados.add(nome.toLowerCase());
      return nome;
    };
    const juntar = (ws, nome) => X.utils.book_append_sheet(wb, ws, nomeAba(nome));
    juntar(ws, "Resumo");
    juntar(aba("Presentes", `${presentes.length} pessoas, em ordem de chegada · ${geradoEm}`,
      ["Nº", "Nome", "Empresa", "Listas", "Situação", "Data", "Hora de chegada", "Tablet"].concat(camposExtras.map(C.rotuloCampo), comAceite ? ["Aceite LGPD"] : []),
      presentes.map((p, i) => ({ g: p.g, valores: [i + 1, p.nome, p.empresa, p.perfil, p.situacao, { data: p.horario }, { hora: p.horario }, p.tablet]
        .concat(camposExtras.map((c) => valorCampo(p.id, c)), comAceite ? [aceite(p.id)] : []) })),
      [6, 36, 42, 26, 22, 12, 16, 16].concat(camposExtras.map((c) => (c.chave === "email" ? 30 : 18)), comAceite ? [18] : []), (l) => corPessoa(l.g)), "Presentes");
    if (!aberto) juntar(aba("Confirmaram e não vieram", `${ausentes.length} pessoas · ${geradoEm}`,
      ["Nº", "Nome", "Empresa", "Listas VIP"],
      ausentes.map((g, i) => ({ g, valores: [i + 1, g.nome, P.empresaTxt(g), g.vips.map((l) => l.nome).join(" / ")] })),
      [6, 36, 48, 26], (l) => corPessoa(l.g)), "Ausentes");
    for (const l of vips.filter((x) => x.aba_relatorio)) {
      const it = P.itensDaLista(m, l).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      const cab = ["Nº", "Nome", "Empresa"].concat(l.campo_extra ? [l.campo_extra] : [], ["Presente", "Hora de chegada", "Tablet"]);
      juntar(aba(l.nome, `${it.filter((i) => i.horario).length} de ${it.length} presentes · ${geradoEm}`, cab,
        it.map((a, i) => ({ ok: !!a.horario, valores: [i + 1, a.nome, a.empresa].concat(l.campo_extra ? [a.extra] : [], [a.horario ? "Sim" : "Não", a.horario ? { hora: a.horario } : "", a.dispositivo]) })),
        [6, 36, 40].concat(l.campo_extra ? [24] : [], [11, 16, 16]), (x) => (x.ok ? COR.ok : COR.falta)), l.nome);
    }
    juntar(aberto
      ? aba("Presença por empresa", `${empresas.length} empresas/instituições · ${geradoEm}`, ["Empresa", "Presentes"],
          empresas.map((e) => ({ valores: [e.nome, e.presentes] })), [50, 13])
      : aba("Presença por empresa", `${empresas.length} empresas/instituições · ${geradoEm}`,
          ["Empresa", "Confirmaram", "Confirmaram e vieram", "Confirmaram e não vieram", "% comparecimento", "Total de presentes (inclui sem confirmação e na hora)"],
          empresas.map((e) => ({ valores: [e.nome, e.conf, e.confIn, e.conf - e.confIn, e.conf ? { pct: e.confIn / e.conf } : "—", e.presentes] })),
          [50, 13, 13, 13, 15, 24]), "Por empresa");

    const p2 = (x) => String(x).padStart(2, "0");
    const nomeArq = `Relatorio-presenca-${C.slug(evento.nome) || "evento"}-${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}-${p2(agora.getHours())}h${p2(agora.getMinutes())}.xlsx`;
    X.writeFile(wb, nomeArq, { compression: true });
    return nomeArq;
  }

  async function baixar(evento, m, extra) {
    await carregarXLSX();
    return gerar(evento, m, extra);
  }
  root.Relatorio = { baixar, serialExcel };
})(typeof self !== "undefined" ? self : this);
