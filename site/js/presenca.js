/* Check-in de Eventos — quem é quem e quem chegou.
   Usado pela recepção, pelo painel e pelo relatório (tablets e organização). */
(function (root) {
  "use strict";
  const C = root.Comum;
  const { norm, nomePadrao, bonita } = C;

  // Mesmo primeiro nome e todos os nomes do mais curto aparecem no mais longo.
  const PEQ = new Set(["da", "de", "do", "das", "dos", "e"]);
  function parecidos(a, b) {
    const ta = norm(a).split(" ").filter((w) => w && !PEQ.has(w)), tb = norm(b).split(" ").filter((w) => w && !PEQ.has(w));
    if (ta.length < 2 || tb.length < 2 || ta[0] !== tb[0]) return false;
    const [m, M] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    return m.every((w) => M.includes(w));
  }

  /* Monta tudo a partir dos dados compactos do banco:
     pessoas  [id, lista, grupo, nome, empresa, extra, busca]
     checkins [grupo, horario, tablet]  (ou objetos {grupo, horario, dispositivo})
     avulsos  [id, nome, empresa, horario, tablet] (ou objetos) */
  function montar(listasBrutas, pessoasBrutas, checkinsBrutos, avulsosBrutos) {
    const listas = (listasBrutas || []).slice().sort((a, b) => a.ordem - b.ordem);
    const porId = new Map(listas.map((l) => [l.id, l]));
    const grupos = new Map(), slugToGrupo = new Map(), membros = new Map();
    for (const [pid, lid, grupo, nome, empresa, extra, busca] of pessoasBrutas || []) {
      const l = porId.get(lid);
      if (!l) continue;
      let g = grupos.get(grupo);
      if (!g) { g = { grupo, nome: nomePadrao(nome), empresas: [], confirmou: false, convidado: false, vips: [], extras: [], busca: "", temConf: false }; grupos.set(grupo, g); }
      if (l.tipo === "confirmados") { g.confirmou = true; if (!g.temConf) { g.nome = nomePadrao(nome); g.temConf = true; } }
      else if (l.tipo === "convidados") g.convidado = true;
      else {
        if (!g.vips.includes(l)) g.vips.push(l);
        if (extra && l.campo_extra) g.extras.push({ lista: l, valor: extra });
      }
      if (empresa && !g.empresas.some((e) => norm(e) === norm(empresa))) g.empresas.push(empresa);
      g.busca += " " + (busca || norm(nome + " " + empresa));
      slugToGrupo.set(C.slug(nome), grupo); slugToGrupo.set(grupo, grupo);
      if (!membros.has(lid)) membros.set(lid, []);
      membros.get(lid).push({ id: pid, grupo, nome: nomePadrao(nome), empresa, extra });
    }
    for (const g of grupos.values()) g.vips.sort((a, b) => a.ordem - b.ordem);
    const checkins = (checkinsBrutos || []).map((c) => (Array.isArray(c) ? { grupo: c[0], horario: c[1], dispositivo: c[2] } : c));
    const avulsos = (avulsosBrutos || []).map((a) => (Array.isArray(a) ? { id: a[0], nome: nomePadrao(a[1]), empresa: a[2], horario: a[3], dispositivo: a[4] } : a));
    // Presença: check-in feito com um grupo antigo continua valendo pelo nome.
    const presenca = new Map();
    for (const c of checkins) {
      const g = slugToGrupo.get(c.grupo);
      if (!g) continue;
      const atual = presenca.get(g);
      if (!atual) presenca.set(g, { horario: c.horario, dispositivo: c.dispositivo, chaves: [c.grupo] });
      else { atual.chaves.push(c.grupo); if (c.horario < atual.horario) { atual.horario = c.horario; atual.dispositivo = c.dispositivo; } }
    }
    return { listas, grupos, slugToGrupo, presenca, checkins, avulsos, membros };
  }

  const empresaTxt = (g) => g.empresas.map(bonita).join(" · ");

  // Chegadas (pessoas das listas + cadastrados na hora), mais recentes primeiro.
  function chegadas(m) {
    return [...m.presenca.entries()].map(([gid, p]) => { const g = m.grupos.get(gid); return { tipo: "g", id: gid, g, nome: g.nome, empresa: empresaTxt(g), horario: p.horario, dispositivo: p.dispositivo }; })
      .concat(m.avulsos.map((a) => ({ tipo: "a", id: a.id, nome: a.nome, empresa: bonita(a.empresa), horario: a.horario, dispositivo: a.dispositivo })))
      .sort((a, b) => String(b.horario).localeCompare(String(a.horario)));
  }

  // Pessoas de uma lista VIP com horário de chegada (se cadastrada na hora com nome igual/parecido, também conta).
  function itensDaLista(m, lista) {
    const vistos = new Set();
    return (m.membros.get(lista.id) || []).filter((p) => !vistos.has(p.grupo) && vistos.add(p.grupo)).map((p) => {
      let pr = m.presenca.get(p.grupo);
      if (!pr) {
        const a = m.avulsos.find((x) => norm(x.nome) === norm(p.nome) || parecidos(x.nome, p.nome));
        if (a) pr = { horario: a.horario, dispositivo: a.dispositivo };
      }
      return { nome: p.nome, empresa: bonita(p.empresa), extra: p.extra, grupo: p.grupo, horario: pr ? pr.horario : null, dispositivo: pr ? pr.dispositivo || "" : "" };
    });
  }

  // Números do painel e do relatório.
  function numeros(m) {
    const todos = [...m.grupos.values()];
    const conf = todos.filter((g) => g.confirmou);
    const confIn = conf.filter((g) => m.presenca.has(g.grupo));
    const semConf = todos.filter((g) => !g.confirmou && !g.vips.length && m.presenca.has(g.grupo));
    return { todos, conf, confIn, semConf, total: m.presenca.size + m.avulsos.length, pct: conf.length ? confIn.length / conf.length : 0 };
  }

  root.Presenca = { montar, empresaTxt, chegadas, itensDaLista, numeros, parecidos };
})(typeof self !== "undefined" ? self : this);
