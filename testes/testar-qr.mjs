// Teste do check-in pelo celular (QR dos convidados), no Edge automático.
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-qr.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
import XLSX from 'xlsx-js-style';
import { RAIZ } from './banco-teste.mjs';
const DIR = RAIZ + '/testes/telas';
fs.mkdirSync(DIR, { recursive: true });
const ARTE = 'C:/Users/hudso/OneDrive - SISTEMA FIEAM/PROJETOS IA/habilidades/checkin-eventos/modelo/site/arte.jpg';
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (s) => { const r = await (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json(); if (r.message) throw new Error(r.message + ' :: ' + s); return r; };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const ORIGEM = 'http://localhost:3999';

// ---------- evento aberto com arte; alguém da equipe já cadastrou uma pessoa ----------
const ev = (await sql(`select checkin.criar_evento(${j({ nome: 'Feira Tech 2027', data: '2027-05-20', local: 'Centro de Convenções', aberto: true,
  campos: [{ chave: 'empresa' }, { chave: 'x1', rotulo: 'Cargo' }], tema: { fundo1: '#02887B', fundo2: '#014B43', destaque: '#0BC5B7', destaque2: '#CA9E52' } })}) r`))[0].r;
await sql(`select checkin.salvar_imagem('${ev.id}', 'arte', 'data:image/jpeg;base64,${fs.readFileSync(ARTE).toString('base64')}')`);
const dados = async () => (await sql(`select slug, codigo, qr_chave from checkin.eventos where id='${ev.id}'`))[0];
let E = await dados();
await sql(`select checkin.cadastrar_avulso('${E.slug}', '${E.codigo}', 'Pessoa Secreta Souza', 'Empresa Sigilosa', 'Tablet 1', '{}'::jsonb)`);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const erros = [];
let ipN = 10;
async function celular({ local, negar } = {}) {
  const ctx = await browser.createBrowserContext();
  if (local) await ctx.overridePermissions(ORIGEM, ['geolocation']); else await ctx.overridePermissions(ORIGEM, []);
  const pg = await ctx.newPage();
  await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await pg.setExtraHTTPHeaders({ 'x-teste-ip': '10.7.0.' + ipN++ });   // cada celular numa rede
  if (local) await pg.setGeolocation(local);
  pg.on('pageerror', (e) => erros.push(e.message));
  pg.on('dialog', (d) => { erros.push('caixa do navegador inesperada: ' + d.message()); d.accept(); });
  pg.respostas = [];
  pg.on('response', async (r) => { if (r.url().includes('/rest/v1/rpc/')) { try { pg.respostas.push(await r.text()); } catch { /* sem corpo */ } } });
  return pg;
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' '));
const vis = (pg, sel) => pg.$eval(sel, (e) => !e.closest('[hidden]') && e.getClientRects().length > 0).catch(() => false);
const clicar = (pg, sel) => pg.$eval(sel, (e) => e.click());
const abrirQr = async (pg, k) => { await pg.goto(`${ORIGEM}/q/${E.slug}/${k}`, { waitUntil: 'networkidle0' }); await espera(400); };
async function preencher(pg, nome, cpf, consente = true) {
  await pg.$eval('#aNome', (e) => { e.value = ''; }); await pg.type('#aNome', nome);
  await pg.$eval('[data-campo="cpf"]', (e) => { e.value = ''; }); await pg.type('[data-campo="cpf"]', cpf);
  if (consente && !(await pg.$eval('#aConsente', (e) => e.checked))) await clicar(pg, '#aConsente');
  await clicar(pg, '#cEnviar'); await espera(900);
}

