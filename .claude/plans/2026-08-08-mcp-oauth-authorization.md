# Autorização OAuth 2.1 do Servidor MCP

## Objective

Permitir que qualquer cliente MCP genérico (Claude, Cursor, etc.) se conecte ao
servidor MCP do StayHub pelo fluxo de autorização do MCP Authorization spec:
o cliente descobre o servidor de autorização, se registra dinamicamente, abre
uma página de login no navegador, o usuário aprova, e a conexão passa a
funcionar sozinha — sem ninguém copiar e colar token.

Hoje o `/mcp` só aceita o JWT de sessão do app, que expira em 1 dia e não tem
nenhum caminho de obtenção para um usuário final. Na prática isso torna a
feature MCP não entregável fora do ambiente do autor.

O StayHub passa a ser, ao mesmo tempo, **Resource Server** (o `/mcp`) e
**Authorization Server** (os endpoints de autorização), emitindo credenciais
próprias, com ciclo de vida e revogação independentes da sessão do app.

## Personas

- **Arquiteto** — análise de domínio e decisões arquiteturais (este documento)
- **Analista de Segurança** — **obrigatório e em duas passagens**: uma revisão de
  contrato antes da implementação (o desenho do fluxo é o próprio controle de
  segurança) e a revisão usual pós-implementação. Registro dinâmico aberto,
  redirect, emissão de credencial de longa duração e página de consentimento são
  todos superfície crítica.
- **Desenvolvedor** — implementação
- **Revisor** — revisão de aderência arquitetural

## Decisões do Usuário (2026-08-08)

1. **Conformidade completa com o spec** — discovery de metadata (RFC 9728 no
   resource server, RFC 8414 no authorization server), registro dinâmico de
   cliente (RFC 7591), PKCE obrigatório, `/authorize` e `/token`. Precisa
   funcionar com cliente MCP genérico, não com cliente pré-configurado.
2. **Página de login/consentimento vive no `stayhub-front`** — fora do escopo
   deste repositório. Este plano define apenas o contrato entre backend e front.
3. **Credenciais dedicadas** — o access/refresh token emitido ao cliente MCP é
   próprio, independente do JWT de sessão do app, com revogação independente.

---

## Análise de Negócio

**O que resolve.** Conectar um agente ao StayHub hoje exige extrair
manualmente o JWT de sessão e colá-lo na configuração do cliente MCP. O token
vale 1 dia (`expiresIn: "1d"`), então a conexão morre diariamente, e é a
credencial **completa** do app — quem a possui pode fazer qualquer coisa que o
usuário faz, inclusive fora do MCP. Não existe caminho para um proprietário
comum conectar o Claude à sua operação.

Depois: o usuário adiciona o servidor no cliente, o navegador abre, ele faz
login, aprova, e está conectado — permanentemente, via renovação automática, e
revogável por aplicativo.

**Por que vale um authorization server completo.** Três razões, nessa ordem:

1. **É o único caminho.** Clientes MCP não têm um mecanismo padrão de "cole
   aqui seu token" que funcione entre fornecedores. O que eles implementam é o
   fluxo do spec. Meio caminho (só `/authorize` sem discovery, ou só um cliente
   pré-registrado) não conecta o Claude nem o Cursor.
2. **Reduz raio de dano.** A credencial entregue ao agente deixa de ser a
   credencial do app. Passa a ser um segredo de propósito único, revogável
   isoladamente, auditável por aplicativo — postura correta também sob a LGPD,
   já que o agente é um terceiro processando dados pessoais de hóspedes.
3. **Custo é limitado e previsível.** O protocolo é fechado e especificado: não
   há ambiguidade de domínio a resolver, não toca nenhuma invariante de
   Booking/Finance/Property, e o volume é da ordem de meia dúzia de endpoints e
   quatro tabelas. A complexidade é real, mas é complexidade **essencial e
   padronizada** — não acidental.

---

## Análise de Domínio

### Bounded context: fica dentro de Auth, não vira BC próprio

