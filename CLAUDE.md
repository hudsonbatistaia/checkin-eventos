# Check-in de Eventos — documentação do sistema

Pasta: `PROJETOS IA\Check-in de Eventos`. Sistema **novo** (criado em 15/10/2026), multi-evento, que reaproveita as ideias do check-in do Prêmio IEL 2026. **Não mexer** no Prêmio IEL (pasta `checkin-iel`, skill `habilidades\checkin-eventos`, Render `checkin-premio-iel-2026`).

## Sobre o dono
- Hudson Batista. **Não é técnico.** Responder sempre em português (PT-BR), passo a passo e sem jargão.
- Explicar cada comando **antes** de pedir que ele rode. Só construir depois de um "pode", "faça" ou equivalente; cada etapa espera o "sim".
- Linguagem neutra de gênero nas telas e documentos ("a equipe", "quem chega", "a pessoa"; nada de "o convidado", "a recepcionista").
- Regras do servidor: `PROJETOS IA\Servidor\CLAUDE.md`.

## O que é
Um sistema onde a organização cria **eventos**. Cada evento tem:
- **Dados básicos:** nome, subtítulo, data, horário, local, mensagem de boas-vindas e modo do tablet (equipe de recepção **ou** totem de autoatendimento).
- **Identidade visual:** arte e logo (reduzidas no navegador), 4 cores (fundo início/fim, destaque, segundo destaque) sugeridas a partir da arte e ajustáveis, com prévia do tablet.
- **Listas:** "Presença confirmada" e "Sem confirmação" (fixas, renomeáveis) + **listas VIP com nome livre** (ex.: Autoridades, Finalistas, Palestrantes). Cada VIP tem cor, selo no tablet (liga/desliga), destaque no painel (bloco grande ou card), campo extra com nome livre (ex.: "Troféu que entrega") e aba própria no relatório.
- **Acesso dos tablets:** link `checkin.hbone.com.br/e/<evento>` + **código de 6 dígitos** (QR code da equipe já leva o código).
- **Funções do Prêmio IEL:** recepção com busca sem acento, confirmar com 1 toque e desfazer, cancelar entrada com 2 toques, cadastro na hora, mesma pessoa em várias listas = um check-in, sincronização entre tablets, painel ao vivo, relatório Excel, encerrar (só consulta).

## Decisões (15/10/2026)
- Público: eventos do IEL **e** produto da HbOne → sem marca fixa nos tablets. A área da organização usava a identidade HbOne; **em 18/10/2026 passou para a identidade IEL** (logo IEL, cores oficiais, tema claro/escuro sincronizado com o portal). Para vender como produto HbOne, vai precisar de uma cópia sem IEL (como foi feito com a Gestão de Processos).
- Acesso da organização integrado ao Portal Geral (18/10/2026): quem cria/configura eventos são os usuários com `admin_geral` (Hudson) ou com a permissão `checkin` marcada no painel de usuários do Portal Geral (`portal.usuarios` sincronizado com `checkin.admins`). Login com SSO transparente via portal e tela de login própria em `checkin.hbone.com.br`.
- Tablets e painel: **link + código** (sem login). Código errado 30 vezes em 10 min bloqueia aquele endereço por 10 min; trocar o código libera.
- Servidor HB + Supabase **hb-sistemas** (schema `checkin`), endereço `checkin.hbone.com.br`.
- Planilhas: escolher as colunas ao enviar + modelo Excel para baixar.
- Depois do evento: "Encerrar" (só consulta); o Hudson apaga quando quiser ("Apagar dados pessoais" guarda só os números; "Excluir evento" apaga tudo).

## Como funciona
Site estático (Caddy) + Supabase. **Nada é lido ou gravado direto nas tabelas**: tudo passa por funções do schema `checkin` (`supabase/01-banco.sql`).
- Organização: funções conferem login + `checkin.admins` (`exigir_admin`).
- Tablets: funções recebem `(slug, código)` e conferem em `checkin.acesso()`; devolvem `{erro: evento|codigo|bloqueado|encerrado|pessoa|nome}` em vez de falhar.
- Sincronização: o tablet chama `sincronizar(slug, código, versao, marca)` a cada poucos segundos. `eventos.versao` muda quando listas/configuração mudam; `eventos.marca` muda quando presenças mudam. Sem mudança, a resposta é curta.
- `pessoas.grupo` liga a mesma pessoa em listas diferentes (check-in é por grupo, como no Prêmio).