// ---------- celular: QR certo ----------
const P1 = await celular();
await abrirQr(P1, E.qr_chave);
ok(await vis(P1, '#cForm') && (await txt(P1, '#cNome')) === 'Feira Tech 2027', 'QR do convidado abre o formulário com o nome do evento');
ok(await P1.$eval('#cArte', (e) => !e.hidden), 'mostra a arte do evento');
const rot = await P1.$$eval('#aCampos label', (ls) => ls.map((l) => l.querySelector('span').firstChild.textContent.trim() + (l.querySelector('.opc') ? '?' : '')));
ok(rot.join('|') === 'Empresa?|CPF|Cargo?', 'CPF entra obrigatório no celular, mesmo fora dos campos do evento: ' + rot.join(', '));
ok(await vis(P1, '#aLgpd') && !(await vis(P1, '#cGeoAviso')), 'aviso de LGPD sempre; sem localização (desligada)');
await P1.screenshot({ path: DIR + '/60-celular-form.png', fullPage: true });
await preencher(P1, 'Carla Mendes', '52998224725', false);
ok(/autorização/.test(await txt(P1, '#aErr')), 'sem aceitar o aviso: não deixa');
await clicar(P1, '#aConsente'); await clicar(P1, '#cEnviar'); await espera(900);
ok(await vis(P1, '#cOk') && (await txt(P1, '#okNome')) === 'Carla Mendes' && /^Check-in às \d\d:\d\d de \d\d\/\d\d$/.test(await txt(P1, '#okHora')), 'comprovante com nome e horário');
const r1 = await txt(P1, '#okRelogio'); await espera(1200); const r2 = await txt(P1, '#okRelogio');
ok(r1 !== r2, 'relógio do comprovante corre (não é print)');
await P1.screenshot({ path: DIR + '/61-celular-comprovante.png' });
ok((await sql(`select dispositivo from checkin.avulsos where nome='Carla Mendes'`))[0].dispositivo === 'Celular (QR)', 'registrado como "Celular (QR)"');
ok(P1.respostas.length >= 3 && P1.respostas.every((t) => !t.includes('Secreta') && !t.includes('Sigilosa')), `celular não recebe nomes de ninguém (${P1.respostas.length} respostas conferidas)`);
await P1.reload({ waitUntil: 'networkidle0' }); await espera(500);
ok(await vis(P1, '#cOk') && (await txt(P1, '#okNome')) === 'Carla Mendes', 'abrir de novo no mesmo celular: volta o comprovante');

// ---------- recusas ----------
const P2 = await celular();
await abrirQr(P2, 'chave-errada');
ok(await vis(P2, '#cAviso') && (await txt(P2, '#cAvisoTit')) === 'QR code vencido', 'QR inválido: "QR code vencido"');
await abrirQr(P2, E.qr_chave);
await preencher(P2, 'Outra Pessoa', '529.982.247-25');
ok(/Este CPF já fez check-in às \d\d:\d\d/.test(await txt(P2, '#aErr')), 'CPF repetido: "Este CPF já fez check-in às ..."');
await preencher(P2, 'Joana', '11144477735');
ok(/sobrenome/.test(await txt(P2, '#aErr')), 'pede nome e sobrenome');
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ abre_em: new Date(Date.now() + 3600e3).toISOString() })})`);
const P3 = await celular();
await abrirQr(P3, E.qr_chave);
ok((await txt(P3, '#cAvisoTit')) === 'O check-in ainda não abriu' && /abre às \d\d:\d\d/.test(await txt(P3, '#cAvisoTxt')), 'antes da abertura: "O check-in ainda não abriu"');
await P3.screenshot({ path: DIR + '/62-celular-antes.png' });
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ abre_em: '' })})`);

