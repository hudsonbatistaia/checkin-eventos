// Impressão do certificado (19/10/2026): avulso = 1 página; lote da organização = 1 página por pessoa, A4 deitado.
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-certificado-impressao.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const sql = async (s) => { const r = await (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json(); if (r.message) throw new Error(r.message); return r; };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const paginas = (buf) => Number((Buffer.from(buf).toString('latin1').match(/\/Count (\d+)/) || [])[1]);
const ev = (await sql(`select checkin.criar_evento(${j({ nome: 'Conexão Carreira Indústria', aberto: true })}) r`))[0].r;
await sql(`select checkin.salvar_evento('${ev.id}', ${j({ certificado_ativo: true, certificado_horas: 4, data: '2026-10-20' })})`);
const E = (await sql(`select slug, codigo from checkin.eventos where id='${ev.id}'`))[0];
for (const n of ['Ana Souza', 'Bruno Lima', 'Carla Dias']) await sql(`select checkin.cadastrar_avulso('${E.slug}', '${E.codigo}', '${n}', '', 'Tablet 1', ${j({ consentiu: true })})`);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const erros = [];
// avulso, pela página do evento (busca por nome)
const p = await b.newPage(); p.on('pageerror', (e) => erros.push(e.message));
await p.setViewport({ width: 390, height: 844 });
await p.goto(`http://localhost:3999/e/${E.slug}#certificado`, { waitUntil: 'networkidle0' }); await espera(800);
await p.$eval('#btnAlternarTipoBusca', (e) => e.click()); await espera(200);
await p.$eval('#campoBuscaCert', (e) => { e.value = ''; }); await p.type('#campoBuscaCert', 'Ana Souza');
await p.$eval('#btnBuscarCert', (e) => e.click()); await espera(1200);
await p.$eval('#btnVerCertPublico', (e) => e.click()); await espera(800);
await p.emulateMediaType('print');
const pdf1 = await p.pdf({ preferCSSPageSize: true, printBackground: true });
ok(paginas(pdf1) === 1, `certificado avulso: ${paginas(pdf1)} página(s)`);
// lote, pela organização
const a = await b.newPage(); a.on('pageerror', (e) => erros.push(e.message));
await a.setViewport({ width: 1280, height: 900 });
await a.goto('http://localhost:3999/', { waitUntil: 'networkidle0' });
await a.waitForSelector('#formEntrar:not([hidden])');
await a.type('#campoUsuario', 'hudson'); await a.type('#campoSenha', 'Senha-Hudson-123'); await a.click('#btnEntrar'); await espera(1500);
await a.evaluate(() => { window.print = () => { window.__imprimiu = true; }; });
await a.goto(`http://localhost:3999/#/evento/${ev.id}/certificados`, { waitUntil: 'networkidle0' }); await espera(1500);
await a.evaluate(() => { window.print = () => { window.__imprimiu = true; }; });
ok(/: 3 pessoa/.test(await a.$eval('#certLoteInfo', (e) => e.textContent)) && !(await a.$eval('#btnBaixarTodosCert', (e) => e.disabled)), 'lote: conta 3 presentes e o botão fica ativo');
await a.$eval('#btnBaixarTodosCert', (e) => e.click()); for (let i = 0; i < 30 && !(await a.evaluate(() => window.__imprimiu)); i++) await espera(300);
ok(await a.evaluate(() => window.__imprimiu === true), 'lote chamou a impressão');
await a.emulateMediaType('print');
const pdf2 = await a.pdf({ preferCSSPageSize: true, printBackground: true });
const mb = (Buffer.from(pdf2).toString('latin1').match(/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/) || []).slice(1).map(Number); const deitada = mb[0] > mb[1];
ok(deitada, `lote em A4 deitado (${mb.join(' x ')})`);
ok(paginas(pdf2) === 3, `lote com 3 presentes: ${paginas(pdf2)} página(s)`);
// com a página aberta, chega mais uma pessoa: ao voltar para a aba, o total acompanha
await sql(`select checkin.cadastrar_avulso('${E.slug}', '${E.codigo}', 'Davi Nunes', '', 'Tablet 2', ${j({ consentiu: true })})`);
await a.emulateMediaType(null);
await a.evaluate((id) => { location.hash = "#/evento/" + id + "/dados"; }, ev.id); await espera(600);
await a.evaluate((id) => { location.hash = "#/evento/" + id + "/certificados"; }, ev.id); await espera(1200);
ok(/: 4 pessoa/.test(await a.$eval("#certLoteInfo", (e) => e.textContent)), "total atualiza sem recarregar a página (4 presentes)");
ok(erros.length === 0, 'sem erros ' + erros.join('|'));
await b.close();
