// Teste do encerramento automático do check-in (horário marcado), no Edge automático.
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-encerramento.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import { RAIZ } from './banco-teste.mjs';
const DIR = RAIZ + '/testes/telas';
fs.mkdirSync(DIR, { recursive: true });
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (s) => { const r = await (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json(); if (r.message) throw new Error(r.message + ' :: ' + s); return r; };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const p2 = (n) => String(n).padStart(2, '0');
const campo = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;

// evento com uma pessoa
const hoje = campo(new Date()).slice(0, 10);
const ev = (await sql(`select checkin.criar_evento(${j({ nome: 'Evento com Horário', data: hoje })}) r`))[0].r;
const L = (await sql(`select id from checkin.listas where evento_id='${ev.id}' and tipo='confirmados'`))[0].id;
await sql(`select checkin.salvar_pessoas('${L}', ${j([{ grupo: 'ana-souza', nome: 'Ana Souza', empresa: 'FIEAM', extra: '', busca: 'ana souza fieam' }, { grupo: 'joao-lima', nome: 'João Lima', empresa: 'SESI', extra: '', busca: 'joao lima sesi' }])}, '')`);
const COD = (await sql(`select codigo from checkin.eventos where id='${ev.id}'`))[0].codigo;
const URL = `http://localhost:3999/e/${ev.slug}?c=${COD}`;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const erros = [];
async function pagina(w, h, atrasoMs) {
  const ctx = await browser.createBrowserContext();
  const pg = await ctx.newPage();
  await pg.setViewport({ width: w, height: h });
  pg.on('pageerror', (e) => erros.push(e.message));
  pg.on('dialog', (d) => { erros.push('caixa do navegador inesperada: ' + d.message()); d.accept(); });
  // Relógio do aparelho errado (ex.: 1 hora atrasado).
  if (atrasoMs) await pg.evaluateOnNewDocument((a) => { const real = Date.now; Date.now = () => real() - a; }, atrasoMs);
  return pg;
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' '));
const vis = (pg, sel) => pg.$eval(sel, (e) => !e.closest('[hidden]') && e.getClientRects().length > 0).catch(() => false);
const clicar = (pg, sel) => pg.$eval(sel, (e) => e.click());
const ate = async (cond, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await espera(250); } return false; };
const entrar = async (pg, nome) => { await pg.goto(URL, { waitUntil: 'networkidle0' }); await pg.waitForSelector('#devStage:not([hidden])', { timeout: 5000 }); await pg.type('#devInput', nome); await clicar(pg, '#devForm button[type="submit"]'); await espera(300); };

// ---------- organização marca o horário pela aba Dados ----------
const adm = await pagina(1366, 900);
await adm.goto('http://localhost:3999/', { waitUntil: 'networkidle0' });
await adm.waitForSelector('#formEntrar:not([hidden])');
await adm.type('#campoUsuario', 'hudson'); await adm.type('#campoSenha', 'Senha-Hudson-123'); await clicar(adm, '#btnEntrar'); await espera(1200);
await adm.goto(`http://localhost:3999/#/evento/${ev.id}/dados`, { waitUntil: 'networkidle0' }); await espera(1000);
ok(/Sem horário/.test(await txt(adm, '#dEncerraInfo')), 'campo de encerramento começa vazio ("Sem horário")');
await clicar(adm, '#dEncerraEvento'); await espera(200);
ok((await adm.$eval('#dEncerra', (e) => e.value)) === hoje + 'T22:00', '"usar a data do evento" sugere a data do evento às 22:00');
const em10 = new Date(Date.now() + 10 * 60000);
await adm.$eval('#dEncerra', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, campo(em10));
ok(/daqui a 1\d min|daqui a 9 min/.test(await txt(adm, '#dEncerraInfo')), 'mostra quanto falta: ' + await txt(adm, '#dEncerraInfo'));
await clicar(adm, '#dSalvar'); await espera(1500);
let banco = (await sql(`select encerra_em from checkin.eventos where id='${ev.id}'`))[0];
ok(banco.encerra_em && Math.abs(new Date(banco.encerra_em) - em10) < 61000, 'horário gravado no banco');
ok((await txt(adm, '#evStatus')) === `Aberto · encerra hoje às ${hhmm(em10)}`, 'cabeçalho: ' + await txt(adm, '#evStatus'));
await adm.screenshot({ path: DIR + '/40-dados-encerramento.png' });

// ---------- tablets: aviso 15 min antes ----------
const A = await pagina(1024, 768);
await entrar(A, 'Tablet 1');
const B = await pagina(1024, 768, 3600e3);   // relógio 1 hora atrasado
await entrar(B, 'Tablet 2');
ok(await ate(async () => await vis(A, '#avisoEncerra')), 'faltando menos de 15 min: aviso na recepção');
ok(new RegExp(`encerra às ${hhmm(em10)} \\(em (9|10) min\\)`).test(await txt(A, '#avisoEncerra')), 'aviso: ' + await txt(A, '#avisoEncerra'));
ok(await ate(async () => await vis(B, '#avisoEncerra')), 'tablet com relógio errado também avisa (usa a hora do servidor)');
await A.screenshot({ path: DIR + '/41-aviso-15min.png' });

