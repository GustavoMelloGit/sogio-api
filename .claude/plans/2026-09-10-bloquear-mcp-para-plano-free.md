# Acesso ao MCP como capacidade de plano — bloquear o Free em dois pontos

## Objective

Transformar "conectar uma IA à própria conta" numa capacidade de acesso do plano: `free` não conecta, trial e pago conectam. O bloqueio acontece em **dois** pontos — na entrada do `/mcp` e no consentimento do OAuth —, para que a pessoa seja avisada antes de conectar a IA, e não só depois, quando toda chamada de tool começar a falhar.

Isto **não é um bug**: a trava nunca existiu. Hoje `makeMcpRequestHandler` checa apenas `entitlement.has_platform_access`, e uma conta `free` tem assinatura ativa no plano `free`, então passa.

## Personas

- **Arquiteto** (`model: opus`) — este plano, as invariantes e o vocabulário
- **Desenvolvedor** (`model: sonnet`) — implementação das tasks
- **Analista de Segurança** (`model: opus`) — revisão do ponto (b): é o caminho do protocolo OAuth, com resposta que atravessa um app de terceiro

## Decisões já tomadas com o usuário (não reabrir)

1. O bloqueio é em **dois pontos**: chamadas ao `/mcp` **e** o consentimento do OAuth (`/authorize` e o que vem depois dele).
2. A matriz de acesso é: **free** sem MCP, **trial** com MCP (limitado ao próprio período de trial), **pago** com MCP.
3. O transporte inteiro recusa — não é "tool a tool".

## Decisões arquiteturais

### D-1 — A capacidade nova: `ai_assistant`

Entrada nova no `CAPABILITY_REGISTRY`:

| campo          | valor                 |
| -------------- | --------------------- |
| `key`          | `ai_assistant`        |
| `kind`         | `access`              |
| `default`      | `false`               |
| `required`     | `false`               |
| `label`        | `AI assistant access` |
| `metadata_key` | `sogio_ai_assistant`  |

**Por que `ai_assistant` e não `mcp_access`.** MCP é o nome de um protocolo — termo técnico disfarçado de linguagem de negócio, exatamente o que o Arquiteto recusa. O que o negócio vende é "usar o Sogio por uma IA"; o `sogio-wa-bot` (projeto irmão, Baileys + Gemini) já consome esta API por MCP, e um segundo transporte para a mesma alavanca comercial não deveria obrigar a criar uma segunda capacidade. O `key` é imutável (**I-5**) e o `kind` também (**I-6**): escolher o nome do protocolo agora significaria conviver com ele para sempre ou pagar uma migration de `jsonb`.

**Por que `default: false`.** Fail-closed, mesmo idioma de `bulk_import`: um Price cujo `metadata` não declare a chave deixa o plano **sem** IA, em vez de liberar por omissão. Numa capacidade que hoje separa o plano gratuito do pago, o fail-open de I-4 (conceder até alguém notar) entregaria de graça justamente a coisa que se quer cobrar — e o custo do erro contrário (um plano pago sem IA até o dashboard ser corrigido) é visível, reclamável e reversível em segundos.

**Por que `required: false`.** `required: true` invalida a **entrada de catálogo inteira** quando a chave falta (I-4). Aplicado aqui, um `sogio_ai_assistant` esquecido no Price do Pro derrubaria o plano Pro inteiro do catálogo, não só a IA — e como `default: false` já responde com segurança, a obrigatoriedade não compra nada e custa um modo de falha desproporcional. Mesma leitura que já foi feita para `bulk_import`. `max_properties` continua sendo o único `required: true`, porque lá a ausência vira silenciosamente "1 imóvel", que é uma resposta plausível e errada.

**Invariantes respeitadas**: I-1 (nenhum `code` de plano muda), I-2 (o `free` não é aposentado), I-3 (nenhuma ausência aposenta nada), I-4 (ausência cai no `default`, com `warn` via `CapabilitySet.fallbacks`), I-5/I-6 (`key` e `kind` nascem definitivos), I-7 (a fixture de planos passa a declarar a chave nova, ou o `typecheck` quebra — é o mecanismo funcionando).

### D-2 — Isto é capacidade, não feature flag

O critério do projeto é "eu venderia isso separado?". Aqui a resposta é sim, e não por analogia: **é a diferença de preço entre os dois planos que está sendo desenhada**. Acesso por IA é a única superfície em que o produto é usado sem UI, é o que o projeto irmão de WhatsApp vende como experiência, e é o recurso cujo custo marginal (chamadas de tool, escrita em lote, rate limit de 300 req/min por usuário) cresce com o uso. Feature flag é o que se liga e desliga para todo mundo por razões de engenharia; isto se liga por plano, por dinheiro, e o valor por plano vem do `metadata` do Price — nunca de um deploy.

### D-3 — A regra do trial cai de graça no modelo (confirmado no código)

Confirmado lendo `SubscriptionAccessPolicy.#resolveTrialing` (`src/billing/domain/policy/subscription_access_policy.ts`), `Entitlement` e `CapabilitySet.of()`:

- Uma `Subscription` em `trialing` resolve `CapabilitySet.of(plan.capabilities)` — as capacidades **do plano que está sendo experimentado** (o pago), não um conjunto próprio de trial. Não existe caminho em que "trial" tenha capacidades diferentes do plano.
- Logo, a matriz inteira sai de **um** fato declarado no gateway: `sogio_ai_assistant=true` no Price do Pro, `false` (ou ausente, caindo no `default: false`) no Price do Free.
- **Nenhum ramo `if (status === "trialing")` entra em lugar nenhum**, nem em `billing`, nem no adaptador HTTP, nem no `/mcp`. Se alguém escrever um, é sinal de que o modelo foi contornado.

### D-4 — O fim do trial revoga sozinho (confirmado no código)

O entitlement é derivado na leitura, a cada requisição, e não há scheduler. Percursos, e em que momento o MCP corta:

| percurso                               | o que a policy devolve                                           | quem corta o MCP                                 | quando                                       |
| -------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| trial vigente                          | `has_platform_access: true`, capacidades do plano pago           | ninguém                                          | —                                            |
| trial vencido (`now > trial_ends_at`)  | `has_platform_access: false`, `blocked_reason: "trial_expired"`  | o **portão de platform access que já existe**    | primeira requisição depois do vencimento     |
| trial → `past_due`, dentro da carência | `has_platform_access: true`, capacidades do plano pago           | ninguém — deliberado: cartão falhou, não o plano | —                                            |
| `past_due` com carência vencida        | `has_platform_access: false`, `blocked_reason: "payment_failed"` | o portão de platform access                      | primeira requisição depois da carência       |
| cancelada, dentro do período já pago   | `has_platform_access: true`, capacidades do plano pago           | ninguém                                          | —                                            |
| cancelada, período encerrado           | `has_platform_access: **true**`, capacidades do **plano free**   | **a trava nova de capacidade**                   | primeira requisição depois do fim do período |
| sem assinatura                         | `has_platform_access: false`, `CapabilitySet.empty()`            | o portão de platform access                      | imediato                                     |

A última linha é a que justifica a trava nova existir ao lado do portão antigo: quem cancela **não** perde acesso à plataforma, cai para as capacidades do Free — e é só a checagem de capacidade que tira a IA dessa conta.

### D-5 — Onde entra a checagem em (a), o `/mcp`

`/mcp` não passa pelo `BunHttpControllerAdapter`; o ponto de entrada é `makeMcpRequestHandler` (`src/core/infra/mcp/routes.ts`). A ordem passa a ser:

1. tetos de corpo (`readBoundedBody`) e profundidade JSON — inalterado
2. `identityResolver.resolveRequester` → `401` — inalterado
3. rate limit por usuário (300/min) → `429` — inalterado
4. `entitlementService.entitlementOf(user.id)` — **uma única vez**, como hoje
5. `has_platform_access` → `403` — inalterado
6. **NOVO**: `entitlement.capabilities.allows(AI_ASSISTANT_CAPABILITY_KEY)` → `403`
7. `createMcpServer` / transporte

Pontos que não podem ser afrouxados na implementação:

- A checagem nova usa o **mesmo `Entitlement` já resolvido** no passo 4. Capacidade nunca é uma segunda ida ao banco (regra já registrada no `CLAUDE.md`).
- Ela fica **dentro** do mesmo `if (requester.user.role !== "admin")` que já envolve o passo 4-5 — é o que dá o bypass de admin de graça (ver D-8).
- Depois do rate limit, não antes: um cliente sem plano em loop precisa bater no `429`, não gastar uma leitura de entitlement por requisição.
- Antes de instanciar `McpServer`/transporte: uma conta sem plano nunca chega a `initialize` nem a `tools/list`.

**Erro que sai**: `403`, com o corpo no mesmo formato de tool error que a recusa de platform access já usa (`mapErrorToToolResult(new ForbiddenError(...))`) — `ForbiddenError` já está no allow-list de `mcp_error_mapper.ts`, então nada vira "Internal server error". A **mensagem é literalmente a mesma** dos outros dois adaptadores: `Your current plan doesn't include AI assistant access. Upgrade your plan to unlock it.` Hoje essa frase está duplicada em `http_controller_adapter.ts` e em `mcp_tool_adapter.ts`; esta entrega seria a terceira cópia, então ela é extraída para uma função em `billing/domain/capability/` e os três sítios passam a usá-la (D-9).

**Log** (disciplina de allowlist, E7): `result: "forbidden"`, mais a chave da capacidade negada — nunca a mensagem, nunca o plano do usuário.

### D-6 — Onde entra a checagem em (b), o consentimento — e a direção de dependência

**Impedimento técnico real, e como ele muda o desenho (reportado ao Orquestrador, sem mudar a decisão de produto):** `/authorize` é `authenticated: false` (`routes.ts`, bloco `delegatedAccessControllers`) e `InitiateAuthorizationUseCase` **não tem usuário nenhum em mãos** — o fluxo é: cliente → `/authorize` (valida `client_id`/`redirect_uri`/PKCE e cria a Pending Authorization Request) → redirect para a tela de consentimento do front → `POST /connect/authorize/decision`, **este sim autenticado**, onde o usuário existe. Não há como decidir por plano em `InitiateAuthorizationUseCase`: não se sabe de quem é a conta. Portanto o ponto (b) é implementado onde a identidade existe, que é o mesmo momento lógico ("o consentimento") com o qual o usuário decidiu:

- **`DecideAuthorizationRequestUseCase` — a trava de verdade.** Depois do `claim` atômico da request (nunca antes: uma recusa é terminal para aquela request, do mesmo jeito que um `deny`, e checar antes deixaria o identificador vivo para replay) e **antes** de resolver o Consent e cunhar o Authorization Code. Resultado: nenhum `Consent` criado ou revivido, nenhum `AuthorizationCode` cunhado.
- **`GetPendingAuthorizationRequestUseCase` — só a UX.** Ganha um fato novo na resposta, para a tela de consentimento mostrar "seu plano não inclui acesso por IA" com o caminho de upgrade, em vez do botão "Autorizar" — e para o **atalho silencioso de reconexão** (`has_existing_consent`) não aprovar sozinho um consentimento que a trava vai recusar em seguida. Como esse endpoint é público com usuário opcional (`handleOptional`), o fato só é computado quando há chamador identificado e vale `false` quando não há — exatamente a mesma semântica que `has_existing_consent` já tem e já documenta.

**Direção de dependência.** `auth` hoje não importa **nada** de nenhum outro BC; `billing` importa de `auth` (`User`, `UserCreatedEvent`). Fazer `auth → billing` fecharia um ciclo. A saída é a que o projeto já usou em `PropertyOccupancy` (declarado em `property_management`, implementado em `booking`, para preservar `booking → property_management`):

- `auth` declara a **porta de saída** em `src/auth/application/service/` — o diretório que o `CLAUDE.md` já define como o lugar das portas que a aplicação declara para a infra implementar (`Hasher`, `CredentialVerifier`), e onde o lint (`sogio/service-only-service-objects`) aceita interface.
- `billing` **implementa** a porta sobre o `EntitlementService` que já existe (uma classe em `billing/application/service/`, no molde de `StayPropertyOccupancy`), e o `BillingDi` publica a fábrica.
- A composição acontece em `routes.ts`, como já acontece com `new PropertyManagementDi(billingDi.makeEntitlementService(), ...)`. Consequência mecânica: `const billingDi = new BillingDi()` precisa passar a ser declarado **antes** de `const authDi = new AuthDi(...)`.
- Nome sugerido para a porta: `AiAssistantAccess`, com uma pergunta só — "esta conta pode conectar um assistente de IA agora?".

**O que a porta responde.** `has_platform_access` **e** `capabilities.allows("ai_assistant")`, nessa ordem — as mesmas duas condições que o `/mcp` aplica. Se ela checasse só a capacidade, uma conta Pro em `past_due` fora da carência completaria o consentimento e tomaria `403` em toda chamada depois: precisamente o desperdício que o ponto (b) existe para evitar. As duas causas colapsam num único `false` — mesmo idioma do `not_found` de `decide`, que já funde "não existe", "expirou" e "já foi usada". O contexto (bloqueada por pagamento vs. plano sem IA) a pessoa encontra na própria conta, que continua acessível (`allowWithoutPlatformAccess`).

**Erro OAuth que sai: modo B — redirecionar com `error=access_denied`.** Razões:

- RFC 6749 §4.1.2.1 define `access_denied` como "o dono do recurso **ou o servidor de autorização** negou a requisição". É literalmente este caso, e já é o código que o caminho de `deny` emite — nenhum cliente precisa aprender nada novo.
- `invalid_scope` estaria errado: o escopo pedido é suportado e seria concedido a uma conta paga. O problema é a conta, não o escopo — e um cliente que leia `invalid_scope` pode tentar de novo com escopo menor, para sempre.
- Modo A (recusar sem redirecionar) está errado aqui porque neste ponto o `redirect_uri` **já foi validado contra o registro** do app em `/authorize`. Modo A existe para quando não há destino confiável; devolver o cliente a uma tela morta faria a IA travar sem erro, em vez de receber uma negativa que ela sabe reportar.
- O `error_description` precisa ser distinto do texto de "o usuário negou", senão a IA dirá à pessoa que ela recusou algo que não recusou. Consequência aceita: o app de terceiro fica sabendo que a conta não tem plano com IA — informação que o próprio dono da conta acabou de provocar, e sem ela a pessoa fica presa num erro mudo.
- O `outcome`/log ganha um valor próprio (não "deny"): a auditoria não pode confundir "o servidor recusou por plano" com "a pessoa clicou em negar".

### D-7 — `/token`, `/refresh` e quem já está conectado

**Nada é revogado, e isso é a decisão, não uma omissão.** Um access token emitido durante o trial (ou antes do downgrade) continua sendo uma credencial OAuth válida; quem recusa é a leitura de entitlement na entrada do `/mcp`, a cada requisição:

- **Corte imediato**: a primeira chamada depois do vencimento do trial / do fim do período cancelado já toma `403`. Não há janela de acesso residual.
- **`/token` e `/refresh` ficam intactos.** Gatear ali seria um terceiro ponto de aplicação sem proteção adicional (o transporte já recusa) e entrelaçaria ciclo de vida de credencial com estado de plano: quem fizesse upgrade teria de refazer todo o fluxo OAuth para reconectar a IA.
- **Nenhum `Consent` é revogado por downgrade.** Mesma razão, mais forte: revogar consentimento é irreversível pelo produto e obrigaria a reconexão manual de todo app depois de qualquer upgrade.
- **Simetria que vem de graça**: quem faz upgrade volta a ter MCP na requisição seguinte, sem reconectar nada.

Ou seja: "falhar na leitura do entitlement" (nada novo) em vez de "revogar tokens" (mecanismo novo, caro, irreversível).

### D-8 — Admin bypassa? Sim, nos dois pontos

Coerente com o que o projeto já faz para **capacidade de acesso** nos dois adaptadores (`user.role !== "admin"` no `BunHttpControllerAdapter` e em `registerMcpTool`):

- No `/mcp`, o bypass vem de graça: a checagem nova entra dentro do bloco que já é pulado para admin.
- No consentimento, o bypass fica **no sítio de aplicação** (o caso de uso, que tem o `User` em mãos), nunca dentro da porta: `AiAssistantAccess` resolve por `user_id` e é cega a papel, exatamente como `EntitlementService.entitlementOf(user_id)`. Isso preserva a assimetria documentada — admin bypassa trava de **acesso**, nunca trava de **limite**.
- O flag exibido pelo `GetPendingAuthorizationRequest` precisa valer `true` para admin, senão um admin veria "faça upgrade" numa tela cujo `decision` o deixaria passar.

### D-9 — Uma frase de recusa, três sítios

`capabilityDeniedMessage` está duplicada literalmente em `http_controller_adapter.ts` e `mcp_tool_adapter.ts`. Esta entrega criaria a terceira cópia; então ela é extraída para uma função em `billing/domain/capability/` (mesmo lugar de `capabilityRegistryEntryOf`, que já é função livre — `domain/` não está sob a regra de lint de `application/service/`) e os três sítios passam a chamá-la. Junto vai a constante `AI_ASSISTANT_CAPABILITY_KEY`, para que a trava do transporte e a da porta de consentimento não possam divergir por digitação.

### D-10 — `get_subscription_status` e a tensão do transporte fechado

A tool existe para que uma IA que bateu numa trava consiga dizer qual plano cobre o quê. Com o transporte fechado, ela não é chamável — e isso é consequência direta da decisão "o transporte inteiro recusa". A tensão se resolve **sem abrir exceção no transporte**:

1. **O ponto (b) é a resposta principal.** A pessoa é avisada no navegador, na tela de consentimento, antes de conectar — com o caminho de upgrade a um clique. Ela nunca chega ao estado "IA conectada que só dá erro". É exatamente por isso que o usuário pediu dois pontos de bloqueio, e não um.
2. **A recusa do transporte carrega a informação.** O `403` traz a frase de upgrade, que é o que o cliente MCP mostra à pessoa. Não é um erro mudo.
3. **A informação continua acessível fora do MCP**: `GET /billing/plans` é público (`authenticated: false`) e `GET /billing/subscription` é `allowWithoutPlatformAccess: true`. Uma IA com acesso HTTP, e a própria aplicação, continuam sabendo responder "o que o Pro cobre".
4. **O que fica explicitamente excluído**: uma allowlist de tools "sempre permitidas" à frente do portão do transporte. Isso é o desenho "bloqueia tool, não transporte" que o usuário recusou, e traria a pergunta insolúvel de qual tool é inofensiva o bastante para uma conta sem plano.

Nenhuma alteração em `get_subscription_status` nesta entrega.

## Mapped Changes

**`billing` — a capacidade**

- **`src/billing/domain/capability/capability_key.ts`** — acrescentar `"ai_assistant"` à união `CapabilityKey` (a união é escrita à mão; sem isto o registro não tipa).
- **`src/billing/domain/capability/capability_registry.ts`** — nova entrada `ai_assistant` (D-1). `AccessCapabilityKey` passa a incluí-la automaticamente.
- **`src/billing/domain/capability/`** (arquivo novo, ex. `capability_denied_message.ts`) — `AI_ASSISTANT_CAPABILITY_KEY` e a função de mensagem de recusa extraída (D-9).
- **`src/billing/application/service/`** (arquivo novo, ex. `subscription_ai_assistant_access.ts`) — classe implementando a porta de `auth` sobre `EntitlementService`: `has_platform_access && capabilities.allows(AI_ASSISTANT_CAPABILITY_KEY)` (D-6).
- **`src/billing/infra/di/billing_di.ts`** — fábrica `make…AiAssistantAccess()`, reusando a **mesma** instância de `EntitlementService`.
- **`src/billing/presentation/controller/get_subscription_status.controller.ts`** e **`list_plans.controller.ts`** — os exemplos do `openApiSpec` listam as capacidades uma a uma; acrescentar a chave nova (só documentação, a resposta já é derivada do registro).

**`auth` — o consentimento**

