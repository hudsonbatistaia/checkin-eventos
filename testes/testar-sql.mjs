// Testes do banco (regras de acesso e funções). Rodar: node testar-sql.mjs
import { criarBanco, chamar, USUARIOS } from './banco-teste.mjs';
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) process.exitCode = 1; };
const db = await criarBanco();
const HUD = { uid: USUARIOS['hudson@hbone.com.br'][0] };
const CON = { uid: USUARIOS['contratos@hbone.com.br'][0] };
const adm = (f, a) => chamar(db, f, a, HUD);
const pub = (f, a, ip) => chamar(db, f, a, { ip: ip || '10.0.0.1' });
const q = async (s) => (await db.query(s)).rows;

// ---------- acesso da organização ----------
let r = await pub('listar_eventos');
ok(r.error && /permission denied/i.test(r.error.message), 'sem login: não lista eventos');
r = await chamar(db, 'listar_eventos', {}, CON);
ok(r.error && /sem permissão/i.test(r.error.message), 'usuário de outro sistema: barrado');
r = await adm('sessao');
ok(r.data && r.data.nome === 'Hudson', 'hudson entra (sessao)');
for (const t of ['eventos', 'pessoas', 'checkins', 'imagens']) {
  await db.exec(`set role anon`);
  let negado = false; try { await db.query(`select * from checkin.${t}`); } catch { negado = true; }
  await db.exec(`reset role`);
  ok(negado, `leitura direta da tabela ${t} bloqueada para o site`);
}

// ---------- criar e configurar evento ----------
r = await adm('criar_evento', { p_dados: { nome: 'Prêmio Inovação 2027 — Manaus', data: '2027-05-20', horario: '19h', local: 'Teatro', modo: 'totem', tema: { fundo1: '#112233', destaque: 'vermelho' } } });
ok(r.data && /^premio-inovacao-2027-manaus-[0-9a-f]{4}$/.test(r.data.slug), 'criar evento: link sem acento e com final aleatório (' + (r.data && r.data.slug) + ')');
const EV = r.data.id, SLUG = r.data.slug;
r = await adm('obter_evento', { p_id: EV });
const ev = r.data;
ok(/^[0-9]{6}$/.test(ev.codigo), 'código de 6 dígitos: ' + ev.codigo);
ok(ev.modo === 'totem' && ev.data === '2027-05-20' && ev.local === 'Teatro', 'dados básicos salvos');
ok(JSON.stringify(ev.tema) === '{"fundo1":"#112233"}', 'tema: só cores válidas ficam');
ok(ev.listas.length === 2 && ev.listas.map((l) => l.tipo).join() === 'confirmados,convidados', 'evento nasce com Confirmados e Convidados');
r = await adm('salvar_evento', { p_id: EV, p_dados: { data: '31/02/2027' } });
ok(r.error && /data inválida/i.test(r.error.message), 'data inválida recusada');
r = await adm('salvar_evento', { p_id: EV, p_dados: { nome: ' ' } });
ok(r.error && /nome do evento/i.test(r.error.message), 'nome vazio recusado');
r = await adm('salvar_evento', { p_id: EV, p_dados: { subtitulo: '  3ª   edição ', boas_vindas: 'Seja bem-vindo!' } });
ok(!r.error, 'salvar dados');
ev.versao = (await adm('obter_evento', { p_id: EV })).data.versao;
ok((await q(`select subtitulo from checkin.eventos where id='${EV}'`))[0].subtitulo === '3ª edição', 'espaços extras limpos');
let codigos = new Set(); for (let i = 0; i < 300; i++) codigos.add((await q(`select checkin.gerar_codigo() c`))[0].c);
ok([...codigos].every((c) => /^[0-9]{6}$/.test(c)) && codigos.size > 290, 'gerador de código: sempre 6 dígitos e variado');

// ---------- imagens ----------
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
r = await adm('salvar_imagem', { p_id: EV, p_tipo: 'arte', p_conteudo: 'data:text/html;base64,PHNjcmlwdD4=' });
ok(r.error && /imagem inválida/i.test(r.error.message), 'imagem: só aceita jpeg/png/webp');
r = await adm('salvar_imagem', { p_id: EV, p_tipo: 'arte', p_conteudo: PNG });
ok(!r.error, 'imagem: arte salva');
r = await pub('imagem', { p_slug: SLUG, p_tipo: 'arte' });
ok(r.data === PNG, 'tablet consegue baixar a arte sem código');
r = await pub('evento_publico', { p_slug: SLUG });
ok(r.data && r.data.nome && !('codigo' in r.data) && !('pessoas' in r.data) && r.data.imagens.arte > 0, 'evento_publico: nome e cores, sem código nem nomes');
r = await pub('evento_publico', { p_slug: 'nao-existe' });
ok(r.data && r.data.erro === 'evento', 'link inexistente: erro "evento"');