### Arquivos
| Arquivo | Papel |
|---|---|
| `site/index.html` + `js/admin.js` + `css/admin.css` | Área da organização (login, eventos, abas Dados / Identidade / Acesso / Operação) |
| `site/js/acesso.js` | Login (Supabase Auth, sessão na aba, sai após 60 min parado) |
| `site/js/comum.js` | Textos (norm, nomePadrao, bonita), datas e **tema**: `variaveisTema()` transforma as 4 cores em todas as variáveis de CSS, com contraste garantido |
| `site/js/lista.js` | Leitura de planilhas (linha dos títulos, sugestão de colunas, vários nomes por célula, cargo depois de " - ", títulos Sra./Dr.) e ligação da mesma pessoa entre listas (nome igual liga sozinho; parecido vai para conferência). Roda também no Node |
| `site/js/admin-listas.js` | Abas Convidados e Listas VIP: enviar planilha escolhendo aba/linha dos títulos/colunas, resumo e pares para conferir, incluir/editar/remover nomes, "Também em", modelo Excel, configuração das listas VIP |
| `site/js/imagens.js` | Reduz imagens (arte 1600 px, logo 600 px) e sugere cores da arte |
| `site/css/evento.css` | Visual da recepção, totem e painel (todas as cores por variável) |
| `site/previa.html` | Prévia do tablet usada na aba Identidade (recebe o tema por postMessage) |
| `site/evento.html` + `js/evento.js` | Link `/e/<evento>`: tela do código, recepção (equipe ou totem), cadastro na hora, nome do aparelho, boas-vindas do totem, modo encerrado. Painel (`#painel`) ao vivo |
| `site/js/config.js` | URL do Supabase e chave **publishable** (falta colar a chave real) |
| `site/vendor/` | supabase-js 2.45.4, xlsx-js-style 1.2.0, qrcode-generator 1.4.4 (sem CDN) |
| `supabase/01-banco.sql` | Banco completo (pode rodar de novo sem perder dados) |
| `supabase/02-usuarios.sql` | Libera o hudson@hbone.com.br como admin |
| `ferramentas/nova-versao.mjs` | Atualiza `?v=` dos .js/.css nas páginas. **Rodar antes de cada publicação** |
| `testes/` | Testes (ver abaixo) |

### Caddy (no ar desde 18/10/2026)
O link `/e/<evento>` precisa abrir `evento.html` e o do convidado `/q/<evento>/<chave>` abre `convidado.html`: no bloco do Caddy, `rewrite /e/* /evento.html` e `rewrite /q/* /convidado.html`. HTML sem cache longo (como nos outros sistemas).

## Testes
Rodar **fora do OneDrive**: copiar `testes/*.mjs` + `package.json` para uma pasta temporária, `npm install`, e:
- `node testar-sql.mjs` — banco e regras de acesso (144 verificações);
- `node testar-lista.mjs` — leitura de planilhas e ligação de pessoas (20 verificações);
- `node servidor-teste.mjs` (deixar aberto; reiniciar = banco limpo) e depois `node testar-telas.mjs` — telas no Edge (44 verificações, prints em `testes/telas/`); `node testar-listas.mjs` — abas Convidados e Listas VIP (35 verificações, gera planilhas de teste bagunçadas); `node testar-recepcao.mjs` — recepção com 2 tablets (aparelhos separados) e totem (51 verificações); `node testar-painel.mjs` — painel e relatório, abrindo o Excel gerado (31 verificações); `node testar-encerramento.mjs` — horário de encerramento, inclusive tablet com relógio errado (27 verificações); `node testar-aberto.mjs` — evento aberto com CPF, LGPD e relatório (37 verificações); `node testar-qr.mjs` — check-in pelo celular, tela cheia, cartazes (PDF em testes/telas) e localização (40 verificações); `node testar-privacidade.mjs` — painel de bloqueios e busca de certificado sem vazar CPF (16 verificações).
- Atalho: `bash rodar-telas.sh testar-telas.mjs testar-listas.mjs` sobe o servidor limpo para cada bateria.
**Para o Hudson testar sozinho:** dois cliques em `testar-no-computador.bat` (pasta do projeto). Ele copia os testes para %LOCALAPPDATA%checkin-eventos-teste, instala na primeira vez, abre a janela "Check-in de Eventos - servidor" e o navegador. Fechar a janela desliga e apaga os dados de teste. Se a porta 3999 estiver ocupada, avisa e para (não abre o navegador em outro sistema).
O servidor de teste serve o site em http://localhost:3999 (login `hudson` / `Senha-Hudson-123`) e imita o Supabase em http://localhost:3998.

