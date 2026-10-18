// Teste do painel ao vivo e do relatório Excel (tablet e organização), no Edge automático.
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-painel.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
import XLSX from 'xlsx-js-style';
import { RAIZ } from './banco-teste.mjs';
const DIR = RAIZ + '/testes/telas';
fs.mkdirSync(DIR, { recursive: true });
const BAIXADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-relatorio-'));
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (s) => { const r = await (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json(); if (r.message) throw new Error(r.message + ' :: ' + s); return r; };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const p = (grupo, nome, empresa = '', extra = '') => ({ grupo, nome, empresa, extra, busca: norm(nome + ' ' + empresa) });

// ---------- evento de teste ----------
const ev = (await sql(`select checkin.criar_evento(${j({ nome: 'Festa da Indústria 2027', data: '2027-05-20', local: 'Teatro Amazonas', tema: { fundo1: '#02887B', fundo2: '#014B43', destaque: '#0BC5B7', destaque2: '#CA9E52' } })}) r`))[0].r;
const L = Object.fromEntries((await sql(`select tipo, id from checkin.listas where evento_id='${ev.id}'`)).map((x) => [x.tipo, x.id]));
const lista = async (d) => (await sql(`select checkin.salvar_lista('${ev.id}', ${j(d)}) r`))[0].r;
const AUT = await lista({ nome: 'Autoridades', cor: '#38C6E3', destaque: 'bloco', campo_extra: 'Troféu' });
const VEN = await lista({ nome: 'Vencedores', cor: '#E84A5F', destaque: 'bloco', selo: false });
const IMP = await lista({ nome: 'Imprensa', cor: '#F6B04C', destaque: 'card' });
const salvar = (id, ps) => sql(`select checkin.salvar_pessoas('${id}', ${j(ps)}, 'x.xlsx')`);
await salvar(L.confirmados, [p('joao-araujo', 'João Araújo', 'FIEAM'), p('ana-souza', 'ANA SOUZA', 'EMPRESA EXEMPLO LTDA'), p('bruno-lima', 'Bruno Lima', 'SESI'), p('eva-reis', 'Eva Reis', 'FIEAM')]);
await salvar(L.convidados, [p('carla-dias', 'Carla Dias', 'Empresa C')]);
await salvar(AUT, [p('ana-souza', 'Ana Souza', 'Governo', 'Ouro'), p('dario-neto', 'Dario Neto', 'Prefeitura', 'Prata')]);
await salvar(VEN, [p('bruno-lima', 'Bruno Lima', 'SESI')]);
await salvar(IMP, [p('fabio-gomes', 'Fabio Gomes', 'Jornal A'), p('gil-nunes', 'Gil Nunes', 'TV B')]);
const COD = (await sql(`select codigo from checkin.eventos where id='${ev.id}'`))[0].codigo;
const chegar = (g, t = 'Tablet 1') => sql(`select checkin.fazer_checkin('${ev.slug}', '${COD}', '${g}', '${t}')`);
for (const g of ['ana-souza', 'joao-araujo', 'carla-dias', 'fabio-gomes']) { await chegar(g, g === 'fabio-gomes' ? 'Tablet 2' : 'Tablet 1'); await espera(30); }
await sql(`select checkin.cadastrar_avulso('${ev.slug}', '${COD}', 'Dario Neto Silva', 'Prefeitura', 'Tablet 2')`);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const erros = [];
const pg = await browser.newPage();
await pg.setViewport({ width: 1366, height: 900 });
pg.on('pageerror', (e) => erros.push(e.message));
pg.on('dialog', (d) => { erros.push('caixa do navegador inesperada: ' + d.message()); d.accept(); });
await (await pg.createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: BAIXADOS });
const txt = (sel) => pg.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' '));
const vis = (sel) => pg.$eval(sel, (e) => !e.closest('[hidden]') && e.getClientRects().length > 0).catch(() => false);
const clicar = (sel) => pg.$eval(sel, (e) => e.click());
const ate = async (cond, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await espera(250); } return false; };
const bloco = (nome) => pg.$$eval('#blocos .bloco', (els, nome) => { const b = els.find((e) => e.querySelector('h2').textContent === nome); return b ? { num: b.querySelector('.fin-num b').textContent + ' ' + b.querySelector('.fin-num span').textContent, corpo: b.querySelector('.fin-body').textContent.replace(/\s+/g, ' ') } : null; }, nome);