// ---------- listas e pessoas ----------
const conf = ev.listas.find((l) => l.tipo === 'confirmados').id;
const conv = ev.listas.find((l) => l.tipo === 'convidados').id;
r = await adm('salvar_lista', { p_evento: EV, p_dados: { nome: 'Autoridades', cor: '#38c6e3', selo: true, destaque: 'bloco', campo_extra: 'Troféu que entrega' } });
ok(r.data, 'lista VIP criada');
const VIP = r.data;
r = await adm('salvar_lista', { p_evento: EV, p_dados: { id: VIP, cor: 'azul' } });
ok(r.error && /cor inválida/i.test(r.error.message), 'cor inválida recusada');
r = await adm('salvar_lista', { p_evento: EV, p_dados: { id: conf, nome: 'Confirmaram presença' } });
ok(!r.error, 'lista fixa pode ser renomeada');
r = await adm('excluir_lista', { p_lista: conf });
ok(r.error, 'lista fixa não pode ser apagada');
const pes = (grupo, nome, empresa, extra = '') => ({ grupo, nome, empresa, extra, busca: (nome + ' ' + empresa).toLowerCase() });
r = await adm('salvar_pessoas', { p_lista: conf, p_dados: [pes('ana-souza', 'Ana Souza', 'Empresa A'), pes('bruno-lima', 'Bruno Lima', 'Empresa B')], p_arquivo: 'confirmados.xlsx' });
ok(r.data === 2, 'planilha de confirmados: 2 pessoas');
r = await adm('salvar_pessoas', { p_lista: conv, p_dados: [pes('carla-dias', 'Carla Dias', 'Empresa C')], p_arquivo: 'convidados.xlsx' });
r = await adm('salvar_pessoas', { p_lista: VIP, p_dados: [pes('ana-souza', 'Ana Souza', 'Gov', 'Troféu Ouro'), pes('dario-neto', 'Dario Neto', 'Gov')], p_arquivo: 'aut.xlsx' });
ok(r.data === 2, 'lista VIP com 2 pessoas (uma também está nos confirmados)');
r = await adm('salvar_pessoas', { p_lista: VIP, p_dados: [{ grupo: 'X Y', nome: 'Fulano' }], p_arquivo: '' });
ok(r.error && /identificador inválido/i.test(r.error.message), 'grupo com formato inválido recusado');
ok((await q(`select count(*) n from checkin.pessoas where lista_id='${VIP}'`))[0].n == 2, '...e a lista anterior continua inteira (tudo ou nada)');
r = await adm('adicionar_pessoa', { p_lista: VIP, p_dados: pes('eva-reis', 'Eva Reis', 'Gov') });
ok(r.data, 'pessoa digitada incluída');
const EVA = r.data;
r = await adm('editar_pessoa', { p_id: EVA, p_dados: pes('eva-reis', 'Eva Reis Santos', 'Governo') });
ok(!r.error && (await q(`select nome from checkin.pessoas where id='${EVA}'`))[0].nome === 'Eva Reis Santos', 'pessoa corrigida');

// ---------- código de acesso (tablets) ----------
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: '000000' === ev.codigo ? '111111' : '000000' });
ok(r.data && r.data.erro === 'codigo', 'código errado: recusado');
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: ev.codigo });
ok(r.data && r.data.ok && r.data.pessoas.length === 6 && r.data.listas.length === 3 && r.data.checkins.length === 0, 'código certo: recebe listas e pessoas');
const versao = r.data.versao, marca = r.data.marca;
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: ev.codigo, p_versao: versao, p_marca: marca });
ok(r.data.ok && !('pessoas' in r.data) && !('checkins' in r.data), 'sem mudanças: resposta curta');

// ---------- check-in ----------
r = await pub('fazer_checkin', { p_slug: SLUG, p_codigo: ev.codigo, p_grupo: 'ana-souza', p_dispositivo: 'Tablet 1' });
ok(r.data.ok && r.data.ja_existia === false, 'confirmar presença');
r = await pub('fazer_checkin', { p_slug: SLUG, p_codigo: ev.codigo, p_grupo: 'ana-souza', p_dispositivo: 'Tablet 2' });
ok(r.data.ok && r.data.ja_existia === true, 'segundo tablet: "já tinha chegado"');
ok((await q(`select dispositivo from checkin.checkins where grupo='ana-souza'`))[0].dispositivo === 'Tablet 1', 'vale o primeiro tablet');
r = await pub('fazer_checkin', { p_slug: SLUG, p_codigo: ev.codigo, p_grupo: 'ninguem' });
ok(r.data.erro === 'pessoa', 'pessoa fora das listas: recusada');
r = await pub('fazer_checkin', { p_slug: SLUG, p_codigo: 'abc', p_grupo: 'bruno-lima' });
ok(r.data.erro === 'codigo' && (await q(`select count(*) n from checkin.checkins where grupo='bruno-lima'`))[0].n == 0, 'código errado não confirma');
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: ev.codigo, p_versao: versao, p_marca: marca });
ok(r.data.checkins.length === 1 && r.data.checkins[0][0] === 'ana-souza' && !('pessoas' in r.data), 'outro tablet recebe só a presença nova');
r = await pub('cadastrar_avulso', { p_slug: SLUG, p_codigo: ev.codigo, p_nome: '  Zeca   Pagodinho ', p_empresa: 'Samba', p_dispositivo: 'Tablet 1' });
ok(r.data.ok && r.data.id, 'cadastrar na hora');
const AV = r.data.id;
r = await pub('cadastrar_avulso', { p_slug: SLUG, p_codigo: ev.codigo, p_nome: 'Z', p_empresa: '' });
ok(r.data.erro === 'nome', 'cadastro sem nome recusado');
r = await pub('remover_avulso', { p_slug: SLUG, p_codigo: ev.codigo, p_id: AV });
ok(r.data.ok && (await q(`select count(*) n from checkin.avulsos`))[0].n == 0, 'desfazer cadastro na hora');
r = await pub('desfazer_checkin', { p_slug: SLUG, p_codigo: ev.codigo, p_grupos: ['ana-souza'] });
ok(r.data.ok && (await q(`select count(*) n from checkin.checkins`))[0].n == 0, 'cancelar entrada');