## Andamento
- **Etapa 1 — FEITA (15/10/2026):** banco completo, login, eventos (criar, duplicar, excluir, encerrar/reabrir, zerar, apagar dados), dados básicos, identidade com cores sugeridas e prévia, acesso (link, código, QR, imprimir). 64 + 44 testes passando.
- **Etapa 2 — FEITA (16/10/2026):** abas Convidados (Presença confirmada e Sem confirmação, renomeáveis) e Listas VIP (criar, configurar cor/selo/destaque/campo extra/aba, apagar). Envio de planilha com escolha de aba, linha dos títulos e colunas; resumo (linhas sem nome, repetidos juntados, ligadas a outra lista, alerta se a planilha tem bem menos nomes); pares parecidos para conferir (marcados quando mesma empresa ou já ligados antes). Incluir nome pergunta se é a mesma pessoa de um nome parecido; editar mantém o grupo (presença não se perde). Modelo Excel por lista. 20 + 35 testes.
  - Ligação de pessoas: `Lista.prepararEnvio` + `finalizarEnvio` (junta em cadeia; o grupo final é o da outra lista, para presenças já marcadas continuarem valendo). `p_regrupar` do banco não é usado pelo site.
  - Corrigido: no Supabase real, função sem retorno devolve `null`; a janela tratava como "Cancelar". O servidor de teste agora imita isso.
- **Etapa 3 — FEITA (16/10/2026):** recepção nos tablets. 51 testes.
  - Código: digitado (6 números) ou vindo no QR (`?c=` no link, guardado no aparelho e tirado do endereço). Código trocado ou errado volta para a tela do código explicando; 30 erros = "Muitas tentativas".
  - Guardado no aparelho (localStorage, por evento): código, nome do aparelho e cópia da arte/logo.
  - Sincroniza a cada 3 s (15 s com a aba escondida) com `sincronizar(versao, marca)`; mudança de configuração (ex.: virar totem, encerrar) chega sozinha aos tablets abertos.
  - Equipe: busca sem acento, selos das listas VIP com selo ligado (faixa lateral com as cores), campo extra ("Troféu: Ouro"), etiqueta "Sem confirmação", confirmar + Desfazer, cancelar com 2 toques, cadastrar agora com aviso de nome parecido, últimas chegadas. Lista com selo desligado não aparece no tablet.
  - Totem: chamada "Digite seu nome…", busca a partir de 3 letras, até 8 resultados, "Sou eu", sem horário/tablet de ninguém, sem menu e sem chegadas; tela "Boas-vindas, <primeiro nome>!" com a mensagem do evento (6 s ou toque); "Não encontrei meu nome" (cadastro pela própria pessoa).
  - Encerrado: aviso, sem Confirmar/Cadastrar, "Não compareceu". Sem conexão: aviso e indicador; volta sozinho.
- **Etapa 4 — FEITA (16/10/2026):** painel ao vivo e relatório Excel. 31 testes.
  - `js/presenca.js` (comum a recepção, painel, relatório e organização): monta grupos/presença a partir dos dados compactos do banco; `itensDaLista` (pessoa VIP que chegou como cadastro na hora com nome igual/parecido conta como presente); `numeros` (total, confirmações, sem confirmação).
  - Painel (`#painel` do link do evento): total + % de quem confirmou; blocos grandes das listas VIP "bloco" (com campo extra; lista sigilosa aparece aqui), cards "X de Y" das listas "card"; números; Chegaram (selos de todas as listas VIP, "na hora", "sem confirmação", Desfazer com 2 toques) e "Confirmaram e faltam chegar" (vira "não vieram" quando encerrado); filtro; guarda rolagem e "Ver nomes" aberto entre atualizações.
  - `js/relatorio.js`: abas Resumo (geral, por lista VIP, horários, meia hora, por tablet), Presentes, Ausentes, uma por lista VIP com "aba no relatório" (com a coluna do campo extra), Por empresa. Cor do relatório = fundo do evento escurecido. Botão no painel e na aba Operação da organização (busca dados frescos).
  - Textos neutros: "Confirmaram e vieram", "Cadastros na hora", "Comparecimento de quem confirmou".