A pergunta se impõe pelo volume, mas o critério de BC é **linguagem**, não
quantidade de arquivos. O vocabulário aqui — usuário, login, senha, sessão,
credencial, revogação — é literalmente o vocabulário do BC Auth. Todo conceito
novo pende de `User` a um salto de distância. Um BC próprio obrigaria a uma
tradução de contexto (um "principal" espelhando `User`) para nenhum ganho de
isolamento, e é exatamente o tipo de fronteira artificial que a persona existe
para evitar.

Decisão: **os novos conceitos vivem no BC Auth**, como um subdomínio interno —
"Acesso Delegado" — presente nas quatro camadas do módulo, agrupado para não
afogar os arquivos existentes.

Critério explícito de revisão futura: se o StayHub um dia expuser esses tokens a
integrações de terceiros **fora do MCP**, com escopos que governem capacidades
de negócio (ex.: "ler finanças" vs "reservar"), a linguagem passa a ser sobre
permissão de negócio e não sobre identidade — aí sim o subdomínio ganha
autonomia. Não é o caso agora.

### Linguagem Ubíqua

| Termo do domínio            | Significado                                                                                                                                                  | Termo técnico correspondente  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **Aplicativo Conectado**    | Um cliente MCP que se registrou e ao qual um usuário concedeu acesso. É o que aparece numa tela de "aplicativos conectados"                                  | OAuth Client + Grant          |
| **Registro de Aplicativo**  | O cadastro auto-declarado de um cliente: nome, URIs de retorno, método de autenticação. Não implica confiança nem acesso — é só uma identidade autodeclarada | Dynamic Client Registration   |
| **Pedido de Autorização**   | A intenção pendente de um aplicativo obter acesso, aguardando o usuário decidir. Efêmero (minutos)                                                           | Pending authorization request |
| **Consentimento**           | O ato do usuário de aprovar um aplicativo. É o que cria a relação de confiança e o que ele revoga depois                                                     | Consent / Grant               |
| **Código de Autorização**   | Comprovante de uso único e vida curtíssima de que o consentimento aconteceu, trocável por credenciais                                                        | Authorization Code            |
| **Credencial de Acesso**    | O segredo que o agente apresenta a cada chamada MCP. Vida curta                                                                                              | Access Token                  |
| **Credencial de Renovação** | O segredo que o agente usa para obter uma nova credencial de acesso sem incomodar o usuário. Vida longa, rotacionada a cada uso                              | Refresh Token                 |
| **Revogação de Acesso**     | O usuário desconecta um aplicativo; todas as credenciais daquele aplicativo deixam de valer imediatamente                                                    | Revocation                    |
| **Solicitante** (do MCP)    | Quem está chamando a tool: um usuário **através de** um aplicativo. Não é o usuário sozinho                                                                  | Principal / AuthInfo          |

Observação de linguagem: o termo "cliente" já é ambíguo no StayHub (hóspede,
proprietário, cliente HTTP). **Não usar "cliente" isolado** para o conceito
OAuth — a linguagem do produto é **aplicativo**.

### Agregados

- **Registro de Aplicativo** — raiz. Identidade autodeclarada + URIs de retorno
  (value objects) + método de autenticação. Invariante: URIs de retorno são
  imutáveis após o registro; alterar exige novo registro.
- **Consentimento** — raiz. Relação `(usuário, aplicativo)` com escopos
  concedidos, momento da concessão e último uso. É o agregado que o usuário
  gerencia e revoga. **A revogação do consentimento invalida, em cascata, todas
  as credenciais emitidas sob ele** — essa é a invariante central do subdomínio.
- **Credencial Emitida** — acesso e renovação, sob um consentimento. Ciclo de
  vida próprio (expiração, rotação, revogação individual).
- **Pedido de Autorização** e **Código de Autorização** — entidades efêmeras,
  com TTL, uso único, sem valor de negócio após consumidas.

### Invariantes novas

1. Um código de autorização é usado **uma única vez**. Segunda apresentação =
   comprometimento presumido → revogar o consentimento inteiro.
2. Uma credencial de renovação é rotacionada a cada uso; a apresentação de uma
   já rotacionada = comprometimento presumido → revogar a família.
3. Uma credencial só vale para o recurso a que foi vinculada na emissão
   (RFC 8707). O `/mcp` recusa credencial cuja audiência não seja ele.
