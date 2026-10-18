// Teste da recepção (link do evento) com dois tablets e o totem, no Edge automático.
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-recepcao.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import { RAIZ } from './banco-teste.mjs';
const DIR = RAIZ + '/testes/telas';
fs.mkdirSync(DIR, { recursive: true });
const ARTE = 'C:/Users/hudso/OneDrive - SISTEMA FIEAM/PROJETOS IA/habilidades/checkin-eventos/modelo/site/arte.jpg';
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (s) => { const r = await (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json(); if (r.message) throw new Error(r.message + ' :: ' + s); return r; };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const p = (grupo, nome, empresa = '', extra = '') => ({ grupo, nome, empresa, extra, busca: norm(nome + ' ' + empresa) });

// ---------- evento de teste (pela "organização", direto no banco) ----------
const ev = (await sql(`select checkin.criar_evento(${j({ nome: 'Festa da Indústria 2027', subtitulo: '5ª edição', data: '2027-05-20', local: 'Teatro Amazonas', boas_vindas: 'Que bom ter você aqui!', tema: { fundo1: '#02887B', fundo2: '#014B43', destaque: '#0BC5B7', destaque2: '#CA9E52' } })}) r`))[0].r;
const ARTE_URL = 'data:image/jpeg;base64,' + fs.readFileSync(ARTE).toString('base64');
await sql(`select checkin.salvar_imagem('${ev.id}', 'arte', '${ARTE_URL}')`);
const L = Object.fromEntries((await sql(`select tipo, id from checkin.listas where evento_id='${ev.id}'`)).map((x) => [x.tipo, x.id]));
const AUT = (await sql(`select checkin.salvar_lista('${ev.id}', ${j({ nome: 'Autoridades', cor: '#38C6E3', campo_extra: 'Troféu' })}) r`))[0].r;
const VEN = (await sql(`select checkin.salvar_lista('${ev.id}', ${j({ nome: 'Vencedores', cor: '#E84A5F', selo: false })}) r`))[0].r;
await sql(`select checkin.salvar_pessoas('${L.confirmados}', ${j([p('joao-araujo', 'João Araújo', 'FIEAM'), p('ana-souza', 'ANA SOUZA', 'EMPRESA EXEMPLO LTDA'), p('bruno-lima', 'Bruno Lima', 'SESI')])}, 'conf.xlsx')`);
await sql(`select checkin.salvar_pessoas('${L.convidados}', ${j([p('carla-dias', 'Carla Dias', 'Empresa C')])}, 'conv.xlsx')`);
await sql(`select checkin.salvar_pessoas('${AUT}', ${j([p('ana-souza', 'Ana Souza', 'Governo', 'Ouro'), p('dario-neto', 'Dario Neto', 'Prefeitura', 'Prata')])}, 'aut.xlsx')`);
await sql(`select checkin.salvar_pessoas('${VEN}', ${j([p('bruno-lima', 'Bruno Lima', 'SESI')])}, 'ven.xlsx')`);
const codigoAtual = async () => (await sql(`select codigo from checkin.eventos where id='${ev.id}'`))[0].codigo;
let CODIGO = await codigoAtual();
const URL = `http://localhost:3999/e/${ev.slug}`;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const erros = [];
async function tablet(largura, altura) {
  const ctx = await browser.createBrowserContext();   // aparelho separado (memória própria)
  const pg = await ctx.newPage();
  await pg.setViewport({ width: largura, height: altura });
  pg.on('pageerror', (e) => erros.push(e.message));
  pg.on('dialog', (d) => { erros.push('caixa do navegador inesperada: ' + d.message()); d.accept(); });
  return pg;
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' '));
const vis = (pg, sel) => pg.$eval(sel, (e) => !e.closest('[hidden]') && e.getClientRects().length > 0).catch(() => false);
const clicar = (pg, sel) => pg.$eval(sel, (e) => e.click());
const buscar = async (pg, v) => { await pg.$eval('#q', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, v); await espera(150); };
const nomeAparelho = async (pg, nome) => { await pg.waitForSelector('#devStage:not([hidden])', { timeout: 5000 }); await pg.$eval('#devInput', (e) => { e.value = ''; }); await pg.type('#devInput', nome); await clicar(pg, '#devForm button[type="submit"]'); await espera(200); };
const ate = async (cond, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await espera(250); } return false; };

