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

1.  ~~**Decidir os pontos pendentes**~~ — **Resolvida (2026-08-08)**: os 10 pontos
    foram decididos pelo usuário; sete conforme a recomendação do Arquiteto e três
    com decisão explícita. Ver **Decisões Resolvidas**. Nenhuma task permanece
    bloqueada por decisão.
    - Dependencies: none
2.  ~~**Revisão de contrato pelo Analista de Segurança**~~ — **Concluída
    (2026-08-08)**: 5 achados críticos e 9 moderados. O crítico de LGPD
    (minimização de dado de hóspede) foi **deferido por decisão do usuário** e
    está em Dívidas; os demais estão fechados como especificação normativa na
    seção **Especificação de Segurança do Protocolo (E1–E10)**.
    - Dependencies: none
3.  **Autenticação na fronteira do transporte MCP** — mover a resolução de
    identidade do handler de tool para o portão do `/mcp`; falha vira 401 com
    `WWW-Authenticate` conforme RFC 9728; tools passam a receber o solicitante já
    resolvido. Refatoração estrutural apenas: a credencial continua sendo a atual,
    agora atrás da abstração de verificação que a task 13 substitui.
    - Dependencies: none
4.  **Contrato de resposta HTTP explícita** — controller pode devolver status,
    headers e corpo próprios; leitura de corpo form-urlencoded; **fonte única de
    parâmetro declarável e detecção de duplicata (E1)**; **propagação do `server`
    do Bun / IP de peer, hoje descartado (E5)**; **log por allowlist, sem o objeto
    de erro inteiro (E7)**; **`no-store` por padrão nas rotas do protocolo (E8)**.
    Comportamento atual das demais rotas preservado.
    - Dependencies: none
5.  **Modelo de dados do acesso delegado** — agregados, repositórios e tabelas:
    registro de aplicativo, consentimento, pedido de autorização, código,
    credenciais. Invariantes de expiração, uso único, rotação e cascata.
    Inclui: **coluna de consumo que sustenta a reivindicação atômica (E4)**,
    **índice único por digest e segredo ≥ 32 bytes CSPRNG com SHA-256 sem salt
    (E10)**, e as **colunas de vida absoluta, inatividade e expurgo (E9)**.
    - Dependencies: none
6.  **Primitiva de rate limiting** — genérica, em `src/core`, aplicada por política
    declarada na rota. Sem conhecimento de OAuth. Conforme **E5**: identidade pelo
    IP de peer real do Bun, `X-Forwarded-For` só com proxy confiável configurado,
    teto de chaves com expurgo e **fail-closed** ao atingir o teto.
    - Dependencies: task 4 _(precisa do IP propagado pelo adaptador)_
7.  **Documentos de descoberta** — metadata do resource server (caminho canônico
    e variante com o caminho do recurso) e do authorization server, públicos e
    cacheáveis, com issuer exato. **Únicas rotas cacheáveis e de CORS público sem
    credenciais (E8)**; não anunciam endpoints de RFC 7592 (E6).
    - Dependencies: task 4
8.  ~~**Registro dinâmico de aplicativo**~~ — **Concluída (2026-08-08)**:
    `POST /register` (`RegisterAppController` + `RegisterAppUseCase`) valida
    tudo à mão, sem o `inputSchema`/pipeline genérico de validação — uma falha
    aqui nunca vira `ValidationError` propagada pelo adaptador, porque isso
    responderia no formato `{ message }` da API e poderia carregar detalhe de
    Zod (violaria E7). Só cliente público é aceito
    (`token_endpoint_auth_method` ausente ou `"none"`; qualquer outro valor é
    `invalid_client_metadata`). `logo_uri` é rejeitado, não ignorado; `client_name`
    passa por um filtro de bidi/controle/null byte novo (`app_display_name_policy.ts`,
    reaproveitado pelo invariante da entidade). `redirect_uris` ganhou teto de
    cardinalidade e tamanho no schema da entidade (`MAX_REDIRECT_URIS`,
    `MAX_REDIRECT_URI_LENGTH`) e cada URI passa pela lista de rejeição de E3
    (`redirect_uri_policy.ts`: relativa, fragmento, esquema perigoso,
    credenciais embutidas, curinga, `http://` não-loopback; string armazenada
    sem nenhuma normalização). `grant_types`/`response_types` são validados
    contra o mesmo vocabulário fechado que o metadata anuncia — as constantes
    foram extraídas para `oauth_authorization_server_metadata.controller.ts` e
    importadas por ambos, para não divergir. Erros seguem o formato OAuth
    (`error`/`error_description`, `no-store`) via o novo `oauth_error_response.ts`,
    nunca o formato padrão da API. RFC 7592 não é implementado nem anunciado.
    Expurgo de E9 (`deleteUnusedRegisteredBefore`) é acionado pelo próprio
    tráfego de `/register`, best-effort, sem introduzir scheduler novo — o
    projeto não tem nenhuma infraestrutura de job/cron hoje. Rate limit por IP
    (E5) declarado no controller.
    - Dependencies: tasks 4, 5, 6
9.  ~~**Início da autorização e pedido pendente**~~ — **Concluída
    (2026-08-08)**: `GET /authorize` (`AuthorizeController` +
    `InitiateAuthorizationUseCase`) implementa a ordem exaustiva de E2 passo a
    passo. O controller cobre o passo 0 (`rateLimitPolicy` por IP) e o passo 1
    (E1): reparsing próprio de `request.url` com `URLSearchParams`, nunca o
    `request.query` já deduplicado pelo adaptador, falhando em Modo A
    (`invalid_request`) na primeira chave repetida, antes de qualquer outra
    validação. Os passos 2-11 vivem no use case, que devolve um resultado
    estruturado (`mode: "A" | "B" | "success"`) em vez de lançar — nada nesta
    rota passa pelo `ValidationError`/pipeline de erro padrão do adaptador.
    `client_id` mal formado ou inexistente (passos 2-3) e `redirect_uri`
    ausente ou fora do registro (passos 4-5, com **um registro expurgado
    caindo no mesmo `invalid_client` de um `client_id` desconhecido**, e sem o
    atalho de "usa a URI única registrada" quando ausente) são Modo A; a
    partir do passo 6 (`response_type`, PKCE `S256`, `scope`, `resource`,
    tamanho de `state`) é Modo B, com `error`/`error_description`/`state`
    ecoados no redirect já validado. A tela do Modo A
    (`oauth_authorize_error_page.ts`) é HTML estático sem `<a>`, sem botão,
    sem `Location`, sem meta refresh e sem script; a `errorDescription`
    exibida é sempre uma string fixa do próprio código, nunca o valor
    recusado, e ainda passa por escape defensivo. A comparação de
    `redirect_uri` (E3) ganhou `redirectUriMatches()` em `redirect_uri_policy.ts`:
    `===` estrita entre a string registrada e o valor decodificado uma vez
    pela URL, com a única exceção de loopback (`127.0.0.1`, `[::1]`,
    `localhost`) comparando esquema+host+caminho+query e ignorando a porta;
    host remoto e esquema customizado continuam em igualdade absoluta, porta
    inclusive. Sucesso cria o Pedido de Autorização com TTL de 10 minutos,
    identificador opaco gerado por `DelegatedSecretService` (persiste só o
    digest) e redireciona 302 para `${FRONT_BASE_URL}/connect/authorize` com
    apenas `request_id` — nenhum parâmetro OAuth chega ao front. O escopo
    único da v1 foi centralizado em `oauth_scope_policy.ts` (domínio, não a
    controller de metadata) para ser reutilizável pelas tasks 10/11 sem um
    use case importar de `presentation/`; o metadata do authorization server
    passou a anunciar `scopes_supported` a partir da mesma constante. Log por
    allowlist (E7) no controller: `endpoint`, `result`, `client_id`, `error`
    (quando houver), `rate_limit_key` (o peer IP) e `redirect_host` (nunca a
    URL completa). Nova config `FRONT_BASE_URL` em `environments.ts`
    (obrigatória fora de `development`, sem barra final) — é o destino do
    redirect de consentimento **e**, com essa config existindo, a origem CORS
    exata em produção: `cors.middleware.ts` trocou o `https://*` (efetivamente
    `*` com credenciais) por `frontBaseUrl` com igualdade exata (não mais
    `startsWith`), preservando a exceção pública sem credenciais dos dois
    documentos de metadata e o wildcard de `localhost` em desenvolvimento. O
    atalho de reconexão **não** foi implementado no `/authorize` — decisão do
    Orquestrador registrada na dispatch desta task: a autenticação do app é
    JWT Bearer, não cookie, então esta rota (navegação de browser) não tem
    como enxergar sessão do usuário; o atalho fica inteiro na task 10, que já
    tem o dado necessário disponível via `ConsentRepository.findByUserAndApp`
    (task 5, sem alteração).
    - Dependencies: tasks 4, 5, 8