4. Consentimento é **por aplicativo**. Ter consentido a um aplicativo nunca
   dispensa o consentimento a outro.
5. Revogado o consentimento, nenhuma credencial derivada sobrevive.

### Invariantes existentes

Nenhuma. Booking, Finance e Property Management não são tocados. `User`
permanece inalterado — os agregados novos o referenciam por id. A única mudança
de comportamento existente é o portão de autenticação do `/mcp`.

### Eventos de domínio

Nenhum novo evento é justificável agora: não há consumidor. "Aplicativo
conectado" e "acesso revogado" são candidatos naturais a evento no dia em que
existir auditoria ou notificação — registrado como dívida. O que **precisa**
existir desde já é o dado, não o evento: momento da concessão e último uso, que
é o que a tela de aplicativos conectados exibe.

---

## Riscos e Questionamentos

### Críticos

1. **Open redirect no `redirect_uri`.** O vetor mais explorado do fluxo. A URI
   apresentada deve bater por **igualdade exata de string** com uma URI
   registrada — sem prefixo, sem curinga, sem normalização, sem "mesmo host".
   E, decisivo: quando o `client_id` ou o `redirect_uri` forem inválidos, o
   servidor **não pode redirecionar** para lugar nenhum — tem que falhar
   exibindo o erro. Redirecionar nesse caso _é_ o open redirect. Todos os
   demais erros do `/authorize` voltam ao redirect já validado.

2. **Phishing por registro dinâmico.** Qualquer um registra um aplicativo
   chamado "StayHub Oficial" e envia o link de autorização à vítima. A tela de
   consentimento é a única defesa: precisa (a) tratar o nome como texto não
   confiável e não verificado, deixando isso visível ao usuário, (b) exibir com
   destaque o **host de destino** do redirect, que é o dado que o atacante não
   consegue disfarçar, e (c) escapar o nome — é conteúdo controlado por
   terceiro renderizado no navegador do usuário.

3. **Registro dinâmico aberto é superfície de abuso.** `/register` sem
   autenticação permite inflar a base indefinidamente. Mitigações necessárias:
   limite por origem e por janela de tempo, teto no número de URIs e no tamanho
   dos campos, e **expurgo de registros nunca usados** (um registro sem nenhum
   consentimento após N dias não tem razão de existir). Não existe hoje
   **nenhum** mecanismo de rate limiting no projeto — isso é uma capacidade nova
   e transversal, não um detalhe do OAuth (ver Decisões Pendentes).

4. **`/token` é oráculo de força bruta.** Rate limiting por `client_id` e por
   origem, e respostas de erro indistinguíveis entre "código não existe",
   "código expirou" e "código é de outro aplicativo".

5. **Segredos em repouso.** Códigos e credenciais são segredos de alta entropia
   e **não** podem ser gravados em claro — um dump do banco não pode render
   credencial utilizável. Guardar o digest, comparar o digest.

6. **Vazamento em log e URL.** O código de autorização trafega em query string,
   que é o lugar mais logado do mundo. Nenhum log pode conter URL completa dos
   endpoints de autorização, header `Authorization`, ou corpo do `/token`. O
   adaptador HTTP atual loga o objeto de erro inteiro em qualquer falha — isso
   precisa ser revisto antes de passar credencial por ali.

### Estruturais

7. **A autenticação do MCP está na camada errada.** Hoje `registerMcpTool`
   resolve a identidade **dentro do handler de cada tool**, e uma falha vira um
   resultado de tool com `isError`. Consequência direta: um token inválido ou
   expirado **nunca produz um 401** — e é exatamente o 401 com
   `WWW-Authenticate` que faz o cliente MCP disparar o fluxo de autorização.
   Sem essa mudança, o OAuth não é acionado na renovação: o agente vê uma
   mensagem de erro em texto e desiste. Autenticação pertence à fronteira de
   transporte, não a cada tool. Isso é um conserto arquitetural que a feature
   força, e é pré-condição de tudo.