// ---------- bloqueio por tentativas ----------
for (let i = 0; i < 30; i++) await pub('sincronizar', { p_slug: SLUG, p_codigo: '99999' + (i % 10) === ev.codigo ? 'x' : '99999' + (i % 10) }, '10.9.9.9');
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: ev.codigo }, '10.9.9.9');
ok(r.data.erro === 'bloqueado', '30 códigos errados: aquele endereço fica bloqueado (mesmo com o código certo)');
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: ev.codigo }, '10.0.0.2');
ok(r.data.ok, 'outros aparelhos continuam funcionando');
r = await adm('novo_codigo', { p_id: EV });
const NOVO = r.data;
ok(/^[0-9]{6}$/.test(NOVO) && NOVO !== ev.codigo, 'trocar código');
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: ev.codigo }, '10.0.0.2');
ok(r.data.erro === 'codigo', 'código antigo deixa de valer');
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: NOVO }, '10.9.9.9');
ok(r.data.ok, 'trocar o código também libera os bloqueados');
ev.codigo = NOVO;

// ---------- encerrar ----------
await adm('encerrar_evento', { p_id: EV, p_encerrar: true });
r = await pub('fazer_checkin', { p_slug: SLUG, p_codigo: NOVO, p_grupo: 'bruno-lima' });
ok(r.data.erro === 'encerrado', 'evento encerrado: não confirma');
r = await pub('cadastrar_avulso', { p_slug: SLUG, p_codigo: NOVO, p_nome: 'Fulano Tal', p_empresa: '' });
ok(r.data.erro === 'encerrado', 'evento encerrado: não cadastra');
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: NOVO });
ok(r.data.ok && r.data.evento.encerrado === true, 'evento encerrado: consulta continua');
await adm('encerrar_evento', { p_id: EV, p_encerrar: false });
r = await pub('fazer_checkin', { p_slug: SLUG, p_codigo: NOVO, p_grupo: 'bruno-lima', p_dispositivo: 'T' });
ok(r.data.ok, 'reaberto: volta a confirmar');

// ---------- encerramento automático (horário marcado) ----------
r = await adm('salvar_evento', { p_id: EV, p_dados: { encerra_em: 'amanhã às 9' } });
ok(r.error && /horário de encerramento inválido/i.test(r.error.message), 'horário de encerramento inválido recusado');
const futuro = new Date(Date.now() + 3600e3).toISOString(), passado = new Date(Date.now() - 60e3).toISOString();
await adm('salvar_evento', { p_id: EV, p_dados: { encerra_em: futuro } });
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: NOVO });
ok(r.data.ok && r.data.encerrado === false && r.data.evento.encerra_em && r.data.agora, 'horário no futuro: aberto, tablet recebe o horário e a hora do servidor');
await adm('salvar_evento', { p_id: EV, p_dados: { encerra_em: passado } });
r = await pub('fazer_checkin', { p_slug: SLUG, p_codigo: NOVO, p_grupo: 'dario-neto', p_dispositivo: 'T' });
ok(r.data.erro === 'encerrado', 'horário passou: não confirma (o servidor decide, não o tablet)');
r = await pub('desfazer_checkin', { p_slug: SLUG, p_codigo: NOVO, p_grupos: ['bruno-lima'] });
ok(r.data.erro === 'encerrado', 'horário passou: nem desfazer (tudo travado)');
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: NOVO, p_versao: 999999, p_marca: 999999 });
ok(r.data.ok && r.data.encerrado === true && new Date(r.data.encerramento).getTime() === new Date(passado).getTime(), 'sincronizar avisa que encerrou (mesmo sem mudança de versão) e a hora');
r = await adm('listar_eventos');
ok(r.data.find((e) => e.id === EV).encerrado_em, 'lista de eventos mostra como encerrado');
await adm('encerrar_evento', { p_id: EV, p_encerrar: false });
ok((await q(`select encerra_em from checkin.eventos where id='${EV}'`))[0].encerra_em === null, 'reabrir apaga o horário marcado');
r = await pub('fazer_checkin', { p_slug: SLUG, p_codigo: NOVO, p_grupo: 'dario-neto', p_dispositivo: 'T' });
ok(r.data.ok, 'reaberto: confirma de novo');
await pub('desfazer_checkin', { p_slug: SLUG, p_codigo: NOVO, p_grupos: ['dario-neto'] });
await adm('salvar_evento', { p_id: EV, p_dados: { encerra_em: '' } });
ok((await q(`select encerra_em from checkin.eventos where id='${EV}'`))[0].encerra_em === null, 'apagar o horário (campo vazio)');

