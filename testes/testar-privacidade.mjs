// Teste das correções de privacidade de 19/10/2026 (painel de bloqueios e busca de certificado), no Edge automático.
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-privacidade.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import { RAIZ } from './banco-teste.mjs';
const DIR = RAIZ + '/testes/telas';
fs.mkdirSync(DIR, { recursive: true });
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (s) => { const r = await (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json(); if (r.message) throw new Error(r.message + ' :: ' + s); return r; };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const ORIGEM = 'http://localhost:3999';
const CPFS = { 'Maria Clara Souza': '52998224725', 'Maria Clara Lima': '11144477735', 'Pedro Longe Alves': '39053344705' };

// evento aberto com localização e certificado; uma pessoa barrada e duas Marias com CPF
const ev = (await sql(`select checkin.criar_evento(${j({ nome: 'Evento Privado', aberto: true, campos: [{ chave: 'empresa' }, { chave: 'cpf', obrigatorio: true }] })}) r`))[0].r;
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ geo_ativo: true, geo_lat: -3.1, geo_lng: -60.0, geo_raio: 300, certificado_ativo: true, certificado_horas: 4 })})`);
const E = (await sql(`select slug, codigo, qr_chave from checkin.eventos where id='${ev.id}'`))[0];
const passe = (await sql(`select checkin.convidado_abrir('${E.slug}', '${E.qr_chave}', null) r`))[0].r.passe;
const barrado = (await sql(`select checkin.convidado_checkin('${E.slug}', '${passe}', 'Pedro Longe Alves', 'Empresa P', ${j({ cpf: CPFS['Pedro Longe Alves'], consentiu: true })}, -3.4, -60.0, 15) r`))[0].r;
ok(barrado.erro === 'longe', 'preparação: uma pessoa barrada pela localização');
for (const nome of ['Maria Clara Souza', 'Maria Clara Lima']) {
  await sql(`select checkin.cadastrar_avulso('${E.slug}', '${E.codigo}', '${nome}', 'Empresa M', 'Tablet 1', ${j({ cpf: CPFS[nome], consentiu: true })})`);
}
const algumCpf = (t) => Object.values(CPFS).some((c) => t.includes(c) || t.includes(c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const erros = [];
async function pagina() {
  const ctx = await browser.createBrowserContext();
  const pg = await ctx.newPage();
  await pg.setViewport({ width: 1100, height: 900 });
  pg.on('pageerror', (e) => erros.push(e.message));
  pg.on('dialog', (d) => { erros.push('caixa do navegador inesperada: ' + d.message()); d.accept(); });
  pg.respostas = [];
  pg.on('response', async (r) => { if (r.url().includes('/rest/v1/rpc/')) { try { pg.respostas.push(await r.text()); } catch { /* sem corpo */ } } });
  return pg;
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' '));
const vis = (pg, sel) => pg.$eval(sel, (e) => !e.closest('[hidden]') && e.getClientRects().length > 0).catch(() => false);
const clicar = (pg, sel) => pg.$eval(sel, (e) => e.click());
const ate = async (cond, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await espera(250); } return false; };

// ---------- painel dos tablets ----------
const P = await pagina();
await P.goto(`${ORIGEM}/e/${E.slug}?c=${E.codigo}#painel`, { waitUntil: 'networkidle0' });
await P.waitForSelector('#devStage:not([hidden])', { timeout: 5000 });
await P.type('#devInput', 'Painel'); await clicar(P, '#devForm button[type="submit"]'); await espera(1500);
ok(await ate(async () => /Pedro Longe Alves/.test(await txt(P, '#listBloqueios'))), 'painel lista quem foi barrado pela localização (nome)');
const textoPainel = await P.evaluate(() => document.body.innerText);
ok(!algumCpf(textoPainel) && !/CPF:/.test(await txt(P, '#listBloqueios')), 'painel NÃO mostra CPF de quem foi barrado');
ok(!(await P.$('#listBloqueios a[href*="maps"]')), 'painel NÃO tem link de mapa da pessoa');
ok(P.respostas.length > 0 && !P.respostas.some(algumCpf) && !P.respostas.some((t) => /"lat"\s*:/.test(t)), `respostas do servidor ao painel sem CPF e sem localização (${P.respostas.length} conferidas)`);
await P.screenshot({ path: DIR + '/70-painel-bloqueios.png', fullPage: true });