- **`src/auth/application/service/`** (arquivo novo, ex. `ai_assistant_access.ts`) — a interface da porta (D-6). É a única coisa que `billing` importa daqui de novo, e a direção continua `billing → auth`.
- **`src/auth/application/use_case/decide_authorization_request.ts`** — depois do `claim`, antes de resolver Consent/Code: para não-admin, se a porta recusar, devolver o redirect modo B com `error=access_denied` e descrição própria, com `outcome`/decisão distintos de `deny`.
- **`src/auth/application/use_case/get_pending_authorization_request.ts`** — novo fato no resultado ("este chamador pode conectar"), computado só quando há chamador identificado; `true` para admin.
- **`src/auth/presentation/controller/delegated_access/decide_authorization_request.controller.ts`** — mapear o novo desfecho (mesma resposta `200 { redirect_to }` que `deny` já usa) e acrescentar o valor novo ao `#log` da allowlist E7.
- **`src/auth/presentation/controller/delegated_access/get_pending_authorization_request.controller.ts`** — expor o campo novo no corpo (snake_case, junto de `has_existing_consent`) e passar o papel do chamador ao caso de uso.
- **`src/auth/infra/di/auth_di.ts`** — receber a porta no construtor e repassá-la ao caso de uso de decisão (e ao de leitura, se ele passar a consultá-la).
- **`src/auth/presentation/controller/delegated_access/authorize.controller.ts`** e **`initiate_authorization.ts`** — **nenhuma alteração** (não há usuário ali; ver D-6).

**`core` — o transporte MCP**

- **`src/core/infra/mcp/routes.ts`** — a checagem nova entre o portão de platform access e a criação do `McpServer`, reusando o `Entitlement` já resolvido, dentro do bloco de não-admin; log com a chave negada.
- **`src/core/infra/mcp/mcp_tool_adapter.ts`** e **`src/core/infra/http/adapters/http_controller_adapter.ts`** — passar a usar a mensagem extraída em D-9, em vez das cópias locais.
- **`src/core/infra/http/routes/routes.ts`** — mover `billingDi` para antes de `authDi` e injetar a porta no `AuthDi`.

**Fixtures, seed e docs**

- **`tests/helpers/fixtures/plan.ts`** — `TotalCapabilityValues` deixa de ser total sem a chave nova (I-7): `free: false`, `pro: true`. É o mesmo arquivo que `bun run db:seed` usa (`scripts/seed_plans.ts` só o chama), então dev e teste ficam consistentes numa edição só.
- **`CLAUDE.md`** — ver a seção "Documentação" abaixo.

## Ripple obrigatório — os testes de MCP que hoje rodam no plano Free

`createUserFixture` provisiona assinatura **Free**, e `tests/core/mcp_routes.test.ts` e `tests/core/per_user_rate_limit.test.ts` criam usuários assim e chamam `/mcp`. Com a trava, **todos** passariam a tomar `403`. A correção é explícita, nunca implícita: chamar `upgradeToPro(user.id)` (helper que já existe em `tests/helpers/fixtures/plan.ts`) nesses testes. Conceder a capacidade por dentro de `createMcpAccessTokenFixture` seria pior: esconderia a trava de todos os testes de uma vez, e o dia em que ela regredisse ninguém saberia.

## Tasks

1. **Declarar a capacidade `ai_assistant`** — `capability_key.ts`, entrada nova no `CAPABILITY_REGISTRY` (D-1), constante `AI_ASSISTANT_CAPABILITY_KEY`; atualizar `tests/helpers/fixtures/plan.ts` (`free: false`, `pro: true`) e os exemplos de `openApiSpec` de `get_subscription_status`/`list_plans`. Ao final, `bun run typecheck` precisa passar.
   - Dependências: nenhuma
2. **Extrair a mensagem de recusa de capacidade** — função única em `billing/domain/capability/`, consumida por `http_controller_adapter.ts` e `mcp_tool_adapter.ts` (D-9). Refactor puro, sem mudança de comportamento nem de texto.
   - Dependências: nenhuma
3. **Trava no transporte `/mcp`** — checagem depois do portão de platform access, dentro do bloco de não-admin, reusando o `Entitlement` já resolvido; `403` com `ForbiddenError` e a mensagem da task 2; log com a chave negada (D-5).
   - Dependências: tasks 1, 2
4. **Porta `AiAssistantAccess` e sua implementação em `billing`** — interface em `auth/application/service/`, implementação em `billing/application/service/` (`has_platform_access && allows(...)`), fábrica no `BillingDi`, `AuthDi` recebendo a porta, `routes.ts` reordenado e compondo (D-6).
   - Dependências: task 1
5. **Trava no consentimento** — `DecideAuthorizationRequestUseCase` recusando depois do `claim` com modo B/`access_denied` e desfecho próprio; controller mapeando e logando; bypass de admin no caso de uso (D-6, D-8).
   - Dependências: task 4
6. **Fato de UX na consulta da request pendente** — `GetPendingAuthorizationRequestUseCase` + controller expondo "este chamador pode conectar", `true` para admin, `false` quando não há chamador identificado (D-6).
   - Dependências: task 4