// ---------- evento aberto: campos do cadastro na entrada, CPF, LGPD ----------
await adm('salvar_evento', { p_id: EV, p_dados: { aberto: true, lgpd_texto: 'Autorizo o uso dos meus dados.', campos: [
  { chave: 'empresa' }, { chave: 'cpf', obrigatorio: true }, { chave: 'email' }, { chave: 'nascimento' }, { chave: 'telefone' },
  { chave: 'x1', rotulo: 'Cargo', obrigatorio: true }, { chave: 'zzz' }, { chave: 'x2', rotulo: '  ' }, { chave: 'cpf' }] } });
let evA = (await adm('obter_evento', { p_id: EV })).data;
ok(evA.aberto === true && evA.campos.map((c) => c.chave).join() === 'empresa,cpf,email,nascimento,telefone,x1' && evA.campos[5].rotulo === 'Cargo' && evA.campos[1].obrigatorio === true, 'campos do cadastro: só os válidos, sem repetir');
const cad = (dados, nome = 'Maria Nova', empresa = 'Startup') => pub('cadastrar_avulso', { p_slug: SLUG, p_codigo: NOVO, p_nome: nome, p_empresa: empresa, p_dispositivo: 'T', p_dados: dados });
r = await cad({ consentiu: true, extras: { x1: 'Diretora' } });
ok(r.data.erro === 'campo' && r.data.campo === 'cpf' && r.data.msg === 'Preencha: CPF.', 'CPF obrigatório em branco: "Preencha: CPF."');
r = await cad({ cpf: '529.982.247-26', consentiu: true, extras: { x1: 'Diretora' } });
ok(r.data.erro === 'campo' && /CPF inválido/.test(r.data.msg), 'CPF com dígito errado: recusado');
r = await cad({ cpf: '529.982.247-25', consentiu: true });
ok(r.data.erro === 'campo' && r.data.msg === 'Preencha: Cargo.', 'campo com nome livre obrigatório: "Preencha: Cargo."');
r = await cad({ cpf: '529.982.247-25', email: 'maria@', consentiu: true, extras: { x1: 'Diretora' } });
ok(r.data.erro === 'campo' && r.data.msg === 'E-mail inválido.', 'e-mail inválido');
r = await cad({ cpf: '529.982.247-25', nascimento: '2999-01-01', consentiu: true, extras: { x1: 'Diretora' } });
ok(r.data.erro === 'campo' && /nascimento/.test(r.data.msg), 'data de nascimento no futuro: recusada');
r = await cad({ cpf: '529.982.247-25', telefone: '1234', consentiu: true, extras: { x1: 'Diretora' } });
ok(r.data.erro === 'campo' && /Telefone/.test(r.data.msg), 'telefone curto: recusado');
r = await cad({ cpf: '529.982.247-25', extras: { x1: 'Diretora' } });
ok(r.data.erro === 'consentimento', 'sem aceitar o aviso de LGPD: recusado');
r = await cad({ cpf: '529.982.247-25', email: 'Maria@Exemplo.com', nascimento: '1990-05-20', telefone: '(92) 99200-1234', consentiu: true, extras: { x1: 'Diretora', x9: 'invasor' } });
ok(r.data.ok, 'cadastro completo aceito');
r = await cad({ cpf: '52998224725', consentiu: true, extras: { x1: 'Outro' } }, 'Outra Pessoa');
ok(r.data.erro === 'cpf_repetido' && r.data.horario, 'mesmo CPF de novo: "já fez check-in" com o horário');
const cads = (await adm('obter_evento', { p_id: EV })).data.cadastros;
const c0 = cads.find((c) => c[1] === '52998224725');
ok(c0 && c0[2] === '1990-05-20' && c0[3] === 'maria@exemplo.com' && c0[4] === '92992001234' && JSON.stringify(c0[5]) === '{"x1":"Diretora"}' && c0[6], 'organização recebe CPF, nascimento, e-mail, telefone, campo livre e aceite (campo desconhecido descartado)');
r = await pub('sincronizar', { p_slug: SLUG, p_codigo: NOVO });
ok(r.data.avulsos.every((a) => a.length === 5) && !JSON.stringify(r.data).includes('52998224725') && !JSON.stringify(r.data).includes('maria@'), 'tablets NÃO recebem CPF nem e-mail');
r = await pub('evento_publico', { p_slug: SLUG });
ok(r.data.aberto === true && r.data.campos.length === 6 && r.data.lgpd_texto === 'Autorizo o uso dos meus dados.', 'tablet recebe a configuração do formulário (sem dados de ninguém)');
await adm('salvar_evento', { p_id: EV, p_dados: { aberto: false, campos: [{ chave: 'empresa' }], lgpd_texto: '' } });
r = await cad({}, 'Sem Consentimento');
ok(r.data.ok, 'só nome e empresa: não precisa de aceite (como antes)');
await adm('zerar_presencas', { p_id: EV });