// ---------- Tablet A: código ----------
const A = await tablet(1024, 768);
await A.goto(URL, { waitUntil: 'networkidle0' }); await espera(600);
ok(await vis(A, '#telaCodigo') && (await txt(A, '#codigoNome')) === 'Festa da Indústria 2027', 'abre pedindo o código, com o nome do evento');
ok(await A.$eval('#codigoArte', (e) => !e.hidden && e.src.startsWith('data:image/jpeg')), 'tela do código mostra a arte');
ok((await A.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fundo1').trim())) === '#02887B', 'cores do evento aplicadas');
await A.screenshot({ path: DIR + '/20-codigo.png' });
await A.type('#campoCodigo', '12'); await clicar(A, '#btnCodigo'); await espera(200);
ok((await txt(A, '#codigoErro')) === 'O código tem 6 números.', 'código curto: avisa');
await A.$eval('#campoCodigo', (e) => { e.value = ''; });
await A.type('#campoCodigo', CODIGO === '000000' ? '111111' : '000000'); await clicar(A, '#btnCodigo'); await espera(800);
ok(/Código incorreto/.test(await txt(A, '#codigoErro')), 'código errado: "Código incorreto"');
await A.$eval('#campoCodigo', (e) => { e.value = ''; });
await A.type('#campoCodigo', CODIGO); await clicar(A, '#btnCodigo'); await espera(800);
ok(await vis(A, '#devStage'), 'código certo: pede o nome do aparelho');
await nomeAparelho(A, 'Tablet 1');
ok(await vis(A, '#v-recepcao') && (await txt(A, '#viewTitle')) === 'Recepção' && (await txt(A, '#deviceName')) === 'Tablet 1', 'recepção aberta, aparelho "Tablet 1"');
ok(await A.$eval('#arte', (e) => !e.hidden), 'arte no topo da recepção');
await A.screenshot({ path: DIR + '/21-recepcao-inicio.png' });

// ---------- busca, selos, campo extra, sigilo ----------
await buscar(A, 'joao arau');
ok((await A.$$('#results .res')).length === 1 && (await txt(A, '#results .n')) === 'João Araújo', 'busca sem acento acha "João Araújo"');
await buscar(A, 'ana');
const ana = await A.$eval('#results .res', (e) => ({ n: e.querySelector('.n').textContent, c: e.querySelector('.c').textContent, selo: e.querySelector('.selo')?.textContent, x: e.querySelector('.x')?.textContent, vip: e.classList.contains('vip') }));
ok(ana.n === 'Ana Souza', 'nome em caixa alta exibido no formato padrão: ' + ana.n);
ok(ana.c === 'Empresa Exemplo LTDA · Governo', 'empresas das duas listas (maiúsculas ajustadas): ' + ana.c);
ok(ana.selo === 'Autoridades' && ana.vip && ana.x === 'Troféu: Ouro', 'selo da lista VIP, faixa colorida e campo extra');
await A.screenshot({ path: DIR + '/22-recepcao-busca.png' });
await buscar(A, 'bruno');
ok(!(await A.$('#results .selo')), 'lista sigilosa (sem selo) não aparece no tablet');
await buscar(A, 'carla');
ok((await txt(A, '#results .tags')) === 'Sem confirmação', 'quem só está em "Sem confirmação" leva a etiqueta');
await buscar(A, 'zzzz');
ok(/Ninguém encontrado/.test(await txt(A, '#results')), 'nome inexistente: sugere "Cadastrar agora"');

// ---------- confirmar, sincronizar com o Tablet B ----------
await buscar(A, 'ana');
await clicar(A, '[data-go="ana-souza"]'); await espera(700);
ok(/Presença confirmada: Ana Souza/.test(await txt(A, '#toastMsg')), 'confirmar: aviso com Desfazer');
let ck = await sql(`select grupo, dispositivo from checkin.checkins where evento_id='${ev.id}'`);
ok(ck.length === 1 && ck[0].dispositivo === 'Tablet 1', 'presença gravada com o nome do tablet');
const B = await tablet(1024, 768);
await B.goto(`${URL}?c=${CODIGO}`, { waitUntil: 'networkidle0' });
await nomeAparelho(B, 'Tablet 2');
ok(!B.url().includes('?c=') && await vis(B, '#v-recepcao'), 'Tablet B entra pelo QR (código no link) e o código some do endereço');
ok((await txt(B, '#rIn')) === '1', 'Tablet B já mostra 1 presente');
await buscar(A, 'joao');
await clicar(A, '[data-go="joao-araujo"]'); await espera(400);
ok(await ate(async () => (await txt(B, '#rIn')) === '2'), 'confirmação no Tablet A aparece no B em segundos');
await clicar(A, '#toastBtn');
ok(await ate(async () => (await sql(`select count(*) n from checkin.checkins where grupo='joao-araujo'`))[0].n == 0), 'Desfazer remove a presença');
ok(await ate(async () => (await txt(B, '#rIn')) === '1'), '...e o Tablet B volta para 1');
await buscar(B, 'ana');
ok(/Chegou/.test(await txt(B, '#results .arrived')) && /Tablet 1/.test(await txt(B, '#results .arrived')), 'Tablet B vê "Chegou" e em qual tablet');

// cancelar entrada (dois toques)
await buscar(A, 'ana'); await espera(300);
await clicar(A, '[data-cancel="g:ana-souza"]'); await espera(150);
ok((await txt(A, '[data-cancel="g:ana-souza"]')) === 'Toque de novo para cancelar', 'cancelar entrada: primeiro toque arma');
await clicar(A, '[data-cancel="g:ana-souza"]'); await espera(800);
ok((await sql(`select count(*) n from checkin.checkins`))[0].n == 0 && /cancelada/.test(await txt(A, '#toastMsg')), 'segundo toque cancela');

// cadastrar agora, com aviso de nome parecido
await buscar(A, 'Dario Neto Silva');
await clicar(A, '[data-add]'); await espera(200);
ok((await A.$eval('#aNome', (e) => e.value)) === 'Dario Neto Silva', 'cadastrar agora já traz o que foi digitado');
await clicar(A, '#addSave'); await espera(300);
ok(await vis(A, '#aDup') && /Dario Neto/.test(await txt(A, '#aDup')), 'nome parecido com alguém da lista: avisa antes');
await A.screenshot({ path: DIR + '/23-cadastro-parecido.png' });
await clicar(A, '#addSave'); await espera(800);
ok((await sql(`select nome, dispositivo from checkin.avulsos`))[0]?.dispositivo === 'Tablet 1', '"Cadastrar mesmo assim" grava o cadastro na hora');
await buscar(A, '');
ok(/Dario Neto Silva/.test(await txt(A, '#recentList')), 'aparece nas últimas chegadas');
ok(await ate(async () => (await txt(B, '#rIn')) === '1'), 'Tablet B conta o cadastro na hora');

// ---------- organização troca o código ----------
await sql(`select checkin.novo_codigo('${ev.id}')`);
CODIGO = await codigoAtual();
ok(await ate(async () => await vis(A, '#telaCodigo')), 'código trocado: o tablet volta para a tela do código');
ok(/código do evento mudou/.test(await txt(A, '#codigoErro')), '...explicando que o código mudou');
await A.type('#campoCodigo', CODIGO); await clicar(A, '#btnCodigo'); await espera(800);
ok(await vis(A, '#v-recepcao') && !(await vis(A, '#devStage')), 'código novo: volta direto (o nome do aparelho fica guardado)');
await B.$eval('#campoCodigo', (e) => { e.value = ''; }).catch(() => {});
await B.waitForSelector('#telaCodigo:not([hidden])', { timeout: 6000 }).catch(() => {});
await B.type('#campoCodigo', CODIGO); await clicar(B, '#btnCodigo'); await espera(800);

// ---------- evento encerrado ----------
await sql(`select checkin.encerrar_evento('${ev.id}', true)`);
ok(await ate(async () => await vis(A, '#telaEncerrado')), 'check-in encerrado: tela "Check-in encerrado" no lugar da recepção');
ok(!(await vis(A, '#v-recepcao')) && /encerrado às/.test(await txt(A, '#encTexto')), '...com o horário do encerramento');
await A.screenshot({ path: DIR + '/24-encerrado.png' });
await sql(`select checkin.encerrar_evento('${ev.id}', false)`);
ok(await ate(async () => !(await vis(A, '#telaEncerrado')) && await vis(A, '#v-recepcao')), 'reaberto: tablet volta à recepção');

// ---------- sem internet ----------
await A.setOfflineMode(true);
ok(await ate(async () => await vis(A, '#offline') && (await txt(A, '#liveTxt')) !== 'Online'), 'sem internet: aviso e indicador');
await A.setOfflineMode(false);
ok(await ate(async () => !(await vis(A, '#offline')) && (await txt(A, '#liveTxt')) === 'Online'), 'internet volta: "Online" de novo');

// ---------- totem ----------
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ modo: 'totem' })})`);
ok(await ate(async () => (await A.$eval('#q', (e) => e.placeholder)) === 'Digite seu nome'), 'modo totem chega aos tablets abertos');
ok(!(await vis(A, '#nav')) && await vis(A, '#totemChamada') && !(await vis(A, '#deviceChip')) && !(await vis(A, '#recent')), 'totem: sem menu, sem chegadas na tela, com chamada');
await A.screenshot({ path: DIR + '/25-totem.png' });
await buscar(A, 'jo');
ok((await A.$$('#results .res')).length === 0, 'totem: só busca a partir de 3 letras');
await buscar(A, 'joao');
ok((await txt(A, '#results .go')) === 'Sou eu' && !(await A.$('#results .dev')), 'totem: botão "Sou eu", sem horário/tablet de ninguém');
await clicar(A, '[data-go="joao-araujo"]'); await espera(700);
ok(await vis(A, '#boasvindas') && (await txt(A, '#bvNome')) === 'Boas-vindas, João!' && (await txt(A, '#bvTexto')) === 'Que bom ter você aqui!', 'boas-vindas com o primeiro nome e a mensagem do evento');
await A.screenshot({ path: DIR + '/26-boas-vindas.png' });
await clicar(A, '#boasvindas'); await espera(200);
ok(!(await vis(A, '#boasvindas')) && (await A.$eval('#q', (e) => e.value)) === '', 'tocar fecha e limpa a busca para a próxima pessoa');
await buscar(A, 'ana souza'); await clicar(A, '[data-go="ana-souza"]'); await espera(700);
ok((await txt(A, '#bvSelos')) === 'Autoridades', 'boas-vindas mostra o selo VIP');
await clicar(A, '#boasvindas');
await clicar(A, '[data-add]'); await espera(200);
ok((await txt(A, '#addTitle')) === 'Não encontrei meu nome', 'totem: "Não encontrei meu nome"');
await A.type('#aNome', 'Maria Nova'); await A.type('[data-campo="empresa"]', 'Startup X'); await clicar(A, '#addSave'); await espera(800);
ok((await txt(A, '#bvNome')) === 'Boas-vindas, Maria!' && (await sql(`select count(*) n from checkin.avulsos where nome='Maria Nova'`))[0].n == 1, 'cadastro pelo próprio convidado + boas-vindas');
await clicar(A, '#boasvindas');

// ---------- formatos de tela ----------
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ modo: 'recepcao' })})`);
await ate(async () => (await A.$eval('#q', (e) => e.placeholder)) === 'Nome ou empresa');
await A.setViewport({ width: 768, height: 1024 }); await buscar(A, 'ana'); await espera(300);
await A.screenshot({ path: DIR + '/27-tablet-em-pe.png' });
await A.setViewport({ width: 390, height: 844 }); await espera(300);
const larg = await A.evaluate(() => document.documentElement.scrollWidth);
ok(larg <= 390, 'celular: sem rolagem lateral (' + larg + 'px)');
await A.screenshot({ path: DIR + '/28-celular.png' });

// ---------- link errado e bloqueio por tentativas ----------
const D = await tablet(1024, 768);
await D.goto('http://localhost:3999/e/nao-existe', { waitUntil: 'networkidle0' }); await espera(500);
ok((await txt(D, '#avisoTitulo')) === 'Evento não encontrado', 'link inexistente: "Evento não encontrado"');
await D.goto(URL, { waitUntil: 'networkidle0' }); await espera(400);
for (let i = 0; i < 30; i++) {
  await D.$eval('#campoCodigo', (e) => { e.value = ''; });
  await D.type('#campoCodigo', String(100000 + i) === CODIGO ? '999999' : String(100000 + i));
  await clicar(D, '#btnCodigo'); await espera(120);
}
await D.$eval('#campoCodigo', (e) => { e.value = ''; }); await D.type('#campoCodigo', CODIGO); await clicar(D, '#btnCodigo'); await espera(600);
ok(/Muitas tentativas/.test(await txt(D, '#codigoErro')), '30 códigos errados: bloqueia por 10 minutos');

ok(erros.length === 0, 'nenhum erro na página' + (erros.length ? ': ' + erros.join(' | ') : ''));
await browser.close();