7. **Consertar os testes de MCP que rodam no plano Free** — `upgradeToPro` explícito em `tests/core/mcp_routes.test.ts` e `tests/core/per_user_rate_limit.test.ts`; atualizar a lista de chaves de acesso em `tests/billing/capability_registry.test.ts`.
   - Dependências: task 3
8. **Testes da trava do transporte** — arquivo novo `tests/billing/mcp_ai_assistant_gate.test.ts` (D-11 abaixo).
   - Dependências: tasks 3, 7
9. **Testes da trava do consentimento** — arquivo novo `tests/auth/delegated_access/consent_ai_assistant_gate.test.ts` (D-11 abaixo).
   - Dependências: tasks 5, 6
10. **Documentação** — atualizar `CLAUDE.md` (ver "Documentação").
    - Dependências: tasks 3, 5, 6

> Paralelizáveis: **tasks 1 e 2** juntas na largada. Depois de 1, a **task 4** roda em paralelo com a **task 3** (task 3 também espera 2). Depois de 4, as **tasks 5 e 6** rodam em paralelo. As **tasks 8 e 9** rodam em paralelo entre si assim que suas dependências fecharem.

## D-11 — Testes

**Nasce `tests/billing/mcp_ai_assistant_gate.test.ts`** (ao lado de `mcp_platform_access_gate.test.ts`, que já é o molde: `createUserFixture` + `createMcpAccessTokenFixture` + `POST /mcp` com `tools/list`):

- conta **free** com token MCP válido → `403`, mensagem de upgrade, **sem** chegar a `tools/list`
- conta **pro** → caminho feliz, `200`
- conta em **trial** do plano pago → `200` (prova D-3 sem nenhum ramo de `trialing` no código)
- **trial vencido** → `403` pelo portão de platform access, `blocked_reason: "trial_expired"` (prova D-4: revoga sozinho)
- **cancelada com período encerrado** (cai para capacidades do Free, `has_platform_access: true`) → `403` pela trava **nova** — é o caso que só ela pega
- **admin sem assinatura** → passa (D-8)
- token emitido **antes** do downgrade continua sendo aceito como credencial e mesmo assim toma `403` (prova D-7: nada é revogado, a leitura é que recusa)

**Nasce `tests/auth/delegated_access/consent_ai_assistant_gate.test.ts`** (usa `createAppRegistrationFixture` + `createAuthorizationRequestFixture`, que já existem):

- **free** aprovando → `200` com `redirect_to` carregando `error=access_denied`, **nenhum** `Consent` criado e **nenhum** `AuthorizationCode` cunhado; a request pendente fica consumida
- **pro** aprovando → caminho feliz: código cunhado, consent registrado
- **admin** aprovando → passa
- **free** negando → continua sendo `access_denied` "do usuário" (a recusa por plano não pode canibalizar o caminho de negativa)
- consulta da request pendente: fato novo `false` para free, `true` para pro, `true` para admin, `false` sem chamador identificado

**Mudam**: `tests/billing/capability_registry.test.ts` (a lista de chaves `access` é assertada literalmente), `tests/core/mcp_routes.test.ts` e `tests/core/per_user_rate_limit.test.ts` (ripple da seção acima). `tests/helpers/fixtures/plan.ts` muda por I-7 — o `typecheck` cobra.

## Documentação — o que registrar no `CLAUDE.md`

1. Em **"Capacidades de plano"**: a capacidade `ai_assistant` — o que ela governa (o transporte `/mcp` **e** o consentimento OAuth que emite o token dele), por que `default: false`/`required: false` (fail-closed, sem invalidar entrada de catálogo), e por que o nome não é `mcp_access`.
2. Em **"Superfície MCP obrigatória"**: a superfície continua obrigatória para todo caso de uso de escopo de usuário; o que mudou é **quem** alcança a superfície. Uma tool nova continua nascendo junto com a rota, mesmo que planos gratuitos não a alcancem.
3. Em **"Bounded Context `billing`"**: a matriz free/trial/pago sai de um único fato do gateway, sem nenhum ramo de `trialing` no código, porque `trialing` já resolve as capacidades do plano experimentado; e a tabela de D-4 (quem corta o MCP em cada percurso), em especial o caso "cancelada com período encerrado", que só a trava de capacidade pega.
4. Onde hoje se lê que o `/mcp` aplica rate limit e depois o portão de platform access: acrescentar a trava de capacidade **depois** dele, sobre o mesmo `Entitlement`, e o bypass de admin.
5. Uma frase nova sobre credenciais: **downgrade não revoga token nem consentimento**; o corte é na leitura do entitlement, a cada requisição — e é isso que faz upgrade voltar a funcionar sem reconectar a IA.
6. Nas exceções documentadas do MCP: nada muda. Esta não é uma exceção à superfície MCP, é uma **trava comercial sobre ela**.
7. Uma frase permanente, nova, em **"Capacidades de plano"**: **uma capacidade nova só existe no catálogo depois que o registro que a conhece está em produção _e_ o catálogo foi ressincronizado.** O parser itera o `CAPABILITY_REGISTRY` do binário em execução, então nenhuma sincronização feita pelo binário antigo grava a chave nova, por mais correto que esteja o dashboard — e enquanto ela não estiver gravada, todo plano cai no `default` do registro. Vale para toda capacidade futura, e já valeu (sem estar escrito) para `bulk_import` e `export_reports`. O gatilho confiável é `POST /billing/catalog/sync`, não o webhook: o webhook só dispara quando o Price é editado, e uma edição feita antes do deploy nunca volta a disparar.

