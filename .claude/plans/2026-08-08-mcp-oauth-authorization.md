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
4. **Rate limiting é implementado agora, no código** — não delegado à
   infraestrutura.
5. **O JWT de sessão deixa de ser credencial válida no `/mcp`, por completo** —
   sem carve-out por ambiente, nem em desenvolvimento. Justificativa do usuário:
   a branch `feat/mcp-server` ainda não foi mergeada em `main`, então não há
   ninguém em produção dependendo do JWT como credencial do MCP. O OAuth
   substitui o mecanismo inteiro, sem período de convivência.
6. **A tela de "aplicativos conectados" entra no escopo** — listar e desconectar,
   incluindo a implementação no `stayhub-front`.

> Os demais pontos que o Arquiteto levantou foram decididos conforme as
> recomendações deste documento — ver **Decisões Resolvidas** ao final.

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
   comprometimento presumido → revogar a **família de credenciais originada
   daquele código**. _(Corrigido pela revisão de contrato: a versão anterior
   desta invariante mandava revogar o Consentimento inteiro — ver E4, é vetor de
   negação de serviço.)_
2. Uma credencial de renovação é rotacionada a cada uso; a apresentação de uma
   já rotacionada, **fora da janela de graça**, = comprometimento presumido →
   revogar a família (ver E4).
3. Uma credencial só vale para o recurso a que foi vinculada na emissão
   (RFC 8707). O `/mcp` recusa credencial cuja audiência não seja ele.
4. Consentimento é **por aplicativo**. Ter consentido a um aplicativo nunca
   dispensa o consentimento a outro.
5. Revogado o consentimento, nenhuma credencial derivada sobrevive.
6. O Consentimento só é revogado por **ação explícita do usuário** ou por
   expiração (absoluta ou por inatividade) — nunca como reação automática a
   suspeita de reuso de credencial.
7. Toda transição de uso único (código, renovação, pedido de autorização) é uma
   **reivindicação atômica no banco**, nunca leitura seguida de escrita.

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
   e transversal, não um detalhe do OAuth. **Decidido: implementar no código**,
   não delegar à infraestrutura. Consequência: a primitiva nasce genérica e
   passa a ser um bem de toda a API, não um acessório do OAuth — mas também
   nasce por processo, o que é uma limitação real a registrar (ver Dívidas).

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

### Questionamentos de modelagem (todos resolvidos — ver Decisões Resolvidas)

13. **Cliente público ou confidencial?** Registro dinâmico + aplicativo desktop
    = o segredo não é segredo. **Resolvido: somente clientes públicos**
    (`token_endpoint_auth_method: none`), com PKCE como única prova. Elimina de
    vez a pergunta "como guardar client secret" e é o que os clientes MCP de
    fato usam. Registro que declare cliente confidencial é **rejeitado**.