- **Encerramento automático do check-in — FEITO (16/10/2026, pedido do Hudson).** 9 testes de banco + 27 de tela (`testar-encerramento.mjs`).
  - Banco: coluna `eventos.encerra_em`; função `checkin.encerramento(ev)` = `encerrado_em` (botão) ou `encerra_em` se já passou. Vale para tudo que grava (confirmar, desfazer, cadastrar, remover). `sincronizar` sempre devolve `encerrado`, `encerramento` e `agora` (hora do servidor). Reabrir (`encerrar_evento(false)`) apaga também `encerra_em`.
  - Organização: aba Dados, campo "Encerrar o check-in automaticamente em" (data e hora; "usar a data do evento" sugere 22:00; "sem horário"; mostra quanto falta). Cabeçalho: "Aberto · encerra hoje às 21:00" / "Check-in encerrado às 21:00". Operação: "Encerrar check-in" / "Reabrir check-in" e, se encerrou pelo horário, "Adiar horário". A tela confere o horário sozinha a cada 15 s.
  - Tablets: acompanham o relógio do servidor (relógio errado do tablet não importa).
- **Evento aberto (cadastro na entrada) — FEITO (16/10/2026, pedido do Hudson).** 14 testes de banco + 37 de tela (`testar-aberto.mjs`).
  - Decisões: campos Nome completo (sempre), Empresa, CPF, Data de nascimento, E-mail, Telefone e até 5 com nome livre (x1..x5), cada um obrigatório ou não; aviso de LGPD com caixinha obrigatória quando pede algo além de nome/empresa (texto padrão editável por evento); CPF repetido no evento = bloqueado ("Este CPF já fez check-in às …"); **CPF, nascimento, e-mail, telefone e campos livres só no relatório da organização** — os tablets nunca recebem (teste confere as respostas do servidor).
  - Banco: `eventos.aberto/campos/lgpd_texto`; `avulsos.cpf/nascimento/email/telefone/extras/consentiu_em` + índice único (evento, cpf); `cpf_valido`, `campos_validos`; `cadastrar_avulso(..., p_dados jsonb)` confere tudo (erros `campo` com mensagem, `consentimento`, `cpf_repetido`); `obter_evento` devolve `cadastros` (só organização).
  - Os campos valem também para o "Cadastrar agora" dos eventos com lista (padrão: só empresa, sem LGPD).
  - Tablet: formulário montado pelos campos do evento, com máscaras (CPF, data dd/mm/aaaa, telefone) e conferência antes de enviar. No evento aberto o formulário fica fixo na recepção ("Novo check-in", botão "Limpar"), a busca vira "Conferir quem já entrou"; totem: "Faça seu check-in" sem busca. Listas VIP continuam funcionando.
  - Painel do evento aberto: presentes, última meia hora, pico, empresas diferentes, coluna "Por empresa".