8. **`WWW-Authenticate` conforme RFC 9728.** O 401 atual devolve um envelope
   JSON-RPC genérico e `WWW-Authenticate: Bearer` pelado — sem apontar o
   metadata, o cliente não sabe onde descobrir o authorization server. Precisa
   carregar `resource_metadata` com a URL do metadata do resource server, e o
   `error`/`error_description` apropriados. Vale tanto para ausência de
   credencial quanto para credencial inválida, expirada ou revogada.

9. **O adaptador HTTP não expressa o que o OAuth exige.** O adaptador atual
   sempre responde JSON com 200/204, só lê corpo JSON, e não emite header
   customizado nem redirect. O fluxo precisa de: `302` no `/authorize`, corpo
   `application/x-www-form-urlencoded` no `/token` e no `/revoke`, `201` no
   `/register`, corpo de erro no formato OAuth (`error`/`error_description`) com
   status próprio, e headers de cache. Ou o contrato de controller passa a
   admitir uma resposta HTTP explícita, ou nasce um segundo pipeline paralelo —
   a segunda opção duplica o mapeamento de erro e deve ser evitada.

10. **Confused deputy / consentimento silencioso.** Como o StayHub é o próprio
    provedor de identidade, o cenário clássico do spec (proxy para IdP terceiro)
    não se aplica. Mas o risco irmão aplica: aprovar automaticamente porque o
    usuário tem sessão no navegador. A **primeira** autorização de cada
    aplicativo exige interação explícita, sempre.

11. **Identidade do issuer.** `API_BASE_URL` é opcional hoje. O `issuer` do
    metadata precisa ser exato e estável, e HTTPS em produção — a variável passa
    a ser **obrigatória** fora de desenvolvimento. Divergência entre issuer
    anunciado e URL real quebra clientes que validam.

12. **CORS nos endpoints novos.** Clientes MCP em navegador buscam o metadata e
    chamam `/token` e `/register` via fetch. Os endpoints de descoberta precisam
    ser públicos e amplamente acessíveis, e o `/mcp` precisa **expor** o header
    `WWW-Authenticate` ao JavaScript — caso contrário o cliente não o lê. O
    middleware de CORS atual ecoa a origem e não devolve nada quando não há
    `Origin`; isso precisa ser explicitado para essas rotas.

### Questionamentos de modelagem

13. **Cliente público ou confidencial?** Registro dinâmico + aplicativo desktop
    = o segredo não é segredo. Recomendação forte: **somente clientes públicos**
    (`token_endpoint_auth_method: none`), com PKCE como única prova. Isso elimina
    de vez a pergunta "como guardar client secret" e é o que os clientes MCP de
    fato usam. Aceitar cliente confidencial adicionaria uma classe inteira de
    segredo para proteger, sem consumidor.

