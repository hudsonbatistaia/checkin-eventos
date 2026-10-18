// Testes da leitura de planilhas e da ligação de pessoas (site/js/lista.js). Rodar: node testar-lista.mjs
import { createRequire } from 'module';
import { RAIZ } from './banco-teste.mjs';
const L = createRequire(import.meta.url)(RAIZ + '/site/js/lista.js');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };

// Nomes
ok(L.nomeLimpo('Sra. ANA SOUZA - Diretora') === 'Ana Souza', 'tira "Sra.", cargo depois de " - " e caixa alta');
ok(L.nomeLimpo('Dr. Bruno  de Lima;') === 'Bruno de Lima', 'espaço especial, espaços duplos e ponto e vírgula');
ok(L.nomeLimpo('Maria Clara Antunes-Silva') === 'Maria Clara Antunes-Silva', 'sobrenome com hífen colado fica');
ok(L.nomeLimpo('Prof. Dra. Eva Reis') === 'Eva Reis', 'dois títulos seguidos');

// Planilha bagunçada: título na 3ª linha, vários nomes na mesma célula
const linhas = [
  ['LISTA DE CONFIRMADOS - PRÊMIO 2027'], [],
  ['Nº', 'EMPRESAS', 'NOMES DOS PARTICIPANTES E CARGOS', 'Mesa'],
  ['1', 'FIEAM', 'ANA SOUZA - Diretora\nBRUNO LIMA - Gerente', '3'],
  ['2', 'Empresa B', 'Sra. Carla Dias', ''],
  ['3', 'Empresa C', '', ''],
  [],
  ['4', 'Empresa D', 'Ana Souza', '5'],
];
const cab = L.acharCabecalho(linhas);
ok(cab === 2, 'acha a linha dos títulos (3ª linha)');
const col = L.sugerirColunas(linhas[cab], 'Mesa');
ok(col.nome === 2 && col.empresa === 1 && col.extra === 3, 'sugere colunas Nome, Empresa e campo extra: ' + JSON.stringify(col));
ok(L.sugerirColunas(['Nome da empresa', 'Nome completo'], '').nome === 1, '"Nome da empresa" não é confundido com o nome da pessoa');
ok(L.sugerirColunas(['Órgão', 'Autoridade', 'Troféu'], 'Troféu que entrega').extra === 2, 'campo extra "Troféu que entrega" acha a coluna "Troféu"');
const lido = L.lerPessoas(linhas, cab, col);
ok(lido.pessoas.length === 4 && lido.semNome === 1, 'lê 4 nomes (2 na mesma célula) e conta 1 linha sem nome');
ok(lido.pessoas[0].nome === 'Ana Souza' && lido.pessoas[0].empresa === 'FIEAM' && lido.pessoas[0].extra === '3', 'nome, empresa e campo extra da linha');

// Envio: repetidos, ligação com outras listas e pares parecidos
const outros = [
  { id: 'o1', grupo: 'carla-dias', nome: 'Carla Dias', empresa: 'Empresa B', lista: 'vip' },
  { id: 'o2', grupo: 'bruno-lima-sa', nome: 'Bruno Lima Santos', empresa: 'FIEAM', lista: 'vip' },
  { id: 'o3', grupo: 'zeina-russo', nome: 'Zeina Russo', empresa: 'Gov', lista: 'vip' },
];
const env = L.prepararEnvio(lido.pessoas.concat([{ nome: 'Zeina Maria Russo', empresa: 'Outra', extra: '' }]), outros, []);
ok(env.repetidos === 1 && env.pessoas.length === 4, 'Ana Souza repetida na planilha vira uma só');
const carla = env.pessoas.find((p) => p.nome === 'Carla Dias');
ok(carla.grupo === 'carla-dias' && carla.ligadaA, 'mesmo nome em outra lista: ligada automaticamente');
const parBruno = env.pares.find((p) => p.novo.nome === 'Bruno Lima');
ok(parBruno && parBruno.alvo.id === 'o2' && parBruno.sugerido, 'par parecido com a mesma empresa vem marcado (Bruno Lima ~ Bruno Lima Santos)');
const parZeina = env.pares.find((p) => p.novo.nome === 'Zeina Maria Russo');
ok(parZeina && !parZeina.sugerido, 'par parecido com empresa diferente vem desmarcado (a organização decide)');
const final = L.finalizarEnvio(env.pessoas, [parBruno]);
ok(final.find((p) => p.nome === 'Bruno Lima').grupo === 'bruno-lima-sa', 'par aprovado: usa o grupo da outra lista (presença vale para os dois)');
ok(final.find((p) => p.nome === 'Zeina Maria Russo').grupo === 'zeina-maria-russo', 'par não aprovado: pessoa separada');
ok(final.every((p) => /^[a-z0-9-]{1,80}$/.test(p.grupo) && p.busca === L.norm(p.nome + ' ' + p.empresa)), 'grupos e busca no formato do banco');

// Cadeia dentro da mesma planilha: A ~ B (mesma lista) e B ~ C (outra lista)
const e2 = L.prepararEnvio([{ nome: 'Zeina Russo da Silva' }, { nome: 'Zeina Russo' }], [{ id: 'x', grupo: 'zeina-r', nome: 'Zeina Maria Russo', empresa: '' }], []);
const f2 = L.finalizarEnvio(e2.pessoas, e2.pares);
ok(f2.length === 2 && f2.every((p) => p.grupo === 'zeina-r'), 'pares em cadeia viram uma pessoa só: ' + f2.map((p) => p.grupo).join(','));

// Reenvio: par ligado antes volta marcado
const e3 = L.prepararEnvio([{ nome: 'Zeina Maria Russo', empresa: 'Outra' }], outros, [{ nome: 'Zeina Maria Russo', grupo: 'zeina-russo' }]);
ok(e3.pares.length === 1 && e3.pares[0].sugerido, 'reenvio: par aprovado da vez anterior já vem marcado');

// Desempenho: 3000 x 3000 nomes
const nomes = (n, pre) => Array.from({ length: n }, (_, i) => ({ nome: `${pre}${i % 300} Silva ${i}`, empresa: '' }));
const t0 = Date.now();
const grande = L.prepararEnvio(nomes(3000, 'Nome'), nomes(3000, 'Nome').map((p, i) => ({ ...p, id: 'g' + i, grupo: 'g' + i, nome: p.nome + ' Souza' })), []);
ok(Date.now() - t0 < 3000, `3000 nomes contra 3000: ${Date.now() - t0} ms, ${grande.pares.length} pares`);