- **Check-in pelo celular (QR dos convidados) — FEITO (16/10/2026, pedido do Hudson).** Só no evento aberto. 33 testes de banco + 40 de tela (`testar-qr.mjs`).
  - Link do convidado `/q/<slug>/<chave>` → `convidado.html` + `js/convidado.js` (**Caddy: `rewrite /q/* /convidado.html`**). Só faz o próprio check-in; nunca recebe nomes, lista ou as coordenadas do evento.
  - Banco: `eventos.abre_em, qr_chave, qr_rotativo, geo_ativo, geo_lat, geo_lng, geo_raio`; tabela `qr_registros`. `convidado_abrir` confere evento aberto, abertura, encerramento e chave (fixa, ou do minuto atual/anterior se `qr_rotativo`) e entrega um **passe de 20 min** assinado com a chave (trocar o QR invalida tudo). `convidado_checkin`: passe, limite 3 check-ins/15 tentativas por IP em 10 min, localização (servidor calcula a distância: raio + tolerância de até 100 m; precisão > 1 km = imprecisa; a posição não é guardada), **CPF sempre obrigatório** e depois o mesmo `registrar_cadastro` dos tablets (dispositivo "Celular (QR)"). `qr_atual` (com código da equipe) dá o QR do momento para a tela cheia. `novo_qr_convidados` troca a chave.
  - Celular: formulário (`js/formulario.js`, o mesmo módulo do tablet), aviso de LGPD (+ frase da localização), comprovante com marca animada e relógio correndo, guardado no aparelho (reabre o comprovante). Recusas explicadas: QR vencido, ainda não abriu, encerrado, longe/sem localização ("faça o check-in na recepção"), muitas tentativas, tempo esgotado.
  - Tela cheia: link do evento com `#qr` (sem cabeçalho, sem pedir nome do aparelho); com "muda a cada minuto", barra de tempo.
  - Organização, aba Acesso → "QR para os convidados": abertura, "QR muda a cada minuto" (desativa cartazes), "Conferir localização" (coordenadas coladas ou "usar minha localização atual", "ver no mapa", raio 100 m–2 km), cartaz A4, meia folha (2 por A4), tela cheia, copiar link, trocar QR. Relatório: "Pelo celular (QR)". Relatório: sem "Confirmaram"/Ausentes; o da organização tem as colunas do cadastro + "Aceite LGPD". Faixa "O check-in encerra às 21:00 (em 10 min)" nos últimos 15 min; no horário, recepção e totem viram a tela "Check-in encerrado" com botão "Ver painel"; painel travado (sem Desfazer). O botão manual mostra a mesma tela.
- **Certificado de participação — FEITO entre 16 e 18/10/2026 (em outra conversa; já estava no primeiro envio ao GitHub).** Sem testes automáticos.
  - Organização: aba **Certificados** — liga/desliga, texto com `{nome}`, `{evento}`, `{data}`, `{horas}`, carga horária, emissor, assinatura (nome, cargo e imagem) e horário de liberação (vazio = libera assim que a presença é confirmada).
  - Banco: colunas `eventos.certificado_*`; tabela `checkin.certificados` (código `CERT-XXXX-XXXXXXXX`, nome, empresa, CPF, horas). `obter_certificado(slug, chave, id)` (público) busca por id, código CERT, CPF, nome exato ou nome parcial; `validar_certificado(codigo)` (público) confere a autenticidade; `obter_presentes_certificado(evento)` (organização).
  - Celular: no comprovante aparecem "Certificado de participação", "Salvar/Enviar link no meu WhatsApp" e, depois de liberado, "Baixar meu Certificado (PDF)". Link do evento ganhou as telas `#certificado` (baixar pelo nome/CPF/código) e `#validar`. Layout do certificado com as cores e a logo do IEL.
  - Envio automático por e-mail: só planejado (Amazon SES, ver Roadmap).
- **Etapa 5 — PUBLICADO em 18/10/2026 (em outra conversa).** No ar em **https://checkin.hbone.com.br** (conferido em 19/10: responde 200). Repositório `github.com/hudsonbatistaia/checkin-eventos` (a pasta do projeto inteira é o repositório; o site é a subpasta `site/`). `site/js/config.js` já tem a chave publishable do hb-sistemas.
  - `supabase/02-usuarios.sql` foi reescrito: libera o Hudson, cadastra o Check-in no catálogo do Portal (`portal.sistemas`, código `checkin`) e liga o painel de usuários do Portal a `checkin.admins` (`portal.sincronizar_perfis` / `portal.aplicar_acessos`). Quem tem "Check-in de Eventos" marcado no Portal (ou é admin geral) entra na organização.
  - Login (`js/acesso.js`): tela própria + entrada transparente vinda do Portal (`#access_token=` no endereço ou cookie `sb_auth_token` de `.hbone.com.br`); "Sair" volta ao portal.
