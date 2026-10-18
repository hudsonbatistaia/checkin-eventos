// Teste das abas Convidados e Listas VIP no Edge automático.
// Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-listas.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
import XLSX from 'xlsx-js-style';
import { RAIZ } from './banco-teste.mjs';
const DIR = RAIZ + '/testes/telas';
fs.mkdirSync(DIR, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-planilhas-'));
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (s) => (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json();
function planilha(nome, abas) {
  const wb = XLSX.utils.book_new();
  for (const [aba, linhas] of Object.entries(abas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba);
  const f = path.join(TMP, nome); XLSX.writeFile(wb, f); return f;
}
const CONF = planilha('confirmados.xlsx', { Plan1: [
  ['LISTA DE CONFIRMADOS - PRÊMIO 2027'], [],
  ['Nº', 'EMPRESAS', 'NOMES DOS PARTICIPANTES E CARGOS'],
  ['1', 'FIEAM', 'ANA SOUZA - Diretora\nBRUNO LIMA - Gerente'],
  ['2', 'Empresa B', 'Sra. Carla Dias'],
  ['3', 'Empresa C', ''],
  ['4', 'Empresa D', 'Ana Souza'],
] });
const AUT = planilha('autoridades.xlsx', { Capa: [['Autoridades do Prêmio']], Lista: [
  ['Autoridade', 'Órgão', 'Troféu'],
  ['Ana Souza', 'Governo', 'Ouro'],
  ['Bruno Lima Santos', 'FIEAM', 'Prata'],
  ['Zeina Russo', 'Prefeitura', 'Bronze'],
] });

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900 });
const erros = [];
page.on('pageerror', (e) => erros.push(e.message));
page.on('dialog', (d) => { erros.push('caixa do navegador inesperada: ' + d.message()); d.accept(); });
const cdp = await page.createCDPSession();
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: TMP });
const texto = (sel) => page.$eval(sel, (e) => e.textContent.trim().replace(/\s+/g, ' '));
const visivel = (sel) => page.$eval(sel, (e) => !e.closest('[hidden]') && e.getClientRects().length > 0).catch(() => false);
const clicar = (sel) => page.$eval(sel, (e) => e.click());
const preencher = async (sel, v) => { await page.$eval(sel, (e) => { e.value = ''; }); await page.type(sel, v); };
const escolher = async (sel, v) => { await page.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, v); await espera(300); };
const cartao = async (nome) => page.$$eval('.lista', (els, nome) => { const c = els.find((e) => e.querySelector('h2').textContent === nome); return c ? '[data-lista="' + c.dataset.lista + '"]' : null; }, nome);

// entrar e criar evento
await page.goto('http://localhost:3999/', { waitUntil: 'networkidle0' });
await page.waitForSelector('#formEntrar:not([hidden])');
await page.type('#campoUsuario', 'hudson'); await page.type('#campoSenha', 'Senha-Hudson-123'); await page.click('#btnEntrar'); await espera(1200);
await clicar('#btnNovo'); await espera(200);
await page.type('#jNome', 'Evento das Listas'); await clicar('#janelaOk'); await espera(1500);
const evId = page.url().match(/evento\/([0-9a-f-]{36})/)[1];

// ---------- Convidados ----------
await clicar('[data-aba="convidados"]'); await espera(500);
const nomesFixas = await page.$$eval('#listasFixas .lista h2', (h) => h.map((x) => x.textContent));
ok(nomesFixas.join('|') === 'Presença confirmada|Sem confirmação', 'aba Convidados com as duas listas fixas: ' + nomesFixas.join(', '));
let C1 = await cartao('Presença confirmada');
await (await page.$(C1 + ' [data-enviar]')).uploadFile(CONF); await espera(1500);
ok(await visivel(C1 + ' [data-envio]'), 'enviar planilha abre a conferência');
ok((await page.$eval(C1 + ' [data-sel="cab"]', (e) => e.value)) === '2', 'acha os títulos na 3ª linha');
ok((await page.$eval(C1 + ' [data-sel="nome"]', (e) => e.value)) === '2' && (await page.$eval(C1 + ' [data-sel="empresa"]', (e) => e.value)) === '1', 'sugere as colunas de nome e empresa');
ok((await texto(C1 + ' .envio-total')).startsWith('3 pessoas encontradas'), 'resumo: ' + await texto(C1 + ' .envio-total'));
const avisos = await texto(C1 + ' .envio-avisos');
ok(/1 linha sem nome/.test(avisos) && /1 nome repetido/.test(avisos), 'avisa linha sem nome e repetido: ' + avisos);
// trocar a linha dos títulos para uma errada e voltar
await escolher(C1 + ' [data-sel="cab"]', '0');
ok(await visivel(C1 + ' .alerta'), 'linha de títulos errada: alerta e botão travado');
await escolher(C1 + ' [data-sel="cab"]', '2');
await page.screenshot({ path: DIR + '/10-envio-planilha.png', fullPage: true });
await clicar(C1 + ' [data-salvar-envio]'); await espera(1500);
let n = await sql(`select count(*) n from checkin.pessoas p join checkin.listas l on l.id=p.lista_id where l.evento_id='${evId}' and l.tipo='confirmados'`);
ok(n[0].n == 3, 'salvou 3 pessoas na lista');
ok(/3 pessoas · planilha "confirmados.xlsx"/.test(await texto(C1 + ' [data-info]')), 'cartão mostra total e planilha: ' + await texto(C1 + ' [data-info]'));
// renomear
await clicar(C1 + ' [data-renomear]'); await espera(200);
await preencher('#jNome', 'Confirmaram'); await clicar('#janelaOk'); await espera(1200);
ok(await cartao('Confirmaram'), 'renomear lista fixa');