// ---------- QR que muda a cada minuto (tela cheia) ----------
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ qr_rotativo: true })})`);
const ctxT = await browser.createBrowserContext();
const T = await ctxT.newPage();
await T.setViewport({ width: 1280, height: 800 });
T.on('pageerror', (e) => erros.push('tela: ' + e.message));
await T.goto(`${ORIGEM}/e/${E.slug}?c=${E.codigo}#qr`, { waitUntil: 'networkidle0' }); await espera(1200);
ok(await vis(T, '#v-qr') && !(await vis(T, '#topo')) && !(await vis(T, '#devStage')), 'tela cheia: só o QR (sem cabeçalho, sem pedir nome do aparelho)');
ok(await T.$('#qrImagem svg') && await vis(T, '#qrTempo') && (await txt(T, '#qrLink')) === 'O código muda a cada minuto.', 'tela cheia com QR, barra de tempo e aviso de que muda');
await T.screenshot({ path: DIR + '/63-tela-cheia-qr.png' });
const token = (await sql(`select checkin.qr_token(e, checkin.qr_minuto()) t from checkin.eventos e where id='${ev.id}'`))[0].t;
const P4 = await celular();
await abrirQr(P4, token);
ok(await vis(P4, '#cForm'), 'QR do minuto (da tela cheia) abre o formulário');
await abrirQr(P4, E.qr_chave);
ok((await txt(P4, '#cAvisoTit')) === 'QR code vencido' && /muda a cada minuto/.test(await txt(P4, '#cAvisoTxt')), 'QR fixo não vale com "muda a cada minuto"');
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ qr_rotativo: false })})`);
await T.goto(`${ORIGEM}/e/${E.slug}#qr`, { waitUntil: 'networkidle0' }); await espera(1200);
ok((await txt(T, '#qrLink')).startsWith(`localhost:3999/q/${E.slug}/`) && !(await vis(T, '#qrTempo')), 'QR fixo na tela cheia mostra o link e não tem barra de tempo');