// ---------- busca de certificado por nome ----------
const C = await pagina();
await C.goto(`${ORIGEM}/e/${E.slug}#certificado`, { waitUntil: 'networkidle0' }); await espera(800);
ok(await vis(C, '#v-certificado'), 'tela pública de certificado abre sem código');
await clicar(C, '#btnAlternarTipoBusca'); await espera(200);
await C.$eval('#campoBuscaCert', (e) => { e.value = ''; }); await C.type('#campoBuscaCert', 'maria clara');
await clicar(C, '#btnBuscarCert'); await espera(1000);
const opcoes = await C.$$eval('#certListaMultiplos button', (bs) => bs.map((b) => ({ nome: b.dataset.nome, pede: b.dataset.pedeCpf, id: b.dataset.id || '' })));
ok(opcoes.length === 2 && opcoes.every((o) => o.pede === '1' && !o.id), 'busca por pedaço do nome: 2 opções, sem id, marcadas para pedir CPF');
ok(!C.respostas.some(algumCpf), 'resposta da busca por nome sem nenhum CPF');
await C.screenshot({ path: DIR + '/71-certificado-opcoes.png', fullPage: true });
await clicar(C, '#certListaMultiplos button'); await espera(300);
const escolhida = opcoes[0].nome;
ok(await vis(C, '#certSeguranca') && (await txt(C, '#certSegurancaMsg')).includes('CPF completo') && !(await vis(C, '#certResultado')), 'ao escolher: pede o CPF completo antes de emitir');
await C.type('#campoConfirmaDigitos', '123'); await clicar(C, '#btnConfirmarSeguranca'); await espera(200);
ok(/CPF inválido/.test(await txt(C, '#certSegurancaErro')), 'CPF incompleto: recusado na tela');
await C.$eval('#campoConfirmaDigitos', (e) => { e.value = ''; });
await C.type('#campoConfirmaDigitos', CPFS[escolhida]);
ok((await C.$eval('#campoConfirmaDigitos', (e) => e.value)) === CPFS[escolhida].replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'), 'campo do CPF com máscara');
await clicar(C, '#btnConfirmarSeguranca'); await espera(1200);
ok(await vis(C, '#certResultado') && (await txt(C, '#certResNome')) === escolhida, 'com o CPF certo: certificado de ' + escolhida);
await C.screenshot({ path: DIR + '/72-certificado-emitido.png', fullPage: true });
// nome exato de quem tem CPF: também pede o CPF (no servidor)
const C2 = await pagina();
await C2.goto(`${ORIGEM}/e/${E.slug}#certificado`, { waitUntil: 'networkidle0' }); await espera(800);
await clicar(C2, '#btnAlternarTipoBusca'); await espera(200);
await C2.$eval('#campoBuscaCert', (e) => { e.value = ''; }); await C2.type('#campoBuscaCert', 'Maria Clara Lima');
await clicar(C2, '#btnBuscarCert'); await espera(1000);
ok(await vis(C2, '#certSeguranca') && !(await vis(C2, '#certResultado')), 'nome exato: pede o CPF, não emite direto');
ok(!C2.respostas.some((t) => /CERT-/.test(t)) && !C2.respostas.some(algumCpf), 'antes do CPF, o servidor não entrega código do certificado nem CPF');
await C2.$eval('#campoBuscaCert', (e) => { e.value = ''; }); await C2.type('#campoBuscaCert', 'ma');
await clicar(C2, '#btnBuscarCert'); await espera(800);
ok(await vis(C2, '#certErro') && !(await vis(C2, '#certMultiplos')), 'pedaço de nome curto ("ma"): não lista ninguém');

ok(erros.length === 0, 'nenhum erro na página' + (erros.length ? ': ' + erros.join(' | ') : ''));
await browser.close();