// ---------- Listas VIP ----------
await clicar('[data-aba="vip"]'); await espera(400);
ok(await visivel('#vipVazio'), 'sem listas VIP: mensagem');
await clicar('#btnNovaVip'); await espera(200);
await page.type('#jNome', 'Autoridades'); await clicar('#janelaOk'); await espera(1500);
let V = await cartao('Autoridades');
ok(V && await page.$eval(V + ' details', (d) => d.open), 'lista VIP criada com a configuração aberta');
await preencher(V + ' input[name="extra"]', 'Troféu que entrega');
await clicar(V + ' input[value="bloco"]');
await clicar(V + ' [data-cor-pronta="#38C6E3"]'); await espera(200);
ok((await texto(V + ' [data-estado]')) === 'Alterações não salvas', 'mudar configuração marca "não salvas"');
await clicar(V + ' [data-config] button[type="submit"]'); await espera(1500);
V = await cartao('Autoridades');
let cfg = (await sql(`select cor, destaque, campo_extra, selo from checkin.listas where evento_id='${evId}' and tipo='vip'`))[0];
ok(cfg.cor === '#38C6E3' && cfg.destaque === 'bloco' && cfg.campo_extra === 'Troféu que entrega' && cfg.selo === true, 'configuração salva: ' + JSON.stringify(cfg));
// planilha com 2 abas e coluna de nome com título diferente ("Autoridade")
await (await page.$(V + ' [data-enviar]')).uploadFile(AUT); await espera(1500);
ok(await page.$(V + ' [data-sel="aba"]'), 'planilha com várias abas: deixa escolher a aba');
await escolher(V + ' [data-sel="aba"]', 'Lista');
ok((await page.$eval(V + ' [data-sel="nome"]', (e) => e.value)) === '-1' && await visivel(V + ' .alerta'), 'título "Autoridade": pede para escolher a coluna do nome');
await escolher(V + ' [data-sel="nome"]', '0');
ok((await page.$eval(V + ' [data-sel="empresa"]', (e) => e.value)) === '1' && (await page.$eval(V + ' [data-sel="extra"]', (e) => e.value)) === '2', 'empresa ("Órgão") e campo extra ("Troféu") sugeridos');
ok(/1 já está em outra lista/.test(await texto(V + ' .envio-avisos')), 'Ana Souza (mesmo nome) ligada automaticamente');
const pares = await page.$$eval(V + ' .pares li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
ok(pares.length === 1 && /Bruno Lima Santos.*Bruno Lima/.test(pares[0]), 'par parecido para conferir: ' + pares[0]);
ok(await page.$eval(V + ' [data-par="0"]', (e) => e.checked), '...vem marcado (mesma empresa)');
await page.screenshot({ path: DIR + '/11-envio-vip.png', fullPage: true });
await clicar(V + ' [data-salvar-envio]'); await espera(1500);
const grupos = await sql(`select p.nome, p.grupo, p.extra from checkin.pessoas p join checkin.listas l on l.id=p.lista_id where l.evento_id='${evId}' and l.tipo='vip' order by p.nome`);
ok(grupos.length === 3 && grupos[0].grupo === 'ana-souza' && grupos[1].grupo === 'bruno-lima' && grupos[2].grupo === 'zeina-russo', 'grupos ligados certo: ' + grupos.map((g) => g.nome + '=' + g.grupo).join(', '));
ok(grupos[0].extra === 'Ouro', 'campo extra gravado (troféu)');

// ver nomes, incluir parecido, editar, remover
V = await cartao('Autoridades');
await clicar(V + ' [data-ver]'); await espera(400);
const tambem = await page.$$eval(V + ' .tabela tbody tr', (trs) => trs.map((t) => t.children[0].textContent + ':' + t.children[3].textContent));
ok(tambem.includes('Ana Souza:Confirmaram') && tambem.includes('Bruno Lima Santos:Confirmaram') && tambem.includes('Zeina Russo:'), 'coluna "Também em": ' + tambem.join(' | '));
await clicar(V + ' [data-incluir]'); await espera(200);
await page.type('#jNome', 'carla dias moreira'); await page.type('#jEmpresa', 'Empresa B'); await page.type('#jExtra', 'Ouro');
await clicar('#janelaOk'); await espera(500);
ok((await texto('#janelaTitulo')) === 'É a mesma pessoa?' && /Carla Dias/.test(await texto('#janelaCorpo')), 'incluir nome parecido: pergunta se é a mesma pessoa');
await clicar('#janelaOk'); await espera(1500);
let carla = await sql(`select p.nome, p.grupo from checkin.pessoas p join checkin.listas l on l.id=p.lista_id where l.tipo='vip' and p.nome like 'Carla%'`);
ok(carla.length === 1 && carla[0].nome === 'Carla Dias Moreira' && carla[0].grupo === 'carla-dias', 'incluída e ligada à Carla Dias dos confirmados');
V = await cartao('Autoridades');
await page.type(V + ' [data-filtro]', 'zeina'); await espera(300);
ok((await page.$$(V + ' .tabela tbody tr')).length === 1, 'busca na lista filtra os nomes');
await clicar(V + ' [data-editar]'); await espera(200);
await preencher('#jEmpresa', 'Prefeitura de Manaus'); await clicar('#janelaOk'); await espera(1500);
ok((await sql(`select empresa, grupo from checkin.pessoas where nome='Zeina Russo'`))[0].empresa === 'Prefeitura de Manaus', 'editar pessoa (grupo mantido)');
V = await cartao('Autoridades');
await clicar(V + ' [data-remover]'); await espera(200); await clicar('#janelaOk'); await espera(1500);
ok((await sql(`select count(*) n from checkin.pessoas where nome='Zeina Russo'`))[0].n == 0, 'remover pessoa');
await page.screenshot({ path: DIR + '/12-nomes-vip.png', fullPage: true });

// modelo Excel
V = await cartao('Autoridades');
await clicar(V + ' [data-modelo]'); await espera(2500);
const modelo = path.join(TMP, 'modelo-autoridades.xlsx');
ok(fs.existsSync(modelo), 'baixar modelo Excel');
if (fs.existsSync(modelo)) {
  const wb = XLSX.readFile(modelo);
  ok(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0]) === '["Nome","Empresa","Troféu que entrega"]' && wb.SheetNames[1] === 'Como preencher', 'modelo com as colunas da lista e instruções');
}