## Passos de operação — a ordem correta, e por que a intuitiva quebra as contas pagas

### O que o código faz (verificado)

`parseCapabilities` (`src/billing/infra/gateway/stripe_catalog_entry_parser.ts`) itera o **`CAPABILITY_REGISTRY` do binário em execução** e busca cada `metadata_key` dentro do Price — nunca o contrário:

```
for (const entry of CAPABILITY_REGISTRY) {
  const raw = price.metadata[entry.metadata_key];
```

Uma chave de metadata que o registro **em execução** não conhece nunca é lida. E `SyncPlanCatalogEntryUseCase.#applyEntryChanged` grava `capabilities: entry.capabilities` — o **registro inteiro**, não um merge —, então cada sincronização **reescreve** `plans.capabilities` com exatamente as chaves que o binário conhecia naquele instante.

Consequência dura: **nenhuma sincronização executada pelo binário antigo é capaz de gravar `ai_assistant`, faça o dashboard o que fizer.** Editar o `metadata` antes do deploy dispara `price.updated`, o catálogo sincroniza, e a chave é ignorada. Depois do deploy, `CapabilitySet.of()` não a encontra em `plans.capabilities` e cai no `default: false` — **inclusive para o Pro**. Editar o metadata antes do deploy não é errado; o erro é **acreditar que isso resolveu**. O que resolve é sempre uma releitura do gateway feita **depois** do deploy.

### Qual gatilho é confiável

| gatilho                                                                                                      | como funciona                                                                                                                                                                                | confiável?                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Webhook `price.updated` → `SyncPlanCatalogEntryUseCase` (`catalog_entry_changed`, `ignore_staleness: false`) | reaplica **um** Price, e só quando o Price é de fato editado                                                                                                                                 | **Não**, como garantia. Se o metadata foi editado **antes** do deploy, nenhum evento novo dispara depois dele, e o catálogo fica errado indefinidamente. Ainda está sujeito ao descarte por staleness. |
| `POST /billing/catalog/sync` → `ReconcilePlanCatalogFromGatewayUseCase`                                      | lê o catálogo inteiro (`listCatalogEntries()`, `stripe.prices.list({ limit: 100 })`, auto-paginado) e aplica **toda** entrada por `applyReconciledEntry`, que passa `ignore_staleness: true` | **Sim.** Idempotente, não depende de nenhum evento ter disparado, e ignora staleness por construção. É o gatilho a usar.                                                                               |

### Ordem correta

1. **(recomendado, antes do deploy) declarar o metadata nos Prices.** Fazer isto antes tira o humano do caminho crítico depois do deploy e é o que deixa a janela do passo 3 mais curta. O `price.updated` disparado aqui é inócuo — o binário antigo ignora a chave —, e tudo bem: não é ele que resolve.
   - Descobrir o id do Price ativo de cada plano: `SELECT code, external_price_reference FROM plans WHERE code IN ('free','pro');`
   - Pelo dashboard: abrir o Price ativo e acrescentar a chave em **Metadata**. Metadata é mutável — **não** é preciso criar Price novo (ao contrário de mudar preço).
   - Ou, sem depender de rótulo de UI:

     ```
     curl https://api.stripe.com/v1/prices/<price_id_do_pro> \
       -u "$STRIPE_SECRET_KEY:" \
       -d "metadata[sogio_ai_assistant]=true"

     curl https://api.stripe.com/v1/prices/<price_id_do_free> \
       -u "$STRIPE_SECRET_KEY:" \
       -d "metadata[sogio_ai_assistant]=false"
     ```

     Declarar `false` explicitamente no Free é melhor que omitir: cai no mesmo `default: false`, mas some do `warn` de fallback e deixa a intenção legível no dashboard.

2. **Deployar o código.** A partir daqui o registro conhece `ai_assistant` — e a janela do passo 3 está aberta.
3. **Imediatamente, ressincronizar o catálogo.** Este passo é **obrigatório**, não conferência:

   ```
   TOKEN=$(curl -s -X POST "$API_BASE_URL/auth/sign-in" \
     -H 'Content-Type: application/json' \
     -d '{"email":"<admin>","password":"<senha>"}' | jq -r .token)

   curl -s -X POST "$API_BASE_URL/billing/catalog/sync" \
     -H "Authorization: Bearer $TOKEN"
   ```

   Resposta esperada: `{"entries_seen":N}` com `N` ≥ 2. `N = 0` significa chave/ambiente errado do Stripe, não catálogo vazio.

4. **Verificar (passo obrigatório, ver abaixo) antes de considerar o deploy concluído.**

Se o metadata só for declarado **depois** do deploy, o `price.updated` sozinho até resolveria — mas a janela fica maior (deploy → edição manual → entrega do webhook) e passa a depender de entrega assíncrona. Rodar o passo 3 mesmo assim é mais barato que raciocinar sobre isso.