14. **Formato da credencial de acesso: opaca ou autocontida?** Autocontida
    (JWT) evita ida ao banco, mas revogação imediata deixa de ser possível — o
    que colide frontalmente com a decisão 3 do usuário ("revogação
    independente"). Recomendação: **opaca, com consulta indexada**. O caminho
    MCP já faz uma consulta por chamada para carregar o usuário; o custo
    marginal é irrelevante e a revogação passa a ser instantânea e verdadeira.

15. **Escopos.** Um escopo único cobrindo o MCP é suficiente para a v1 e mantém
    a tela de consentimento honesta ("este aplicativo poderá reservar estadias e
    lançar despesas em seu nome"). Um recorte leitura/escrita é desejável, mas
    só tem valor se as tools passarem a ser filtradas por escopo — o que é uma
    feature à parte. Ver Decisões Pendentes.

16. **O `McpIdentityResolver` aceita as duas credenciais, ou o token novo é
    trocado por um JWT?** Trocar por JWT está descartado: viola a decisão 3
    (o ciclo de vida voltaria a ser o da sessão do app) e injeta uma credencial
    completa do app dentro do agente. O resolver deve parar de conhecer JWT
    especificamente e passar a depender de uma abstração "verificar credencial
    do MCP → solicitante". O JWT de sessão vira apenas _uma_ implementação, de
    transição, e idealmente sai (ver Decisões Pendentes). O resolver também
    deve passar a devolver o **solicitante** (usuário + aplicativo + escopos),
    não só o usuário — as tools continuam recebendo `User`, mas o transporte
    ganha a identidade do aplicativo para log e auditoria.

---

## Decisões Arquiteturais

1. **Localização** — subdomínio "Acesso Delegado" **dentro do BC Auth**, nas
   quatro camadas. Sem BC novo. Sem lógica de OAuth em `src/core`.
2. **`src/core/infra/mcp` continua consumidor** — o transporte MCP não implementa
   autorização; depende da abstração de verificação de credencial exposta pelo
   BC Auth, exatamente como já depende de `MiddlewareDi` hoje.
3. **Container DI dedicado** — a verificação de credencial precisa ser montável
   sem instanciar o grafo inteiro de casos de uso do app, espelhando o split que
   já existe entre `AuthDi` e `MiddlewareDi`. Os endpoints de autorização e o
   verificador ficam em containers distintos.
4. **Autenticação sobe para a fronteira de transporte do `/mcp`** — o portão
   resolve o solicitante antes de instanciar o servidor MCP e responde 401 com
   `WWW-Authenticate` completo em qualquer falha. As tools recebem o solicitante
   já resolvido e deixam de fazer resolução própria.
5. **Credencial de acesso opaca**, digest em repouso, vida curta; renovação
   rotacionada com detecção de reuso; código de autorização de uso único e vida
   curtíssima; tudo pendurado no Consentimento, que é o ponto único de revogação.
6. **Somente clientes públicos com PKCE `S256` obrigatório.** `plain` e
   `code_challenge` ausente são rejeitados.
7. **O contrato de controller passa a admitir resposta HTTP explícita** (status,
   headers, corpo), preservando o comportamento atual de DTO→JSON como padrão.
   Um pipeline só.
8. **Descoberta** — o resource server publica seu metadata no caminho canônico
   e também na variante com o caminho do recurso anexado (é a que o cliente
   monta a partir da URL do `/mcp`); o authorization server publica o seu no
   caminho canônico. Ambos públicos, cacheáveis, sem autenticação.
9. **Vinculação ao recurso** — a credencial é emitida vinculada ao `/mcp` e o
   `/mcp` recusa credencial de outra audiência, ainda que AS e RS estejam no
   mesmo processo.

### Contrato com o `stayhub-front`

Princípio de desenho: **o front nunca vê nem manipula parâmetros OAuth.** Ele
recebe um identificador opaco e devolve uma decisão. Assim não há como induzir o
front a repassar um `redirect_uri` hostil, e não há nada para adulterar no
navegador.

1. O cliente MCP chama o `/authorize` com os parâmetros do spec
   (`response_type`, `client_id`, `redirect_uri`, `code_challenge`,
   `code_challenge_method`, `state`, `scope`, `resource`).
2. O backend valida tudo. Falha de `client_id`/`redirect_uri` → erro exibido,
   **sem redirect**. Demais falhas → redirect de erro para a URI já validada.
3. Sucesso → o backend grava um **Pedido de Autorização** com TTL curto e
   redireciona (302) para a página de consentimento do front, passando **apenas
   um identificador opaco do pedido**.
4. O front consulta o backend por esse identificador e recebe os dados de
   exibição: nome autodeclarado do aplicativo (não confiável), host de destino
   do redirect, descrição legível do acesso pedido, e se já existe consentimento
   anterior. Nada sensível, nenhum parâmetro OAuth.
5. O usuário se autentica. **Reaproveitar o login existente do app**: o front
   usa o mesmo endpoint de sign-in que já usa, e um usuário já logado nem
   precisa digitar a senha. Uma só implementação de verificação de credencial de
   usuário no sistema.
6. O front chama o backend para **aprovar** ou **negar** o pedido, autenticado
   como o usuário logado. O backend consome o pedido, registra/atualiza o
   Consentimento, emite o código de autorização e devolve **a URL de destino já
   montada** a partir da URI **registrada** — o front apenas navega até ela.
   Negar devolve a mesma URL com erro de acesso negado.
7. O cliente MCP troca o código no `/token` com o `code_verifier` e recebe as
   credenciais.

Pontos não negociáveis desse contrato: o pedido tem TTL e uso único; o
identificador é imprevisível; a URL final é sempre montada pelo backend a partir
do registro, nunca a partir de entrada do front; e a aprovação exige o usuário
autenticado no momento da decisão.

---

## Diretrizes para o Desenvolvedor

- Não implemente nada de OAuth em `src/core`. O subdomínio pertence ao BC Auth;
  `src/core/infra/mcp` apenas consome a abstração de verificação.
- Antes de qualquer endpoint, resolva a diretriz 4: mova a resolução de
  identidade do handler de tool para o portão de transporte do `/mcp`, e faça a
  falha virar 401 com `WWW-Authenticate` apontando o metadata. É o alicerce.
- O SDK MCP traz os schemas de validação das mensagens OAuth em módulos
  agnósticos de framework — reutilize-os. Os _handlers_ do SDK são Express e
  **não** servem a este projeto; não introduza Express.
- Trate a igualdade de `redirect_uri` como comparação de string bruta. Qualquer
  tentativa de ser esperto (normalizar, comparar host, aceitar prefixo) é bug de
  segurança.
- Separe com clareza os dois modos de erro do `/authorize`: o que redireciona e
  o que não redireciona. Errar isso é criar um open redirect.
- Nenhum segredo em claro no banco. Nenhuma URL de autorização, header de
  autorização ou corpo de `/token` em log.
- Todo campo de entrada dos endpoints novos com limite de tamanho e cardinalidade
  explícitos, e vocabulário fechado onde o spec fecha (`response_type`,
  `grant_type`, `code_challenge_method`, `token_endpoint_auth_method`).
- Respostas de erro no formato OAuth, com status próprio — não no formato de
  erro atual da API. Isso é contrato de protocolo, não estilo da casa.
- Prefira estender o contrato de controller a criar um segundo pipeline HTTP.
- Endpoints de descoberta: públicos, sem autenticação, cacheáveis, e com o
  `issuer` idêntico à URL pública real.
- Quando a diretriz esbarrar em impedimento técnico real, pare e volte ao
  Arquiteto antes de improvisar — especialmente em qualquer ponto que afrouxe
  validação de redirect, PKCE ou uso único.

---

## Mapped Changes

- **`src/auth/domain/`** (novo subdomínio) — entidades e repositórios do acesso
  delegado: registro de aplicativo, consentimento, pedido de autorização, código
  de autorização, credenciais emitidas. Invariantes de uso único, expiração,
  rotação e cascata de revogação.
- **`src/auth/application/`** (novo subdomínio) — casos de uso do fluxo: registrar
  aplicativo, iniciar autorização, consultar pedido pendente, aprovar/negar,
  trocar código por credenciais, renovar, revogar, listar e desconectar
  aplicativos conectados. Serviços de geração e digest de segredo.
- **`src/auth/infra/database/postgres_repository/`** — repositórios dos novos
  agregados.
- **`src/auth/infra/di/`** — container(s) do subdomínio; verificação de credencial
  montável isoladamente, separada do grafo dos casos de uso do fluxo.
- **`src/auth/presentation/`** — endpoints de autorização, token, registro,
  revogação, consulta/decisão do pedido pendente, e os dois documentos de
  metadata.
- **`src/core/infra/mcp/identity_resolver.ts`** — deixa de conhecer JWT
  especificamente; passa a depender da abstração de verificação e a devolver o
  solicitante (usuário + aplicativo + escopos).
- **`src/core/infra/mcp/routes.ts`** — o portão passa a autenticar de fato e a
  responder 401 conforme RFC 9728; o solicitante resolvido desce para as tools.
- **`src/core/infra/mcp/mcp_tool.ts`** / **`mcp_server.ts`** — tools recebem o
  solicitante já resolvido em vez de resolvê-lo por conta própria.
- **`src/core/presentation/controller/controller.ts`** e
  **`src/core/infra/http/adapters/http_controller_adapter.ts`** — contrato de
  resposta HTTP explícita (status/headers/corpo), leitura de corpo
  `x-www-form-urlencoded`, e revisão do log de erro para não vazar credencial.
- **`src/core/presentation/middleware/cors.middleware.ts`** — exposição de
  `WWW-Authenticate` e política própria para descoberta e endpoints do protocolo.
- **`src/core/infra/http/routes/routes.ts`** — montagem das rotas novas,
  incluindo os caminhos de descoberta.
- **`src/core/infra/database/drizzle/schemas/auth_schemas.ts`** — tabelas dos
  novos agregados, com índices por digest e por consentimento, e expiração.
- **`src/core/infra/config/environments.ts`** — `API_BASE_URL` obrigatória fora
  de desenvolvimento (identidade do issuer) e URL base do front de
  consentimento; parâmetros de tempo de vida das credenciais.
- **`src/core/`** (transversal) — primitiva de rate limiting, hoje inexistente no
  projeto (ver Decisões Pendentes, item 6).
- **`tests/auth/`, `tests/core/`** — cobertura do fluxo ponta a ponta e dos casos
  de abuso (redirect inválido, PKCE ausente, código reusado, credencial revogada,
  audiência errada).

---

## Tasks

1. **Decidir os pontos pendentes** — resolver as Decisões Pendentes abaixo com o
   usuário. Bloqueia o desenho de dados e o contrato do front.
   - Dependencies: none
2. **Revisão de contrato pelo Analista de Segurança** — revisar este documento
   (validação de redirect, modos de erro do `/authorize`, contrato do front,
   registro aberto, armazenamento de segredo) **antes** da implementação.
   - Dependencies: task 1
3. **Autenticação na fronteira do transporte MCP** — mover a resolução de
   identidade do handler de tool para o portão do `/mcp`; falha vira 401 com
   `WWW-Authenticate` conforme RFC 9728; tools passam a receber o solicitante já
   resolvido. Ainda sobre a credencial atual, sem OAuth.
   - Dependencies: none
4. **Contrato de resposta HTTP explícita** — controller pode devolver status,
   headers e corpo próprios; adaptador lê corpo form-urlencoded; log de erro
   deixa de expor credencial. Comportamento atual preservado por padrão.
   - Dependencies: none
5. **Modelo de dados do acesso delegado** — agregados, repositórios e tabelas:
   registro de aplicativo, consentimento, pedido de autorização, código,
   credenciais. Invariantes de expiração, uso único, rotação e cascata.
   - Dependencies: task 1
6. **Primitiva de rate limiting** — conforme decisão do item 6 das pendências.
   - Dependencies: task 1
7. **Documentos de descoberta** — metadata do resource server (caminho canônico
   e variante com o caminho do recurso) e do authorization server, públicos e
   cacheáveis, com issuer exato.
   - Dependencies: task 4
8. **Registro dinâmico de aplicativo** — validação estrita de URIs de retorno,
   método de autenticação restrito a cliente público, limites de tamanho e
   cardinalidade, expurgo de registros sem uso.
   - Dependencies: tasks 4, 5, 6
9. **Início da autorização e pedido pendente** — validação dos parâmetros, os
   dois modos de erro (com e sem redirect), criação do pedido com TTL e redirect
   para o front.
   - Dependencies: tasks 4, 5, 8
10. **Endpoints de consumo do front** — consulta do pedido pendente por
    identificador opaco (dados de exibição, nada sensível) e decisão de
    aprovar/negar autenticada, emitindo o código e devolvendo a URL de destino
    montada a partir do registro.
    - Dependencies: task 9
11. **Emissão e renovação de credenciais** — troca de código com verificação de
    PKCE, uso único com revogação em caso de reuso, rotação de renovação com
    detecção de reuso, vinculação ao recurso, digest em repouso.
    - Dependencies: tasks 5, 6, 10
12. **Revogação** — endpoint do protocolo e revogação por consentimento, com
    cascata sobre as credenciais derivadas.
    - Dependencies: task 11
13. **Verificação da credencial no `/mcp`** — o portão passa a aceitar a
    credencial nova (expiração, revogação, audiência) e o resolver passa a
    depender da abstração; destino do caminho legado conforme item 7 das
    pendências.
    - Dependencies: tasks 3, 11
14. **Gestão de aplicativos conectados** — listar e desconectar, para a tela do
    usuário (escopo conforme item 9 das pendências).
    - Dependencies: task 12
15. **Cobertura de testes de abuso** — redirect não registrado, erro que não pode
    redirecionar, PKCE ausente/`plain`, código reusado, renovação reusada,
    credencial revogada, audiência errada, pedido expirado.
    - Dependencies: task 13
16. **Fluxo ponta a ponta com cliente MCP real** — validar descoberta, registro,
    login, consentimento e reconexão com um cliente genérico.
    - Dependencies: tasks 13, 14, e a página de consentimento no `stayhub-front`
17. **Revisão de segurança pós-implementação** — Analista de Segurança sobre o
    código produzido.
    - Dependencies: task 16
18. **Revisão arquitetural** — Revisor sobre aderência de camadas e fronteiras.
    - Dependencies: task 16

> Tasks 3 e 4 podem rodar em paralelo e não dependem das decisões pendentes.
> Tasks 5 e 6 podem rodar em paralelo após a task 1. Task 7 é independente das
> tasks 8–12. A task 16 tem uma dependência externa a este repositório.

---

## Decisões Pendentes (bloqueiam a task 5 em diante)

1. **Somente clientes públicos?** Recomendação: sim — `token_endpoint_auth_method:
none` + PKCE, sem client secret. Elimina uma classe inteira de segredo.
2. **Credencial de acesso opaca ou autocontida (JWT)?** Recomendação: opaca. É a
   única forma de honrar "revogação independente"; o custo é uma consulta
   indexada por chamada, sobre um caminho que já consulta o banco.
3. **Escopos na v1: um só, ou recorte leitura/escrita?** Recomendação: um só. O
   recorte só tem valor se as tools forem filtradas por escopo, o que é uma
   feature à parte.
4. **Login no front: reaproveitar o sign-in existente, ou endpoint dedicado?**
   Recomendação: reaproveitar. Uma só verificação de senha no sistema, e usuário
   já logado aprova sem redigitar nada.
5. **Consentimento nas autorizações seguintes: sempre exibir, ou pular quando já
   houver consentimento vigente?** A primeira é sempre explícita (não negociável).
   Recomendação para as seguintes: pular, para a reconexão ficar transparente.
6. **Rate limiting: implementar agora no projeto, ou delegar à infraestrutura?**
   Não existe nada hoje. Se for delegado, precisa estar garantido antes de expor
   `/register` e `/token` publicamente — do contrário a feature nasce abusável.
7. **Manter o JWT de sessão como credencial válida no `/mcp` depois do OAuth?**
   Recomendação: manter apenas em desenvolvimento e remover em produção. Um
   caminho paralelo de autenticação é dívida de segurança permanente.
8. **Tempos de vida** — acesso, renovação, código de autorização e pedido
   pendente. Recomendação: acesso curto (ordem de uma hora), renovação longa com
   rotação, código de segundos, pedido de minutos.
9. **A tela de "aplicativos conectados" entra neste escopo, ou só os endpoints?**
   Sem ela, o usuário não tem como revogar — o que enfraquece a justificativa de
   segurança da feature.
10. **URL base do front de consentimento** — nova configuração; e confirmação de
    que `API_BASE_URL` passa a ser obrigatória fora de desenvolvimento.

---

## Dívidas Registradas (fora de escopo)

- Sem eventos de domínio para concessão e revogação de acesso; quando existir
  auditoria ou notificação, são os candidatos naturais.
- Sem trilha de auditoria das chamadas MCP (qual aplicativo agiu, quando, sobre
  o quê) — o dado de identidade do aplicativo passa a existir, mas não é
  registrado.
- Tools não são filtradas por escopo; o consentimento é tudo-ou-nada.
- Sem introspecção de token (RFC 7662) — desnecessária enquanto AS e RS forem o
  mesmo processo.
- Sem suporte a múltiplos recursos protegidos; a vinculação de audiência é
  implementada, mas só existe um recurso.
- As dívidas do plano do servidor MCP (`2026-08-07-servidor-mcp-stayhub.md`)
  permanecem abertas — em especial ausência de idempotência nas escritas e
  ausência de log/auditoria no caminho MCP.
