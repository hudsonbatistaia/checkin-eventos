// QR com a logo do IEL (19/10/2026): tela cheia, cartaz A4/A5 e cartão de acesso; confere 1 página e lê o QR (jsqr + pngjs).
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-qr-logo.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
const sql = async (s) => { const r = await (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json(); if (r.message) throw new Error(r.message); return r; };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const paginas = (buf) => Number((Buffer.from(buf).toString('latin1').match(/\/Count (\d+)/) || [])[1]);
const ler = (buf) => { const p = PNG.sync.read(Buffer.from(buf)); const r = jsQR(new Uint8ClampedArray(p.data), p.width, p.height); return r && r.data; };
const ev = (await sql(`select checkin.criar_evento(${j({ nome: 'Conexão Carreira Indústria', aberto: true })}) r`))[0].r;
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ data: '2026-10-20', local: 'Auditório da Escola SENAI Antônio Simões' })})`);
const E = (await sql(`select slug, codigo from checkin.eventos where id='${ev.id}'`))[0];
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const erros = [];
// tela cheia
const t = await b.newPage(); t.on('pageerror', (e) => erros.push(e.message));
await t.setViewport({ width: 1024, height: 768 });
await t.goto(`http://localhost:3999/e/${E.slug}?c=${E.codigo}#qr`, { waitUntil: 'networkidle0' }); await espera(1500);
ok(await t.$eval('.qr-logo-iel img', (i) => i.complete && i.naturalWidth > 0), 'tela cheia: logo do IEL no topo');
ok(await t.$eval('#qrImagem svg image', (i) => i.getAttribute('href') === '/img/logo-iel.png'), 'tela cheia: logo no centro do QR');
const lidoT = ler(await (await t.$('.qr-caixa')).screenshot());
ok(lidoT && lidoT.includes(`/q/${E.slug}/`), 'tela cheia: QR com logo é lido pela câmera → ' + lidoT);
// organização
const a = await b.newPage(); a.on('pageerror', (e) => erros.push(e.message));
await a.setViewport({ width: 1280, height: 900 });
await a.goto('http://localhost:3999/', { waitUntil: 'networkidle0' });
await a.waitForSelector('#formEntrar:not([hidden])');
await a.type('#campoUsuario', 'hudson'); await a.type('#campoSenha', 'Senha-Hudson-123'); await a.click('#btnEntrar'); await espera(1500);
await a.goto(`http://localhost:3999/#/evento/${ev.id}/acesso`, { waitUntil: 'networkidle0' }); await espera(1500);
await a.evaluate(() => { window.print = () => { window.__imprimiu = (window.__imprimiu || 0) + 1; }; });
for (const [botao, nome, qrSel, mm] of [['#qcA4', 'cartaz A4', '.cartaz .qr', 85], ['#qcA5', 'cartaz A5', '.cartaz .qr', 44], ['#btnImprimir', 'cartão de acesso dos tablets', '.qr-imp', 90]]) {
  await a.emulateMediaType(null);
  const antes = await a.evaluate(() => window.__imprimiu || 0);
  await a.$eval(botao, (e) => e.click());
  for (let i = 0; i < 20 && (await a.evaluate(() => window.__imprimiu || 0)) === antes; i++) await espera(200);
  ok((await a.evaluate(() => window.__imprimiu || 0)) > antes, `${nome}: chamou a impressão`);
  ok(await a.$eval('#impressao img.logo-iel', (i) => i.complete && i.naturalWidth > 0), `${nome}: logo do IEL no topo, carregada`);
  await a.emulateMediaType('print');
  const pdf = await a.pdf({ preferCSSPageSize: true, printBackground: true, format: 'A4' });
  ok(paginas(pdf) === 1, `${nome}: ${paginas(pdf)} página`);
  const el = await a.$('#impressao ' + qrSel);
  const lido = ler(await el.screenshot());
  ok(lido && lido.startsWith('http'), `${nome}: QR com logo é lido → ${lido}`);
}
ok(erros.length === 0, 'sem erros ' + erros.join('|'));
await b.close();