// ---------- painel ----------
await pg.goto(`http://localhost:3999/e/${ev.slug}?c=${COD}#painel`, { waitUntil: 'networkidle0' });
await pg.waitForSelector('#devStage:not([hidden])', { timeout: 5000 });
await pg.type('#devInput', 'Painel'); await clicar('#devForm button[type="submit"]'); await espera(500);
ok(await vis('#v-painel') && (await txt('#viewTitle')) === 'Painel de presença', 'link com #painel abre o painel');
ok((await txt('#kIn')) === '5', 'presentes no evento: 5 (4 das listas + 1 cadastro na hora)');
ok((await txt('#kPct')) === '50% de quem confirmou já chegou', 'porcentagem de quem confirmou: ' + await txt('#kPct'));
ok((await txt('#kConf')) === '2 de 4' && (await txt('#kAus')) === '2' && (await txt('#kInv')) === '1' && (await txt('#kWalk')) === '1', 'números: 2 de 4 confirmações, 2 faltam, 1 sem confirmar, 1 na hora');
const aut = await bloco('Autoridades');
ok(aut && aut.num === '2 de 2', 'bloco Autoridades: 2 de 2 (Dario chegou como "cadastro na hora" com nome parecido)');
ok(aut && /Troféu: Ouro/.test(aut.corpo) && /Troféu: Prata/.test(aut.corpo), 'bloco mostra o campo extra (troféu)');
const ven = await bloco('Vencedores');
ok(ven && ven.num === '0 de 1' && /Bruno Lima/.test(ven.corpo), 'lista sigilosa (sem selo no tablet) aparece no painel');
const card = await pg.$eval('#cards .cat', (e) => ({ h: e.querySelector('h3').textContent, n: e.querySelector('.num').textContent.replace(/\s+/g, ' ').trim() }));
ok(card.h === 'Imprensa' && card.n === '1 de 2', 'lista em card: Imprensa 1 de 2');
ok((await txt('#cIn')) === '5' && (await txt('#cOut')) === '2', 'chegaram 5, faltam 2 (Bruno e Eva)');
ok(/Autoridades/.test(await pg.$eval('#listIn', (e) => e.textContent)) && /Vencedores/.test(await pg.$eval('#listOut', (e) => e.textContent)), 'selos das listas VIP nas colunas do painel');
await pg.screenshot({ path: DIR + '/30-painel.png', fullPage: true });

// ao vivo
await chegar('eva-reis', 'Tablet 2');
ok(await ate(async () => (await txt('#cIn')) === '6' && (await txt('#kConf')) === '3 de 4'), 'nova chegada aparece no painel sozinha');
ok(await pg.$eval('#listIn .row', (e) => e.classList.contains('fresh') && e.textContent.includes('Eva Reis')), 'chegada nova no topo, destacada');
await pg.type('#pq', 'eva'); await espera(200);
ok((await txt('#cIn')) === '1' && (await txt('#cOut')) === '0', 'filtro por nome');
await pg.$eval('#pq', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
await clicar('#listIn [data-undo^="g:eva"]'); await espera(150);
ok((await txt('#listIn [data-undo^="g:eva"]')) === 'Confirmar desfazer', 'desfazer: primeiro toque arma');
await clicar('#listIn [data-undo^="g:eva"]'); await espera(800);
ok((await sql(`select count(*) n from checkin.checkins where grupo='eva-reis'`))[0].n == 0 && (await txt('#cIn')) === '5', 'segundo toque desfaz');

// ---------- relatório pelo painel ----------
await clicar('#exportBtn');
let arq = null;
await ate(async () => { arq = fs.readdirSync(BAIXADOS).find((f) => f.endsWith('.xlsx')); return !!arq; }, 10000);
ok(arq && /^Relatorio-presenca-festa-da-industria-2027-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}\.xlsx$/.test(arq), 'relatório baixado: ' + arq);
if (arq) {
  const wb = XLSX.readFile(path.join(BAIXADOS, arq), { cellStyles: true });
  ok(wb.SheetNames.join('|') === 'Resumo|Presentes|Ausentes|Autoridades|Vencedores|Imprensa|Por empresa', 'abas: ' + wb.SheetNames.join(', '));
  const linhas = (aba) => XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: '' });
  const resumo = linhas('Resumo');
  const val = (rot) => (resumo.find((l) => l[0] === rot) || [])[1];
  ok(val('Total de presentes') === 5 && val('Confirmaram e vieram') === 2 && val('Comparecimento de quem confirmou') === 0.5 && val('Cadastros na hora') === 1, 'resumo: 5 presentes, 2 confirmaram e vieram, 50%, 1 na hora');
  ok(val('Autoridades presentes') === 2 && val('Imprensa presentes') === 1 && val('Vencedores presentes') === 0, 'resumo por lista VIP');
  const pres = linhas('Presentes').slice(4).filter((l) => l[1]);
  ok(pres.length === 5 && pres[0][1] === 'Ana Souza' && pres[0][3] === 'Autoridades', 'aba Presentes em ordem de chegada, com as listas: ' + pres.map((l) => l[1]).join(', '));
  const hora = wb.Sheets.Presentes.G5;
  ok(hora && hora.t === 'n' && hora.z === 'hh:mm', 'hora de chegada como hora do Excel (não texto)');
  const autAba = linhas('Autoridades');
  ok(autAba[3].join('|') === 'Nº|Nome|Empresa|Troféu|Presente|Hora de chegada|Tablet', 'aba da lista VIP com o campo extra: ' + autAba[3].join(', '));
  ok(autAba.slice(4).some((l) => l[1] === 'Dario Neto' && l[4] === 'Sim' && l[6] === 'Tablet 2'), 'Dario aparece como presente (cadastro na hora ligado pelo nome)');
  const aus = linhas('Ausentes').slice(4).filter((l) => l[1]).map((l) => l[1]);
  ok(aus.join(',') === 'Bruno Lima,Eva Reis', 'aba Ausentes: quem confirmou e não veio');
  ok(linhas('Por empresa').slice(4).some((l) => l[0] === 'FIEAM' && l[1] === 2 && l[2] === 1), 'presença por empresa');
}