// ---------- check-in pelo celular (QR dos convidados) ----------
const QE = (await adm('criar_evento', { p_dados: { nome: 'Feira do QR', aberto: true, campos: [{ chave: 'empresa' }] } })).data;
let qe = (await adm('obter_evento', { p_id: QE.id })).data;
ok(/^[0-9a-f]{16}$/.test(qe.qr_chave) && qe.geo_ativo === false, 'evento tem chave própria do QR dos convidados');
r = await pub('evento_publico', { p_slug: QE.slug });
ok(!JSON.stringify(r.data).includes(qe.qr_chave) && !('geo_lat' in r.data) && r.data.geo === false, 'dados públicos sem a chave do QR e sem coordenadas');
const abrir = (k, ip, id) => pub('convidado_abrir', { p_slug: QE.slug, p_k: k, p_id: id || null }, ip);
const viaQr = (passe, cpf, ip, extra = {}) => pub('convidado_checkin', { p_slug: QE.slug, p_passe: passe, p_nome: 'Pessoa ' + cpf.slice(0, 3) + ' Silva', p_empresa: 'X', p_dados: { cpf, consentiu: true }, p_lat: null, p_lng: null, p_precisao: null, ...extra }, ip);
r = await abrir('errada', '10.5.0.1');
ok(r.data.erro === 'chave', 'QR com chave errada: recusado');
r = await abrir(qe.qr_chave, '10.5.0.1');
ok(r.data.ok && /^\d+\.[0-9a-f]{20}$/.test(r.data.passe) && r.data.geo === false, 'QR certo: entrega um passe');
let PASSE = r.data.passe;
r = await pub('convidado_checkin', { p_slug: QE.slug, p_passe: PASSE, p_nome: 'Ana Lima', p_empresa: '', p_dados: { consentiu: true }, p_lat: null, p_lng: null, p_precisao: null }, '10.5.0.1');
ok(r.data.erro === 'campo' && r.data.campo === 'cpf', 'pelo celular o CPF é obrigatório (mesmo sem estar nos campos do evento)');
r = await pub('convidado_checkin', { p_slug: QE.slug, p_passe: PASSE, p_nome: 'Ana Lima', p_empresa: '', p_dados: { cpf: '52998224725' }, p_lat: null, p_lng: null, p_precisao: null }, '10.5.0.1');
ok(r.data.erro === 'consentimento', 'pelo celular sempre pede o aceite de LGPD');
r = await viaQr(PASSE, '52998224725', '10.5.0.1');
ok(r.data.ok, 'check-in pelo celular');
const ID_QR = r.data.id;
ok((await q(`select dispositivo from checkin.avulsos where id='${ID_QR}'`))[0].dispositivo === 'Celular (QR)', 'aparece como "Celular (QR)"');
r = await viaQr(PASSE, '52998224725', '10.5.0.2');
ok(r.data.erro === 'cpf_repetido', 'mesmo CPF pelo celular: bloqueado');
r = await viaQr(PASSE.replace(/.$/, (c) => (c === '0' ? '1' : '0')), '11144477735', '10.5.0.3');
ok(r.data.erro === 'passe', 'passe adulterado: recusado');
const vencido = (await q(`select checkin.passe_de(e, extract(epoch from now())::bigint - 60) p from checkin.eventos e where id='${QE.id}'`))[0].p;
r = await viaQr(vencido, '11144477735', '10.5.0.3');
ok(r.data.erro === 'passe', 'passe vencido (mais de 20 min): recusado');
// limite por rede (Wi-Fi do evento): 60 check-ins a cada 10 min
const cpfs = ['11144477735', '39053344705', '71428793860', '87748248800'];
for (const c of cpfs.slice(0, 2)) await viaQr(PASSE, c, '10.5.0.9');
r = await viaQr(PASSE, cpfs[2], '10.5.0.9');
ok(r.data.ok, '3º check-in da mesma rede: passa (Wi-Fi do evento)');
await q(`insert into checkin.qr_registros (evento_id, ip, ok) select '${QE.id}', '10.5.0.9', true from generate_series(1, 57)`);
r = await viaQr(PASSE, cpfs[3], '10.5.0.9');
ok(r.data.erro === 'muitas', '61º check-in da mesma rede em 10 min: "muitas tentativas"');
r = await viaQr(PASSE, cpfs[3], '10.5.0.10');
ok(r.data.ok, '...outra rede continua normal');
// abertura marcada
await adm('salvar_evento', { p_id: QE.id, p_dados: { abre_em: new Date(Date.now() + 3600e3).toISOString() } });
r = await abrir(qe.qr_chave, '10.5.0.11');
ok(r.data.erro === 'antes' && r.data.abre_em, 'antes do horário de abertura: "o check-in abre às ..."');
await adm('salvar_evento', { p_id: QE.id, p_dados: { abre_em: '' } });
// QR que muda a cada minuto
await adm('salvar_evento', { p_id: QE.id, p_dados: { qr_rotativo: true } });
r = await abrir(qe.qr_chave, '10.5.0.11');
ok(r.data.erro === 'chave', 'QR que muda: o QR fixo (cartaz) deixa de valer');
const tok = async (d) => (await q(`select checkin.qr_token(e, checkin.qr_minuto() + ${d}) t from checkin.eventos e where id='${QE.id}'`))[0].t;
ok((await abrir(await tok(0), '10.5.0.11')).data.ok && (await abrir(await tok(-1), '10.5.0.11')).data.ok, 'QR do minuto atual e do anterior: valem');
ok((await abrir(await tok(-2), '10.5.0.11')).data.erro === 'chave', 'QR de 2 minutos atrás: vencido');
r = await pub('qr_atual', { p_slug: QE.slug, p_codigo: qe.codigo }, '10.5.0.12');
ok(r.data.ok && r.data.rotativo && r.data.k === await tok(0) && r.data.expira, 'tela cheia (código da equipe) recebe o QR do minuto');
r = await pub('qr_atual', { p_slug: QE.slug, p_codigo: '000000' === qe.codigo ? '111111' : '000000' }, '10.5.0.12');
ok(r.data.erro === 'codigo', 'tela cheia sem o código da equipe: recusada');
await adm('salvar_evento', { p_id: QE.id, p_dados: { qr_rotativo: false } });
// trocar o QR invalida cartaz e passes
await adm('novo_qr_convidados', { p_id: QE.id });
r = await abrir(qe.qr_chave, '10.5.0.13');
ok(r.data.erro === 'chave', 'trocar QR: cartaz antigo deixa de valer');
r = await viaQr(PASSE, '15350946056', '10.5.0.13');
ok(r.data.erro === 'passe', '...e quem estava preenchendo com o QR antigo também');
qe = (await adm('obter_evento', { p_id: QE.id })).data;
// localização
r = await adm('salvar_evento', { p_id: QE.id, p_dados: { geo_ativo: true } });
ok(r.error && /local do evento/.test(r.error.message), 'ligar localização sem marcar o local: recusado');
r = await adm('salvar_evento', { p_id: QE.id, p_dados: { geo_ativo: true, geo_lat: '91', geo_lng: '-60' } });
ok(r.error && /Coordenadas inválidas/.test(r.error.message), 'coordenadas impossíveis: recusadas');
await adm('salvar_evento', { p_id: QE.id, p_dados: { geo_ativo: true, geo_lat: -3.1, geo_lng: -60.0, geo_raio: 300 } });
r = await abrir(qe.qr_chave, '10.5.0.14');
PASSE = r.data.passe;
ok(r.data.geo === true, 'celular fica sabendo que precisa da localização (sem receber o local)');
r = await viaQr(PASSE, '15350946056', '10.5.0.15');
ok(r.data.erro === 'sem_local', 'sem localização: recusado');
r = await viaQr(PASSE, '15350946056', '10.5.0.16', { p_lat: -3.1, p_lng: -60.0, p_precisao: 3000 });
ok(r.data.erro === 'local_impreciso', 'localização imprecisa (3 km): recusada');
r = await viaQr(PASSE, '15350946056', '10.5.0.17', { p_lat: -3.2, p_lng: -60.0, p_precisao: 20 });
ok(r.data.erro === 'longe', 'a 11 km do local: "longe"');
r = await viaQr(PASSE, '15350946056', '10.5.0.18', { p_lat: -3.1015, p_lng: -60.0, p_precisao: 30 });
ok(r.data.ok, 'a ~170 m (raio 300 m): aceito');
ok(!JSON.stringify((await q(`select to_jsonb(a) j from checkin.avulsos a where cpf='15350946056'`))[0].j).includes('-3.10'), 'localização da pessoa não é guardada');
// comprovante e encerramento
await adm('encerrar_evento', { p_id: QE.id, p_encerrar: true });
r = await abrir(qe.qr_chave, '10.5.0.19');
ok(r.data.erro === 'encerrado', 'check-in encerrado: QR recusa');
r = await abrir('qualquer', '10.5.0.19', ID_QR);
ok(r.data.ok && r.data.comprovante && r.data.comprovante.nome === 'Pessoa 529 Silva', 'comprovante continua valendo para quem já fez (mesmo encerrado)');
r = await adm('apagar_dados_pessoais', { p_id: QE.id });
ok(!r.error && (await q(`select count(*) n from checkin.qr_registros where evento_id='${QE.id}'`))[0].n == 0, 'apagar dados pessoais limpa as tentativas do QR');
await adm('excluir_evento', { p_id: QE.id });