10. ~~**Endpoints de consumo do front**~~ — **Concluída (2026-08-08)**:
    `GET /connect/authorize/pending-request` (controller
    `GetPendingAuthorizationRequestController`, caso de uso
    `GetPendingAuthorizationRequestUseCase`) e `POST /connect/authorize/decision`
    (controller `DecideAuthorizationRequestController`, caso de uso
    `DecideAuthorizationRequestUseCase`).

    A consulta é pública por necessidade do contrato (o front consulta antes
    do login), mas nunca cega a um solicitante identificado: um método novo,
    `AuthMiddleware.handleOptional`, que só envolve `handle()` num try/catch,
    resolve o usuário a partir de uma sessão que o front já tenha, sem nunca
    falhar a requisição na ausência ou invalidez do token. `has_existing_consent`
    só é calculado para esse usuário identificado — nunca "existe consentimento
    de alguém" — o que resolve a tensão apontada no dispatch sem vazar
    consentimento de terceiro. A decisão, por sua vez, é autenticada de
    verdade (`authenticated: true`, JWT Bearer), nunca por parâmetro OAuth.
    Nenhum dos dois controllers usa `inputSchema`; ambos validam à mão e
    respondem no formato `oauthProtocolError`, pela mesma razão de E7 já
    registrada nas tasks 8 e 9 — evitar que o pipeline padrão ecoe o
    identificador do pedido, que é um segredo, na mensagem de erro.
    `redirect_host` (E6) é simplesmente `new URL(redirect_uri).hostname` —
    confirmado em runtime que o Bun aplica IDNA/punycode ao analisar o host
    de um endereço `http(s)://` (um host cirílico homógrafo vira `xn--...`),
    sem biblioteca de conversão manual. `app_display_name_verified` vai
    sempre `false` no contrato de resposta, já que não há caminho de
    verificação neste subdomínio. A descrição do escopo é uma função nova,
    `describeScope()`, ao lado da constante do escopo único em
    `oauth_scope_policy.ts`, para não divergir do que `isSupportedScope` já
    governa.

    **Reivindicação atômica (E4)**: ao revisar `AuthorizationRequestRepository.claim()`,
    herdado pronto da task 9, contra o SQL exigido no dispatch, faltava a
    condição de expiração — a implementação original fazia apenas:

    ```sql
    UPDATE authorization_requests
       SET consumed_at = now()
     WHERE identifier_digest = $1
       AND consumed_at IS NULL
    RETURNING *
    ```

    sem `AND expires_at > now()`, apesar de o próprio docstring da interface
    já prometer esse comportamento. Corrigido para uma única instrução, sem
    `SELECT` prévio:

    ```sql
    UPDATE authorization_requests
       SET consumed_at = now(), updated_at = now()
     WHERE identifier_digest = $1
       AND consumed_at IS NULL
       AND expires_at > now()
    RETURNING *
    ```

    (Drizzle: `and(eq(identifier_digest, $1), isNull(consumed_at), gt(expires_at, new Date()))`).
    Zero linhas afetadas é tratado uniformemente como "não existe, expirou ou
    já foi consumido" (Modo A, task 10); nenhum teste existente dependia do
    comportamento antigo. `DecideAuthorizationRequestUseCase.execute()` chama
    `claim()` primeiro, sempre — aprovar e negar passam pelo mesmo caminho, o
    que consome o pedido nos dois casos.

    Negar constrói `error=access_denied`, `error_description` fixa e `state`
    ecoado sobre o `redirect_uri` do próprio Pedido — nunca de entrada do
    front; nenhum Consentimento é escrito, nenhum código é emitido. Aprovar
    resolve o Consentimento reaproveitando um vigente (não revogado), tocando
    só `last_used_at` através de um método novo, `ConsentRepository.touchLastUsedAt`,
    análogo a `revoke()`; ou criando um novo quando inexistente ou revogado —
    uma nova concessão, com novo `granted_at`. Um consentimento reaproveitado
    nunca tem seu `granted_at` resetado, para que a tela de aplicativos
    conectados (task 14) mostre a data da concessão original, não a de cada
    reconexão. Em seguida emite um `AuthorizationCode` com TTL de 60 segundos
    ("ordem de segundos", decisão 8), carregando `redirect_uri`,
    `code_challenge`, `scope` e `resource` do Pedido sem alteração, para a
    revalidação de E3 no `/token` (task 11), e devolve a URL final
    (`redirect_to` no corpo JSON) com `code` e `state` ecoado, montada sobre o
    `redirect_uri` **registrado**.

    O atalho de reconexão (decisão da task 9) não ganhou endpoint próprio: é
    o mesmo `POST /connect/authorize/decision`, mesma reivindicação atômica,
    chamado silenciosamente pelo front quando `has_existing_consent` vem
    `true`. A primeira autorização de cada aplicativo nunca passa por esse
    atalho, porque só existe consentimento vigente depois de uma aprovação
    explícita anterior.

    Refino colateral: extraído `parseUniqueQueryParams()` (E1) para um arquivo
    novo, `unique_query_params.ts`, compartilhado entre `AuthorizeController`
    (refatorado, comportamento inalterado) e o novo controller de consulta —
    ambos precisavam da mesma checagem de duplicata em query string.

    Log por allowlist (E7) nos dois controllers: `endpoint`, `result`
    (`approve`/`deny`/`request_not_found` na decisão), `client_id` e
    `redirect_host` — nunca a URL completa, nunca o identificador do pedido,
    nunca o código.

    **Observação para o Arquiteto/Revisor**: `AuthorizationCodeRepository.claim()`,
    usado pela task 11, tem a mesma lacuna que eu corrigi aqui — seu `claim()`
    também não filtra por `expires_at`, e seu próprio docstring não promete
    isso (ao contrário do de `AuthorizationRequestRepository`). Não toquei
    nele por estar fora do escopo desta task, já que só é consumido pelo
    `/token`, mas fica registrado para quando a task 11 for aberta. Rate
    limiting não foi adicionado aos dois endpoints novos: a consulta carrega
    um identificador com 256 bits de entropia, inviável de adivinhar, e a
    decisão já exige sessão autenticada; E5 não lista nenhum dos dois entre
    as rotas com dimensão de rate limit exigida, e a diretriz do Desenvolvedor
    pede para não expandir a primitiva além do que as rotas exigem.
    - Dependencies: task 9

