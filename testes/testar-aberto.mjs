// Teste do evento aberto (cadastro na entrada com CPF, contatos, campo livre e LGPD), no Edge automático.
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-aberto.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
import XLSX from 'xlsx-js-style';
import { RAIZ } from './banco-teste.mjs';
const DIR = RAIZ + '/testes/telas';
fs.mkdirSync(DIR, { recursive: true });
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (s) => { const r = await (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json(); if (r.message) throw new Error(r.message + ' :: ' + s); return r; };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const erros = [];
async function pagina(w, h, pasta) {
  const ctx = await browser.createBrowserContext();
  const pg = await ctx.newPage();
  await pg.setViewport({ width: w, height: h });
  pg.on('pageerror', (e) => erros.push(e.message));
  pg.on('dialog', (d) => { erros.push('caixa do navegador inesperada: ' + d.message()); d.accept(); });
  if (pasta) await (await pg.createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: pasta });
  return pg;
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' '));
const vis = (pg, sel) => pg.$eval(sel, (e) => !e.closest('[hidden]') && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none').catch(() => false);
const clicar = (pg, sel) => pg.$eval(sel, (e) => e.click());
const valor = (pg, sel) => pg.$eval(sel, (e) => e.value);
const limpar = (pg, sel) => pg.$eval(sel, (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
const ate = async (cond, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await espera(250); } return false; };
const baixado = async (pasta) => { let a = null; await ate(async () => { a = fs.readdirSync(pasta).find((f) => f.endsWith('.xlsx')); return !!a; }, 10000); return a && XLSX.readFile(path.join(pasta, a)); };

// ---------- organização configura o evento aberto ----------
const PASTA_ORG = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-aberto-org-'));
const adm = await pagina(1366, 900, PASTA_ORG);
await adm.goto('http://localhost:3999/', { waitUntil: 'networkidle0' });
await adm.waitForSelector('#formEntrar:not([hidden])');
await adm.type('#campoUsuario', 'hudson'); await adm.type('#campoSenha', 'Senha-Hudson-123'); await clicar(adm, '#btnEntrar'); await espera(1200);
await clicar(adm, '#btnNovo'); await espera(200);
await adm.type('#jNome', 'Feira Aberta 2027'); await clicar(adm, '#janelaOk'); await espera(1500);
const evId = adm.url().match(/evento\/([0-9a-f-]{36})/)[1];
ok((await adm.$eval('input[name="tipo"][value="lista"]', (e) => e.checked)) && (await adm.$eval('#camposFixos [data-chave="empresa"] [data-pedir]', (e) => e.checked)), 'evento novo: "com lista prévia" e cadastro pedindo só empresa');
ok((await adm.$eval('#dLgpd', (e) => e.placeholder)).includes('Feira Aberta 2027'), 'aviso de LGPD padrão já com o nome do evento');
await clicar(adm, 'input[name="tipo"][value="aberto"]');
for (const k of ['cpf', 'nascimento', 'email', 'telefone']) await clicar(adm, `#camposFixos [data-chave="${k}"] [data-pedir]`);
ok(!(await adm.$eval('#camposFixos [data-chave="email"] [data-obrig]', (e) => e.disabled)) && (await adm.$eval('#camposFixos [data-chave="empresa"] [data-obrig]', (e) => !e.disabled)), 'marcar "pedir" libera o "obrigatório"');
await clicar(adm, '#camposFixos [data-chave="cpf"] [data-obrig]');
await clicar(adm, '#btnCampoLivre'); await espera(100);
await adm.type('#camposLivres [data-rotulo]', 'Cargo');
await clicar(adm, '#camposLivres [data-obrig]');
await adm.screenshot({ path: DIR + '/50-dados-aberto.png', fullPage: true });
await clicar(adm, '#dSalvar'); await espera(1500);
const evb = (await sql(`select aberto, campos, slug, codigo from checkin.eventos where id='${evId}'`))[0];
ok(evb.aberto === true && evb.campos.map((c) => c.chave + (c.obrigatorio ? '*' : '')).join() === 'empresa,cpf*,nascimento,email,telefone,x1*' && evb.campos[5].rotulo === 'Cargo', 'gravado: evento aberto, CPF e Cargo obrigatórios: ' + JSON.stringify(evb.campos));
// uma lista VIP no evento aberto (continua funcionando)
const VIP = (await sql(`select checkin.salvar_lista('${evId}', ${j({ nome: 'Palestrantes', cor: '#7B6BEF', destaque: 'card' })}) r`))[0].r;
await sql(`select checkin.salvar_pessoas('${VIP}', ${j([{ grupo: 'paula-reis', nome: 'Paula Reis', empresa: 'Universidade', extra: '', busca: 'paula reis universidade' }])}, '')`);
const URL = `http://localhost:3999/e/${evb.slug}?c=${evb.codigo}`;

// ---------- tablet da recepção (equipe) ----------
const A = await pagina(1024, 768);
const respostas = [];
A.on('response', async (r) => { if (/\/rpc\/(sincronizar|evento_publico)/.test(r.url())) { try { respostas.push(await r.text()); } catch { /* sem corpo */ } } });
await A.goto(URL, { waitUntil: 'networkidle0' });
await A.waitForSelector('#devStage:not([hidden])', { timeout: 5000 });
await A.type('#devInput', 'Entrada 1'); await clicar(A, '#devForm button[type="submit"]'); await espera(500);
ok(await vis(A, '#addForm') && (await A.$eval('#addStage', (e) => e.parentElement.id)) === 'v-recepcao', 'evento aberto: formulário fixo na recepção (não é janela)');
ok(!(await vis(A, '[data-add]')) && (await A.$eval('#q', (e) => e.placeholder)) === 'Conferir quem já entrou (nome ou empresa)', 'sem botão "Cadastrar agora"; busca vira conferência');
ok((await txt(A, '#addTitle')) === 'Novo check-in' && (await txt(A, '#addSave')) === 'Fazer check-in', 'títulos do evento aberto');
const rotulos = await A.$$eval('#aCampos label', (ls) => ls.map((l) => l.querySelector('span').firstChild.textContent.trim() + (l.querySelector('.opc') ? '?' : '')));
ok(rotulos.join('|') === 'Empresa?|CPF|Data de nascimento?|E-mail?|Telefone?|Cargo', 'campos na ordem, opcionais marcados: ' + rotulos.join(', '));
ok(await vis(A, '#aLgpd') && /Feira Aberta 2027/.test(await txt(A, '#aLgpdTexto')), 'caixinha de LGPD com o texto padrão');
await A.screenshot({ path: DIR + '/51-recepcao-aberta.png' });

const campo = (k) => `#aCampos [data-campo="${k}"]`;
await clicar(A, '#addSave'); await espera(200);
ok((await txt(A, '#aErr')) === 'Informe o nome completo.', 'sem nome: avisa');
await A.type('#aNome', 'Maria'); await clicar(A, '#addSave'); await espera(200);
ok(/nome e sobrenome/.test(await txt(A, '#aErr')), 'só o primeiro nome: pede nome e sobrenome');
await A.type('#aNome', ' Nova Silva');
await A.type(campo('cpf'), '52998224726'); await clicar(A, '#addSave'); await espera(200);
ok((await valor(A, campo('cpf'))) === '529.982.247-26', 'máscara do CPF enquanto digita');
ok(/CPF inválido/.test(await txt(A, '#aErr')) && await A.$eval(campo('cpf'), (e) => e.classList.contains('invalido') && document.activeElement === e), 'CPF errado: avisa e marca o campo');
await limpar(A, campo('cpf')); await A.type(campo('cpf'), '52998224725');
await A.type(campo('nascimento'), '20051990'); await A.type(campo('telefone'), '92992001234'); await A.type(campo('email'), 'maria@exemplo.com');
ok((await valor(A, campo('nascimento'))) === '20/05/1990' && (await valor(A, campo('telefone'))) === '(92) 99200-1234', 'máscaras de data e telefone');
await clicar(A, '#addSave'); await espera(200);
ok((await txt(A, '#aErr')) === 'Preencha: Cargo.', 'campo livre obrigatório: "Preencha: Cargo."');
await A.type(campo('x1'), 'Diretora'); await A.type(campo('empresa'), 'STARTUP X');
await clicar(A, '#addSave'); await espera(200);
ok(/autorização/.test(await txt(A, '#aErr')), 'sem marcar a caixinha de LGPD: não deixa');
await clicar(A, '#aConsente'); await clicar(A, '#addSave'); await espera(900);
ok(/Check-in feito: Maria Nova Silva/.test(await txt(A, '#toastMsg')), 'check-in feito');
ok((await valor(A, '#aNome')) === '' && (await valor(A, campo('cpf'))) === '' && !(await A.$eval('#aConsente', (e) => e.checked)), 'formulário limpo para a próxima pessoa');
const av = (await sql(`select cpf, nascimento, email, telefone, extras, consentiu_em, dispositivo from checkin.avulsos where nome='Maria Nova Silva'`))[0];
ok(av && av.cpf === '52998224725' && av.email === 'maria@exemplo.com' && av.telefone === '92992001234' && av.extras.x1 === 'Diretora' && av.consentiu_em && av.dispositivo === 'Entrada 1', 'banco guardou tudo, com o aceite e o tablet');
ok((await txt(A, '#rIn')) === '1' && /Maria Nova Silva/.test(await txt(A, '#recentList')), 'conta 1 presente e aparece nas últimas chegadas');
// mesmo CPF de novo
await A.type('#aNome', 'Outra Pessoa'); await A.type(campo('cpf'), '529.982.247-25'); await A.type(campo('x1'), 'Analista'); await clicar(A, '#aConsente');
await clicar(A, '#addSave'); await espera(800);
ok(/Este CPF já fez check-in às \d\d:\d\d/.test(await txt(A, '#aErr')), 'mesmo CPF: "Este CPF já fez check-in às ..."');
await clicar(A, '#addCancel'); await espera(100);
ok((await valor(A, '#aNome')) === '' && (await txt(A, '#addCancel')) === 'Limpar', 'botão "Limpar"');
// conferência e lista VIP continuam
await A.$eval('#q', (e) => { e.value = 'paula'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await espera(200);
ok((await txt(A, '#results .n')) === 'Paula Reis' && await A.$('#results [data-go]'), 'lista VIP funciona no evento aberto (busca e confirma)');
await clicar(A, '#results [data-go]'); await espera(700);
await A.$eval('#q', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
ok(respostas.length > 0 && respostas.every((t) => !t.includes('52998224725') && !t.includes('maria@exemplo') && !t.includes('92992001234')), `tablet NUNCA recebe CPF, e-mail ou telefone (${respostas.length} respostas conferidas)`);

// ---------- totem ----------
await sql(`select checkin.salvar_evento('${evId}', ${j({ modo: 'totem' })})`);
ok(await ate(async () => (await txt(A, '#totemChamada')) === 'Faça seu check-in' && (await txt(A, '#addTitle')) === 'Seus dados'), 'totem do evento aberto: "Faça seu check-in"');
ok(!(await vis(A, '.find')) && !(await vis(A, '#recent')), 'totem: sem busca e sem lista de quem chegou');
await A.screenshot({ path: DIR + '/52-totem-aberto.png' });
await A.type('#aNome', 'João Pedro Lima'); await A.type(campo('cpf'), '11144477735'); await A.type(campo('x1'), 'Estudante'); await clicar(A, '#aConsente');
await clicar(A, '#addSave'); await espera(900);
ok(await vis(A, '#boasvindas') && (await txt(A, '#bvNome')) === 'Boas-vindas, João!', 'totem: boas-vindas depois do check-in');
await clicar(A, '#boasvindas');
ok((await valor(A, '#aNome')) === '', 'totem: formulário limpo para a próxima pessoa');

// ---------- painel do evento aberto ----------
const PASTA_PAINEL = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-aberto-painel-'));
const B = await pagina(1366, 900, PASTA_PAINEL);
await B.goto(URL + '#painel', { waitUntil: 'networkidle0' });
await B.waitForSelector('#devStage:not([hidden])', { timeout: 5000 }); await B.type('#devInput', 'Painel'); await clicar(B, '#devForm button[type="submit"]'); await espera(600);
ok((await txt(B, '#kConfTit')) === 'Presentes' && (await txt(B, '#kConf')) === '3' && (await txt(B, '#kAus')) === '3' && (await txt(B, '#kAusTit')) === 'Na última meia hora', 'painel: presentes e última meia hora (3)');
ok((await txt(B, '#kInvTit')) === 'Horário de pico' && /^\d\d:(00|30)$/.test(await txt(B, '#kInv')) && (await txt(B, '#kWalkTit')) === 'Empresas diferentes', 'painel: pico e empresas');
ok((await txt(B, '#tituloFaltam')) === 'Por empresa' && /Startup X/.test(await txt(B, '#listOut')) && !/Confirmaram/.test(await txt(B, '#v-painel')), 'painel: "Por empresa" no lugar de "faltam chegar", sem "Confirmaram"');
await B.screenshot({ path: DIR + '/53-painel-aberto.png', fullPage: true });
await clicar(B, '#exportBtn');
const wbP = await baixado(PASTA_PAINEL);
const cabP = wbP && XLSX.utils.sheet_to_json(wbP.Sheets.Presentes, { header: 1 })[3];
ok(wbP && !cabP.includes('CPF') && !cabP.includes('E-mail') && !wbP.SheetNames.includes('Ausentes'), 'relatório do painel: sem CPF/e-mail e sem aba "Ausentes"');

// ---------- relatório da organização ----------
await adm.goto(`http://localhost:3999/#/evento/${evId}/operacao`, { waitUntil: 'networkidle0' }); await espera(1200);
await clicar(adm, '#btnRelatorio');
const wbO = await baixado(PASTA_ORG);
if (wbO) {
  const linhas = XLSX.utils.sheet_to_json(wbO.Sheets.Presentes, { header: 1, defval: '' });
  const cab = linhas[3];
  ok(['CPF', 'Data de nascimento', 'E-mail', 'Telefone', 'Cargo', 'Aceite LGPD'].every((c) => cab.includes(c)), 'relatório da organização com as colunas do cadastro: ' + cab.slice(8).join(', '));
  const maria = linhas.find((l) => l[1] === 'Maria Nova Silva');
  const col = (n) => maria[cab.indexOf(n)];
  ok(col('CPF') === '529.982.247-25' && col('Data de nascimento') === '20/05/1990' && col('Telefone') === '(92) 99200-1234' && col('Cargo') === 'Diretora' && col('Empresa') === 'Startup X' && col('Aceite LGPD'), 'dados formatados (CPF, data, telefone, cargo, aceite)');
  const resumo = XLSX.utils.sheet_to_json(wbO.Sheets.Resumo, { header: 1 });
  ok(resumo.some((l) => l[0] === 'Check-ins na entrada' && l[1] === 2) && !resumo.some((l) => /Confirmaram/.test(l[0] || '')), 'resumo do evento aberto: check-ins na entrada, sem "Confirmaram"');
} else ok(false, 'relatório da organização baixado');

// celular
await A.setViewport({ width: 390, height: 844 }); await espera(400);
ok((await A.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'celular: formulário sem rolagem lateral');
await A.screenshot({ path: DIR + '/54-aberto-celular.png', fullPage: true });

ok(erros.length === 0, 'nenhum erro na página' + (erros.length ? ': ' + erros.join(' | ') : ''));
await browser.close();
