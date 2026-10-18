/* Imagens do evento: reduzir antes de salvar e sugerir cores a partir da arte. */
(function (root) {
  "use strict";
  const C = root.Comum;

  function carregarImagem(src) {
    return new Promise((ok, falha) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => falha(new Error("Não foi possível abrir esta imagem. Use JPG, PNG ou WEBP."));
      img.src = src;
    });
  }
  const lerArquivo = (arq) => new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => falha(new Error("Não foi possível ler o arquivo."));
    r.readAsDataURL(arq);
  });

  // Reduz para no máximo "lado" pixels e cabe no limite do banco (1,5 MB em texto).
  // Logo com fundo transparente continua PNG; o resto vira JPEG.
  async function reduzir(arq, lado, transparente) {
    if (!/^image\/(jpeg|png|webp)$/.test(arq.type)) throw new Error("Use uma imagem JPG, PNG ou WEBP.");
    if (arq.size > 25 * 1024 * 1024) throw new Error("Imagem grande demais (mais de 25 MB).");
    const img = await carregarImagem(await lerArquivo(arq));
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    let w = Math.max(1, Math.round(img.naturalWidth * escala)), h = Math.max(1, Math.round(img.naturalHeight * escala));
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      if (!transparente) { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      const url = transparente ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.86 - tentativa * 0.08);
      if (url.length <= 1400000) return { url, largura: w, altura: h };
      w = Math.round(w * 0.8); h = Math.round(h * 0.8);
    }
    throw new Error("Não foi possível reduzir a imagem o suficiente. Tente uma imagem menor.");
  }

  /* ---------- Cores da arte ---------- */
  function hsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  const distHue = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Paleta da imagem: cores mais presentes, já juntando tons muito parecidos.
  async function paleta(src) {
    const img = await carregarImagem(src);
    const N = 96, cv = document.createElement("canvas");
    const esc = Math.min(1, N / Math.max(img.naturalWidth, img.naturalHeight));
    cv.width = Math.max(1, Math.round(img.naturalWidth * esc)); cv.height = Math.max(1, Math.round(img.naturalHeight * esc));
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const caixas = new Map();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      const k = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
      const c = caixas.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      c.n++; c.r += px[i]; c.g += px[i + 1]; c.b += px[i + 2];
      caixas.set(k, c);
    }
    const total = [...caixas.values()].reduce((s, c) => s + c.n, 0) || 1;
    const cores = [...caixas.values()].sort((a, b) => b.n - a.n).map((c) => ({ rgb: [c.r / c.n, c.g / c.n, c.b / c.n], peso: c.n / total }));
    const juntas = [];
    for (const c of cores) {
      const igual = juntas.find((j) => dist(j.rgb, c.rgb) < 38);
      if (igual) igual.peso += c.peso; else juntas.push({ ...c });
      if (juntas.length >= 40) break;
    }
    return juntas.sort((a, b) => b.peso - a.peso).map((c) => ({ ...c, hex: C.rgbHex(c.rgb), hsl: hsl(c.rgb) }));
  }

  // Sugere as 4 cores do evento: fundo (cor dominante, puxada para escuro),
  // destaque (cor viva que se diferencia do fundo) e um segundo destaque.
  function sugerirTema(cores) {
    if (!cores.length) return { ...C.TEMA_PADRAO };
    const escurasOuMedias = cores.filter((c) => c.hsl[2] < 0.62 && c.peso > 0.01);
    const base = (escurasOuMedias.length ? escurasOuMedias : cores).slice().sort((a, b) =>
      (b.peso * (0.6 + b.hsl[1])) - (a.peso * (0.6 + a.hsl[1])))[0];
    let f1 = base.rgb;
    if (C.luminancia(f1) > 0.32) f1 = C.misturar(f1, [0, 0, 0], 0.35);           // fundo legível com texto branco
    const f2 = C.misturar(f1, [0, 0, 0], 0.45);
    const hBase = base.hsl[0];
    const vivacidade = (c) => c.hsl[1] * (1 - Math.abs(c.hsl[2] - 0.58) * 1.6) * Math.pow(c.peso + 0.002, 0.25);
    const vivas = cores.filter((c) => c.hsl[1] > 0.35 && c.hsl[2] > 0.3 && c.hsl[2] < 0.85)
      .sort((a, b) => vivacidade(b) - vivacidade(a));
    const fundoMedio = C.misturar(f1, f2, 0.5);
    // Destaque bom: aparece bem sobre o fundo (contraste) ou tem um tom claramente diferente dele.
    const bom = (c) => C.contraste(c.rgb, fundoMedio) >= 3 || (distHue(c.hsl[0], hBase) > 30 && C.contraste(c.rgb, fundoMedio) >= 2.2);
    const d1c = vivas.find(bom);
    const d1 = d1c ? d1c.rgb : C.hexRgb(C.TEMA_PADRAO.destaque);
    const h1 = d1c ? d1c.hsl[0] : 170;
    const d2c = vivas.find((c) => c !== d1c && bom(c) && distHue(c.hsl[0], h1) > 40 && distHue(c.hsl[0], hBase) > 30);
    // Sem uma segunda cor boa na arte: âmbar (ou verde-água, se o primeiro destaque já for quente).
    const quente = h1 < 70 || h1 > 330;
    const d2 = d2c ? d2c.rgb : C.hexRgb(quente ? C.TEMA_PADRAO.destaque : C.TEMA_PADRAO.destaque2);
    return { fundo1: C.rgbHex(f1), fundo2: C.rgbHex(f2), destaque: C.rgbHex(d1), destaque2: C.rgbHex(d2) };
  }

  root.Imagens = { reduzir, paleta, sugerirTema };
})(typeof self !== "undefined" ? self : this);
