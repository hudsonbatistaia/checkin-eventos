/* Check-in de Eventos — funções usadas pela organização, pela prévia e pelos tablets. */
(function (root) {
  "use strict";

  /* ---------- Textos ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Sem acento, minúsculo, espaços simples (para busca e comparação).
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

  // Nomes de pessoas sempre no mesmo formato: "Iara Duranth da Silva dos Santos". Só muda a exibição.
  const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "e", "di", "du", "del"]);
  function nomePadrao(n) {
    return String(n || "").trim().replace(/\s+/g, " ").toLowerCase().split(" ").map((w, i) => {
      if (i > 0 && PARTICULAS.has(w)) return w;
      return w.split("-").map((x) => x.replace(/^(d')?(\p{L})/u, (m, ap, l) => (ap ? "D'" : "") + l.toUpperCase())).join("-");
    }).join(" ");
  }
  // Empresa toda em maiúsculas vira "Primeira Maiúscula"; siglas curtas ficam (IEL, SESI, LTDA).
  const MINUSC = new Set(["da", "de", "do", "das", "dos", "e", "em", "para"]);
  function bonita(s) {
    s = String(s || "");
    if (!s || s !== s.toUpperCase() || !/[A-ZÀ-Ú]{5}/.test(s) || !/\S\s+\S/.test(s.trim())) return s;
    return s.split(" ").map((w, i) => {
      const lw = w.toLowerCase();
      if (i > 0 && MINUSC.has(lw)) return lw;
      if (w.replace(/[^A-Za-zÀ-ú]/g, "").length <= 4) return w;
      return lw.split("-").map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join("-");
    }).join(" ");
  }

  /* ---------- Datas ---------- */
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  // "2027-05-20" -> "20 de maio de 2027" (sem passar por fuso horário).
  function dataExtenso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${+m[3]} de ${MESES[+m[2] - 1]} de ${m[1]}` : "";
  }
  function dataCurta(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  }
  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");

  /* ---------- Cores ---------- */
  function hexRgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
  function luminancia(c) {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contraste(a, b) {
    const la = luminancia(a), lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  const misturar = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const BRANCO = [255, 255, 255], PRETO = [0, 0, 0];
  // Escurece (ou clareia) até ter o contraste pedido contra "fundo".
  function ajustarContraste(cor, fundo, minimo) {
    const alvo = luminancia(fundo) > 0.4 ? PRETO : BRANCO;
    let c = cor;
    for (let i = 0; i < 20 && contraste(c, fundo) < minimo; i++) c = misturar(c, alvo, 0.12);
    return c;
  }
  const sobre = (c) => (contraste(c, BRANCO) >= contraste(c, [16, 24, 32]) ? "#FFFFFF" : "#101820");
  const rgba = (c, a) => `rgba(${c.map(Math.round).join(", ")}, ${a})`;

  // Tema padrão (usado quando o evento ainda não tem cores).
  const TEMA_PADRAO = { fundo1: "#1C5D99", fundo2: "#0B2545", destaque: "#46E6CB", destaque2: "#F6B04C" };

  // Converte as 4 cores do evento em todas as variáveis de CSS da recepção e do painel.
  function variaveisTema(tema) {
    const t = { ...TEMA_PADRAO, ...(tema || {}) };
    const f1 = hexRgb(t.fundo1), f2 = hexRgb(t.fundo2);
    const media = misturar(f1, f2, 0.5);
    const escuro = luminancia(media) < 0.35;
    const tinta = escuro ? BRANCO : [16, 24, 32];
    const d1 = ajustarContraste(hexRgb(t.destaque), media, 2.2);
    const d2 = ajustarContraste(hexRgb(t.destaque2), media, 2.2);
    // Cor dos botões "Confirmar" e títulos nos cartões brancos: tom do fundo com bom contraste no branco.
    const forte = ajustarContraste(escuro ? misturar(f1, f2, 0.3) : f2, BRANCO, 4.8);
    const cartaoTinta = ajustarContraste(misturar(f2, PRETO, 0.35), BRANCO, 9);
    return {
      "--fundo1": rgbHex(f1), "--fundo2": rgbHex(f2),
      "--tinta": rgbHex(tinta),
      "--tinta-suave": rgbHex(misturar(tinta, media, escuro ? 0.28 : 0.32)),
      "--linha": rgba(tinta, escuro ? 0.18 : 0.16),
      "--superficie": escuro ? rgba(misturar(f2, PRETO, 0.3), 0.38) : rgba(BRANCO, 0.55),
      "--superficie-2": escuro ? rgba(misturar(f2, PRETO, 0.3), 0.6) : rgba(BRANCO, 0.78),
      "--destaque": rgbHex(d1), "--sobre-destaque": sobre(d1), "--destaque-suave": rgba(d1, 0.16),
      "--destaque2": rgbHex(d2), "--sobre-destaque2": sobre(d2), "--destaque2-suave": rgba(d2, 0.22),
      "--forte": rgbHex(forte),
      "--cartao-tinta": rgbHex(cartaoTinta),
      "--cartao-suave": rgbHex(misturar(cartaoTinta, BRANCO, 0.42)),
      "--cartao-linha": rgbHex(misturar(f1, BRANCO, 0.82)),
      "--cartao-claro": rgbHex(misturar(f1, BRANCO, 0.93)),
      "--ok": escuro ? "#7FF0C0" : "#11724A",
      "--aviso": escuro ? "#FFB39C" : "#B3412A",
      "--esquema": escuro ? "dark" : "light",
    };
  }
  function aplicarTema(el, tema) {
    const v = variaveisTema(tema);
    for (const k in v) el.style.setProperty(k, v[k]);
    el.style.colorScheme = v["--esquema"];
    return v;
  }

  /* ---------- Cadastro na entrada (evento aberto e "cadastrar agora") ---------- */
  // Campos fixos, na ordem em que aparecem. Os de nome livre são x1..x5 (com "rotulo").
  const CAMPOS_FIXOS = ["empresa", "cpf", "nascimento", "email", "telefone"];
  const ROTULOS = { empresa: "Empresa", cpf: "CPF", nascimento: "Data de nascimento", email: "E-mail", telefone: "Telefone" };
  const rotuloCampo = (c) => c.rotulo || ROTULOS[c.chave] || c.chave;
  // Pede algo além de nome e empresa? Então precisa do aceite do aviso de LGPD.
  const precisaConsentimento = (campos) => (campos || []).some((c) => c.chave !== "empresa");
  const textoLgpdPadrao = (nomeEvento) =>
    `Autorizo o uso dos meus dados pela organização do evento ${nomeEvento || ""} para controle de presença e emissão de certificados. Os dados serão apagados após o evento.`.replace(/\s+/g, " ");
  const digitos = (s) => String(s || "").replace(/\D/g, "");
  function cpfValido(s) {
    const d = digitos(s);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += +d[i] * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === +d[9] && dv(10) === +d[10];
  }
  // Máscaras enquanto digita.
  function mascaraCpf(s) {
    const d = digitos(s).slice(0, 11);
    return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  function mascaraTelefone(s) {
    const d = digitos(s).slice(0, 11);
    if (d.length <= 2) return d.length ? "(" + d : "";
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  function mascaraData(s) {
    const d = digitos(s).slice(0, 8);
    return d.replace(/^(\d{2})(\d)/, "$1/$2").replace(/^(\d{2})\/(\d{2})(\d)/, "$1/$2/$3");
  }
  // "20/05/1990" -> "1990-05-20" (ou "" se não for uma data de verdade).
  function dataParaIso(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim());
    if (!m) return "";
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (d.getFullYear() !== +m[3] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[1]) return "";
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const emailValido = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());

  function quandoCurto(iso) {
    if (!iso) return "";
    const d = new Date(iso), hoje = new Date();
    const dia = d.toDateString() === hoje.toDateString() ? "hoje" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    return `${dia} às ${hhmm(iso)}`;
  }

  function gerarHtmlCertificado(c) {
    const nome = nomePadrao(c.nome || "Nome da Pessoa Participante");
    const eventoNome = esc(c.evento || "Nome do Evento");
    const dataTxt = dataExtenso(c.data) || "Data do evento";
    let texto = c.texto || "Certificamos que {nome} participou do evento {evento}, realizado em {data}, com carga horária de {horas} horas.";
    
    const nomeDestaque = `<span class="cert-destaque-nome">${esc(nome)}</span>`;
    const eventoDestaque = `<strong class="cert-destaque-evento">${eventoNome}</strong>`;
    const dataDestaque = `<strong class="cert-destaque-dado">${esc(dataTxt)}</strong>`;
    const horasDestaque = `<strong class="cert-destaque-dado">${esc(c.horas || 0)} horas</strong>`;

    texto = esc(texto)
      .replace(/{nome}/g, nomeDestaque)
      .replace(/{evento}/g, eventoDestaque)
      .replace(/{data}/g, dataDestaque)
      .replace(/{horas}\s*(horas?)?/gi, horasDestaque);

    const emissor = esc(c.emissor || "INSTITUTO EUVALDO LODI — IEL AMAZONAS");
    const cod = esc(c.codigo || "CERT-0000-0000");
    const assNome = esc(c.assinatura_nome || "Coordenação Geral");
    const assCargo = esc(c.assinatura_cargo || "IEL Amazonas");
    const assImg = c.assinatura_imagem ? `<img class="cert-ass-img" src="${c.assinatura_imagem}" alt="Assinatura">` : "";
    const logoUrl = c.logo || "/img/logo-iel.png";

    return `
      <div class="cert-pagina">
        <div class="cert-moldura">
          <div class="cert-borda-interna"></div>
          <div class="cert-canto c-topo-esq"></div>
          <div class="cert-canto c-topo-dir"></div>
          <div class="cert-canto c-baixo-esq"></div>
          <div class="cert-canto c-baixo-dir"></div>

          <div class="cert-conteudo">
            <header class="cert-topo">
              <div class="cert-marca">
                <img src="${logoUrl}" alt="Logo IEL" class="cert-logo-img">
              </div>
              <div class="cert-titulos">
                <span class="cert-emissor">${emissor}</span>
                <h1 class="cert-titulo">CERTIFICADO</h1>
                <span class="cert-subtitulo">DE PARTICIPAÇÃO</span>
              </div>
            </header>

            <main class="cert-meio">
              <div class="cert-texto-bloco">
                <p class="cert-texto">${texto}</p>
              </div>
            </main>

            <footer class="cert-rodape">
              <div class="cert-autenticidade">
                <div class="cert-qr" data-qr="${cod}"></div>
                <div class="cert-cod-bloco">
                  <span class="cert-rotulo-cod">Autenticidade Digital</span>
                  <span class="cert-cod">${cod}</span>
                  <span class="cert-dica-valida">Valide pela câmera ou link oficial</span>
                </div>
              </div>

              <div class="cert-assinatura">
                ${assImg}
                <div class="cert-traco"></div>
                <b class="cert-ass-nome">${assNome}</b>
                ${assCargo ? `<span class="cert-ass-cargo">${assCargo}</span>` : ""}
              </div>
            </footer>

            <div class="cert-faixa-rodape">
              <span>SISTEMA FIEAM · IEL AMAZONAS · PELO FUTURO DO TRABALHO</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  root.Comum = { esc, norm, slug, nomePadrao, bonita, dataExtenso, dataCurta, hhmm, quandoCurto, hexRgb, rgbHex, luminancia, contraste, misturar,
    ajustarContraste, sobre, TEMA_PADRAO, variaveisTema, aplicarTema,
    CAMPOS_FIXOS, ROTULOS, rotuloCampo, precisaConsentimento, textoLgpdPadrao, digitos, cpfValido, mascaraCpf, mascaraTelefone, mascaraData, dataParaIso, emailValido,
    gerarHtmlCertificado };
})(typeof self !== "undefined" ? self : this);