// ---------- duplicar ----------
r = await adm('duplicar_evento', { p_id: EV, p_nome: 'Prêmio Inovação 2028' });
ok(r.data && r.data.id !== EV, 'duplicar evento');
const DUP = (await adm('obter_evento', { p_id: r.data.id })).data;
ok(DUP.listas.length === 3 && DUP.listas[2].nome === 'Autoridades' && DUP.listas[2].campo_extra === 'Troféu que entrega' && DUP.listas[0].nome === 'Confirmaram presença', 'cópia leva as listas e seus nomes');
ok(DUP.pessoas.length === 0 && DUP.checkins.length === 0 && DUP.codigo !== NOVO && DUP.imagens.arte, 'cópia sem pessoas, com código novo e com a arte');

// ---------- certificados ----------
r = await adm('salvar_evento', { p_id: EV, p_dados: {
  certificado_ativo: true,
  certificado_horas: 8,
  certificado_texto: 'Certificamos que {nome} participou do {evento}.',
  certificado_emissor: 'FIEAM / IEL',
  certificado_assinatura_nome: 'Hudson Batista',
  certificado_assinatura_cargo: 'Diretor',
  certificado_libera_em: new Date(Date.now() + 3600000).toISOString()
} });
ok(!r.error, 'configuração de certificados salva');
r = await pub('obter_certificado', { p_slug: SLUG, p_chave: 'Ninguém Aqui' });
ok(r.data && r.data.erro === 'nao_encontrado', 'certificado para quem não fez check-in: não encontrado');
await pub('fazer_checkin', { p_slug: SLUG, p_codigo: NOVO, p_grupo: 'ana-souza' });
r = await pub('obter_certificado', { p_slug: SLUG, p_chave: 'Ana Souza' });
ok(r.data && r.data.ok && !r.data.liberado && r.data.libera_em, 'certificado antes do horário: liberado = false e avisa horário');
await adm('salvar_evento', { p_id: EV, p_dados: { certificado_libera_em: new Date(Date.now() - 1000).toISOString() } });
r = await pub('obter_certificado', { p_slug: SLUG, p_chave: 'Ana Souza' });
ok(r.data && r.data.ok && r.data.liberado && r.data.codigo && r.data.horas == 8, 'certificado no horário: liberado = true com código (' + (r.data && r.data.codigo) + ')');
const cod = r.data.codigo;
r = await pub('obter_certificado', { p_slug: SLUG, p_chave: 'Ana Sou' });
ok(r.data && r.data.ok && r.data.liberado && r.data.nome === 'Ana Souza', 'busca parcial (4 letras ou mais): "Ana Sou" encontra "Ana Souza"');
r = await pub('obter_certificado', { p_slug: SLUG, p_chave: cod });
ok(r.data && r.data.ok && r.data.liberado && r.data.codigo === cod, 'busca por código: encontra pelo código do certificado');
r = await pub('obter_certificado', { p_slug: SLUG, p_chave: 'Bruno Lima' });
ok(r.data && r.data.erro === 'sem_presenca', 'pessoa na lista sem check-in (nome completo): avisa que não confirmou presença');
r = await pub('validar_certificado', { p_codigo: cod });
ok(r.data && r.data.ok && r.data.valido && r.data.nome === 'Ana Souza', 'validar_certificado público: confirma autenticidade');
r = await pub('validar_certificado', { p_codigo: 'CERT-FALSO-1234' });
ok(r.data && r.data.ok && !r.data.valido, 'validar_certificado código falso: valido = false');
r = await adm('obter_presentes_certificado', { p_evento_id: EV });
ok(r.data && r.data.length >= 1 && r.data[0].codigo, 'organização: obter_presentes_certificado traz lista para impressão em lote');

