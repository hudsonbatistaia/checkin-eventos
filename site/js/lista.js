/* Leitura de planilhas e ligação de pessoas repetidas entre listas.
   Funciona no navegador (window.Lista) e no Node (testes). */
(function (root) {
  "use strict";
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const PEQUENAS = new Set(["da", "de", "do", "das", "dos", "e"]);
  const TITULOS = /^((sra|sr|dra|dr|prof|profa|exmo|exma|ilmo|ilma)\.?\s+)+/i;

  // Tira espaços especiais e quebras do Windows.
  const limpo = (s) => String(s ?? "").replace(/ /g, " ").replace(/\r/g, "");
  const linha = (s) => limpo(s).replace(/\s+/g, " ").trim();
  // "DEBORA MENEZES" -> "Debora Menezes"; nomes já com maiúsculas e minúsculas ficam como estão.
  function titulo(s) {
    if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
    return s.toLowerCase().split(" ").filter(Boolean)
      .map((w) => (PEQUENAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  }
  // "Sra. ANA SOUZA - Diretora" -> "Ana Souza"
  function nomeLimpo(s) {
    let n = limpo(s).split(/\s+[-–—]\s*/)[0];
    n = n.replace(TITULOS, "").replace(/[;.,\s]+$/, "").replace(/\s+/g, " ").trim();
    return titulo(n);
  }

  /* ---------- Colunas ---------- */
  const PISTAS = {
    nome: ["nome", "participante", "convidad", "pessoa", "name", "competencia", "responsavel", "contato"],
    empresa: ["empresa", "instituic", "orgao", "fornecedor", "organizac", "entidade", "companhia", "razao social", "secretaria"],
  };
  const naoVazias = (l) => (l || []).filter((c) => linha(c) !== "").length;
  // Linha dos títulos: a primeira (até a 15ª) que tem algo parecido com "nome"; senão, a mais preenchida.
  function acharCabecalho(linhas) {
    const max = Math.min(linhas.length, 15);
    for (let i = 0; i < max; i++) {
      const cel = (linhas[i] || []).map(norm);
      if (naoVazias(linhas[i]) >= 1 && cel.some((c) => c.length <= 60 && PISTAS.nome.some((p) => c.includes(p)))) return i;
    }
    let melhor = 0;
    for (let i = 0; i < max; i++) if (naoVazias(linhas[i]) > naoVazias(linhas[melhor])) melhor = i;
    return melhor;
  }
  // Sugere quais colunas são Nome, Empresa e o campo extra (pelo título).
  function sugerirColunas(titulos, campoExtra) {
    const t = titulos.map(norm);
    const acha = (pistas, evitar) => t.findIndex((c, i) => c && !evitar.includes(i) && pistas.some((p) => c.includes(p)));
    // "Nome da empresa" é empresa, não nome: procura empresa primeiro.
    const empresa = acha(PISTAS.empresa, []);
    let nome = t.findIndex((c, i) => i !== empresa && /^nome/.test(c) && !PISTAS.empresa.some((p) => c.includes(p)));
    if (nome < 0) nome = acha(PISTAS.nome, [empresa]);
    let extra = -1;
    const palavras = norm(campoExtra).split(" ").filter((w) => w.length >= 4 && !["que", "para", "qual"].includes(w));
    if (palavras.length) extra = t.findIndex((c, i) => c && i !== nome && i !== empresa && palavras.some((w) => c.includes(w)));
    return { nome, empresa, extra };
  }

  // Lê as pessoas das linhas abaixo do título. Célula com vários nomes (Alt+Enter) vira várias pessoas.
  function lerPessoas(linhas, cab, col) {
    const out = [];
    let semNome = 0;
    const tituloNome = norm((linhas[cab] || [])[col.nome]);
    for (const l of linhas.slice(cab + 1)) {
      if (!l || !naoVazias(l)) continue;
      const empresa = col.empresa >= 0 ? linha(l[col.empresa]) : "";
      const extra = col.extra >= 0 ? linha(l[col.extra]) : "";
      const nomes = limpo(l[col.nome]).split("\n").map(nomeLimpo).filter((n) => n.length > 1 && norm(n) !== tituloNome);
      if (!nomes.length) { semNome++; continue; }
      for (const nome of nomes) out.push({ nome, empresa, extra });
    }
    return { pessoas: out, semNome };
  }

  /* ---------- Mesma pessoa ---------- */
  // Mesmo primeiro nome e todos os nomes do mais curto aparecem no mais longo
  // (ex.: "Zeina Russo" e "Zeina Maria Russo da Silva"). Sempre conferido pela organização.
  const tokens = (n) => norm(n).split(" ").filter((w) => w && !PEQUENAS.has(w));
  function parecidos(a, b) {
    const ta = tokens(a), tb = tokens(b);
    if (ta.length < 2 || tb.length < 2 || ta[0] !== tb[0]) return false;
    const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    return menor.every((w) => maior.includes(w));
  }

  /* Prepara o envio de uma lista.
     novos: [{nome, empresa, extra}] lidos da planilha;
     outros: pessoas das OUTRAS listas do evento [{id, grupo, nome, empresa, lista}];
     anteriores: pessoas que esta lista tinha antes [{grupo, nome}].
     Devolve as pessoas com "grupo" (sem aprovar pares) e os pares parecidos para conferir. */
  function prepararEnvio(novos, outros, anteriores) {
    const porSlugOutros = new Map();
    outros.forEach((p) => { const s = slug(p.nome); if (s && !porSlugOutros.has(s)) porSlugOutros.set(s, p); });
    const grupoAnterior = new Map();
    (anteriores || []).forEach((p) => grupoAnterior.set(slug(p.nome), p.grupo));
    // Repetidos dentro da própria planilha: fica o primeiro.
    const vistos = new Map(); let repetidos = 0;
    const pessoas = [];
    novos.forEach((p, i) => {
      const s = slug(p.nome) || "pessoa-" + (i + 1);
      if (vistos.has(s)) {
        repetidos++;
        const ja = vistos.get(s);
        if (!ja.empresa && p.empresa) ja.empresa = p.empresa;
        if (!ja.extra && p.extra) ja.extra = p.extra;
        return;
      }
      const igual = porSlugOutros.get(s);
      const pessoa = { nome: p.nome, empresa: p.empresa || "", extra: p.extra || "", s, grupo: igual ? igual.grupo : s, ligadaA: igual || null };
      vistos.set(s, pessoa); pessoas.push(pessoa);
    });
    // Pares parecidos: com as outras listas e dentro da própria lista (só quem tem o mesmo primeiro nome).
    const indice = new Map();
    const indexar = (p, origem) => { const t = tokens(p.nome)[0]; if (!t) return; if (!indice.has(t)) indice.set(t, []); indice.get(t).push({ p, origem }); };
    const outrosUnicos = [...porSlugOutros.values()];
    outrosUnicos.forEach((p) => indexar(p, "outra"));
    const pares = [];
    for (const novo of pessoas) {
      if (novo.ligadaA) continue;
      for (const { p: alvo, origem } of indice.get(tokens(novo.nome)[0]) || []) {
        if (origem === "outra" && slug(alvo.nome) === novo.s) continue;
        if (!parecidos(novo.nome, alvo.nome)) continue;
        const antes = grupoAnterior.get(novo.s);
        pares.push({
          novo, alvo, origem,
          // Vem marcado: mesma empresa, ou já tinham sido ligados no envio anterior.
          sugerido: (norm(novo.empresa) && norm(novo.empresa) === norm(alvo.empresa)) || (antes && antes === alvo.grupo),
        });
      }
      indexar(novo, "mesma");
    }
    return { pessoas, pares, repetidos };
  }

  // Aplica os pares aprovados e devolve o que vai para o banco.
  // Junta em cadeia: A~B (mesma planilha) e B~C (outra lista) => A, B e C viram uma pessoa só.
  function finalizarEnvio(pessoas, paresAprovados) {
    const pai = new Map();
    const meus = new Set(pessoas);
    const chave = (p) => (meus.has(p) ? "n:" + p.s : "o:" + p.grupo);
    const achar = (x) => { if (!pai.has(x)) pai.set(x, x); while (pai.get(x) !== x) { pai.set(x, pai.get(pai.get(x))); x = pai.get(x); } return x; };
    const unir = (a, b) => { const ra = achar(a), rb = achar(b); if (ra !== rb) pai.set(ra > rb ? ra : rb, ra > rb ? rb : ra); };
    pessoas.forEach((p) => unir(chave(p), p.ligadaA ? "o:" + p.ligadaA.grupo : chave(p)));
    paresAprovados.forEach((par) => unir(chave(par.novo), chave(par.alvo)));
    // Grupo final: o da outra lista, se houver (as presenças dela continuam valendo); senão, o menor nome.
    const final = new Map();
    const melhor = (k, atual) => {
      if (!atual) return true;
      const ko = k.startsWith("o:"), ao = atual.startsWith("o:");
      return ko !== ao ? ko : k < atual;
    };
    for (const k of [...pai.keys()]) {
      const r = achar(k);
      if (melhor(k, final.get(r))) final.set(r, k);
    }
    pessoas.forEach((p) => { p.grupo = final.get(achar(chave(p))).slice(2); });
    return pessoas.map((p) => ({ grupo: p.grupo, nome: p.nome, empresa: p.empresa, extra: p.extra, busca: norm(p.nome + " " + p.empresa) }));
  }

  const api = { norm, slug, limpo, nomeLimpo, titulo, acharCabecalho, sugerirColunas, lerPessoas, parecidos, prepararEnvio, finalizarEnvio };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Lista = api;
})(typeof self !== "undefined" ? self : this);