// ---------- evento encerrado ----------
await sql(`select checkin.encerrar_evento('${ev.id}', true)`);
ok(await ate(async () => (await txt('#tituloFaltam')) === 'Confirmaram e não vieram'), 'encerrado: "Confirmaram e não vieram"');
ok(!(await vis('#listIn [data-undo]')), 'encerrado: sem botão Desfazer');
await sql(`select checkin.encerrar_evento('${ev.id}', false)`);

// ---------- formatos ----------
await pg.setViewport({ width: 1024, height: 768 }); await espera(400);
await pg.screenshot({ path: DIR + '/31-painel-tablet.png' });
await pg.setViewport({ width: 390, height: 844 }); await espera(400);
const larg = await pg.evaluate(() => document.documentElement.scrollWidth);
ok(larg <= 390, 'celular: sem rolagem lateral (' + larg + 'px)');
await pg.screenshot({ path: DIR + '/32-painel-celular.png', fullPage: true });

// ---------- relatório pela organização ----------
const adm = await browser.newPage();
await adm.setViewport({ width: 1366, height: 900 });
adm.on('pageerror', (e) => erros.push('organização: ' + e.message));
const BAIX2 = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-relatorio-org-'));
await (await adm.createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: BAIX2 });
await adm.goto('http://localhost:3999/', { waitUntil: 'networkidle0' });
await adm.waitForSelector('#formEntrar:not([hidden])');
await adm.type('#campoUsuario', 'hudson'); await adm.type('#campoSenha', 'Senha-Hudson-123'); await adm.$eval('#btnEntrar', (e) => e.click()); await espera(1200);
await adm.goto(`http://localhost:3999/#/evento/${ev.id}/operacao`, { waitUntil: 'networkidle0' }); await espera(1200);
await adm.$eval('#btnRelatorio', (e) => e.click());
let arq2 = null;
await ate(async () => { arq2 = fs.readdirSync(BAIX2).find((f) => f.endsWith('.xlsx')); return !!arq2; }, 10000);
ok(!!arq2, 'organização também baixa o relatório (aba Operação)');
if (arq2) {
  const wb2 = XLSX.readFile(path.join(BAIX2, arq2));
  const r2 = XLSX.utils.sheet_to_json(wb2.Sheets.Resumo, { header: 1 });
  ok((r2.find((l) => l[0] === 'Total de presentes') || [])[1] === 5, '...com os mesmos números do painel');
}

ok(erros.length === 0, 'nenhum erro na página' + (erros.length ? ': ' + erros.join(' | ') : ''));
await browser.close();