// ---------- o horário chega ----------
const em5s = new Date(Date.now() + 5000);
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ encerra_em: em5s.toISOString() })})`);
ok(await ate(async () => await vis(A, '#telaEncerrado')), 'no horário: tela "Check-in encerrado"');
ok(new RegExp(`encerrado às ${hhmm(em5s)}`).test(await txt(A, '#encTexto')) && !(await vis(A, '#v-recepcao')) && !(await vis(A, '#avisoEncerra')), 'mostra o horário, sem recepção e sem o aviso');
ok(await ate(async () => await vis(B, '#telaEncerrado')), 'tablet com relógio 1 h atrasado também encerra (quem decide é o servidor)');
const r = await sql(`select checkin.fazer_checkin('${ev.slug}', '${COD}', 'ana-souza', 'x') r`);
ok(r[0].r.erro === 'encerrado', 'banco recusa confirmação depois do horário');
await A.screenshot({ path: DIR + '/42-checkin-encerrado.png' });
await clicar(A, '#btnVerPainel'); await espera(800);
ok(await vis(A, '#v-painel') && /Check-in encerrado às/.test(await txt(A, '#consultaAviso')), '"Ver painel": painel com o aviso de encerrado');
ok(!(await vis(A, '#listIn [data-undo]')) && (await txt(A, '#tituloFaltam')) === 'Confirmaram e não vieram', 'painel travado: sem Desfazer, "não vieram"');

// ---------- organização: adiar ----------
await adm.goto(`http://localhost:3999/#/evento/${ev.id}/operacao`, { waitUntil: 'networkidle0' }); await espera(1200);
ok((await txt(adm, '#evStatus')).startsWith('Check-in encerrado às') && (await txt(adm, '#btnEncerrar')) === 'Reabrir check-in' && await vis(adm, '#btnAdiar'), 'organização: "Check-in encerrado", botões Reabrir e Adiar');
await adm.screenshot({ path: DIR + '/43-operacao-encerrado.png' });
await clicar(adm, '#btnAdiar'); await espera(300);
await adm.$eval('#jEncerra', (e, v) => { e.value = v; }, campo(new Date(Date.now() - 120000)));
await clicar(adm, '#janelaOk'); await espera(300);
ok(/futuro/.test(await txt(adm, '#janelaErro')), 'adiar para horário que já passou: recusado');
await adm.$eval('#jEncerra', (e, v) => { e.value = v; }, campo(new Date(Date.now() + 30 * 60000)));
await clicar(adm, '#janelaOk'); await espera(1500);
ok((await txt(adm, '#evStatus')).startsWith('Aberto · encerra'), 'adiado: aberto de novo, com o novo horário');
await A.goto(URL.replace(/\?c=\d+/, '') + '#recepcao', { waitUntil: 'networkidle0' });
ok(await ate(async () => await vis(A, '#v-recepcao') && !(await vis(A, '#telaEncerrado'))), 'tablet volta à recepção');
ok(await ate(async () => !(await vis(B, '#telaEncerrado')) && await vis(B, '#v-recepcao')), 'o outro tablet volta sozinho');
const r2 = await sql(`select checkin.fazer_checkin('${ev.slug}', '${COD}', 'ana-souza', 'x') r`);
ok(r2[0].r.ok, 'banco volta a aceitar confirmações');

// ---------- encerrar na mão e reabrir (apaga o horário) ----------
await clicar(adm, '#btnEncerrar'); await espera(300); await clicar(adm, '#janelaOk'); await espera(1500);
ok(await ate(async () => await vis(B, '#telaEncerrado')), 'botão "Encerrar check-in": mesma tela nos tablets');
ok(!(await vis(adm, '#btnAdiar')), 'encerrado na mão: sem "Adiar" (só Reabrir)');
await clicar(adm, '#btnEncerrar'); await espera(300); await clicar(adm, '#janelaOk'); await espera(1500);
ok((await sql(`select encerra_em, encerrado_em from checkin.eventos where id='${ev.id}'`))[0].encerra_em === null && (await txt(adm, '#evStatus')) === 'Aberto', 'reabrir apaga o horário marcado');
ok(await ate(async () => await vis(B, '#v-recepcao')), 'tablets voltam à recepção');

// ---------- totem também ----------
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ modo: 'totem', encerra_em: new Date(Date.now() - 1000).toISOString() })})`);
ok(await ate(async () => await vis(B, '#telaEncerrado') && (await B.$eval('#q', (e) => e.placeholder)) === 'Digite seu nome'), 'totem: mesma tela de encerrado');
await B.screenshot({ path: DIR + '/44-totem-encerrado.png' });

// celular
await A.setViewport({ width: 390, height: 844 }); await espera(400);
ok((await A.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'celular: sem rolagem lateral');

ok(erros.length === 0, 'nenhum erro na página' + (erros.length ? ': ' + erros.join(' | ') : ''));
await browser.close();