// ---------- zerar, apagar dados, excluir ----------
await pub('cadastrar_avulso', { p_slug: SLUG, p_codigo: NOVO, p_nome: 'Fulano Tal', p_empresa: '' });
r = await adm('zerar_presencas', { p_id: EV });
ok(!r.error && (await q(`select count(*) n from checkin.checkins where evento_id='${EV}'`))[0].n == 0 && (await q(`select count(*) n from checkin.avulsos`))[0].n == 0, 'zerar presenças (listas continuam)');
ok((await q(`select count(*) n from checkin.pessoas where evento_id='${EV}'`))[0].n == 6, '...as pessoas continuam');
await pub('fazer_checkin', { p_slug: SLUG, p_codigo: NOVO, p_grupo: 'ana-souza' });
await pub('cadastrar_avulso', { p_slug: SLUG, p_codigo: NOVO, p_nome: 'Fulano Tal', p_empresa: '' });
r = await adm('apagar_dados_pessoais', { p_id: EV });
const res = (await q(`select resumo from checkin.eventos where id='${EV}'`))[0].resumo;
ok(!r.error && res.pessoas_nas_listas === 5 && res.presentes_das_listas === 1 && res.cadastrados_na_hora === 1, 'apagar dados pessoais guarda os números: ' + JSON.stringify(res));
ok((await q(`select count(*) n from checkin.pessoas where evento_id='${EV}'`))[0].n == 0 && (await q(`select count(*) n from checkin.listas where evento_id='${EV}'`))[0].n == 3, '...nomes apagados, listas (configuração) ficam');
r = await adm('excluir_evento', { p_id: EV });
ok(!r.error && (await q(`select count(*) n from checkin.listas where evento_id='${EV}'`))[0].n == 0 && (await q(`select count(*) n from checkin.imagens where evento_id='${EV}'`))[0].n == 0, 'excluir evento apaga tudo dele');
r = await adm('listar_eventos');
ok(r.data.length === 1 && r.data[0].nome === 'Prêmio Inovação 2028', 'lista de eventos: só a cópia');
r = await pub('fazer_checkin', { p_slug: SLUG, p_codigo: NOVO, p_grupo: 'ana-souza' });
ok(r.data.erro === 'evento', 'evento apagado: link deixa de funcionar');