### A janela de indisponibilidade — dimensionada e assumida

- **Quando abre**: no instante em que o processo novo atende a primeira requisição. **Quando fecha**: quando o `POST /billing/catalog/sync` commita.
- **O que acontece dentro dela**: `plans.capabilities` ainda não tem a chave, `CapabilitySet.of()` cai no `default: false` (I-4) e **toda conta paga perde o MCP**, recebendo o `403` de upgrade. Não é degradação teórica: hoje ninguém é bloqueado, então quem usa MCP no Pro sente.
- **Custo do fechamento**: uma chamada `prices.list` (uma página, para um catálogo de poucos Prices) mais um upsert por entrada, síncrono dentro da requisição — trabalho sub-segundo, dominado pela latência do Stripe. Ou seja: **se o passo 3 estiver no script de deploy, logo depois do health check, a janela é de segundos**; feita à mão, é o tempo que a pessoa leva para autenticar e rodar dois curls — minutos.
- **Nada fica gravado errado e nada precisa ser desfeito**: a recusa é derivada na leitura, então a requisição seguinte ao sync já passa. Como nenhum token ou consentimento é revogado (D-7), ninguém precisa reconectar a IA depois.
- **Dá para eliminar, e não só encurtar?** **Não, sem violar a propriedade do catálogo.** A única forma de a janela ser zero seria a linha do Pro já carregar `ai_assistant: true` no instante em que o binário novo sobe — isto é, uma migration escrevendo dentro de `plans.capabilities`. Isso põe **um valor comercial** (qual plano dá IA) dentro de uma migration, que é exatamente o que "registro em código, valores no gateway" proíbe, e seria sobrescrito pela primeira sincronização de qualquer forma. Dito com todas as letras: **a janela existe, não é eliminável sem quebrar essa regra, é da ordem de segundos se automatizada e se cura sozinha no passo 3.** Mitigação que não custa nada: deployar em horário de baixo tráfego e não anunciar o recurso antes do passo 4 passar.

### Verificação obrigatória (passo 4)

```
curl -s "$API_BASE_URL/billing/plans" | jq '.[] | {code, ai_assistant: .capabilities.ai_assistant}'
```

Esperado: `pro → true`, `free → false`. A rota é pública (`authenticated: false`), então não precisa de token.

**Por que essa leitura prova o que precisa ser provado**: a resposta é o `CapabilitySet` **já resolvido**, e o `default` do registro é `false` — então um `true` só pode ter vindo do `jsonb` gravado. (A recíproca não vale: um `false` não distingue "gravado false" de "ausente"; e não precisa, porque o que precisa ser provado é o plano pago.)

Dois sinais de apoio no log, para o caso de o valor não aparecer:

- `"Plan capabilities fell back to registry defaults on write (D-3)"` listando `ai_assistant` para o plano `pro` ⟹ o parser não leu a chave: nome de metadata digitado errado, ou editado no Price errado (o inativo).
- `"Ignoring catalog entry: invalid capability metadata"` ⟹ a chave foi lida mas o valor não parseia como booleano.

### A mesma armadilha já existia — e não está escrita em lugar nenhum

`bulk_import` e `export_reports` foram introduzidas exatamente sob este mecanismo: enquanto o binário sem a chave no registro estava no ar, nenhuma sincronização conseguia gravá-las, e depois do deploy elas valeram `default: false` até alguém ressincronizar. Passou despercebido porque o raio de alcance era o oposto do de agora — `false` significava "recurso novo ainda desligado", e ninguém perde o que nunca teve. Aqui o mesmo `false` **tira** de contas pagas um acesso que elas têm hoje.

Não há frase no `CLAUDE.md` que cubra isso. A mais próxima é o parágrafo de "Registro em código, valores no gateway", que discute o risco de **renomear** uma `metadata_key` (e conclui o contrário para aquele caso: renomear exigiria editar o dashboard **antes** do deploy). Introduzir uma capacidade nova é o caso simétrico e não está documentado — daí o item novo na seção "Documentação".

## Limitações conhecidas, aceitas

- O `sogio-wa-bot` (projeto irmão) consome esta API por MCP: contas free deixam de conseguir usá-lo. É a decisão de produto, não um efeito colateral.
- O front (`sogio-front`, outro repositório) precisa passar a ler o fato novo da request pendente e renderizar a tela de upgrade. Enquanto não o fizer, a pessoa vê a tela de consentimento normal e recebe a recusa depois de clicar em "Autorizar" — degradado, mas nunca inseguro: a trava de verdade é a da task 5.
- A recusa por plano informa ao app de terceiro que a conta não tem plano com IA (via `error_description`). Alternativa seria um erro mudo, que deixaria a pessoa presa.
- O `error_description` do modo B viaja na query string do `redirect_uri` do cliente: nenhum dado pessoal novo entra ali, só a razão da recusa.

## Fluxo de branch

Worktree `.claude/worktrees/block-mcp-for-free-plan`, branch `block-mcp-for-free-plan`, commits em inglês no formato Conventional Commits, um commit por task.