11. ~~**Emissão e renovação de credenciais**~~ — **Concluída (2026-08-08)**:
    `POST /token` (`TokenController`) implementa `grant_type=authorization_code`
    e `grant_type=refresh_token` (RFC 6749 §4.1.3/§6). Lê exclusivamente do
    corpo `x-www-form-urlencoded` (E1): o helper de duplicata da task 10
    (`unique_query_params.ts`) ganhou um segundo export,
    `parseUniqueFormParams(rawBody)`, compartilhando a mesma checagem de
    ocorrência única com `parseUniqueQueryParams` — mas isso exigiu que o
    contrato de controller (task 4) passasse a expor `request.rawBody` (corpo
    cru, pré-parsing), já que `request.body` já chega com duplicata colapsada
    pelo adaptador, exatamente o mesmo problema que motivou `request.url` a
    ser re-parseado à mão em `AuthorizeController`. Sem `inputSchema` (mesmo
    motivo E7 já registrado nas tasks 8/9/10). `cache: "no-store"` (E8) em
    toda resposta; sem `corsPolicy` — rota de protocolo com credencial em
    jogo, então mantém a origem restrita ao front (E8), diferente dos dois
    documentos de metadata.

    **Rate limit por duas dimensões (E5)**: `RateLimitKeyDimension` ganhou um
    segundo valor genérico, `"caller-key"` — "uma chave que o próprio
    chamador fornece, sem a primitiva interpretá-la" — ao lado do `"peer-ip"`
    já existente; nenhuma mudança em `RateLimiter`/`InMemoryRateLimiter`, que
    já eram genéricos o bastante (`consume(key, policy)` sempre aceitou
    qualquer string). O `rateLimitPolicy` declarativo do controller continua
    cobrindo IP automaticamente, pré-parsing, pelo adaptador (30/min); a
    segunda dimensão (`client_id`, 60/min) é aplicada manualmente dentro do
    `handle()`, após extrair `client_id` do corpo, chamando o mesmo
    `RateLimiter` injetado com uma chave montada pelo próprio controller
    (`token:client_id:${id}`) — a primitiva nunca soube o que é um
    `client_id`, só recebeu uma string.

    **Reivindicação atômica do código (E4)** — `AuthorizationCodeRepository.claim()`
    não foi tocado (a lacuna de `expires_at` identificada pela task 10 é
    **intencionalmente diferente** aqui, conforme a correção de leitura do
    Orquestrador registrada no dispatch desta task):

    ```sql
    UPDATE authorization_codes
       SET consumed_at = now(), updated_at = now()
     WHERE code_digest = $1
       AND consumed_at IS NULL
    RETURNING *
    ```

    Zero linhas → reuso presumido. Linha retornada com `expires_at` no
    passado → `invalid_grant` comum, avaliado sobre a linha, sem tratamento
    de reuso.

    **Vínculo código → família para reuso (extensão sobre as "peças
    prontas" — sinalizando para Arquiteto/Revisor)**: `AuthorizationCode`
    não guarda qual família ele originou, então zero linhas do `claim()` por
    si só não diz _qual_ família revogar. Adicionada uma coluna nova,
    `issued_credentials.authorization_code_digest` (`varchar(64)`, única,
    nula em toda credencial nascida de rotação — só a primeira credencial de
    uma família a carrega), populada na emissão com o mesmo digest usado no
    `claim()`. Novo método `IssuedCredentialRepository.findByAuthorizationCodeDigest(digest)`.
    Em reuso (zero linhas no `claim()`), `ExchangeAuthorizationCodeUseCase`
    busca por esse digest: encontrada uma credencial, `revokeFamily` na
    família dela — e só nela, nunca no Consentimento; não encontrada (código
    nunca existiu, ou existiu mas uma tentativa anterior falhou antes de
    emitir, ex. PKCE errado), não há nada para revogar. Migration gerada em
    `drizzle/0002_jazzy_captain_marvel.sql`. Alternativa descartada: derivar
    `family_id` deterministicamente do digest do código (evitaria a coluna)
    — rejeitada por exigir forjar bits de versão/variante de UUID v4 para
    passar no schema Zod, uma solução mais obscura para revisar do que uma
    coluna nula-por-padrão com propósito óbvio.

    **PKCE (`pkce_policy.ts`, novo)**: `verifyPkceS256` compara
    `BASE64URL(SHA256(code_verifier))` a `code_challenge` via
    `crypto.timingSafeEqual` (tempo constante, guardado por uma checagem de
    tamanho antes). `plain` nunca chega aqui — já rejeitado no `/authorize`
    (E2 passo 7); todo `code_challenge` persistido já é S256.

    **Revalidação de E3 na troca**: `client_id` diferente do que originou o
    código, ou `redirect_uri` que não bate via `redirectUriMatches` (mesma
    função de `redirect_uri_policy.ts`, sem alteração), barram a troca.
    Auditoria adicional de vinculação ao recurso: `resource` diferente do
    canônico também barra (defesa em profundidade; `/authorize` já
    garante que só o `/mcp` canônico chega até aqui). Todas essas falhas, mais
    código inexistente/expirado/PKCE incorreto, convergem para o **mesmo**
    `{ outcome: "invalid_grant" }` (`TokenExchangeResult`, tipo compartilhado
    entre os dois use cases) — `TokenController` traduz qualquer uma delas
    para o mesmo `error: "invalid_grant"` com a mesma `error_description`
    fixa, nunca variando por causa (risco crítico 4).

    **Rotação de renovação e janela de graça (E4)** —
    `RefreshAccessTokenUseCase` usa `rotateRefreshToken` tal como documentado
    (insere sucessora + reivindica a atual em uma transação; `null` de volta
    = perdeu a corrida, cabe a quem chamou reconsultar
    `findByRefreshTokenDigest`). Achado ao implementar a graça: o repositório
    só guarda **digest**, nunca o segredo em claro (E10), então não existe
    como "devolver a mesma sucessora" a uma segunda chamada concorrente
    consultando o banco depois do fato — o segredo em claro só existe, uma
    vez, na resposta de quem venceu a rotação. Resolvido com uma peça nova,
    pequena e explicitamente de escopo estreito: `RefreshRotationGraceCache`
    (interface em `domain/service/`, `InMemoryRefreshRotationGraceCache` em
    `infra/service/`) — um cache em memória, por processo, análogo ao
    `InMemoryRateLimiter` (mesmo teto de entradas, mesmo fail-closed ao
    atingir o teto), guardando o payload em claro da sucessora por
    `REFRESH_ROTATION_GRACE_WINDOW_SECONDS` (novo env, default 20s, dentro da
    janela de 10–30s pedida), indexado pelo digest da credencial **superada**.
    Quem vence a rotação grava no cache; uma segunda chamada dentro da janela
    (`rotated_at` já setado, `elapsedMs <= graceWindowMs`) lê o mesmo payload
    de lá e devolve exatamente os mesmos `access_token`/`refresh_token` — não
    uma nova sucessora. Fora da janela → `revokeFamily` (nunca o
    Consentimento) + `invalid_grant`. Dentro da janela mas com o cache já
    vazio (ex. reinício do processo) → `invalid_grant` sem revogar — um
    "miss" benigno não é evidência de reuso, só impossibilidade de honrar o
    pedido. Uma credencial mais de uma geração atrás naturalmente não recebe
    graça: o `rotated_at` dela reflete quando _ela_ foi superada, e a entrada
    de cache daquele momento (TTL igual à janela) já expirou no tempo que um
    ciclo de renovação real levaria para chegar até ela. **Limitação aceita e
    registrada, no mesmo espírito do rate limiter**: cache por processo,
    single-instance — dívida a revisitar junto da contagem do rate limiter
    quando houver mais de uma instância.

    **Tempos de vida configuráveis (Mapped Changes previa isso em
    `environments.ts`)**: `ACCESS_TOKEN_TTL_SECONDS` (default 3600),
    `REFRESH_TOKEN_TTL_SECONDS` (default 2592000/30 dias),
    `REFRESH_ROTATION_GRACE_WINDOW_SECONDS` (default 20) — todos opcionais
    com default, então nenhum `.env` existente quebra e a nota de
    pré-requisito do `CLAUDE.md` (que documenta só variáveis **obrigatórias**
    para os testes) não precisou de atualização.

    Resposta de sucesso: `access_token`, `token_type: "Bearer"`,
    `expires_in`, `refresh_token`, `scope` — `scope` vem de `claimed.scope`
    na troca de código (já carregado, sem custo extra) e da constante
    `OAUTH_MCP_SCOPE` na renovação (evita um join a `Consent` só para
    confirmar um valor que só pode ser um, dado o escopo único da v1).

    Log por allowlist (E7) no controller: `endpoint`, `result`, `client_id`,
    `error` (código OAuth, quando houver) e `rate_limit_key` (peer IP) —
    nunca `code`, `code_verifier`, `code_challenge`, os tokens emitidos ou
    `redirect_uri`.

    **Para o Arquiteto/Revisor**: a extensão de `IssuedCredentialRepository`
    (novo método + nova coluna) e a introdução de `RefreshRotationGraceCache`
    vão além do que o dispatch desta task descrevia como "peças prontas" —
    ambas as decisões estão documentadas acima com a alternativa descartada e
    o motivo. Nenhuma delas afrouxa PKCE, redirect, uso único, ou distingue
    respostas de erro; ambas existem para tornar a revogação de E4 e a graça
    de rotação **precisas** com o modelo de dados existente. Sinalizando
    explicitamente para revisão, como pedido.
    - Dependencies: tasks 5, 6, 10 — **todas concluídas**.

12. ~~**Revogação**~~ — **Concluída (2026-08-08)**: `POST /revoke`
    (`RevokeController` + `RevokeTokenUseCase`, RFC 7009) e o mecanismo de
    cascata por consentimento (`RevokeConsentUseCase`), sem endpoint nem
    controller próprios — entregue para a task 14 consumir.

    **`/revoke` nunca é oráculo (RFC 7009 §2.2).** A resposta é sempre `200`
    com corpo vazio, idêntica para token inexistente, expirado, já revogado,
    revogado com sucesso, ou pertencente a outro aplicativo. Só falha de
    forma distinguível o que descreve a forma da própria requisição, não
    algo sobre o status do token: parâmetro duplicado no corpo (E1, via
    `parseUniqueFormParams`, mesmo helper de `TokenController`), `token`
    ausente, `token_type_hint` fora do vocabulário fechado (`access_token`
    ou `refresh_token`), ou `client_id` malformado. `RevokeTokenUseCase.execute()`
    devolve um `outcome` (revogado, não encontrado ou aplicativo divergente)
    que o controller só usa para a linha de log (E7 permite "resultado") —
    nunca para variar a resposta.

    **Busca por ordem, não por porta (E4-adjacente).** `token_type_hint` só
    decide qual digest é consultado primeiro; nunca impede a segunda busca.
    Um hint errado ainda encontra o token na segunda tentativa — sem hint,
    access token é tentado primeiro. `client_id` é opcional aqui, ao
    contrário do `/token`: RFC 7009 não o exige de um cliente público, já
    que possuir o token em claro já é a prova de autoridade costumeira para
    revogá-lo. Quando presente, ainda assim precisa bater com o registro do
    aplicativo do Consentimento da credencial localizada (via
    `ConsentRepository.findById`) — do contrário a revogação é pulada em
    silêncio, sem nunca revelar isso na resposta. Um aplicativo não revoga
    o token de outro por essa via, valor de token correto ou não.

    **Escopo de revogação por tipo (invariante central desta task).**
    Access token localizado revoga só aquela linha, via `revokeById` (novo
    método em `IssuedCredentialRepository`, implementado em
    `IssuedCredentialPostgresRepository`) — nunca a família nem as demais
    credenciais do mesmo Consentimento, distinto de `revokeFamily` de
    propósito. Refresh token localizado revoga a família inteira, via
    `revokeFamily`, a mesma unidade que `RefreshAccessTokenUseCase` já
    revoga em reuso (E4): o escopo de autoridade de um refresh token é a
    família que ele origina. Em nenhum dos dois casos o Consentimento é
    tocado — permanece reservado à ação explícita do usuário ou à
    expiração de E9 (invariante 6).

    **Rate limiting (E5, mesmo padrão do `/token` por instrução do
    dispatch).** `rateLimitPolicy` automático por IP (30/min, aplicado pelo
    adaptador antes de qualquer parsing) e, só quando `client_id` está
    presente e é um UUID válido, uma segunda dimensão por `client_id`
    (60/min), aplicada manualmente pelo controller — como `client_id` é
    opcional aqui, essa segunda dimensão é condicional, ao contrário do
    `/token`, onde é sempre obrigatória.

    **Cascata de consentimento sem transação entre repositórios**
    (`RevokeConsentUseCase`, novo, sem endpoint nem controller — só a task
    14 consome). O subdomínio não tem nenhuma abstração de unidade de
    trabalho cruzando `ConsentRepository` e `IssuedCredentialRepository` (a
    única `db.transaction` existente, em `rotateRefreshToken`, é
    inteiramente interna a um único repositório). A ordem escolhida revoga
    primeiro as credenciais (`revokeAllByConsent`) e só depois marca o
    Consentimento como revogado (`consentRepository.revoke`). Até o
    primeiro passo terminar, o Consentimento ainda lê como ativo — a
    direção segura, já que nada ainda afirma ter revogado algo. No momento
    em que qualquer leitor observa o Consentimento como revogado, toda
    credencial sob ele já carrega seu próprio `revoked_at`, exatamente o
    que a invariante 5 exige. Uma falha entre os dois passos deixa
    credenciais revogadas com o Consentimento ainda, incorretamente, lendo
    como ativo — o oposto da janela proibida, e autocurável: chamar de
    novo reexecuta o primeiro passo como no-op (`revokeAllByConsent` só
    toca linhas com `revoked_at IS NULL`) e completa o segundo. A ordem
    inversa foi descartada exatamente por seu único modo de falha ser o
    proibido. Posse do Consentimento é verificada dentro do próprio use
    case: um Consentimento que não pertence ao usuário autenticado é
    tratado como inexistente (`ResourceNotFoundError`), a mesma convenção
    de colapsar "não existe" com "não é seu" que `UpdatePropertyUseCase` e
    `CancelStayUseCase` já usam no projeto — "os aplicativos do próprio
    usuário" é invariante de autorização declarada no plano, não filtro de
    UI que o controller da task 14 pudesse pular.

    Log por allowlist (E7) no controller: `endpoint`, `result` (código de
    erro OAuth ou o `outcome` interno do use case), `client_id` e
    `rate_limit_key` (o peer IP) — nunca o token, seu digest, ou qualquer
    outro campo do corpo.

    **Para o Arquiteto/Revisor**: nenhuma migration foi necessária — `id` e
    `revoked_at` já existiam em `issued_credentials` desde a task 5.
    `revokeById` é extensão pontual de `IssuedCredentialRepository` (mesmo
    espírito das extensões sinalizadas nas tasks 10 e 11), sinalizada aqui
    por transparência.
    - Dependencies: task 11 — **concluída**.

13. ~~**Troca da credencial do `/mcp` para OAuth**~~ — **Concluída
    (2026-08-08)**: nova abstração `CredentialVerifier`
    (`src/auth/application/service/credential_verifier.ts`, junto com o tipo
    `Requester` — usuário + `appRegistrationId` + `scope`) com uma única
    implementação, `OAuthCredentialVerifier`
    (`src/auth/infra/service/oauth_credential_verifier.ts`). `verify()`
    consulta `IssuedCredentialRepository.findByAccessTokenDigest` pelo
    digest (E10) e recusa com o mesmo `UnauthorizedError` genérico — nunca
    distinguível — nos quatro motivos do plano: não existe; expirou
    (`access_token_expires_at`); foi revogada (`revoked_at` da própria
    credencial, que já cobre as três formas de revogação, já que
    `revokeById`/`revokeFamily`/`revokeAllByConsent` gravam a mesma coluna;
    `consent.revoked_at` é checado como defesa em profundidade adicional);
    audiência errada (`credential.resource !== expectedResource`, RFC 8707).
    Em sucesso, resolve o usuário via `AuthRepository.findUserById` e chama
    `ConsentRepository.touchLastUsedAt` — o último uso que a task 14 exibe.

    **Container distinto (Decisão Arquitetural 3)**: `MiddlewareDi`
    (`src/auth/infra/di/middleware.ts`) ganhou `makeCredentialVerifier()`,
    ao lado do já existente `makeAuthMiddleware()` — mesmo espírito
    (montável sem o grafo de casos de uso de `AuthDi`), agora também para a
    credencial que autentica o transporte MCP. `expectedResource`
    (`${apiBaseUrl}${MCP_RESOURCE_PATH}`) é montado aqui, nunca dentro de
    `OAuthCredentialVerifier`, que não importa nada de `presentation/`.
    `makeAuthRepository()`/`makeSessionManager()` — expostos publicamente só
    para alimentar o antigo `McpIdentityResolver` — ficaram sem nenhum
    chamador externo após a troca; removidos (o uso interno de
    `makeAuthMiddleware()` continua intacto).

    **A remoção**: `McpIdentityResolver`
    (`src/core/infra/mcp/identity_resolver.ts`) perdeu `AuthRepository` e
    `ISessionManager` por completo — depende só de `CredentialVerifier`.
    `resolveUser` virou `resolveRequester`, devolvendo o `Requester` inteiro.
    `src/core/infra/mcp/routes.ts` troca as antigas `middlewareDi.makeAuthRepository()`
    e `middlewareDi.makeSessionManager()` por `middlewareDi.makeCredentialVerifier()`,
    e passa `requester.user` (não o `Requester` inteiro) para `createMcpServer`
    — `mcp_tool.ts`/`mcp_server.ts` **não foram tocados**, continuam só com
    `User`, como o dispatch pedia. Nenhum `if` por ambiente em nenhum dos
    arquivos tocados; confirmado por grep que não sobra referência a
    `SessionManager`/JWT no caminho `/mcp` fora de um comentário explicando
    a remoção.

    **E7**: `routes.ts` ganhou um `Logger` (via `new CoreDi().makeLogger()`,
    mesmo padrão de instanciação independente já usado em `auth_di.ts` e
    `http_controller_adapter.ts`) e loga por allowlist a cada requisição —
    `endpoint: "mcp"`, `result: "authenticated"` ou `"unauthorized"`,
    `client_id` (o `appRegistrationId`, só em sucesso) — nunca a credencial,
    o header `Authorization`, ou a URL completa; `timestamp` já é
    carimbado pelo `ConsoleLogger`. Não há trilha por método JSON-RPC
    (`tools/call` vs `tools/list`) — isso é auditoria de verdade, dívida
    já registrada no plano, fora do escopo desta task.

    **E8 — achado**: o dispatch presumia `Access-Control-Expose-Headers`
    para `WWW-Authenticate` já resolvido pela task 3; **não estava** — o
    handler de `/mcp` em `core/infra/http/routes/routes.ts` é montado à
    parte do `CorsMiddleware`/`BunHttpControllerAdapter` (sem preflight,
    sem `Access-Control-Allow-Origin`) e nunca passou por CORS nenhum.
    Adicionado `Access-Control-Expose-Headers: WWW-Authenticate` na
    resposta 401 de `unauthorizedResponse` — seguro e alinhado à letra do
    requisito desta task — mas isso sozinho não resolve E8 por completo: sem
    `Access-Control-Allow-Origin` em nenhuma resposta de `/mcp`, um cliente
    MCP em navegador ainda não consegue ler nada de uma chamada cross-origin,
    expose-headers ou não. Decidido não expandir para CORS completo do
    `/mcp` (política de quais origens podem chamá-lo é decisão do Arquiteto,
    não estava no escopo desta task, e o dispatch só pedia para "confirmar").
    **Sinalizado para o Arquiteto**: gap real de CORS no `/mcp`, herdado da
    task 3, ainda aberto.

    **Testes reescritos** (única exceção de testes autorizada pelo
    Orquestrador nesta task): `tests/core/identity_resolver.test.ts` e
    `tests/core/mcp_routes.test.ts` passaram a autenticar emitindo
    credencial OAuth via fixtures (`tests/helpers/fixtures/delegated_access.ts`,
    que ganhou `accessTokenExpiresAt` opcional em `issueCredentialFixture` e
    um novo composto `createMcpAccessTokenFixture` — app registration +
    consent + credencial emitida em uma chamada) em vez de
    `createAuthToken` (JWT). `identity_resolver.test.ts` manteve a intenção
    de cada teste original (header ausente, header sem token, token
    inexistente/expirado) e acrescentou dois casos que o próprio enunciado
    desta task exige como comportamento central da nova abstração —
    credencial revogada e audiência errada — sem entrar em cobertura de
    abuso (concorrência, replay, rate limit), que são as tasks 15/16. Um
    caso do arquivo antigo — "token válido mas usuário não existe mais" —
    **não tem equivalente construível**: `consents.user_id` tem
    `onDelete: "cascade"` para `users.id`, então apagar o usuário sempre
    apaga o consentimento (e a credencial) junto; sinalizando essa
    constatação para o Arquiteto/Revisor em vez de forçar um estado
    inatingível via SQL bruto. `tests/core/mcp_tool.test.ts` foi só
    inspecionado — não autentica via JWT (usa um `User` fake direto, sem
    HTTP), então não precisou de nenhuma mudança.

    **Verificação**: `bun run typecheck`, `lint:check` e `format:check`
    limpos. O Postgres de teste não sobe nesta máquina (porta 5433 ocupada
    por container de outro projeto, `taya-clt-db-1` — não parado). Para
    verificar de fato (não só por tipo/leitura), subi um container Postgres
    **temporário e isolado** em outra porta (`15433`), apliquei as
    migrations existentes (`drizzle/*.sql`) e rodei a suite inteira contra
    ele; **todos os 23 arquivos de teste passam integralmente** (rodados
    por diretório/arquivo — `bun test` sozinho crasha com um segfault do
    próprio Bun ao transicionar para `oauth_discovery_metadata.test.ts`,
    reproduzível também sem minhas mudanças e alheio a este código; SDK do
    Bun, não da aplicação). Confirmado que as tasks 8–12 (auth/delegated_access),
    RBAC, sign-in, booking, finance e backoffice continuam 100% verdes — a
    troca não afetou a autenticação de sessão do app. Container temporário
    parado e removido ao final; o container do outro projeto na porta 5433
    nunca foi tocado.
    - Dependencies: tasks 3, 11 — **todas concluídas**.

14. ~~**Gestão de aplicativos conectados (backend)**~~ — **Concluída
    (2026-08-08)**: `GET /auth/connected-apps` (`ListConnectedAppsController`
    e `ListConnectedAppsUseCase`) e `DELETE /auth/connected-apps/:consentId`
    (`DisconnectAppController`), ambos `authenticated: true` — sessão normal
    do app (JWT Bearer), nunca a credencial OAuth (Decisão Arquitetural 12).
    Inclui também o adendo de CORS do `/mcp` deixado em aberto pela task 13
    (E8) e a retenção completa de E9.

    **Escopo por usuário — invariante, não filtro.** `user.id` vem só do
    middleware de autenticação, nunca de entrada do cliente.
    `ListConnectedAppsController` não recebe nenhum parâmetro de rota; a
    listagem é inteiramente função do usuário autenticado, via
    `ConsentRepository.findActiveByUser` (novo método, filtra
    `user_id` **e** `revoked_at IS NULL` no próprio repositório — o
    consentimento revogado nunca chega ao use case). O desconectar reusa
    `RevokeConsentUseCase` (task 12) **sem nenhuma mudança**: a checagem de
    posse (`consent.user_id !== user.id` → `ResourceNotFoundError`, 404) já
    vive lá, então um `consentId` de outro usuário nunca é alcançável — nem
    por acidente, nem por um controller futuro que esquecesse de filtrar.
    Verificado com um teste ad-hoc (não commitado, ver "Verificação"): um
    segundo usuário tentando desconectar o consentimento do primeiro recebe
    404 e o consentimento permanece intacto no banco.

    **Host em punycode (E6).** Mesma abordagem confirmada em runtime pela
    task 10: `new URL(uri).hostname`, sem biblioteca. Diferença em relação à
    task 10: o Consentimento não guarda qual `redirect_uri` foi usado numa
    autorização específica (isso vive nas entidades efêmeras Pedido/Código,
    já apagadas por expurgo) — só o Registro de Aplicativo, que pode ter até
    10 URIs registradas. `ListConnectedAppsUseCase#primaryRedirectHost` usa
    o **primeiro** `redirect_uri` registrado como representativo, o que é
    estável porque `redirect_uris` é imutável após o registro (invariante do
    agregado). **Sinalizando para o Arquiteto/Analista de Segurança**: um
    registro com múltiplos `redirect_uris` mostra só o host do primeiro
    nesta tela — diferente da tela de consentimento (task 10), que sempre
    mostra o host efetivamente usado naquela autorização. Considerado
    aceitável porque esta tela é revisão histórica, não o ponto de decisão
    de um redirect (nenhuma navegação acontece a partir dela), mas é uma
    simplificação deliberada que vale segunda opinião.

    **E9 — as três partes, e onde cada uma dispara:**
    1. **Vida absoluta.** `CONSENT_ABSOLUTE_LIFETIME_SECONDS` (novo env,
       default 180 dias) — `isConsentExpired` (novo,
       `domain/service/consent_expiry_policy.ts`) compara
       `now - consent.granted_at` contra o limite.
    2. **Inatividade.** `CONSENT_INACTIVITY_TTL_SECONDS` (novo env, default
       30 dias, mesma ordem de grandeza do `REFRESH_TOKEN_TTL_SECONDS`) —
       mesma função compara `now - consent.last_used_at`.
    3. **Expurgo de linhas mortas.** `IssuedCredentialRepository.deleteExpiredOrRevoked`
       (novo método + implementação Postgres) remove credenciais já
       revogadas ou cuja renovação já expirou; `AuthorizationRequestRepository.deleteExpired`
       e `AuthorizationCodeRepository.deleteExpired` — **já existiam desde a
       task 5, prontos, mas nunca chamados por nada até agora** — passam a
       ser acionados aqui.

    **Onde acionam.** Nem tudo cabe no padrão "faxina best-effort a partir
    do tráfego" que a task 8 estabeleceu para registros não usados — as
    partes 1 e 2 precisam valer no caminho de **verificação**, não só numa
    faxina periódica (o dispatch já antecipava essa tensão). Decisão, com
    dois pontos de acionamento deliberadamente diferentes:
    - `OAuthCredentialVerifier.verify()` (task 13) passou a receber
      `consentAbsoluteLifetimeMs`/`consentInactivityTtlMs` e avalia
      `isConsentExpired` a cada verificação de credencial — é o caminho
      correto para um agente **ainda ativo**: a próxima chamada ao `/mcp`
      depois do vencimento já falha, sem depender de nenhum job. Ao
      detectar, revoga de verdade (não só rejeita), reusando a mesma
      cascata de `RevokeConsentUseCase` — ver próximo parágrafo.
    - `ListConnectedAppsUseCase` avalia a **mesma** política para cada
      consentimento antes de listá-lo, e exclui (revogando antes) o que já
      expirou. Isto cobre o caso que o verificador **não** cobre: um
      aplicativo que o usuário testou e nunca mais chamou `/mcp` de novo —
      sem tráfego ali, o verificador nunca roda, e sem esta checagem a tela
      mostraria "conectado" para sempre um app já morto pela regra de
      inatividade. Depois de listar, a mesma chamada também aciona a
      faxina de linhas mortas (pedidos, códigos, credenciais), best-effort,
      try/catch com log — mesmo padrão de `RegisterAppUseCase`, nenhum
      scheduler introduzido.

    **Cascata compartilhada, sem duplicar a lógica.** Extraí
    `revokeConsentCascade` (`application/service/consent_cascade.ts`) das
    duas linhas que `RevokeConsentUseCase` já tinha
    (`revokeAllByConsent` → `revoke`, nessa ordem, pela mesma razão de
    auto-cura já documentada na task 12) — agora reusada por três
    chamadores: revogação explícita (`RevokeConsentUseCase`), expiração
    avaliada na verificação (`OAuthCredentialVerifier`), e expiração
    avaliada na listagem (`ListConnectedAppsUseCase`). Nenhum deles
    reimplementa a ordem; só o helper compartilhado a executa.

    **Configuração.** `CONSENT_ABSOLUTE_LIFETIME_SECONDS` e
    `CONSENT_INACTIVITY_TTL_SECONDS`, ambas opcionais com default (mesmo
    estilo de `ACCESS_TOKEN_TTL_SECONDS` etc., task 11) — nenhum `.env`
    existente quebra, e a nota de pré-requisito do `CLAUDE.md` (que só
    documenta variáveis **obrigatórias**) não precisou de atualização.

    **Adendo — CORS do `/mcp` (E8), fechado.** O handler de `/mcp`
    (`core/infra/mcp/routes.ts`) é montado à parte do
    `BunHttpControllerAdapter`/`CorsMiddleware` — a task 13 tinha
    adicionado `Access-Control-Expose-Headers: WWW-Authenticate` no 401,
    mas sem `Access-Control-Allow-Origin` em **nenhuma** resposta, um
    fetch cross-origin em modo `cors` falha a checagem de CORS do
    navegador antes do JavaScript conseguir inspecionar status ou headers
    — o `WWW-Authenticate` exposto nunca chegava a ser lido, e o próprio
    corpo de uma chamada bem-sucedida também não. Fechado reusando
    `CorsMiddleware` (nenhuma reimplementação de CORS em `/mcp`):
    - `handleMcpRequest` agora envolve toda resposta — 401 e sucesso — com
      `corsMiddleware.addCorsHeaders(response, origin, "public")`, a mesma
      política pública já usada pelos dois documentos de descoberta.
    - `core/infra/http/routes/routes.ts` ganhou um handler de `OPTIONS`
      para `/mcp` (`corsMiddleware.handlePreflightRequest(request, "public")`)
      — sem ele, o preflight que o navegador dispara por causa do header
      `Authorization` e do `Content-Type: application/json` (ambos não
      simples) nunca tinha resposta, e a chamada real nunca saía do
      navegador.
    - `CorsMiddleware.getPublicCorsHeaders()` ganhou `POST`/`DELETE` em
      `Allow-Methods` e `Authorization` em `Allow-Headers` — antes só
      `GET, OPTIONS` / `Content-Type, Accept`, suficiente para os
      documentos de descoberta, insuficiente para `/mcp`.

    **Decisão sinalizada para o Arquiteto**: reusar a política **pública**
    (origem `*`, sem credenciais) para `/mcp`, em vez de restringi-la à
    origem do front como as demais rotas do protocolo (E8 já faz essa
    distinção — a frase normativa sobre `/mcp` não menciona restrição de
    origem, só a exposição do header, diferente da frase-irmã sobre
    "rotas do protocolo e do consentimento"). Justificativa: um cliente MCP
    em navegador **não é** o `stayhub-front` — é um terceiro qualquer — e
    restringir a origem do `/mcp` à do front quebraria exatamente o cenário
    que a E8 existe para viabilizar. Isso é seguro porque `/mcp` não usa
    nenhum credential ambiente de navegador (cookie): o Bearer token é
    anexado pelo próprio JavaScript do chamador, então uma origem coringa
    não abre CSRF a la cookie. Nenhuma mudança estrutural — reuso do
    mecanismo de CORS existente, sem pipeline novo.

    Log por allowlist (E7): nenhum dos dois controllers novos loga nada
    além do que o `Logger`/adaptador padrão já loga em erro (`endpoint`,
    `name`, `message`) — não há segredo em jogo em nenhum dos dois
    (consentId e appRegistrationId não são segredos, ao contrário de
    código/verifier/challenge/token).

    **Verificação**: `bun run typecheck`, `lint:check` e `format:check`
    limpos. Subi de novo um Postgres temporário e isolado (porta `15433`,
    a `5433` do `.env.test` está livre nesta máquina no momento, mas o
    padrão da task 13 foi seguido por segurança), apliquei as três
    migrations existentes (`drizzle/*.sql`, nenhuma nova — E9 não exigiu
    coluna, ver abaixo) e rodei a suíte inteira por diretório
    (`tests/auth`, `tests/core`, `tests/backoffice`, `tests/booking`,
    `tests/finance`): **todos os 23 arquivos de teste passam
    integralmente**. Além disso, escrevi e rodei um arquivo de teste
    ad-hoc, **não commitado** (removido ao final, conforme a restrição de
    não escrever testes novos), cobrindo: 401 sem sessão, escopo por
    usuário + punycode, desconectar → cascata → `/mcp` 401 na chamada
    seguinte, 404 ao tentar desconectar consentimento de outro usuário
    (sem alterar `revoked_at`), expiração por vida absoluta autocurando via
    `/mcp` e desaparecendo da lista, expiração por inatividade limpa só
    pela visita à lista (sem nenhuma chamada a `/mcp`), e o preflight/CORS
    do `/mcp`. Os 7 casos passaram. Container temporário parado e removido
    ao final; nenhum container de outro projeto foi tocado.

    **Sem migration.** E9 não precisou de coluna nova: vida absoluta e
    inatividade são calculadas a partir de `granted_at`/`last_used_at`, que
    já existiam desde a task 5 — só faltava a configuração e a avaliação
    em tempo real, não um dado novo no schema.

    **Para o Arquiteto/Revisor**: além do gap de CORS e da simplificação de
    punycode já sinalizados acima, `revokeConsentCascade` é uma extração
    (sem mudança de comportamento) de duas linhas que já existiam em
    `RevokeConsentUseCase` — sinalizando por transparência, mesmo padrão
    das tasks 10-12.
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

---

## Correções Pós-Revisão (2026-08-08)

Origem: revisão de segurança pós-implementação (task 18, veredito "não apta a
seguir sem correção") e revisão arquitetural (task 19), sobre o código das
tasks 8–14. Três achados corrigidos pelo Desenvolvedor — os dois críticos e o
buraco de E9 que as duas revisões acharam de forma independente. Fora desta
rodada: M1, M2, M4, M5, M6, e os 9 desvios arquiteturais (ficam para uma
segunda leva).

### Achado 1 — "Desconectar" não desconectava (consentimentos duplicados)

**Causa raiz.** `consentsTable` não tinha constraint única em
`(user_id, app_registration_id)`; `findByUserAndApp` fazia `findFirst` sem
filtro de `revoked_at` nem `orderBy`; e `DecideAuthorizationRequestUseCase#resolveConsent`
inserida um Consentimento novo sempre que encontrava a linha existente
revogada, em vez de revivê-la.

**Correção:**

- `src/core/infra/database/drizzle/schemas/delegated_access_schemas.ts` —
  índice único `consents_user_id_app_registration_id_idx` em
  `(user_id, app_registration_id)`.
- **Migration `drizzle/0003_tired_jocasta.sql`.** Antes de criar o índice,
  deduplica linhas existentes: sobrevivente por combinação é o não-revogado
  mais recente (desempate por `granted_at`, depois `created_at`, depois
  `id`); `issued_credentials.consent_id` e `authorization_codes.consent_id`
  das linhas descartadas são reapontados para o sobrevivente (não perdidos
  ao cascade-delete — o histórico de credenciais emitidas sob aquele
  `(usuário, aplicativo)` continua íntegro, com o `revoked_at` original de
  cada credencial preservado); só então as linhas duplicadas são removidas.
  Testado com uma reprodução exata do cenário medido pelo Analista (C1
  revogado, C2 e C3 ativos, com tok1/tok2/tok3 sob cada um): após a
  migration, sobra 1 linha (a mais recente, C3) e as 3 credenciais passam a
  apontar para ela, mantendo seu `revoked_at` individual.
- `src/auth/domain/repository/delegated_access/consent_repository.ts` e
  `consent_postgres_repository.ts` — novo método `revive()`: limpa
  `revoked_at`, redefine `granted_at`/`last_used_at`.
- `src/auth/application/use_case/decide_authorization_request.ts` —
  `#resolveConsent` agora: usável → reutiliza (`touchLastUsedAt`); inexistente
  → cria; revogado/expirado → cascata (`revokeConsentCascadeIfNotAlreadyRevoked`,
  cobre o caso raro de expiração de E9 nunca antes detectada) seguida de
  `revive` com `granted_at` novo — nunca um segundo `INSERT`.

**Reprodução medida (contra Postgres real, ver seção Verificação):**
registrar app → autorizar/aprovar → obter token → confirmar `/mcp` 200 →
desconectar (`DELETE /auth/connected-apps/:id`) → confirmar **o mesmo**
access token agora responde 401 → reautorizar o mesmo (usuário, app) →
`pending-request` reporta `has_existing_consent: false` (não reconecta em
silêncio) → aprovar de novo → `SELECT` confirma **uma única linha** de
Consentimento, revivida (mesmo `id`, `granted_at` novo) → novo token emitido
funciona no `/mcp` → tentativa manual de `INSERT` de uma segunda linha para o
mesmo `(user_id, app_registration_id)` falha com violação do índice único.

### Achado 2 — host de destino vazio para `redirect_uri` de esquema privado (E6)

**Causa raiz.** `new URL(uri).hostname` devolve `""` para a forma nativa do
RFC 8252 §7.1 (`com.exemplo.app:/oauth2redirect`, sem `//`); e para esquema
customizado com host IDN (`myapp://аррӏе.com/cb`), WHATWG só aplica IDNA aos
esquemas especiais, então o host homógrafo virava percent-encoding em vez de
punycode.

**Correção — um único helper para as duas telas:**

- `src/auth/domain/service/redirect_uri_policy.ts` — nova função
  `redirectUriDisplayAnchor(uri)`: sem authority (`hostname === ""`), devolve
  a string completa registrada/apresentada (esquema + caminho — nunca vazio,
  nunca perde informação); com authority, decodifica o host e o reparseia
  através de uma URL `https://` sintética, forçando a conversão IDNA/punycode
  do WHATWG independentemente do esquema original.
- `src/auth/application/use_case/get_pending_authorization_request.ts` (tela
  de consentimento) e `list_connected_apps.ts` (tela de aplicativos
  conectados) — ambos trocaram `new URL(...).hostname` por
  `redirectUriDisplayAnchor`.
- **Todos os hosts, não só o primeiro, na tela de aplicativos conectados**:
  `ConnectedApp.redirectHost: string` virou `redirectHosts: string[]`,
  mapeando todos os `redirect_uris` registrados (máximo 10,
  `MAX_REDIRECT_URIS`) — contrato do controller e `outputSchema` do OpenAPI
  atualizados (`redirect_host` → `redirect_hosts`). A tela de consentimento
  continua mostrando um único host: o efetivamente usado naquela autorização,
  que ela tem e a tela de aplicativos conectados não.

**Reprodução medida:** `POST /register` com
`redirect_uris: ["com.stayhub.official:/oauth2redirect"]` →
`pending-request` devolve `redirect_host: "com.stayhub.official:/oauth2redirect"`
(antes: `""`). `POST /register` com `redirect_uris: ["myapp://аррӏе.com/cb"]`
→ `pending-request` devolve `redirect_host: "xn--80ak6aa92e.com"` (antes:
`"%D0%B0%D1%80%D1%80%D3%8F%D0%B5.com"`). App registrado com 3 `redirect_uris`
(`https://app.example.com/cb`, `com.multiredirect.app:/oauth2redirect`,
`http://127.0.0.1:54321/cb`) → `GET /auth/connected-apps` devolve
`redirect_hosts: ["app.example.com", "com.multiredirect.app:/oauth2redirect", "127.0.0.1"]`
— os três, não só o primeiro.

### Achado 3 — expiração por inatividade contornada pelo atalho de reconexão (E9)

**Predicado único no domínio.** `Consent.isUsable(absoluteLifetimeMs,
inactivityTtlMs, now?)`
(`src/auth/domain/entity/delegated_access/consent.ts`) — comportamento do
agregado, não serviço solto, como sugerido pelo Arquiteto: `!revoked_at` e
não vencido por E9 (reaproveita `isConsentExpired` internamente). Consumido
pelos seis caminhos:

| #   | Caminho                                                     | Antes                               | Depois                                                                                                     |
| --- | ----------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | `OAuthCredentialVerifier.verify`                            | `revoked_at` + E9, checks separados | `consent.isUsable(...)`                                                                                    |
| 2   | `ListConnectedAppsUseCase`                                  | `isConsentExpired` direto           | `consent.isUsable(...)`                                                                                    |
| 3   | `GetPendingAuthorizationRequestUseCase#hasUnrevokedConsent` | só `revoked_at`                     | renomeado `#hasUsableConsent`, usa `isUsable(...)`                                                         |
| 4   | `DecideAuthorizationRequestUseCase#resolveConsent`          | só `revoked_at`                     | `isUsable(...)`; se não usável, cascata + `revive`                                                         |
| 5   | `ExchangeAuthorizationCodeUseCase`                          | nada                                | resolve o Consentimento por `claimed.consent_id`, checa `isUsable(...)` antes de emitir                    |
| 6   | `RefreshAccessTokenUseCase`                                 | só a própria credencial             | resolve o Consentimento por `current.consent_id`, checa `isUsable(...)` antes de rotacionar/honrar a graça |

**Cascata condicional compartilhada.** Nova
`revokeConsentCascadeIfNotAlreadyRevoked` em
`src/auth/application/service/consent_cascade.ts`: só executa
`revokeConsentCascade` quando o Consentimento ainda não carrega seu próprio
`revoked_at` — evita recarimbar um `revoked_at` que uma revogação explícita
já gravou, e é a que os caminhos 1, 2, 4, 5 e 6 chamam quando `isUsable`
retorna `false`.

**Docstring corrigido em `oauth_credential_verifier.ts`.** A versão anterior
afirmava que "nunca deveria haver uma janela em que o Consentimento leia como
revogado e a credencial ainda não". Falso: `revokeAllByConsent` varre uma
foto do banco no momento da cascata; uma credencial nascida _durante_ essa
varredura (troca de um código ainda vivo — 60s, E4 — ou renovação correndo em
paralelo) nunca é visitada por ela e nasce órfã, com `revoked_at` próprio
nulo sob um Consentimento já revogado. As correções dos caminhos 5 e 6
estreitam essa janela, mas não a fecham (corrida real entre processos, sem
transação cruzando os dois casos de uso) — a checagem do verificador continua
sendo o backstop de fato, não uma redundância a ser removida numa limpeza
futura.

**Reprodução medida:**

- `#hasUsableConsent`: consentimento com `last_used_at` de 60 dias
  (TTL de inatividade default: 30 dias) → `pending-request` devolve
  `has_existing_consent: false` (antes: `true`, aprovação em silêncio).
- `ExchangeAuthorizationCodeUseCase` (corrida de revogação dentro dos 60s do
  código): autorizar/aprovar → **antes de trocar o código**, desconectar o
  app via `DELETE /auth/connected-apps/:id` → `POST /token` com o código
  ainda vivo devolve `400 invalid_grant` (antes: sucesso, credencial nova sob
  Consentimento morto).
- `RefreshAccessTokenUseCase`: emitir token → recuar `last_used_at` do
  Consentimento 60 dias no banco → `POST /token` com `grant_type=refresh_token`
  devolve `400 invalid_grant`, e o Consentimento e a credencial aparecem
  revogados no banco logo em seguida (autocura) — antes, a renovação
  sucedia incondicionalmente.
- `ListConnectedAppsUseCase`: consentimento com `last_used_at` de 31 dias,
  nunca tocado por `/mcp` nem por `/token` — visitar `GET /auth/connected-apps`
  já o exclui da lista **e** grava `revoked_at` no banco, sem nenhuma outra
  chamada ter acontecido.

### Verificação

`bun run typecheck`, `lint:check` e `format:check` limpos. Suíte completa
rodada **por arquivo** (23 arquivos — rodar o diretório inteiro, ou `bun
test` sozinho, ainda sofre o segfault conhecido do Bun ao entrar em
`oauth_discovery_metadata.test.ts`, alheio a este código): **todos passam**
(129 testes). Nenhum teste existente precisou de ajuste — os novos parâmetros
de construtor (`ConsentRepository` e os dois TTLs de E9 em
`ExchangeAuthorizationCodeUseCase`/`RefreshAccessTokenUseCase`/
`GetPendingAuthorizationRequestUseCase`/`DecideAuthorizationRequestUseCase`) só
são exercitados via DI (`AuthDi`), não instanciados diretamente em teste
algum, e nenhum teste cria duas linhas de Consentimento para o mesmo
`(user, app)`.

Postgres temporário e isolado subido em `15433` (a `5433` local já estava
ocupada pelo container de desenvolvimento **deste** projeto,
`stayhub_db` — não tocado, por segurança, mesmo sendo do próprio projeto);
migrations 0000–0003 aplicadas; servidor real (`bun run src/index.ts`) subido
contra ele para as reproduções acima via `curl`, ponta a ponta, sem mock.
Container temporário removido ao final.

---

## Correções Pós-Revisão — Segunda Leva (2026-08-08)

Origem: os 5 achados moderados de segurança restantes da revisão pós-
implementação (task 18) e os 2 baixos (B3, B6) que vivem na mesma superfície
de código de M5. A primeira leva já havia corrigido os 2 críticos e o buraco
de E9 (seção acima). Fora desta rodada, por decisão do Orquestrador: M4's
alternativa cifrada, e os 9 desvios arquiteturais da task 19 — todos
registrados em **Dívidas Registradas — Achados do Arquiteto e do Analista
(task 19)**, ao final desta seção.

### M1 — Duas trocas concorrentes do mesmo código revogavam a família do vencedor

**Onde:** `src/auth/application/use_case/exchange_authorization_code.ts`.

**Causa raiz.** A perdedora de uma corrida entre dois `POST /token` com o
mesmo código sempre cai em "zero linhas" no `claim()` atômico. Sem mais
nada, ela localizava a credencial que a vencedora **acabou** de emitir via
`findByAuthorizationCodeDigest` e revogava a família inteira — o mesmo modo
de falha que E4 já havia previsto para a rotação de renovação e resolvido
com uma janela de graça, nunca estendida ao caminho do código.

**Correção.** `#handleReplay(codeDigest)` (antes `#revokeFamilyIfAlreadyIssued`)
só revoga quando `alreadyIssued.created_at` estiver **fora** de
`graceWindowMs` — a mesma constante de E4, `REFRESH_ROTATION_GRACE_WINDOW_SECONDS`,
recebida agora como novo parâmetro do construtor (`AuthDi.makeExchangeAuthorizationCodeUseCase`
passa `refreshRotationGraceWindowMs`). Dentro da janela, a chamada perdedora
continua recebendo `invalid_grant` — nunca ganha credencial própria — mas a
família da vencedora sobrevive. Não abre superfície nova: quem só observa o
código (sem o `code_verifier`) nunca conseguiria reivindicar a linha nem
emitir nada por conta própria, e o replay tardio (fora da janela) continua
revogando exatamente como antes.

**Reprodução medida (Postgres real + servidor real, ver Verificação):**
fluxo completo `/authorize` → aprovação → `POST /token` disparado duas vezes
em paralelo com o mesmo `code`/`client_id`/`code_verifier`:

```
r1: {"access_token":"3dtT7...", ...}                 <- 200, com credenciais
r2: {"error":"invalid_grant", ...}
POST /mcp com o access_token de r1 -> 200 (tools/list)  <- não mais revogado
```

Antes da correção este último passo respondia `401` (comportamento medido
pelo Analista). Confirmado com esta instância que agora responde `200`.

### M2 — O grant `refresh_token` não era vinculado ao `client_id` apresentado

**Onde:** `src/auth/application/use_case/refresh_access_token.ts` (novo
campo `clientId` no input) e
`src/auth/presentation/controller/delegated_access/token.controller.ts`
(repassa o `clientId` já validado ao invés de descartá-lo).

**Correção.** Resolvido o Consentimento, `consent.app_registration_id !==
input.clientId` colapsa no mesmo `invalid_grant` genérico das demais causas
(risco #4) — nunca revela que o motivo foi o vínculo de aplicativo. A
checagem entra **antes** de `isUsable`, mas isso não importa
observacionalmente: todo ramo devolve o mesmo `invalid_grant`.

**Reprodução medida:** refresh token emitido ao App A —

```
client_id do App B         -> {"error":"invalid_grant", ...}
UUID nunca registrado       -> {"error":"invalid_client", ...}  (ver nota)
client_id correto (App A)   -> 200, com credenciais novas
```

Nota: o UUID nunca registrado responde `invalid_client`, não `invalid_grant`
— porque a correção de M6 (abaixo) intercepta qualquer `client_id` que não
identifique um registro existente **antes** mesmo do `grant_type` ser
despachado ao caso de uso. Não é uma divergência do achado: a consequência —
"200 com credenciais" deixando de acontecer — está igualmente fechada para
os dois casos medidos pelo Analista, e a distinção `invalid_client` vs.
`invalid_grant` não vaza nada sensível (`client_id` não é segredo em um
fluxo de cliente público — `token_endpoint_auth_method: none`; qualquer um
obtém um `client_id` válido via `/register`, sem autenticação).

### M4 — O cache de graça retinha credenciais em claro muito além da janela

**Onde:** `src/auth/infra/service/in_memory_refresh_rotation_grace_cache.ts`
e o docstring de `src/auth/domain/service/refresh_rotation_grace_cache.ts`
(corrigido para descrever o que o código agora faz, não mais a intenção que
o código anterior não implementava).

**Correção.** Reescrito para nunca depender de uma escrita futura ou do
mapa atingir a capacidade para liberar espaço: todo `put` agenda sua própria
remoção via `setTimeout(ttlMs).unref()`, e `get` apaga a entrada no primeiro
acerto (só existe um perdedor legítimo por rotação — a corrida de duas
pontas de E4). Um processo que nunca mais rotaciona nada não retém payload
nenhum além do `ttlMs` da última rotação, ao contrário de antes, onde o
purge só rodava ao atingir o teto de 10.000 entradas.

**Verificação.** Não há reprodução por HTTP possível para "quanto tempo uma
entrada em memória sobrevive" — é exatamente por isso que o achado só foi
identificado por leitura de código, não por sintoma observável (os dois
caminhos, antigo e novo, respondem de forma idêntica no request/response).
Verificado por: (1) leitura do código reescrito, garantindo remoção
determinística por temporizador ou por leitura; (2) reprodução funcional em
runtime de que a janela de graça **continua correta** após a reescrita —
duas renovações concorrentes com o mesmo refresh token superado ainda
recebem a mesma sucessora:

```
g1: {"access_token":"PAt-W...","refresh_token":"rLJNZ...", ...}
g2: {"access_token":"PAt-W...","refresh_token":"rLJNZ...", ...}   (idênticos a g1)
```

**Nota do Analista, mantida como dívida, não implementada agora:** a
alternativa estruturalmente melhor — persistir o payload da sucessora
cifrado com chave derivada do refresh token superado
(`AES-GCM(payload, HKDF(refresh_superado))`) — ver **Dívidas Registradas**
ao final.

### M5 (+ B3, B6) — Corpo bruto e stack trace em log; erro fora do formato do protocolo e sem `no-store`

**Onde:** `src/core/infra/http/adapters/http_controller_adapter.ts`
(`#parseBody`, `buildErrorLogContext`, novo helper `withNoStore` aplicado no
`catch` do adaptador) e `src/core/infra/mcp/routes.ts` (novo helper
`withNoStore` local, aplicado às respostas de sucesso e de 401 do `/mcp`).

**Correção:**

1. `#parseBody()` nunca tenta `JSON.parse` quando o controller declara
   `parameterSource: "form"`, independente do header `Content-Type` — a
   fonte declarada (E1) é a verdade, não um header que o chamador controla.
   Isso fechou a causa raiz: `/token` sem `Content-Type` ou com um
   `Content-Type` incorreto caía no `JSON.parse` de um corpo que não é JSON,
   lançando um `SyntaxError` cuja mensagem embute um fragmento **literal**
   do corpo (ex.: `Unexpected identifier "grant_type"` ou o próprio segredo
   enviado como corpo `text/plain`) — antes mesmo de `TokenController.handle()`
   rodar.
2. Quando ainda assim é JSON (rotas com `parameterSource: "json"` ou sem
   fonte declarada), `JSON.parse` agora está em `try/catch`: um corpo
   malformado vira `{}` em vez de lançar — para uma rota com `inputSchema`,
   isso falha normalmente como `ValidationError` (422), não como um erro não
   mapeado (500) com o corpo vazando no log.
3. `buildErrorLogContext` ganhou `isProtocolRoute` (verdadeiro quando o
   controller declara `parameterSource` — hoje, exclusivamente os endpoints
   OAuth de acesso delegado): para essas rotas, um erro **não mapeado**
   nunca loga `message`/`stack`, só `name`. Erros mapeados (`ValidationError`
   e afins) continuam logando `message` em toda rota — são falhas tipadas
   cujo texto o próprio projeto já controla.
4. `withNoStore` (novo, em ambos os arquivos) aplica `Cache-Control: no-store`
   e `Pragma: no-cache` a **toda** resposta de erro do adaptador para uma
   rota de protocolo — mapeada ou não, `4xx` ou `500` — fechando B6 (o `401`
   de `/connect/authorize/decision`, que vinha de `AuthMiddleware`/`errorCodeMap`,
   nunca do próprio controller, então nunca passava pelo `oauthProtocolError`
   que já carregava `no-store`). E ao `/mcp` (B3), que nunca passa pelo
   `BunHttpControllerAdapter` — aplicado diretamente em `handleMcpRequest`,
   tanto no 401 quanto na resposta de sucesso.

**Reprodução medida (servidor real, log real inspecionado):**

```
POST /token, sem Content-Type, corpo "grant_type=refresh_token&refresh_token=x&client_id=y"
 -> 400 {"error":"invalid_client",...}, com Cache-Control: no-store
 log: {"endpoint":"token","result":"error","rate_limit_key":"127.0.0.1","error":"invalid_client"}
     (sem "message", sem "stack", sem qualquer fragmento do corpo)

POST /token, Content-Type: text/plain, corpo "SUPERSECRETREFRESHTOKEN"
 -> 400 {"error":"invalid_client",...}, com Cache-Control: no-store
 log: idêntico ao acima — a string "SUPERSECRETREFRESHTOKEN" não aparece em
      lugar nenhum do log do processo (`grep` confirmou)

POST /connect/authorize/decision sem sessão -> 401 {"message":"Unauthorized"}
 com Cache-Control: no-store, Pragma: no-cache   (B6)

POST /mcp sem credencial -> 401, com Cache-Control: no-store, Pragma: no-cache (B3)
POST /mcp com credencial válida -> 200, com Cache-Control: no-store, Pragma: no-cache (B3)
```

Antes da correção, os dois primeiros casos respondiam `500` com
`{"message":"Internal server error"}` sem `no-store`, e o log continha a
mensagem bruta do `SyntaxError` — incluindo, no segundo caso, o valor do
corpo inteiro — mais o `stack` completo.

### M6 — Teto fail-closed sobre dimensão controlada pelo chamador negava o `/token` globalmente

**Onde:** `src/auth/presentation/controller/delegated_access/token.controller.ts`
e, por extensão (ver justificativa abaixo),
`src/auth/presentation/controller/delegated_access/revoke.controller.ts`;
`src/auth/infra/di/auth_di.ts` (injeção de `AppRegistrationRepository` nos
dois controllers); `src/core/infra/di/core_di.ts` (correlato).

**Correção escolhida, com justificativa.** Das duas alternativas propostas
("só criar chave depois de confirmar que o registro existe" ou "dar teto
próprio à dimensão `caller-key`"), escolhi a primeira: `TokenController` e
`RevokeController` agora chamam `AppRegistrationRepository.findById(clientId)`
**antes** de consumir a dimensão `caller-key` do `RateLimiter` — um
`client_id` que não identifica um registro existente responde `invalid_client`
sem nunca tocar o limitador. Um mapa separado (a segunda alternativa) só
limitaria o raio de dano a `/token`/`/revoke`; não fecharia a vulnerabilidade
em si, porque um `crypto.randomUUID()` novo por requisição continuaria
gratuito para o atacante e continuaria esgotando **esse** mapa dedicado,
negando `/token` a aplicativos genuinamente novos exatamente como o achado
descreve. Exigir um registro real ancora o custo de inflar essa dimensão ao
custo de passar por `/register` (que já tem rate limit próprio por IP,
task 8) — não a uma chamada de função gratuita.

**Por que `/revoke` também mudou, sem estar no texto original do achado.**
`RevokeController` e `TokenController` são montados pelo mesmo `AuthDi` e já
compartilhavam a mesma instância de `RateLimiter` (`this.#rateLimiter` de
`AuthDi`) **antes** de qualquer mudança nesta rodada — logo, um atacante já
conseguia esgotar a dimensão `caller-key` que `/token` usa simplesmente
mandando UUIDs novos para `/revoke` (`client_id` ali é opcional, mas quando
presente já alimentava o mesmo mapa). Deixar `/revoke` sem a mesma checagem
teria corrigido a porta nomeada no achado e deixado a porta ao lado aberta,
alcançando exatamente o mesmo resultado ("nega `/token` globalmente").

**Correlato — `CoreDi` instanciava um `InMemoryRateLimiter` novo a cada `new
CoreDi()`.** Confirmado antes da correção: `AuthDi` constrói seu próprio
`new CoreDi()` internamente, então o `RateLimiter` que `TokenController`/
`RevokeController` usam para a dimensão `caller-key` era uma instância
**diferente** da que `http_controller_adapter.ts` usa (em escopo de módulo,
para a dimensão `peer-ip` automática de toda rota, incluindo essas mesmas
duas). O docstring de `makeRateLimiter()` ("shared across every route in the
process") era falso. Corrigido tornando `#logger`/`#rateLimiter` singletons
de **módulo** em vez de campos de instância — todo `new CoreDi()`, presente
ou futuro, devolve exatamente o mesmo `RateLimiter`. Isso só é seguro
**depois** da correção acima: sem o `findById` prévio, unificar as duas
dimensões num único mapa teria ampliado o raio de dano do achado (UUIDs de
`/revoke` esgotando o mesmo teto usado pela dimensão `peer-ip` de qualquer
outra rota do processo), não apenas o de `/token`.

**Reprodução medida:**

```
POST /token, grant_type=refresh_token, client_id=deadbeef-0000-4000-8000-000000000000
 -> 400 {"error":"invalid_client",...}   (nunca chega a RateLimiter.consume)

POST /revoke, client_id=deadbeef-0000-4000-8000-000000000000
 -> 400 {"error":"invalid_client",...}   (mesma checagem, aplicada por extensão)

POST /revoke, client_id=<App A real> -> 200 (fluxo legítimo intacto)

new CoreDi().makeRateLimiter() === new CoreDi().makeRateLimiter()  -> true
 (antes da correção: false)
```

### Verificação (Segunda Leva)

`bun run typecheck`, `lint:check` e `format:check` limpos. Suíte rodada
**por diretório** (`tests/auth`, `tests/core`, `tests/backoffice`,
`tests/booking`, `tests/finance` — `bun test` sozinho ainda sofre o segfault
conhecido do Bun ao entrar em `oauth_discovery_metadata.test.ts`, alheio a
este código): **todos os 23 arquivos de teste passam, 144 testes, 0
falhas**. Nenhum teste existente precisou de ajuste — os novos parâmetros de
construtor (`graceWindowMs` em `ExchangeAuthorizationCodeUseCase`,
`clientId` no input de `RefreshAccessTokenUseCase`,
`AppRegistrationRepository` em `TokenController`/`RevokeController`) só são
exercitados via DI (`AuthDi`), não instanciados diretamente em teste algum.

Nota sobre a contagem: a leva anterior reportou 129 testes para os mesmos 23
arquivos; a execução desta leva mediu 144. Nenhuma mudança desta rodada
adiciona teste algum (restrição de processo mantida) — a diferença não foi
investigada a fundo por estar fora do escopo desta tarefa, mas fica
registrada para não parecer inconsistência silenciosa.

Postgres temporário e isolado subido em `15433` via `docker run` direto
(não `docker compose` — mais simples para uma instância descartável), já que
a `5433` local segue ocupada pelo `stayhub_db` deste projeto (não tocado).
As quatro migrations (`drizzle/0000`–`0003`) foram aplicadas via `psql`
diretamente sobre os arquivos `.sql` gerados — `drizzle-kit push` não se
conectava de forma confiável ao container temporário nesta sessão (motivo
não investigado; não é uma mudança de comportamento desta tarefa) e `psql`
contornou o problema sem risco, já que as migrations já existiam,
versionadas, de tasks anteriores. Servidor real (`bun run src/index.ts`)
subido contra esse Postgres para todas as reproduções via `curl` acima,
ponta a ponta: registro de dois aplicativos, fluxo completo `/authorize` →
`/connect/authorize/decision` → `/token` → `/mcp` → `/revoke`. Arquivo de
ambiente temporário (`.env.verify`) e container removidos ao final; o
container de desenvolvimento deste projeto (`stayhub_db`, porta `5433`)
nunca foi tocado.

---

## Dívidas Registradas — Achados do Arquiteto (task 19) e Baixos do Analista (não corrigidos)

Origem: relatório do Arquiteto (task 19, revisão arquitetural) e achados
baixos da revisão de segurança pós-implementação (task 18) que o usuário
decidiu **não** corrigir nesta rodada. Registrados aqui, na forma pedida
pelo Orquestrador, para sobreviver à conversa. Nenhum destes itens foi
implementado — apenas mapeado.

1. **A1** — `AppRegistration` não enforça a lista de rejeição de
   `redirect_uri` de E3 na própria entidade; a invariante é só de borda
   (`RegisterAppController`/`redirect_uri_policy.ts`). Hoje,
   `AppRegistration.create({redirect_uris:["javascript:alert(1)"]})` passa
   sem lançar. Correção futura: mover a validação de E3 para dentro do
   `create()`/schema Zod da entidade, para que a invariante valha
   independente de quem a chama.
2. **A3** — `ControllerParameterSource`/`#collectUnique` em
   `http_controller_adapter.ts` são inalcançáveis na prática: só rodam
   quando o controller declara `inputSchema`, e **nenhum** controller de
   protocolo declara — todos validam à mão (E7). Consequência: as fontes
   **JSON** (`/register`, `/connect/authorize/decision`) ficam sem detecção
   de duplicata de chave pelo caminho genérico (não conformidade literal com
   E1 regras 2 e 3 — achado **B1** do Analista, ainda aberto). Duplicado
   também com `unique_query_params.ts`, que resolve o mesmo problema para
   `query`/`form` de forma independente. Correção futura: ou os controllers
   JSON passam a chamar uma checagem de duplicata equivalente à de
   `unique_query_params.ts` sobre o corpo bruto, ou o mecanismo genérico do
   adaptador é reaproveitado de fato — não os dois convivendo, um deles
   morto.
3. **A4** — `MCP_RESOURCE_PATH` e o well-known do protected resource moram
   em `presentation/` e estão duplicados como literal em
   `src/core/infra/mcp/routes.ts`; o `resource_metadata` do 401 de `/mcp`
   deriva de `request.url` em vez de `apiBaseUrl` (inconsistente com o resto
   do sistema, que trata `apiBaseUrl` como fonte da verdade da identidade do
   issuer — risco #11).
4. **A5** — `OAuthCredentialVerifier` é lógica de aplicação (decide se uma
   credencial ainda é válida, cruzando expiração/revogação/audiência/vigência
   de Consentimento) arquivada em `infra/service/`, quando deveria estar em
   `application/service/` — só a implementação Postgres dos repositórios
   que ela consome pertence a `infra/`.
5. **Coalescer `touchLastUsedAt`** — escreve em `consents.last_used_at` a
   cada requisição MCP autenticada, numa coluna cuja granularidade
   semântica (E9, tela de "aplicativos conectados") é de dias, não de
   milissegundos. Candidato a debounce (ex.: só escrever se a última escrita
   foi há mais de N minutos).
6. **A6** — `RateLimitPolicy.keyDimension` (`"peer-ip"` | `"caller-key"`)
   não é lido nem por `RateLimiter`/`InMemoryRateLimiter` nem pelo
   `BunHttpControllerAdapter` — é um discriminante puramente documental que
   nada no código atual discrimina sobre. Ou passa a ser usado para algo
   real (ex.: validar em runtime que a política declarada bate com o uso),
   ou é removido do tipo.
7. **A7** — falta o agrupamento `delegated_access/` (que já existe em
   `domain/entity`, `domain/repository` e `presentation/controller`) em
   `application/use_case`, `application/service`, `domain/service` e
   `infra/service` — os arquivos do subdomínio ficam misturados com os do
   restante do BC Auth nessas quatro pastas.
8. **A8** — vocabulário "client" vazou para DTOs de aplicação e domínio
   (`clientId` em `RefreshAccessTokenInput`/`ExchangeAuthorizationCodeInput`/
   `RevokeTokenInput`, `"client_mismatch"` em `RevokeTokenResult`,
   `#belongsToClient` em `RevokeTokenUseCase`), contra a Linguagem Ubíqua do
   plano ("a linguagem do produto é **aplicativo**", não "cliente"). Nomear
   como `appRegistrationId`/`"app_mismatch"`/`#belongsToApp` alinharia com o
   restante do domínio (`AppRegistration`, `app_registration_id`).
9. **A9** — `IssuedCredentialRepository.deleteExpiredOrRevoked(before)`
   ignora o parâmetro `before` no ramo que apaga credenciais **revogadas**
   (só o respeita para as expiradas) — expurga revogadas de qualquer idade,
   não só as anteriores ao corte.
10. **Renames do contrato com o `stayhub-front`**, pedidos pelo Arquiteto
    **antes** do front implementar (para não vazar vocabulário interno):
    `GET /connect/authorize/pending-request` → `/connect/authorize/request`;
    `DELETE /auth/connected-apps/:consentId` → `/auth/connected-apps/:id`
    (não vazar o nome do agregado interno — "Consentimento" — no vocabulário
    do front, que só enxerga "aplicativo conectado"). O Arquiteto classificou
    o segundo como o único caro de mudar depois de o front já ter
    implementado contra o nome atual.
11. **Portas técnicas hoje em `domain/service`** — `RefreshRotationGraceCache`
    e `DelegatedSecretService` são portas de infraestrutura (cache em
    processo, geração/digest de segredo), não conceitos do domínio de
    negócio; pertencem a `application/service`, como as demais portas do
    projeto.
12. **Alternativa cifrada ao cache de graça (nota de M4).** Persistir o
    payload da sucessora cifrado com chave derivada do próprio refresh token
    superado (`AES-GCM(payload, HKDF(refresh_superado))`) em vez de cache em
    memória: só quem apresenta o token superado decifra, um dump do banco
    rende ciphertext, e funciona multi-instância e através de restart — sem
    a limitação de processo único que `InMemoryRefreshRotationGraceCache`
    (e o rate limiter) têm hoje. É o alvo estrutural correto; o cache em
    memória, mesmo corrigido nesta rodada, continua paliativo.
13. **Baixos do Analista não corrigidos:**
    - **B1** — ver A3 acima (fontes JSON sem detecção de duplicata pelo
      caminho genérico).
    - **B2** — normalização residual de `.`/`..`, userinfo e fragmento no
      ramo loopback de `matchesIgnoringLoopbackPort`
      (`redirect_uri_policy.ts`) — não explorável hoje, porque o host
      continua sendo resolvido como loopback de qualquer forma, mas é
      comparação mais permissiva do que a igualdade estrita que E3 pede para
      o resto da string.
    - **B4** — `resolveRequester` (`McpIdentityResolver`) faz
      `header.split(" ")[1]` sem conferir que o primeiro token é literalmente
      `Bearer` (case-sensitive ou não) — um header `Basic xyz` ou `xyz` sem
      esquema algum ainda tenta usar `xyz`/`split(" ")[1]` como credencial.
    - **B5** — a lista de rejeição de esquema em `redirect_uri_policy.ts`
      (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`) é uma
      blocklist, não allowlist: `filesystem:` e `view-source:`, entre
      outros, passam sem serem esquemas HTTP(S) ou loopback pretendidos.
    - **B7** — o expurgo de registros nunca usados (E9, task 8) só dispara
      como efeito colateral de tráfego em `/register` ou
      `GET /auth/connected-apps` — uma instalação onde ninguém jamais abre a
      tela de aplicativos conectados nem registra um segundo app nunca
      aciona o expurgo, mesmo tendo registros mortos há meses.
14. **Questão de contrato em aberto, para o Arquiteto antes da task 17**:
    CORS restrito à origem do front nas rotas do protocolo (E8) significa
    que um cliente MCP **em navegador** não consegue chamar `/token` nem
    `/register` cross-origin — só o `/mcp` recebeu a política pública
    (task 14). É a letra de E8 (que só menciona a exceção pública para os
    dois documentos de metadata e, por extensão já decidida, para `/mcp`),
    mas colide com o cenário do risco 12 do plano ("Clientes MCP em
    navegador buscam o metadata e chamam `/token` e `/register` via
    fetch"). Não é falha de implementação — é decisão de contrato a
    confirmar: ou o risco 12 estava descrevendo um cenário que a decisão de
    E8 conscientemente não cobre, ou `/token`/`/register` precisam da mesma
    exceção pública que `/mcp` já tem.

---

## Dívidas Registradas — Revisão da PR #24 e SDK do MCP (2026-08-09)

Origem: revisão do usuário na PR #24 (`feat/mcp-server` → `main`) e investigação
do Orquestrador sobre o estado do protocolo MCP. Os 8 itens acionáveis da review
foram corrigidos (commits `75e0beb`, `ea130a2`, `869efc5`); o que segue é o que
foi deliberadamente **não** corrigido.

15. **Migração para o SDK v2 do MCP (`@modelcontextprotocol/server` 2.0.0) e a
    revisão de protocolo `2026-07-28`.** Decisão explícita do usuário
    (2026-08-09): **ficar no v1 por enquanto.**

    Situação atual: o projeto usa `@modelcontextprotocol/sdk@1.30.0` (última do
    v1) e **já opera em modo stateless** — `WebStandardStreamableHTTPServerTransport`
    com `sessionIdGenerator: undefined` e par `McpServer`+transport novo por
    requisição (`src/core/infra/mcp/routes.ts`). Isso não é dívida: é o padrão
    correto, e a documentação de migração confirma que a hospedagem v1 stateless
    "mapeia diretamente" na entrada default do v2.

    O que a revisão `2026-07-28` muda: modelo **por requisição** substituindo a
    arquitetura de sessão; entrega de input in-band (`inputRequired(...)` no lugar
    de requisições servidor→cliente); notificações por subscrição via
    `subscriptions/listen`; `requestState` opaco no lugar de estado de sessão;
    identidade de cliente por `_meta` por requisição em vez de capabilities no
    `initialize`.

    Por que não migrar agora: a migração é **opt-in** — _"Nothing in v2 puts a
    2026-07-28 byte on the wire by default"_ — e o `createMcpHandler(factory)`
    com `legacy: 'stateless'` (default) serve as duas eras. Como já somos
    stateless, é drop-in. O motivo de adiar é de risco, não técnico: `routes.ts`
    é onde vive o portão de autenticação OAuth, recém-revisado por segurança
    (task 18) e arquitetura (task 19); mexer nele agora exigiria nova revisão.

    Caminho de migração quando for a hora: trocar `server.connect(transport)` +
    `transport.handleRequest(request)` por `createMcpHandler(factory)` do pacote
    `@modelcontextprotocol/server`, mantendo `legacy: 'stateless'`. O portão de
    credencial e o 401 com `WWW-Authenticate` continuam **antes** do handler,
    como estão hoje. Referência:
    <https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28>

    Encerrado na review: `carlosedp/mcp-bun`, citado em dois comentários da PR
    #24, **não é biblioteca para construir servidores MCP** — é um servidor MCP
    que expõe capacidades do runtime Bun (rodar scripts, testes, builds) como
    tools para um assistente. Não substitui nem concorre com o SDK oficial.

16. **`eslint.config.js`: o glob dos arquivos TypeScript nunca casa com nenhum
    arquivo.** Achado colateral do Desenvolvedor ao remover os `eslint-disable`
    (2026-08-09), confirmado via `eslint --print-config`. O padrão declarado nos
    dois primeiros blocos da configuração é:

    ```
    src/**/*.{ts}
    ```

    Chaves com um único item não funcionam como alternação no matcher do flat
    config, então esses blocos — que declaram `js/recommended`, `no-console`,
    `prefer-const` e `no-var` — **nunca se aplicaram a nenhum arquivo TypeScript
    da base**, e isso é anterior a qualquer mudança desta feature.

    Não corrigido de propósito: consertar o glob habilitaria `js/recommended` e
    `no-console: warn` sobre todo o código pela primeira vez, com efeito
    abrangente e imprevisível. É decisão do time, não conserto de passagem.

---

## Dívidas Registradas — Revisão de Segurança da tool `cancel_stay` (2026-08-12)

Origem: revisão do Analista de Segurança na branch `feat/mcp-cancel-stay-tool`
(PR de `feat: add cancel_stay mcp tool`, commit `b9601b4`). Achado crítico
avaliado pelo usuário e deliberadamente **não corrigido** nesta PR.

17. **A descrição do escopo OAuth `mcp` não menciona a capacidade de cancelar
    estadias, e consentimentos já concedidos herdam essa capacidade em
    silêncio.** `SCOPE_DESCRIPTIONS[OAUTH_MCP_SCOPE]` em
    `src/auth/domain/service/oauth_scope_policy.ts` descreve o escopo como
    "Book stays, record expenses, and view your properties and stays on your
    behalf" — só ações construtivas. A PR que adicionou a tool `cancel_stay`
    (destrutiva e irreversível: estorna receita no ledger) não atualizou esse
    texto.

    Consequência: `#hasUsableConsent` (mesmo arquivo) trata qualquer
    consentimento vigente como utilizável para todo o escopo `mcp`, incluindo
    capacidades adicionadas depois da concessão original — o "atalho
    silencioso de reconexão" do fluxo delegado passa a cobrir `cancel_stay`
    sem nova tela de consentimento.

    Decisão explícita do usuário (2026-08-12): **não corrigir agora.** No
    momento apenas o próprio usuário utiliza o servidor MCP — não há terceiro
    cujo consentimento estaria desatualizado. Reavaliar antes de qualquer
    integração de terceiros ser conectada ao escopo `mcp`.

    Caminho de correção quando for a hora (conforme laudo do Analista de
    Segurança): atualizar o texto de `SCOPE_DESCRIPTIONS` para mencionar
    cancelamento, e considerar versionar a superfície do escopo
    (`scope_surface_version` no registro de consentimento) para que
    consentimentos anteriores à mudança deixem de ser "utilizáveis" via o
    atalho silencioso e exijam nova tela — em vez de aplicar a capacidade nova
    retroativamente a autorizações antigas.
