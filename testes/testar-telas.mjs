// Teste das telas no Edge automático. Antes: node servidor-teste.mjs (banco limpo). Rodar: node testar-telas.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import { RAIZ } from './banco-teste.mjs';
const DIR = RAIZ + '/testes/telas';
fs.mkdirSync(DIR, { recursive: true });
const ARTE = 'C:/Users/hudso/OneDrive - SISTEMA FIEAM/PROJETOS IA/habilidades/checkin-eventos/modelo/site/arte.jpg';
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (s) => (await fetch('http://localhost:3998/teste/sql', { method: 'POST', body: JSON.stringify({ sql: s }) })).json();

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900 });
const erros = [];
page.on('pageerror', (e) => erros.push(e.message));
page.on('dialog', (d) => { erros.push('caixa do navegador inesperada: ' + d.message()); d.accept(); });
const texto = (sel) => page.$eval(sel, (e) => e.textContent.trim());
const visivel = (sel) => page.$eval(sel, (e) => !e.closest('[hidden]') && e.getClientRects().length > 0).catch(() => false);
const preencher = async (sel, v) => { await page.$eval(sel, (e) => { e.value = ''; }); await page.type(sel, v); };
const entrar = async (u, s) => {
  await page.goto('http://localhost:3999/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#formEntrar:not([hidden])', { timeout: 10000 });
  await page.type('#campoUsuario', u); await page.type('#campoSenha', s); await page.click('#btnEntrar'); await espera(1200);
};

// ---------- entrada ----------
await page.goto('http://localhost:3999/', { waitUntil: 'networkidle0' }); await espera(500);
ok(await visivel('#formEntrar'), 'abre na tela de entrada (login próprio, sem portal)');
ok(await page.evaluate(() => document.body.classList.contains('bloqueado')), 'sistema coberto até entrar');
await page.screenshot({ path: DIR + '/01-entrada.png' });
await entrar('hudson', 'errada');
ok((await texto('#msgAcesso')) === 'Usuário ou senha incorretos.', 'senha errada: mensagem em português');
await entrar('contratos', 'Senha-Contratos-123');
ok((await texto('#msgAcesso')) === 'Este usuário não tem acesso a este sistema.', 'usuário de outro sistema: barrado');
await entrar('hudson', 'Senha-Hudson-123');
ok(!(await visivel('#telaAcesso')) && (await texto('#usuarioNome')) === 'Hudson', 'hudson entra');
ok(await visivel('#eventosVazio'), 'sem eventos: mensagem de lista vazia');