// ---------- organização: localização, cartazes, trocar QR ----------
const ctxA = await browser.createBrowserContext();
const A = await ctxA.newPage();
await A.setViewport({ width: 1366, height: 900 });
A.on('pageerror', (e) => erros.push('organização: ' + e.message));
const BAIX = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-qr-'));
await (await A.createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: BAIX });
await A.goto(ORIGEM + '/', { waitUntil: 'networkidle0' });
await A.waitForSelector('#formEntrar:not([hidden])');
await A.type('#campoUsuario', 'hudson'); await A.type('#campoSenha', 'Senha-Hudson-123'); await clicar(A, '#btnEntrar'); await espera(1200);
await A.goto(`${ORIGEM}/#/evento/${ev.id}/acesso`, { waitUntil: 'networkidle0' }); await espera(1200);
ok(await vis(A, '#qcConteudo') && !(await vis(A, '#qcSo')) && await A.$('#qcQr svg'), 'aba Acesso: bloco "QR para os convidados" com o QR');
ok((await txt(A, '#qcQrNota')) === `localhost:3999/q/${E.slug}/${E.qr_chave}`, 'link do convidado: ' + await txt(A, '#qcQrNota'));
await clicar(A, '#qcGeo'); await espera(100);
ok(await vis(A, '#qcGeoCampos'), 'ligar localização mostra local e raio');
await clicar(A, '#qcSalvar'); await espera(500);
ok(/local do evento/.test(await txt(A, '#toast')), 'salvar sem o local: pede o local');
await A.type('#qcCoord', '-3.1190, -60.0217');
ok(await vis(A, '#qcMapa') && (await A.$eval('#qcMapa', (e) => e.href)).includes('-3.119,-60.0217'), 'link "ver no mapa"');
await A.select('#qcRaio', '300');
await clicar(A, '#qcSalvar'); await espera(1500);
let g = (await sql(`select geo_ativo, geo_lat, geo_lng, geo_raio from checkin.eventos where id='${ev.id}'`))[0];
ok(g.geo_ativo && g.geo_lat === -3.119 && g.geo_lng === -60.0217 && g.geo_raio === 300 && (await txt(A, '#qcEstado')) === 'Salvo ✓', 'localização salva (local e raio)');
await A.screenshot({ path: DIR + '/64-acesso-qr-convidados.png', fullPage: true });
// cartazes
await A.evaluate(() => { window.__imprimiu = 0; window.print = () => { window.__imprimiu++; }; });
await clicar(A, '#qcA4'); await espera(800);
ok((await A.evaluate(() => window.__imprimiu)) === 1 && (await A.$$('#impressao .cartaz.a4')).length === 1 && await A.$('#impressao .cartaz img.arte') && await A.$('#impressao .qr svg'), 'cartaz A4: arte, chamada e QR');
await A.emulateMediaType('print');
await A.pdf({ path: DIR + '/65-cartaz-a4.pdf', format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
await A.emulateMediaType('screen');
await clicar(A, '#qcA5'); await espera(800);
ok((await A.$$('#impressao .cartaz.a5')).length === 2, 'meia folha: dois cartazes por A4');
await A.emulateMediaType('print');
await A.pdf({ path: DIR + '/66-cartaz-a5.pdf', format: 'A4', printBackground: true, margin: { top: '8mm', bottom: '8mm', left: '10mm', right: '10mm' } });
await A.emulateMediaType('screen');
await clicar(A, '#qcRotativo'); await espera(100);
ok(await A.$eval('#qcA4', (e) => e.disabled) && await A.$eval('#qcA5', (e) => e.disabled) && /só na tela cheia/.test(await txt(A, '#qcQr')), 'com "muda a cada minuto": cartazes desativados');
await clicar(A, '#qcRotativo');

// ---------- celular com localização ----------
const P5 = await celular({ local: { latitude: -3.1195, longitude: -60.0217, accuracy: 20 } });
await abrirQr(P5, E.qr_chave);
ok(await vis(P5, '#cGeoAviso') && /localização/.test(await txt(P5, '#aLgpdTexto')), 'com localização: avisa e o texto de LGPD explica');
await preencher(P5, 'Diego Perto Lima', '39053344705');
ok(await vis(P5, '#cOk'), 'a ~55 m do local: check-in feito');
const P6 = await celular({ local: { latitude: -3.20, longitude: -60.02, accuracy: 20 } });
await abrirQr(P6, E.qr_chave);
await preencher(P6, 'Elisa Longe Costa', '71428793860');
ok((await txt(P6, '#cAvisoTit')) === 'Você precisa estar no local do evento' && /recepção/.test(await txt(P6, '#cAvisoTxt')), 'a 9 km: barrado e mandado para a recepção');
await P6.screenshot({ path: DIR + '/67-celular-longe.png' });
const P7 = await celular();   // sem permissão de localização
await abrirQr(P7, E.qr_chave);
await preencher(P7, 'Fabio Negou Reis', '87748248800');
ok((await txt(P7, '#cAvisoTit')) === 'Não foi possível confirmar que você está no local', 'localização negada: mandado para a recepção');
ok((await sql(`select count(*) n from checkin.avulsos where nome in ('Elisa Longe Costa','Fabio Negou Reis')`))[0].n == 0, 'nenhum dos dois entrou');

// ---------- trocar QR e encerrar ----------
await clicar(A, '#qcTrocar'); await espera(300); await clicar(A, '#janelaOk'); await espera(1500);
const novaChave = (await dados()).qr_chave;
ok(novaChave !== E.qr_chave && (await txt(A, '#qcQrNota')).endsWith(novaChave), 'trocar QR: chave nova na tela');
const P8 = await celular();
await abrirQr(P8, E.qr_chave);
ok((await txt(P8, '#cAvisoTit')) === 'QR code vencido', 'cartaz antigo deixa de valer');
E = await dados();
await sql(`select checkin.encerrar_evento('${ev.id}', true)`);
await abrirQr(P8, E.qr_chave);
ok((await txt(P8, '#cAvisoTit')) === 'Check-in encerrado', 'check-in encerrado: celular avisa');
await P1.reload({ waitUntil: 'networkidle0' }); await espera(500);
ok(await vis(P1, '#cOk'), 'quem já fez continua vendo o comprovante');

// ---------- relatório ----------
await A.goto(`${ORIGEM}/#/evento/${ev.id}/operacao`, { waitUntil: 'networkidle0' }); await espera(1200);
await clicar(A, '#btnRelatorio');
let arq = null;
for (let i = 0; i < 40 && !arq; i++) { await espera(250); arq = fs.readdirSync(BAIX).find((f) => f.endsWith('.xlsx')); }
const resumo = arq ? XLSX.utils.sheet_to_json(XLSX.readFile(path.join(BAIX, arq)).Sheets.Resumo, { header: 1 }) : [];
ok(resumo.some((l) => l[0] === 'Pelo celular (QR)' && l[1] === 2), 'relatório: "Pelo celular (QR)" = 2');

ok((await P1.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'celular: sem rolagem lateral');
ok(erros.length === 0, 'nenhum erro na página' + (erros.length ? ': ' + erros.join(' | ') : ''));
await browser.close();