- **Ajustes de 18/10/2026 (outra conversa, 10 envios entre 12:29 e 16:00):**
  - Identidade IEL na organização (logo, faixa de destaque, vitrine de recursos, rodapé), tema claro/escuro sincronizado com o portal.
  - Cards dos eventos mostram a logo ou a arte do evento; degradê nas cores IEL; emissor padrão do certificado.
  - **Registro de bloqueios por localização** (`supabase/03-bloqueios-geo.sql`, também incorporado ao `01-banco.sql`): tabela `checkin.bloqueios_geo` (nome, empresa, CPF, telefone, e-mail, motivo, distância, latitude/longitude, IP); `convidado_checkin` grava cada recusa por localização; listagem na organização (`obter_bloqueios_geo`) e no painel (`bloqueios_geo_painel`). Relatório ganhou esses dados.
  - Prévia ao compartilhar o link (imagem `site/img/preview-compartilhamento.jpg`, título e descrição).
  - Correção: a tela não pula mais para o topo ao salvar o QR dos convidados.
- **Os testes automáticos não foram atualizados depois de 16/10** (pasta `testes/`): certificado, bloqueios por localização, integração com o portal e as mudanças visuais não têm teste. Antes de mexer de novo, rodar todas as baterias para ver o que mudou.

## Correções de privacidade (19/10/2026)
Achadas ao atualizar esta documentação (contrariavam as decisões de 16/10: dados sensíveis só no relatório da organização; localização não guardada) e **corrigidas no mesmo dia** com o "pode" do Hudson. Arquivo para o Supabase: `supabase/04-privacidade.sql` (só as funções corrigidas + limpeza; pode rodar de novo). O `01-banco.sql` e o `03-bloqueios-geo.sql` já estão corrigidos.
1. **Painel dos tablets** (`bloqueios_geo_painel`, com o código do evento) recebia CPF, telefone, e-mail e latitude/longitude de quem foi barrado pela localização. Agora recebe só nome, empresa, motivo, distância, raio e horário. CPF e contatos continuam só na organização (`obter_bloqueios_geo`, com login) e no relatório dela.
2. **Localização da pessoa barrada era guardada** (`bloqueios_geo.lat/lng/precisao`) apesar do texto "não é guardada". `convidado_checkin` não grava mais; o `04` apaga as já guardadas. Ficam motivo e distância. Organização e relatório sem coluna/link de mapa.
3. **Busca pública do certificado** (`obter_certificado`, só com o link do evento) devolvia CPF completo de várias pessoas na busca por pedaço de nome. Agora: nunca devolve CPF nem id na lista de opções (só nome, empresa e `pede_cpf`); pedaço de nome exige 4 letras ou mais e no máximo 6 resultados (`erro: muitos`); achando só pelo nome alguém que tem CPF, devolve `precisa_cpf` e só emite com o CPF completo (conferido no banco — antes a conferência dos "3 primeiros dígitos" era só na tela); "estava na lista mas não veio" só com o nome exato. Quem fez cadastro sem CPF (listas, cadastro sem CPF) segue emitindo pelo nome exato. Id (link do próprio celular), código CERT e CPF continuam emitindo direto.
4. `03-bloqueios-geo.sql` liberava `obter_bloqueios_geo` para `anon`; alinhado com o `01` (só `authenticated`).
Testes: 14 novos no `testar-sql.mjs` (2 antigos ajustados: "Ana" → "Ana Sou"; "Bruno" → "Bruno Lima") e `testar-privacidade.mjs` (16, no navegador: painel sem CPF/mapa, respostas do servidor sem CPF, busca por nome pedindo CPF completo).

## Sugestões de mercado para o futuro (Roadmap)
1. **Impressão instantânea de crachás / etiquetas:** ao confirmar no tablet, imprimir etiqueta em impressora térmica sem fio.
2. **Leitor de QR Code no crachá ou convite:** ler o QR individual do participante pela câmera do tablet.
3. **Disparo de mensagem de boas-vindas (WhatsApp / E-mail):** envio automático de mensagem com programação logo após o check-in.
4. **Emissão e envio automático de certificados e notificações:**
   - **Provedor escolhido (18/10/2026):** **Amazon SES** (Simple Email Service). Custo por volume (US$ 0,10 / 1.000 e-mails) sem mensalidade fixa. Atenderá Check-in de Eventos e todos os demais sistemas da HbOne (Contratos, Viabilidade, Portal, etc.).