// ---------- privacidade (correções de 19/10/2026) ----------
const PV = (await adm('criar_evento', { p_dados: { nome: 'Evento Privacidade', aberto: true, campos: [{ chave: 'empresa' }, { chave: 'telefone' }] } })).data;
await adm('salvar_evento', { p_id: PV.id, p_dados: { geo_ativo: true, geo_lat: -3.1, geo_lng: -60.0, geo_raio: 300, certificado_ativo: true } });
const pv = (await adm('obter_evento', { p_id: PV.id })).data;
const passeDe = async (ip) => (await pub('convidado_abrir', { p_slug: PV.slug, p_k: pv.qr_chave, p_id: null }, ip)).data.passe;
const chegar = async (nome, cpf, ip, lat) => pub('convidado_checkin', { p_slug: PV.slug, p_passe: await passeDe(ip), p_nome: nome, p_empresa: 'Empresa X',
  p_dados: { cpf, telefone: '92992001234', consentiu: true }, p_lat: lat, p_lng: -60.0, p_precisao: 15 }, ip);
r = await chegar('Pedro Longe Alves', '39053344705', '10.8.0.1', -3.3);
ok(r.data.erro === 'longe', 'barrado pela localização (longe)');
const bl = (await q(`select lat, lng, precisao, distancia_metros, cpf from checkin.bloqueios_geo where evento_id='${PV.id}'`))[0];
ok(bl && bl.lat === null && bl.lng === null && bl.precisao === null && bl.distancia_metros > 20000, 'bloqueio guarda só motivo e distância, NÃO a localização');
r = await pub('bloqueios_geo_painel', { p_slug: PV.slug, p_codigo: pv.codigo }, '10.8.0.2');
ok(r.data.length === 1 && r.data[0].nome === 'Pedro Longe Alves' && !('cpf' in r.data[0]) && !('telefone' in r.data[0]) && !('email' in r.data[0]) && !('lat' in r.data[0]) && !JSON.stringify(r.data).includes('39053344705'),
  'painel dos tablets vê o bloqueio sem CPF, contatos e localização');
r = await adm('obter_bloqueios_geo', { p_id: PV.id });
ok(r.data[0].cpf === '39053344705' && !('lat' in r.data[0]), 'organização (login) vê o CPF, mas não a localização');
r = await pub('obter_bloqueios_geo', { p_id: PV.id });
ok(r.error, 'sem login: não lê os bloqueios da organização');
// certificado
for (const [nome, cpf, ip] of [['Maria Clara Souza', '52998224725', '10.8.0.3'], ['Maria Clara Lima', '11144477735', '10.8.0.4']]) {
  r = await chegar(nome, cpf, ip, -3.1001);
  ok(r.data.ok, 'check-in pelo celular: ' + nome);
}
const cert = (chave, id) => pub('obter_certificado', { p_slug: PV.slug, p_chave: chave || '', p_id: id || null }, '10.8.0.9');
r = await cert('maria clara');
ok(r.data.multiplos && r.data.opcoes.length === 2 && r.data.opcoes.every((o) => o.pede_cpf === true && !('cpf' in o) && !('id' in o)) && !JSON.stringify(r.data).includes('52998224725'),
  'busca por pedaço do nome: lista nomes SEM CPF e sem id');
r = await cert('mar');
ok(r.data.erro === 'nao_encontrado', 'pedaço de nome com menos de 4 letras: não lista ninguém');
r = await cert('Maria Clara Souza');
ok(r.data.precisa_cpf === true && !r.data.codigo && !r.data.liberado && (await q(`select count(*) n from checkin.certificados where evento_id='${PV.id}'`))[0].n == 0,
  'nome exato de quem tem CPF: pede o CPF antes de emitir (nada emitido)');
r = await cert('111.444.777-35');
ok(r.data.ok && r.data.liberado && r.data.nome === 'Maria Clara Lima' && /^CERT-/.test(r.data.codigo) && !('cpf' in r.data) && r.data.cpf_parcial === '111.***.***-**', 'com o CPF completo: emite o certificado (sem o CPF inteiro na resposta)');
const COD_CERT = r.data.codigo, ID_MARIA = r.data.id;
ok((await cert(COD_CERT)).data.nome === 'Maria Clara Lima' && (await cert('', ID_MARIA)).data.liberado, 'pelo código CERT ou pelo id (link do próprio celular): emite');
for (let i = 1; i <= 7; i++) await pub('cadastrar_avulso', { p_slug: PV.slug, p_codigo: pv.codigo, p_nome: `Joana Teste ${i}`, p_empresa: '', p_dispositivo: 'T', p_dados: { consentiu: true } }, '10.8.0.10');
r = await cert('joana teste');
ok(r.data.erro === 'muitos', 'mais de 6 pessoas com o mesmo pedaço de nome: pede o nome completo');
r = await cert('Joana Teste 3');
ok(r.data.ok && r.data.liberado && r.data.nome === 'Joana Teste 3', 'quem não informou CPF (cadastro sem CPF): emite pelo nome exato');
await adm('excluir_evento', { p_id: PV.id });
