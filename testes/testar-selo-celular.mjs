// Selo do IEL no topo da página do celular (19/10/2026): aviso e formulário.
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-selo-celular.mjs
import puppeteer from 'puppeteer-core';
const sql = async (s) => { const r = await (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json(); if (r.message) throw new Error(r.message); return r; };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const ev = (await sql(`select checkin.criar_evento(${j({ nome: 'Conexão Carreira Indústria', aberto: true })}) r`))[0].r;
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ data: '2026-10-20', local: 'Auditório da Escola SENAI Antônio Simões - Av. Rodrigo Otávio, 2394' })})`);
const E = (await sql(`select slug, qr_chave from checkin.eventos where id='${ev.id}'`))[0];
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const erros = [];
for (const [nome, url, sel] of [['aviso', `/q/${E.slug}/errado`, '#cAviso'], ['formulario', `/q/${E.slug}/${E.qr_chave}`, '#cForm']]) {
  const p = await b.newPage(); p.on('pageerror', (e) => erros.push(e.message));
  await p.setViewport({ width: 370, height: 640 });
  await p.goto('http://localhost:3999' + url, { waitUntil: 'networkidle0' }); await espera(1000);
  ok(await p.$eval(sel, (e) => !e.hidden), `${nome}: tela certa aberta`);
  ok(await p.$eval('.selo-iel img', (i) => i.complete && i.naturalWidth > 0 && i.getClientRects().length > 0), `${nome}: selo do IEL visível`);
}
ok(erros.length === 0, 'sem erros ' + erros.join('|'));
await b.close();