14. **Formato da credencial de acesso: opaca ou autocontida?** Autocontida
    (JWT) evita ida ao banco, mas revogação imediata deixa de ser possível — o
    que colide frontalmente com a decisão 3 do usuário ("revogação
    independente"). **Resolvido: opaca, com consulta indexada.** O caminho MCP
    já faz uma consulta por chamada para carregar o usuário; o custo marginal é
    irrelevante e a revogação passa a ser instantânea e verdadeira.

15. **Escopos.** **Resolvido: escopo único na v1.** Cobre todo o MCP e mantém a
    tela de consentimento honesta ("este aplicativo poderá reservar estadias e
    lançar despesas em seu nome"). Um recorte leitura/escrita só teria valor se
    as tools passassem a ser filtradas por escopo — feature à parte, registrada
    como dívida.

16. **O `McpIdentityResolver` aceita as duas credenciais, ou o token novo é
    trocado por um JWT?** Trocar por JWT estava descartado desde o início: viola
    a decisão 3 (o ciclo de vida voltaria a ser o da sessão do app) e injeta uma
    credencial completa do app dentro do agente. **Resolvido, e mais forte do
    que o recomendado: o JWT de sessão sai por completo do `/mcp`**, sem
    convivência nem carve-out por ambiente — a branch `feat/mcp-server` não está
    mergeada, então não há compatibilidade a preservar.

    Consequências arquiteturais desta decisão, que são boas:
    - O resolver depende de **uma** abstração de verificação de credencial, com
      **uma** implementação. Sem cadeia de tentativas, sem ambiguidade sobre
      qual credencial autenticou a chamada, sem ramo condicional por ambiente —
      e portanto sem o clássico "em dev funciona de outro jeito".
    - Não existe caminho paralelo de autenticação para auditar depois. Um
      segundo mecanismo de autenticação sobre o mesmo recurso é dívida de
      segurança permanente; nunca chega a nascer.
    - O resolver passa a devolver o **solicitante** (usuário + aplicativo +
      escopos), não só o usuário. As tools continuam recebendo `User`, mas o
      transporte ganha a identidade do aplicativo para log e auditoria — algo
      que o JWT de sessão, por definição, nunca poderia fornecer.

    Custo a assumir explicitamente: **o desenvolvimento local do MCP passa a
    exigir o fluxo OAuth completo**. Não há mais "gera um JWT e testa". Os
    testes existentes do caminho MCP (`tests/core/`) autenticam com JWT e
    **precisam ser reescritos** para emitir credencial OAuth — isso não é
    ajuste cosmético de teste, é parte do escopo da task de troca.

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
10. **A credencial OAuth é o único mecanismo de autenticação do `/mcp`** — o
    verificador de JWT de sessão é **removido** desse caminho, não desativado
    por configuração. Um só mecanismo, sem ramo por ambiente.
11. **Rate limiting é uma primitiva de `src/core`, genérica** — não uma regra
    embutida nos endpoints OAuth. Ela é aplicada na fronteira HTTP, por política
    declarada na rota, para poder ser reaproveitada por qualquer endpoint
    (o sign-in do app é candidato imediato, mas fora do escopo desta feature).
    A contagem é por processo — limitação aceita conscientemente (ver Dívidas).
12. **A gestão de aplicativos conectados é do BC Auth e usa a autenticação do
    app** — listar e desconectar são operações do usuário no produto,
    autenticadas pela sessão normal do app, **nunca** pela credencial OAuth.
    Um aplicativo conectado não pode se auto-gerenciar nem enxergar os demais:
    isso fecharia o ciclo de privilégio que a revogação existe para quebrar.

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

Na **reconexão** (o aplicativo já tem consentimento vigente do mesmo usuário e
pede o mesmo acesso), o passo 4–6 é dispensado: havendo sessão de app válida, o
backend emite o código e redireciona direto. É isso que faz a renovação parecer
instantânea, como nos MCPs de referência. A **primeira** autorização de cada
aplicativo nunca é dispensada.

### Contrato com o `stayhub-front` — tela de aplicativos conectados

Segunda entrega no front, decidida como parte desta feature. É o par obrigatório
do consentimento: sem ela, o usuário concede acesso e não tem como retirá-lo.

1. O front lista os aplicativos conectados do usuário, autenticado pela **sessão
   normal do app** — nunca pela credencial OAuth. Cada item traz nome
   autodeclarado do aplicativo (novamente, tratado como não confiável e
   escapado), momento da concessão e último uso.
2. Desconectar revoga o Consentimento e, em cascata, todas as credenciais
   derivadas. Efeito imediato: a próxima chamada do agente recebe 401.
3. A lista mostra apenas os aplicativos **do próprio usuário**. O escopo por
   usuário é invariante de autorização, não filtro de conveniência.

---

## Especificação de Segurança do Protocolo

Origem: revisão de contrato do Analista de Segurança (2026-08-08), 5 achados
críticos e 9 moderados sobre este plano. O achado crítico de LGPD (minimização
de dado de hóspede) foi **deferido por decisão do usuário** e está registrado em
Dívidas — não é reaberto aqui. Os demais estão fechados como especificação
abaixo.

Esta seção é **normativa**. Não é contexto: é o comportamento exigido. Onde ela
conflitar com o texto mais acima, ela prevalece.

### E1. Fonte única de parâmetro

Cada endpoint do protocolo lê seus parâmetros de **uma única fonte**:

| Endpoint     | Fonte única                          |
| ------------ | ------------------------------------ |
| `/authorize` | apenas query string (método `GET`)   |
| `/token`     | apenas corpo `x-www-form-urlencoded` |
| `/revoke`    | apenas corpo `x-www-form-urlencoded` |
| `/register`  | apenas corpo JSON                    |

Regras:

1. Parâmetro presente em fonte diferente da declarada é **ignorado** — nunca
   mesclado, nunca usado como fallback.
2. Parâmetro **duplicado dentro da própria fonte** (mesma chave duas vezes na
   query ou no corpo form) faz a requisição **falhar imediatamente**, antes de
   qualquer validação semântica e antes de qualquer decisão sobre redirect.
3. A detecção de duplicata tem que inspecionar **todas as ocorrências**. Colapsar
   a query num objeto — que é o que o parser atual faz — descarta duplicatas
   silenciosamente e deixa passar exatamente o ataque que esta regra existe para
   impedir.

Por quê isso é crítico: se uma camada valida a primeira ocorrência de
`redirect_uri` e outra usa a última na hora de montar o redirect, o resultado é
um open redirect que passa por toda a validação. É o mesmo raciocínio para
`client_id`, `scope` e `resource`.

Consequência direta para a task 4: o adaptador HTTP atual mescla `query`, `body`
e `params` num objeto só, com precedência silenciosa. **As rotas do protocolo
não podem usar esse merge.** O contrato de controller precisa permitir declarar
a fonte dos parâmetros.

### E2. Ordem de validação do `/authorize`

Dois modos de erro, e a distinção entre eles é o controle de segurança:

- **Modo A — sem redirect.** Renderiza um erro. Não navega para lugar nenhum.
  Vale enquanto **não houver** um `redirect_uri` comprovadamente pertencente a
  um aplicativo registrado.
- **Modo B — com redirect.** `302` para a URI já validada, com `error`,
  `error_description` e `state` ecoado literalmente.

Ordem exaustiva. O primeiro passo que falha determina a resposta:

| #   | Verificação                                                       | Falha → | Erro OAuth                  |
| --- | ----------------------------------------------------------------- | ------- | --------------------------- |
| 0   | Limite de taxa não atingido                                       | Modo A  | `429`, sem corpo OAuth      |
| 1   | Método é `GET`; parâmetros só na query; sem duplicatas (E1)       | Modo A  | `invalid_request`           |
| 2   | `client_id` presente e bem formado                                | Modo A  | `invalid_client`            |
| 3   | Registro do aplicativo existe **e não foi expurgado nem expirou** | Modo A  | `invalid_client`            |
| 4   | `redirect_uri` **presente**                                       | Modo A  | `invalid_request`           |
| 5   | `redirect_uri` casa com uma das registradas (E3)                  | Modo A  | `invalid_request`           |
| —   | _A partir daqui existe destino confiável. Tudo abaixo é Modo B._  | —       | —                           |
| 6   | `response_type` é exatamente `code`                               | Modo B  | `unsupported_response_type` |
| 7   | `code_challenge` presente e `code_challenge_method` é `S256`      | Modo B  | `invalid_request`           |
| 8   | `scope` contido no escopo suportado                               | Modo B  | `invalid_scope`             |
| 9   | `resource` presente e igual à URL canônica do `/mcp`              | Modo B  | `invalid_target`            |
| 10  | `state`, se presente, dentro do limite de tamanho                 | Modo B  | `invalid_request`           |
| 11  | Sucesso → cria o Pedido de Autorização e redireciona para o front | —       | —                           |

Casos que faltavam e agora são explícitos:

- **`redirect_uri` ausente (passo 4)** — é Modo A, e **não** existe o atalho
  "usa a única URI registrada". Ausência é erro, não inferência.
- **Registro expurgado (passo 3)** — o expurgo de registros sem uso (E9) cria a
  janela em que um `client_id` existiu e não existe mais. Tem que cair em Modo A,
  como qualquer `client_id` desconhecido.
- **Pedido já consumido ou expirado, no momento da aprovação** — **Modo A, na
  tela do front**. Não redireciona para o cliente. O Pedido é a única prova de
  que a validação aconteceu; morto o Pedido, a prova não vale, e redirecionar com
  base nele é replay. O usuário reinicia o fluxo pelo cliente MCP.

Requisitos da tela de erro do Modo A:

- **Sem link, sem botão de navegação, sem `<a>`.**
- **Sem redirecionamento de qualquer natureza** — nada de `Location`, meta
  refresh ou navegação por JavaScript.
- O valor recusado **não é renderizado de forma navegável nem clicável**.
  Preferencialmente não é renderizado: basta o motivo. Se for exibido, é texto
  escapado e inerte.

Razão: a tela do Modo A existe precisamente porque não há destino confiável.
Qualquer coisa navegável nela reintroduz o open redirect por outra porta — o
atacante deixa de precisar do `302` e passa a precisar de um clique.

### E3. Comparação de `redirect_uri`

**Representação.** A URI é armazenada **exatamente como veio no registro**, como
string. Sem normalização de nenhum tipo: sem lowercase de host, sem remover
porta padrão, sem resolver `.`/`..`, sem reordenar query, sem re-encode.

**Comparação.** Igualdade `===` entre a string registrada e o valor **já
decodificado uma vez pela camada HTTP**. Não decodificar de novo (double-decode
é vetor), não normalizar nenhum dos dois lados, não comparar por partes.

**Rejeição no registro.** O `/register` recusa a URI que:

- for relativa (sem esquema);
- contiver fragmento (`#`);
- usar esquema perigoso: `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`;
- embutir credenciais (`usuario:senha@host`);
- contiver curinga em qualquer posição;
- usar `http://` com host que não seja loopback.

**Loopback.** `http://` é aceito apenas para `127.0.0.1`, `[::1]` e `localhost`.
Aceitar `localhost` é decisão consciente de interoperabilidade — vários clientes
MCP reais o usam — com o risco residual registrado: a resolução de `localhost`
depende do resolvedor da máquina. As formas por IP literal são preferíveis.

**Porta de loopback variável — único afrouxamento da igualdade exata.** Cliente
nativo escolhe uma porta livre em tempo de execução (RFC 8252 §7.3), então a
porta não pode fazer parte da comparação para URI de loopback: compara-se
esquema, host e caminho exatos, **ignorando a porta**. Esse afrouxamento vale
**só** para loopback. Host remoto e esquema customizado permanecem em igualdade
absoluta, porta inclusive.

**Esquema customizado** (`cursor://`, etc.) é aceito, com limite de tamanho.
Registrado como elo fraco conhecido: no sistema operacional, outro aplicativo
local pode reivindicar o mesmo esquema. A mitigação é o PKCE, que é obrigatório
e é exatamente o controle desenhado para esse cenário.

**Revalidação no `/token`.** A troca do código revalida:

- o `client_id` apresentado é o **mesmo** que originou o código;
- o `redirect_uri` apresentado é **idêntico** ao usado no `/authorize`.

Código emitido para o aplicativo A não é trocável pelo aplicativo B, nem com o
verifier correto. PKCE cobre o roubo do código em trânsito; esta checagem cobre
a confusão de aplicativo, e é barata.

### E4. Reivindicação atômica e detecção de reuso

**Reivindicação atômica.** Código de autorização, credencial de renovação e
Pedido de Autorização são consumidos por uma única instrução:

```
UPDATE <tabela>
   SET consumed_at = now()
 WHERE <coluna_digest> = $1
   AND consumed_at IS NULL
RETURNING <dados necessários>
```

**Zero linhas retornadas** significa "não existe ou já foi consumido" → tratar
como reuso. É proibido `SELECT` seguido de `UPDATE`: duas requisições
concorrentes passam ambas pelo `SELECT` e ambas emitem credencial. Essa corrida
é o achado, e a instrução única é a correção.

**Escopo da revogação em reuso.** Reuso detectado revoga **a família de
credenciais originada daquele código** — e nada além disso. Não revoga o
Consentimento. Derrubar o Consentimento por um reuso presumido:

- desconecta o usuário de tudo por um evento que pode ser simples corrida de
  rede; e
- é vetor de negação de serviço — quem capturar um código velho derruba a
  conexão inteira da vítima ao reapresentá-lo.

Revogação de Consentimento fica reservada à **ação explícita do usuário** na
tela de aplicativos conectados (e à expiração de E9).

**Janela de graça na rotação de renovação.** A credencial de renovação
recém-rotacionada continua aceita por uma janela curta (**10–30 s**) após a
rotação, devolvendo **a mesma sucessora** já emitida — não uma nova. Motivo:
clientes MCP reconectam em paralelo, duas chamadas legítimas do mesmo agente
usam a mesma credencial de renovação, e sem a janela a segunda é classificada
como reuso e derruba uma conexão boa. Fora da janela, é reuso de verdade.

A graça vale **só para a sucessora imediata**. Apresentar uma credencial
rotacionada há mais de uma geração é reuso, sem graça.

### E5. Identidade do chamador no rate limiter

- A chave de contagem é o **IP de peer real**, obtido do servidor Bun
  (`server.requestIP(request)`) — **não** de header.
- `X-Forwarded-For` e `X-Real-IP` só são considerados se houver **proxy confiável
  configurado explicitamente** (config nova). Sem essa configuração, os headers
  são ignorados por completo. Confiar neles por padrão torna o limitador inútil:
  o atacante manda um valor diferente a cada requisição.
- **Consequência concreta para a task 4**: o handler de rota do Bun recebe
  `(request, server)` e o adaptador HTTP atual **descarta o segundo argumento**.
  Sem propagá-lo (ou o IP já resolvido) até a fronteira que aplica o limite, não
  existe identidade confiável para contar. Isso muda a assinatura do adaptador e
  do handler do `/mcp`.
- **Teto de chaves.** O mapa de contadores tem número máximo de entradas e
  expurgo por expiração. Sem teto, contar por IP é ele próprio um vetor de
  exaustão de memória — o atacante varia a origem ou o `client_id`. Atingido o
  teto, a política para chaves novas é **fail-closed** (recusa), não fail-open.
- Dimensões: `/token` por IP **e** por `client_id`; `/register` por IP;
  `/authorize` por IP.

### E6. Mitigação de phishing no registro e no consentimento

- **Host exibido em ASCII (punycode).** A tela de consentimento mostra o host de
  destino na forma ASCII, nunca a forma Unicode renderizada. Um host homógrafo é
  indistinguível a olho nu em Unicode; em punycode aparece como `xn--…`, que é o
  sinal que o usuário consegue ver.
- **Caracteres bidi e de controle proibidos no nome do aplicativo.** Rejeitar no
  registro os overrides bidirecionais (U+202A–U+202E, U+2066–U+2069), caracteres
  de controle e null bytes. Eles permitem inverter visualmente o nome exibido.
- **`logo_uri` é rejeitado no registro** — não apenas ignorado. Imagem remota
  controlada por terceiro na tela de consentimento é o recurso gráfico que torna
  o phishing convincente, além de canal de rastreamento e de SSRF. Sem logo,
  todo aplicativo tem a mesma aparência e o usuário lê o texto.
- **RFC 7592 (gestão do registro pelo próprio cliente) fica fora de escopo**, e
  isso é declarado: sem `registration_access_token`, sem endpoints de leitura,
  atualização ou exclusão do registro. Alterar registro exige registrar de novo.
  Elimina uma superfície inteira — um token de gestão de vida longa emitido sem
  nenhuma autenticação de usuário — a custo de UX nulo aqui. Não anunciar esses
  endpoints no metadata.
- O nome do aplicativo continua tratado como texto não confiável, escapado, e
  rotulado ao usuário como **não verificado**.

### E7. Log por allowlist

- Nas rotas do protocolo, o log é por **allowlist de campos**. Nunca o objeto de
  erro inteiro, nunca a requisição inteira.
  - Permitido: nome do endpoint, código de erro OAuth, `client_id`, resultado,
    timestamp, chave de rate limit, **host** do redirect.
  - Proibido: `code`, `code_verifier`, `code_challenge`, credencial de acesso ou
    de renovação, `redirect_uri` completo, header `Authorization`, corpo bruto,
    URL completa.
- O adaptador HTTP atual loga o objeto de erro inteiro em toda falha. Isso muda
  **antes** de qualquer credencial passar por ali — é parte da task 4.
- `ValidationError` originado de rota OAuth **nunca propaga o valor de entrada**,
  nem no log nem na resposta. O projeto hoje serializa o erro do Zod com o
  contexto do valor; nas rotas do protocolo a resposta é o código OAuth com uma
  descrição fixa, e o detalhe da validação não sai do processo.

### E8. Cache e CORS

- **`Cache-Control: no-store` (e `Pragma: no-cache`) é o padrão** em todas as
  rotas do protocolo, com exatamente duas exceções: os dois documentos de
  metadata, que são cacheáveis. Padrão seguro por omissão — não "lembrar de pôr"
  endpoint a endpoint.
- **CORS restrito à URL do front, por configuração** — não `https://*`. O
  middleware atual, em produção, aceita qualquer origem `https://` por
  `startsWith`, o que é efetivamente `*` com credenciais habilitadas. Para as
  rotas do protocolo e do consentimento, a origem permitida é a config do front,
  exata.
- Exceção deliberada: os dois documentos de metadata são o ponto de descoberta e
  respondem a qualquer origem — **sem** credenciais.
- O `/mcp` expõe `WWW-Authenticate` via `Access-Control-Expose-Headers`; sem
  isso o cliente em navegador não consegue lê-lo, e o 401 não dispara o fluxo.

### E9. Retenção e descarte

- **Vida absoluta do Consentimento** — prazo máximo mesmo em uso contínuo.
  Vencido, o usuário reautoriza. Sem isso, uma concessão feita uma vez vale para
  sempre.
- **Expiração por inatividade** — consentimento sem uso por um período é
  encerrado sozinho. É o que limpa o aplicativo que o usuário testou e largou.
- **Expurgo de linhas mortas** — rotina para pedidos expirados, códigos
  consumidos, credenciais expiradas ou revogadas e registros de aplicativo nunca
  consentidos. Sem ela a base cresce indefinidamente com material sensível (ainda
  que em digest) e o "último uso" da tela vira ruído.
- Isso é **modelo de dados** (task 5), não faxina posterior: as colunas de
  expiração e os índices que o expurgo usa nascem com as tabelas.

### E10. Formato do segredo e do digest

- **SHA-256 sem salt é a escolha correta** — confirmado pela revisão. Não usar
  KDF caro (bcrypt/argon) aqui. São segredos de alta entropia gerados pelo
  servidor, não senhas humanas: não há dicionário a atacar, e um KDF caro no
  caminho de verificação de **toda chamada MCP** seria DoS auto-infligido.
- Segredo com **≥ 32 bytes de CSPRNG**, codificado em base64url.
- **Índice único sobre a coluna de digest** — é o índice que a verificação usa e
  a garantia de que colisão não passa despercebida.
- O segredo nunca é gravado nem comparado em claro.

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
- **A seção "Especificação de Segurança do Protocolo" (E1–E10) é normativa.**
  Leia-a antes de escrever qualquer endpoint do protocolo. Ela não é contexto:
  é o comportamento exigido, e prevalece sobre o texto mais acima em caso de
  conflito.
- Trate a igualdade de `redirect_uri` como comparação de string bruta (E3).
  Qualquer tentativa de ser esperto (normalizar, comparar host, aceitar prefixo)
  é bug de segurança. A **única** exceção é a porta em loopback, e ela está
  especificada — não invente outras.
- Implemente a ordem de validação do `/authorize` na sequência de E2, e trate o
  modo de erro como parte da especificação, não como detalhe de apresentação.
  Errar isso é criar um open redirect.
- Todo consumo de uso único é uma instrução atômica com `RETURNING` (E4). Se
  você escreveu um `SELECT` para decidir e um `UPDATE` para aplicar, a corrida
  já está lá.
- Cada endpoint do protocolo lê parâmetros de uma fonte só (E1). Não reutilize o
  merge de `query`/`body`/`params` do adaptador atual nessas rotas.
- Nenhum segredo em claro no banco. Log por allowlist de campos nas rotas do
  protocolo (E7) — nunca o objeto de erro inteiro.
- Todo campo de entrada dos endpoints novos com limite de tamanho e cardinalidade
  explícitos, e vocabulário fechado onde o spec fecha (`response_type`,
  `grant_type`, `code_challenge_method`, `token_endpoint_auth_method`).
- Respostas de erro no formato OAuth, com status próprio — não no formato de
  erro atual da API. Isso é contrato de protocolo, não estilo da casa.
- Prefira estender o contrato de controller a criar um segundo pipeline HTTP.
- Endpoints de descoberta: públicos, sem autenticação, cacheáveis, e com o
  `issuer` idêntico à URL pública real.
- O verificador de JWT no caminho MCP é para **deletar**, não para desligar por
  configuração. Se em algum momento a implementação exigir um `if` por ambiente
  na autenticação do `/mcp`, é sinal de que a decisão foi contornada — pare e
  volte ao Arquiteto.
- A primitiva de rate limiting nasce genérica e aplicada por política declarada
  na rota, não com regra do OAuth embutida dentro dela. Ela não deve conhecer
  OAuth. Não a expanda além do que estas rotas exigem. Identidade do chamador e
  teto de chaves conforme E5 — e note que isso exige propagar o `server` do Bun
  (ou o IP já resolvido) pelo adaptador, que hoje o descarta.
- Gestão de aplicativos conectados é autenticada pela sessão do app, jamais pela
  credencial OAuth, e sempre restrita aos aplicativos do próprio usuário.
- Os testes atuais do caminho MCP autenticam com JWT e vão quebrar por desenho.
  Reescrevê-los para emitir credencial OAuth faz parte da task, não é conserto
  posterior — e não vale "manter o JWT só para o teste passar".
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
  **e passa a não ter mais nenhuma dependência de `SessionManager`**; depende da
  abstração de verificação de credencial e devolve o solicitante (usuário +
  aplicativo + escopos).
- **`src/core/infra/mcp/routes.ts`** — o portão passa a autenticar de fato e a
  responder 401 conforme RFC 9728; o solicitante resolvido desce para as tools.
- **`src/core/infra/mcp/mcp_tool.ts`** / **`mcp_server.ts`** — tools recebem o
  solicitante já resolvido em vez de resolvê-lo por conta própria.
- **`src/core/presentation/controller/controller.ts`** e
  **`src/core/infra/http/adapters/http_controller_adapter.ts`** — contrato de
  resposta HTTP explícita (status/headers/corpo); leitura de corpo
  `x-www-form-urlencoded`; **declaração de fonte única de parâmetro** e detecção
  de duplicata (E1), em vez do merge atual de `query`/`body`/`params`;
  **propagação do `server` do Bun / IP de peer**, hoje descartado, para a
  identidade do rate limiter (E5); log de erro por allowlist (E7); `no-store`
  por padrão nas rotas do protocolo (E8).
- **`src/core/presentation/middleware/cors.middleware.ts`** — exposição de
  `WWW-Authenticate`, origem restrita à config do front nas rotas do protocolo
  e do consentimento, e exceção pública sem credenciais para os dois documentos
  de metadata (E8).
- **`src/core/infra/http/routes/routes.ts`** — montagem das rotas novas,
  incluindo os caminhos de descoberta.
- **`src/core/infra/database/drizzle/schemas/auth_schemas.ts`** — tabelas dos
  novos agregados, com **índice único por digest** (E10), colunas de consumo
  (`consumed_at`) que sustentam a reivindicação atômica (E4), e as colunas de
  expiração absoluta, inatividade e expurgo exigidas por E9.
- **`src/core/infra/config/environments.ts`** — `API_BASE_URL` obrigatória fora
  de desenvolvimento (identidade do issuer); URL base do front (origem CORS e
  destino do consentimento); **proxy confiável para `X-Forwarded-For`** (E5),
  ausente por padrão; parâmetros de tempo de vida de credenciais, de vida
  absoluta e inatividade do consentimento, e da janela de graça de rotação.
- **`src/core/`** (transversal) — primitiva de rate limiting genérica, hoje
  inexistente no projeto, aplicada por política declarada na rota.
- **`tests/core/`** — os testes atuais do caminho MCP (resolução de identidade e
  rotas) autenticam com JWT de sessão e **serão reescritos** para credencial
  OAuth; não é ajuste incidental, é consequência direta da decisão 5.
- **`tests/auth/`** — cobertura do fluxo ponta a ponta e dos casos de abuso
  (redirect inválido, PKCE ausente, código reusado, credencial revogada,
  audiência errada, pedido expirado, limite de taxa atingido).
- **`stayhub-front`** (repositório externo, fora deste plano) — duas entregas:
  a página de login/consentimento e a tela de aplicativos conectados. Os
  contratos de ambas estão definidos acima.

---

## Tasks

1. ~~**Decidir os pontos pendentes**~~ — **Resolvida (2026-08-08)**: os 10 pontos
   foram decididos pelo usuário; sete conforme a recomendação do Arquiteto e três
   com decisão explícita. Ver **Decisões Resolvidas**. Nenhuma task permanece
   bloqueada por decisão.
   - Dependencies: none
2. ~~**Revisão de contrato pelo Analista de Segurança**~~ — **Concluída
   (2026-08-08)**: 5 achados críticos e 9 moderados. O crítico de LGPD
   (minimização de dado de hóspede) foi **deferido por decisão do usuário** e
   está em Dívidas; os demais estão fechados como especificação normativa na
   seção **Especificação de Segurança do Protocolo (E1–E10)**.
   - Dependencies: none
3. **Autenticação na fronteira do transporte MCP** — mover a resolução de
   identidade do handler de tool para o portão do `/mcp`; falha vira 401 com
   `WWW-Authenticate` conforme RFC 9728; tools passam a receber o solicitante já
   resolvido. Refatoração estrutural apenas: a credencial continua sendo a atual,
   agora atrás da abstração de verificação que a task 13 substitui.
   - Dependencies: none
4. **Contrato de resposta HTTP explícita** — controller pode devolver status,
   headers e corpo próprios; leitura de corpo form-urlencoded; **fonte única de
   parâmetro declarável e detecção de duplicata (E1)**; **propagação do `server`
   do Bun / IP de peer, hoje descartado (E5)**; **log por allowlist, sem o objeto
   de erro inteiro (E7)**; **`no-store` por padrão nas rotas do protocolo (E8)**.
   Comportamento atual das demais rotas preservado.
   - Dependencies: none
5. **Modelo de dados do acesso delegado** — agregados, repositórios e tabelas:
   registro de aplicativo, consentimento, pedido de autorização, código,
   credenciais. Invariantes de expiração, uso único, rotação e cascata.
   Inclui: **coluna de consumo que sustenta a reivindicação atômica (E4)**,
   **índice único por digest e segredo ≥ 32 bytes CSPRNG com SHA-256 sem salt
   (E10)**, e as **colunas de vida absoluta, inatividade e expurgo (E9)**.
   - Dependencies: none
6. **Primitiva de rate limiting** — genérica, em `src/core`, aplicada por política
   declarada na rota. Sem conhecimento de OAuth. Conforme **E5**: identidade pelo
   IP de peer real do Bun, `X-Forwarded-For` só com proxy confiável configurado,
   teto de chaves com expurgo e **fail-closed** ao atingir o teto.
   - Dependencies: task 4 _(precisa do IP propagado pelo adaptador)_
7. **Documentos de descoberta** — metadata do resource server (caminho canônico
   e variante com o caminho do recurso) e do authorization server, públicos e
   cacheáveis, com issuer exato. **Únicas rotas cacheáveis e de CORS público sem
   credenciais (E8)**; não anunciam endpoints de RFC 7592 (E6).
   - Dependencies: task 4
8. **Registro dinâmico de aplicativo** — método de autenticação restrito a
   cliente público (confidencial é rejeitado), limites de tamanho e
   cardinalidade, expurgo de registros sem uso. Validação de `redirect_uri`
   conforme **E3** (lista de rejeição, loopback, esquema customizado) e
   antiphishing conforme **E6** (bidi/controle proibidos no nome, `logo_uri`
   rejeitado, RFC 7592 fora de escopo).
   - Dependencies: tasks 4, 5, 6
9. **Início da autorização e pedido pendente** — implementar a **ordem de
   validação de E2 na sequência especificada**, com o modo de erro (A/B) correto
   em cada passo, incluindo `redirect_uri` ausente e registro expurgado; tela de
   erro do Modo A **sem link e sem navegação de qualquer natureza**; comparação
   de `redirect_uri` conforme **E3**; criação do pedido com TTL; redirect para o
   front; atalho de reconexão quando já há consentimento vigente.
   - Dependencies: tasks 4, 5, 8
10. **Endpoints de consumo do front** — consulta do pedido pendente por
    identificador opaco (dados de exibição, nada sensível, **host em punycode —
    E6**) e decisão de aprovar/negar autenticada pela sessão do app, emitindo o
    código e devolvendo a URL de destino montada a partir do registro.
    **Reivindicação atômica do pedido (E4)**; pedido consumido ou expirado é
    **Modo A na tela do front, sem redirect (E2)**.
    - Dependencies: task 9
11. **Emissão e renovação de credenciais** — troca de código com verificação de
    PKCE, vinculação ao recurso, digest em repouso, credencial opaca.
    Conforme **E4**: reivindicação atômica com `RETURNING` (nunca `SELECT` +
    `UPDATE`), revogação em reuso escopada **à família, não ao Consentimento**,
    e **janela de graça de 10–30 s** na rotação de renovação devolvendo a mesma
    sucessora. Conforme **E3**: revalidação de `client_id` e `redirect_uri` na
    troca. Conforme **E1**: parâmetros só do corpo form-urlencoded.
    - Dependencies: tasks 5, 6, 10
12. **Revogação** — endpoint do protocolo e revogação por consentimento, com
    cascata sobre as credenciais derivadas.
    - Dependencies: task 11
13. **Troca da credencial do `/mcp` para OAuth** — a implementação de verificação
    passa a ser a da credencial OAuth (expiração, revogação, audiência) e o
    verificador de JWT é **removido** do caminho MCP, junto com a dependência de
    `SessionManager` no resolver. Sem ramo por ambiente. Inclui a reescrita dos
    testes existentes do caminho MCP, que hoje autenticam com JWT.
    - Dependencies: tasks 3, 11
14. **Gestão de aplicativos conectados (backend)** — listar e desconectar,
    autenticado pela sessão do app, restrito aos aplicativos do próprio usuário,
    expondo concessão e último uso, **host em punycode (E6)**. Inclui a
    **retenção de E9**: vida absoluta do consentimento, expiração por
    inatividade e rotina de expurgo de linhas mortas.
    - Dependencies: task 12
15. **Cobertura de testes de abuso** — redirect não registrado, erro que não pode
    redirecionar, PKCE ausente/`plain`, código reusado, renovação reusada,
    credencial revogada, audiência errada, pedido expirado, limite de taxa,
    registro confidencial rejeitado, e um aplicativo tentando enxergar ou
    revogar consentimento de outro usuário. Acrescidos pela revisão de contrato:
    **parâmetro duplicado e parâmetro na fonte errada (E1)**; **cada passo de E2
    com o modo de erro correto**, em especial `redirect_uri` ausente e registro
    expurgado; **tela do Modo A sem link nem navegação**; **variações de
    `redirect_uri`** (normalização, double-encode, porta em loopback vs. host
    remoto, credenciais embutidas, esquema perigoso); **troca de código por outro
    `client_id`**; **duas trocas concorrentes do mesmo código** (a corrida — só a
    primeira emite); **duas renovações concorrentes dentro da janela de graça**
    (ambas legítimas, mesma sucessora); **reuso fora da janela** (revoga a
    família e **não** o Consentimento); **`X-Forwarded-For` forjado sem proxy
    confiável não altera a contagem**.
    - Dependencies: tasks 13, 14
16. **Teste de vazamento em log** — asserção de que nenhum registro de log
    produzido pelas rotas do protocolo contém código, verifier, challenge,
    credencial, `redirect_uri` completo, header de autorização ou URL completa,
    inclusive nos caminhos de erro e de `ValidationError` (E7).
    - Dependencies: tasks 13, 14
17. **Fluxo ponta a ponta com cliente MCP real** — validar descoberta, registro,
    login, consentimento, reconexão silenciosa e revogação com um cliente
    genérico.
    - Dependencies: tasks 13, 14, e as duas telas no `stayhub-front`
18. **Revisão de segurança pós-implementação** — Analista de Segurança sobre o
    código produzido.
    - Dependencies: task 17
19. **Revisão arquitetural** — Revisor sobre aderência de camadas e fronteiras.
    - Dependencies: task 17

> Com as decisões resolvidas, o paralelismo inicial é amplo: **tasks 2, 3, 4 e 5
> não têm dependência nenhuma** e podem sair juntas — recomendo despachar a task
> 2 em paralelo com as demais, já que 3–5 são estruturais e não implementam o
> protocolo. **Task 6 depende da task 4** (precisa do IP de peer propagado pelo
> adaptador, E5) — sai logo depois. Task 7 é independente das tasks 8–12. As
> tasks 15, 16 e 17 são as únicas com convergência total; a 17 tem dependência
> externa a este repositório (as duas telas do `stayhub-front`).

---

## Decisões Resolvidas (2026-08-08)

Todos os 10 pontos foram decididos. **Nenhuma task permanece bloqueada por
decisão.** Sete saíram conforme a recomendação do Arquiteto; três (6, 7 e 9) são
decisão explícita do usuário, e a 7 é mais restritiva do que o recomendado.

| #   | Ponto                           | Decisão                                                                                                                          | Origem                           |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | Cliente público ou confidencial | **Somente público** — `token_endpoint_auth_method: none` + PKCE `S256`. Registro que declare cliente confidencial é rejeitado    | conforme recomendação            |
| 2   | Formato da credencial de acesso | **Opaca**, com digest em repouso e consulta indexada. Revogação instantânea e verdadeira                                         | conforme recomendação            |
| 3   | Escopos na v1                   | **Escopo único** cobrindo o MCP. Recorte leitura/escrita fica como dívida                                                        | conforme recomendação            |
| 4   | Login no front                  | **Reaproveitar o sign-in existente** do app. Uma só verificação de senha no sistema; usuário já logado aprova sem redigitar      | conforme recomendação            |
| 5   | Consentimento na reconexão      | **Pular quando houver consentimento vigente**. A primeira autorização de cada aplicativo continua sempre explícita               | conforme recomendação            |
| 6   | Rate limiting                   | **Implementar agora, no código** — não delegar à infraestrutura. Primitiva genérica em `src/core`, aplicada por política de rota | **decisão explícita do usuário** |
| 7   | JWT de sessão no `/mcp`         | **Remover por completo** — sem carve-out por ambiente. `feat/mcp-server` não está mergeada; não há compatibilidade a preservar   | **decisão explícita do usuário** |
| 8   | Tempos de vida                  | **Padrão recomendado**: acesso curto (ordem de uma hora), renovação longa com rotação, código de segundos, pedido de minutos     | conforme recomendação            |
| 9   | Tela de aplicativos conectados  | **Entra no escopo**, backend e `stayhub-front` (listar e desconectar)                                                            | **decisão explícita do usuário** |
| 10  | Configuração                    | **URL base do front de consentimento** vira config nova; **`API_BASE_URL` passa a ser obrigatória** fora de desenvolvimento      | conforme recomendação            |

Nota do Arquiteto sobre a decisão 7: é a decisão mais consequente das três. Ela
elimina o cenário que eu tinha aceitado a contragosto — dois mecanismos de
autenticação convivendo sobre o mesmo recurso, com um ramo condicional por
ambiente. O preço é real e está registrado (dev local do MCP passa a exigir o
fluxo OAuth; os testes atuais do caminho MCP são reescritos), mas é preço de uma
vez só, pago agora, contra dívida de segurança permanente. Endosso.

---

## Dívidas Registradas (fora de escopo)

- Sem eventos de domínio para concessão e revogação de acesso; quando existir
  auditoria ou notificação, são os candidatos naturais.
- Sem trilha de auditoria das chamadas MCP (qual aplicativo agiu, quando, sobre
  o quê) — o dado de identidade do aplicativo passa a existir, mas não é
  registrado.
- Tools não são filtradas por escopo; o consentimento é tudo-ou-nada (decisão 3).
- **Rate limiting conta por processo.** Com mais de uma instância da API, o
  limite efetivo é multiplicado pelo número de instâncias. Aceito agora porque a
  operação é de instância única; no dia da segunda instância, a contagem precisa
  sair para um armazenamento compartilhado. Registrar antes de escalar.
- O rate limiting nasce aplicado só às rotas do protocolo; o sign-in do app
  continua sem limite e é o candidato imediato seguinte — fora deste escopo.
- Desenvolvimento local do MCP passa a exigir o fluxo OAuth completo (decisão 7).
  Se isso virar atrito recorrente, a saída correta é uma ferramenta de
  desenvolvimento que **execute** o fluxo, não um segundo mecanismo de
  autenticação.
- Sem introspecção de token (RFC 7662) — desnecessária enquanto AS e RS forem o
  mesmo processo.
- Sem suporte a múltiplos recursos protegidos; a vinculação de audiência é
  implementada, mas só existe um recurso.
- As dívidas do plano do servidor MCP (`2026-08-07-servidor-mcp-stayhub.md`)
  permanecem abertas — em especial ausência de idempotência nas escritas e
  ausência de log/auditoria no caminho MCP.
- **LGPD — dado de hóspede (nome/telefone/sexo) processado por aplicativo de
  terceiro conectado via OAuth, sem minimização nem texto de consentimento
  declarando categorias de dado de terceiro.** Achado crítico #4 da revisão de
  contrato (Analista de Segurança, 2026-08-08). Decisão explícita do usuário:
  **fora de escopo por agora** — seguir com o fluxo OAuth como desenhado,
  autenticação resolve quem pode chamar a tool, mas não resolve para onde o
  dado vai depois nem a finalidade em relação ao hóspede (titular do dado, que
  não é quem consente). Revisitar antes de expor a feature a usuários reais.