// tablets recebem a lista VIP (sincronizar com o código)
const ev = (await sql(`select slug, codigo from checkin.eventos where id='${evId}'`))[0];
const sinc = await page.evaluate(async (ev) => (await fetch('http://localhost:3998/rest/v1/rpc/sincronizar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Profile': 'checkin', apikey: 'x' }, body: JSON.stringify({ p_slug: ev.slug, p_codigo: ev.codigo }) })).json(), ev);
ok(sinc.ok && sinc.pessoas.length === 6 && sinc.listas.some((l) => l.nome === 'Autoridades' && l.cor === '#38C6E3'), 'tablet recebe pessoas e a lista VIP com a cor');

// apagar todos os nomes e apagar a lista
await clicar('[data-aba="convidados"]'); await espera(400);
C1 = await cartao('Confirmaram');
await clicar(C1 + ' [data-limpar]'); await espera(200); await clicar('#janelaOk'); await espera(1500);
ok((await sql(`select count(*) n from checkin.pessoas p join checkin.listas l on l.id=p.lista_id where l.evento_id='${evId}' and l.tipo='confirmados'`))[0].n == 0, 'apagar todos os nomes da lista');
await clicar('[data-aba="vip"]'); await espera(400);
V = await cartao('Autoridades');
await clicar(V + ' [data-excluir-lista]'); await espera(200);
await page.type('#jPalavra', 'apagar'); await clicar('#janelaOk'); await espera(1500);
ok((await sql(`select count(*) n from checkin.listas where evento_id='${evId}' and tipo='vip'`))[0].n == 0 && await visivel('#vipVazio'), 'apagar lista VIP');

// celular
await page.setViewport({ width: 390, height: 844 });
await clicar('#btnNovaVip'); await espera(200); await page.type('#jNome', 'Finalistas'); await clicar('#janelaOk'); await espera(1500);
const larg = await page.evaluate(() => document.documentElement.scrollWidth);
ok(larg <= 390, 'celular: sem rolagem lateral (' + larg + 'px)');
await page.screenshot({ path: DIR + '/13-vip-celular.png', fullPage: true });

ok(erros.length === 0, 'nenhum erro na página' + (erros.length ? ': ' + erros.join(' | ') : ''));
await browser.close();