// ---------- novo evento ----------
await page.click('#btnNovo'); await espera(200);
await page.click('#janelaOk'); await espera(300);
ok(await visivel('#janelaErro'), 'novo evento sem nome: pede o nome');
await page.type('#jNome', 'Prêmio Inovação 2027');
await page.$eval('#jData', (e) => { e.value = '2027-05-20'; });
await page.click('#janelaOk'); await espera(1500);
ok(/#\/evento\/[0-9a-f-]{36}\/dados$/.test(page.url()), 'evento criado e aberto na aba Dados');
ok((await texto('#evNome')) === 'Prêmio Inovação 2027' && (await texto('#evInfo')).startsWith('20 de maio de 2027'), 'cabeçalho com nome e data por extenso');
const evId = page.url().match(/evento\/([0-9a-f-]{36})/)[1];

// ---------- dados ----------
await page.type('#dSubtitulo', '3ª edição · Manaus');
await page.type('#dLocal', 'Teatro Amazonas');
await page.type('#dHorario', '19h');
await page.click('input[name="modo"][value="totem"]');
ok((await texto('#dEstado')) === 'Alterações não salvas', 'aviso de alterações não salvas');
// sair sem salvar pede confirmação
await page.click('.voltar'); await espera(400);
ok(await visivel('#janela') && (await texto('#janelaTitulo')) === 'Sair sem salvar?', 'sair com alterações: pede confirmação');
await page.click('#janelaCancelar'); await espera(400);
ok(page.url().includes(evId) && (await visivel('#formDados')), '...cancelar mantém na tela, com o que foi digitado');
await page.click('#dSalvar'); await espera(1000);
ok((await texto('#dEstado')) === 'Salvo ✓', 'salvar dados');
let ev = (await sql(`select subtitulo, local, horario, modo from checkin.eventos where id='${evId}'`))[0];
ok(ev.subtitulo === '3ª edição · Manaus' && ev.local === 'Teatro Amazonas' && ev.modo === 'totem', 'dados gravados no banco');
await page.screenshot({ path: DIR + '/02-dados.png' });

// ---------- identidade ----------
await page.$eval('[data-aba="identidade"]', (e) => e.click()); await espera(800);
ok(await visivel('#previa'), 'aba identidade com prévia do tablet');
await (await page.$('.imagem-campo[data-tipo="arte"] input[type=file]')).uploadFile(ARTE); await espera(2500);
ok(await visivel('.imagem-campo[data-tipo="arte"] img'), 'arte escolhida aparece');
ok((await page.$$('#paletaCores button')).length >= 4, 'paleta com as cores da arte: ' + (await page.$$('#paletaCores button')).length);
const tema = await page.$$eval('[data-cor]', (els) => Object.fromEntries(els.map((e) => [e.dataset.cor, e.value])));
const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? (g - b) / d % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
ok(hue(tema.fundo1) > 150 && hue(tema.fundo1) < 200, 'fundo sugerido no tom verde-água da arte: ' + tema.fundo1);
ok(tema.destaque !== tema.fundo1 && tema.destaque2 !== tema.destaque, 'destaques sugeridos diferentes do fundo: ' + JSON.stringify(tema));
const fr = page.frames().find((f) => f.url().includes('previa.html'));
ok(fr && await fr.$eval('#arte', (e) => !e.hidden && e.src.startsWith('data:image/jpeg')), 'prévia mostra a arte');
ok(fr && (await fr.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fundo1').trim())) === tema.fundo1.toUpperCase(), 'prévia usa as cores sugeridas');
await page.click('[data-previa="busca"]'); await espera(400);
ok(fr && (await fr.$$('.res')).length === 3 && (await fr.$eval('.go', (e) => e.textContent)) === 'Sou eu', 'prévia "buscando": resultados com botão do totem ("Sou eu")');
await page.screenshot({ path: DIR + '/03-identidade.png', fullPage: true });
// trocar uma cor pela paleta
await page.click('#paletaCores button:nth-child(2)'); await espera(200);
ok(await visivel('#menuCor'), 'tocar numa cor abre o menu "usar como"');
const corPaleta = await page.$eval('#paletaCores button:nth-child(2)', (e) => e.dataset.hex);
await page.click('#menuCor [data-usar="destaque2"]'); await espera(200);
ok((await page.$eval('[data-cor="destaque2"]', (e) => e.value.toUpperCase())) === corPaleta, 'cor da paleta aplicada ao segundo destaque');
await page.click('#iSalvar'); await espera(1500);
ok((await texto('#iEstado')) === 'Salvo ✓', 'salvar identidade');
const img = (await sql(`select tipo, length(conteudo) n from checkin.imagens where evento_id='${evId}'`));
ok(img.length === 1 && img[0].tipo === 'arte' && img[0].n < 1500000, 'arte gravada reduzida (' + (img[0] && img[0].n) + ' caracteres)');
ev = (await sql(`select tema from checkin.eventos where id='${evId}'`))[0];
ok(ev.tema.destaque2 === corPaleta, 'cores gravadas no banco');

// ---------- acesso ----------
await page.$eval('[data-aba="acesso"]', (e) => e.click()); await espera(400);
const codigo = await texto('#aCodigo');
const slug = (await sql(`select slug, codigo from checkin.eventos where id='${evId}'`))[0];
ok(codigo === slug.codigo && /^\d{6}$/.test(codigo), 'código de acesso mostrado: ' + codigo);
ok((await texto('#aLink')) === `http://localhost:3999/e/${slug.slug}`, 'link do evento');
ok(await page.$('#aQr svg'), 'QR code da equipe');
ok((await page.$eval('#evAbrirPainel', (e) => e.href)).endsWith(`/e/${slug.slug}?c=${codigo}#painel`), 'botão "Abrir painel" já leva o código');
await page.screenshot({ path: DIR + '/04-acesso.png' });
await page.click('#btnNovoCodigo'); await espera(300);
await page.click('#janelaOk'); await espera(1000);
const codigo2 = await texto('#aCodigo');
ok(codigo2 !== codigo && /^\d{6}$/.test(codigo2) && (await sql(`select codigo from checkin.eventos where id='${evId}'`))[0].codigo === codigo2, 'trocar código');

// ---------- link do evento ----------
const pg2 = await browser.newPage();
await pg2.setViewport({ width: 1024, height: 768 });
pg2.on('pageerror', (e) => erros.push('evento: ' + e.message));
await pg2.goto(`http://localhost:3999/e/${slug.slug}`, { waitUntil: 'networkidle0' }); await espera(800);
ok((await pg2.$eval('#codigoNome', (e) => e.textContent)) === 'Prêmio Inovação 2027', 'link /e/<evento> abre pedindo o código, com o nome');
ok((await pg2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fundo1').trim())) === tema.fundo1.toUpperCase(), '...e com as cores do evento');
await pg2.screenshot({ path: DIR + '/05-link-evento.png' });
await pg2.goto('http://localhost:3999/e/nao-existe', { waitUntil: 'networkidle0' }); await espera(500);
ok((await pg2.$eval('#avisoTitulo', (e) => e.textContent)) === 'Evento não encontrado', 'link errado: "Evento não encontrado"');
await pg2.close();

// ---------- operação ----------
await page.$eval('[data-aba="operacao"]', (e) => e.click()); await espera(300);
await page.click('#btnEncerrar'); await espera(300); await page.click('#janelaOk'); await espera(1200);
ok((await texto('#evStatus')).startsWith('Check-in encerrado') && (await texto('#btnEncerrar')) === 'Reabrir check-in', 'encerrar check-in');
await page.click('#btnEncerrar'); await espera(300); await page.click('#janelaOk'); await espera(1200);
ok((await texto('#evStatus')) === 'Aberto', 'reabrir evento');
await page.click('#btnDuplicar'); await espera(300);
await preencher('#jNome', 'Prêmio Inovação 2028'); await page.click('#janelaOk'); await espera(1500);
ok((await texto('#evNome')) === 'Prêmio Inovação 2028', 'duplicar abre o evento novo');
const dupId = page.url().match(/evento\/([0-9a-f-]{36})/)[1];
ok(dupId !== evId && (await sql(`select count(*) n from checkin.imagens where evento_id='${dupId}'`))[0].n == 1, '...com a arte copiada');
await page.$eval('[data-aba="operacao"]', (e) => e.click()); await espera(300);
await page.click('#btnExcluir'); await espera(300);
await page.type('#jPalavra', 'excluí'); await page.click('#janelaOk'); await espera(300);
ok(await visivel('#janelaErro'), 'excluir exige digitar EXCLUIR');
await preencher('#jPalavra', 'excluir'); await page.click('#janelaOk'); await espera(1500);
ok(page.url().endsWith('#/') && (await sql(`select count(*) n from checkin.eventos`))[0].n == 1, 'evento excluído, volta para a lista');
ok((await page.$$('#listaEventos .evento')).length === 1 && (await texto('#listaEventos h2')) === 'Prêmio Inovação 2027', 'lista mostra o evento restante');
await page.screenshot({ path: DIR + '/06-eventos.png' });

// ---------- celular ----------
await page.setViewport({ width: 390, height: 844 });
await page.goto(`http://localhost:3999/#/evento/${evId}/identidade`, { waitUntil: 'networkidle0' }); await espera(1500);
const largura = await page.evaluate(() => document.documentElement.scrollWidth);
ok(largura <= 390, 'celular: sem rolagem lateral (' + largura + 'px)');
await page.screenshot({ path: DIR + '/07-identidade-celular.png', fullPage: true });
await page.goto(`http://localhost:3999/#/`, { waitUntil: 'networkidle0' }); await espera(800);
await page.screenshot({ path: DIR + '/08-eventos-celular.png' });

ok(erros.length === 0, 'nenhum erro na página' + (erros.length ? ': ' + erros.join(' | ') : ''));
await browser.close();
