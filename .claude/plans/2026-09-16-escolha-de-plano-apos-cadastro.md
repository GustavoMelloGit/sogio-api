# Escolha de plano logo após o cadastro

## Objective

O front mostra a tela de planos **uma vez, logo depois do cadastro**, sem bloqueio persistente: quem escolhe o Pro vai para o Checkout (trial de 14 dias); quem continua no Free, fecha a aba ou abandona o Checkout segue no Free. A API não guarda "escolha pendente". O que ela garante é a regra de negócio "todo usuário tem uma assinatura, e quem não é Pro é Free", agora também sob demanda, pela rota do Free.

Na mesma entrega, as URLs de retorno do Checkout e do Portal passam a apontar para `/app`, onde o produto mora no front. Hoje quem volta do Stripe cai num 404.

## Personas

- **Orquestrador**: conduz Arquiteto → Desenvolvedor → Analista de Segurança
- **Arquiteto** (`model: opus`): este plano
- **Desenvolvedor** (`model: sonnet`): implementação
- **Analista de Segurança** (`model: opus`): revisão da rota do Free fora do portão de platform access e do `return_to`

## Revisão desta versão: o que foi descartado e por quê

A primeira versão (commits `4b6f4ad`…`a3ca788`) modelava um bloqueio persistente no front. O usuário trocou por uma tela mostrada uma vez, e com isso sai tudo o que só existia para esse bloqueio:

- **`needs_plan_choice`** (no `GET /billing/subscription` e na tool `get_subscription_status`): sem bloqueio persistente, não há pendência a informar.
- **`plan_chosen_at`** (coluna, agregado, `recordPlanChoice`, `recordPlanChoiceIfAbsent`, registro em `GrantPlanUseCase`/`SyncSubscriptionFromGatewayUseCase`, migration `0018` com backfill): era o armazenamento da pendência. As antigas D-1, D-2, D-3 e D-6 caem juntas.
- **`ConfirmFreePlanChoiceUseCase`**: dava `404` sem assinatura e só gravava a escolha. O comentário do usuário na PR pede o contrário (criar o Free), e isso já é o que `EnsureFreeSubscriptionUseCase` faz.
- **Tool `confirm_free_plan_choice`**: seria um no-op garantido para todo mundo que alcança o `/mcp` (D-4).
- **Rota atrás do portão de platform access** (antiga D-4): tornaria inalcançável o único caso em que a rota tem efeito (D-3).

**Mantido sem mudança:** `return_to` no Checkout e os caminhos sob `/app` no Checkout e no Portal (antiga D-5, agora D-5).

## Contrato com o front

1. `GET /billing/subscription` volta exatamente ao contrato de `origin/main`: **sem** `needs_plan_choice`. O mesmo vale para a tool `get_subscription_status`.
2. `POST /billing/subscription/free-plan`: autenticada, sem corpo, `allowWithoutPlatformAccess: true`, resposta `204`.
   - Usuário **sem** `Subscription`: cria a assinatura Free (`active`, perpétua) e registra a entrada `started` no Histórico.
   - Usuário **com** `Subscription` (Free, Pro em trial, ativo, `past_due`, cancelado ou vencido): no-op. **Nunca troca o plano** e nunca reabre acesso de uma conta bloqueada que tenha assinatura.
   - Nunca `404` nem `403` por falta de assinatura. Os únicos não-2xx previstos são `401` (sem sessão) e `404 Plan` quando o catálogo não tem o plano `free`. Esse segundo caso é falha operacional, a mesma que hoje derruba o próprio cadastro.
   - Sem `rateLimitPolicy`/`userRateLimitPolicy`: é no máximo um `INSERT` na vida da conta (`subscriptions.user_id` é único), e depois disso cada chamada custa uma leitura indexada.
3. `POST /billing/checkout-session` aceita `return_to: "billing" | "onboarding"` opcional (default `"billing"`), validado por enum:
   - `billing`: `/app/settings/billing?checkout=success` e `/app/settings/billing?checkout=canceled`
   - `onboarding`: `/app?checkout=success` e `/app?checkout=canceled`
4. `POST /billing/portal-session` volta para `/app/settings/billing?portal=return`.

**Observação para o front (não é conflito).** `RegisterUserUseCase` espera os handlers de `UserCreatedEvent` terminarem antes de emitir a sessão. Então, no fluxo normal, a assinatura Free já existe quando o front recebe a resposta do cadastro, e "Continuar no Free" é um `204` sem efeito. O front não deve depender dessa chamada para seguir adiante: pode disparar e navegar. A rota só muda estado para uma conta cujo cadastro falhou no handler (catálogo sem `free`, erro de banco) e que entrou depois pelo login. Depois de um `204`, o front deve reler o `GET` uma vez em vez de repetir a chamada em loop: uma conta com assinatura e catálogo sem `free` continua com `blocked_reason: "no_subscription"`.

## Decisões arquiteturais

### D-1: A API não tem o conceito de "escolha de plano"

O fato de negócio é o que o domínio já dizia: cada `User` tem exatamente uma `Subscription`, e quem não assina um plano pago está no Free. Mostrar a tela uma única vez é UX, e UX não vira estado no `billing`. Nada entra no agregado `Subscription`, no `Entitlement` ou no banco. A linguagem ubíqua da API para a rota é **garantir a assinatura Free**, e não "confirmar escolha".

### D-2: A rota do Free é o segundo gatilho de `EnsureFreeSubscriptionUseCase`

`EnsureFreeSubscriptionUseCase` já é o escritor único da regra "sem assinatura, cria no Free; com assinatura, não toca". Hoje ele é disparado pelo cadastro (`StartFreeSubscriptionOnUserCreated`). A rota vira o segundo gatilho da **mesma** regra, e nenhum caso de uso novo é criado. Com isso:

- Uma assinatura criada pela rota é indistinguível de uma criada pelo cadastro: mesmo `Subscription.create`, mesmo `SubscriptionStartedEvent`, mesma entrada `started` no Histórico.
- "Nunca troca o plano" vale por construção, porque o caso de uso retorna antes de ler o catálogo quando a assinatura existe.
- O `user_id` vem **só** da sessão. A rota não tem corpo nem parâmetro, e o controller monta `{ user_id: user.id }`.
- `ConfirmFreePlanChoiceUseCase` é apagado. O controller deixa de falar em "escolha de plano" e é nomeado a partir do caso de uso (ex.: `EnsureFreeSubscriptionController`). O caminho `/billing/subscription/free-plan` fica como está, porque é o contrato com o front.

**Risco aceito: duplo clique numa conta sem assinatura.** Duas chamadas simultâneas leem "sem assinatura" e as duas tentam inserir. A restrição única em `subscriptions.user_id` preserva "exatamente uma `Subscription` por `User`". A perdedora falha com `500` antes de despachar `SubscriptionStartedEvent`, então não sobra estado parcial nem Histórico duplicado, e uma nova tentativa responde `204`. Tratar a corrida mudaria o caminho de escrita que o cadastro também usa, por um caso que o fluxo de cadastro não produz (ver a observação para o front). Não se paga.

### D-3: `allowWithoutPlatformAccess: true`

**Por quê.** O único estado que a rota muda é, por definição, um estado bloqueado: conta sem `Subscription` ⇒ `blocked_reason: "no_subscription"`. Atrás do portão, a rota daria `403` justamente no único caso em que tem efeito, e o comentário do usuário ("crie uma subscription pra ele, pro free") ficaria inalcançável pela API para todo não-admin. Ela entra na mesma família do Checkout e do Portal: uma rota que uma conta bloqueada precisa alcançar para sair do bloqueio. Com ela, a frase do `CLAUDE.md` "uma conta sem `Subscription` fica bloqueada até intervenção manual" deixa de ser verdade.

**Só a conta sem assinatura sai do bloqueio pela rota; nenhuma conta bloqueada que tenha assinatura se desbloqueia por ela.** Verificação por motivo de bloqueio:

| Situação                                           | Tem `Subscription`? | Efeito da rota                                                                                          |
| -------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| `no_subscription`, sem linha                       | não                 | cria o Free: o estado que o cadastro teria produzido, só com as capacidades do Free                     |
| `no_subscription` porque o catálogo não tem `free` | sim                 | no-op, segue bloqueada                                                                                  |
| `trial_expired` (trial do Pro vencido)             | sim                 | no-op, segue bloqueada; a saída continua sendo o Checkout/Portal                                        |
| `period_expired` (Pro vencido)                     | sim                 | no-op, segue bloqueada                                                                                  |
| `payment_failed` (`past_due` fora da carência)     | sim                 | no-op, segue bloqueada                                                                                  |
| Pro cancelado (dentro ou fora do período)          | sim                 | não está bloqueada; no-op, plano e status intactos (fora do período já resolve para o Free pela policy) |
| Admin sem assinatura                               | não                 | já passa pelo portão; ganha o Free, sem risco                                                           |

**Não abre caminho para zerar o trial.** Uma linha de `subscriptions` só some junto com o `User` (`ON DELETE cascade` no purge LGPD), e nenhum caminho apaga só a assinatura. Portanto não dá para fabricar o estado "sem assinatura" numa conta que já teve uma e ganhar outro trial pelo Checkout.

### D-4: Sem tool MCP, com a exceção registrada

A regra do projeto proíbe justificar a ausência de tool pela capacidade ("capacidade decide quem alcança, nunca se ela nasce"). Então o motivo **não** é "o Free não tem `/mcp`". O motivo que vale é o **platform access**: `/mcp` exige `has_platform_access` de todo não-admin antes de qualquer tool, e o único caso em que o caso de uso tem efeito (conta sem `Subscription`) é justamente o caso sem platform access. Para todo usuário que alcança uma tool, ela seria um no-op por construção. A conclusão não muda se o Free ganhar `ai_assistant` um dia.

Exceção a registrar em "Demais exceções" do `CLAUDE.md`: **garantia da assinatura Free** (`POST /billing/subscription/free-plan`), cujo único efeito é inalcançável pelo `/mcp`, que exige platform access.

Continuam sem tool pelas exceções já documentadas: `POST /billing/checkout-session` e `POST /billing/portal-session` ("sessões de pagamento que devolvem URL para um humano abrir"; o `return_to` não muda isso) e o webhook ("webhooks de terceiros").

### D-5: `return_to` é enum fechado; a URL é montada no servidor (mantida)

`return_to` nunca é um caminho: é uma chave (`billing`, `onboarding`) que o caso de uso traduz para um par de caminhos fixos, sempre prefixados por `FRONT_BASE_URL`. Qualquer outro valor dá `422`. O default `"billing"` é aplicado no schema do controller. As chaves e os caminhos vivem em `create_checkout_session.ts`, e o controller importa a lista para o `z.enum`. Nada disso muda nesta revisão.

### D-6: A migration `0018` é apagada, sem migration de drop

Apagar `drizzle/0018_tired_blue_marvel.sql` e `drizzle/meta/0018_snapshot.json` e remover a entrada `idx: 18` de `drizzle/meta/_journal.json`, deixando `drizzle/` byte a byte igual a `origin/main`. **Não** criar uma `0019` com `DROP COLUMN`. Motivos:

- A migration nunca chegou a um banco que importe. O deploy (`.github/workflows/deploy.yml`) faz `git reset --hard origin/main` e roda `db:migrate` a partir de `main`, e a PR nunca foi mergeada. Nenhum `__drizzle_migrations` de produção tem essa linha.
- A suíte de testes aplica o schema por `drizzle-kit push --force` (`tests/test_database.ts`), nunca pelas migrations. O banco de teste de cada worktree perde a coluna sozinho no próximo `bun run test`.
- Uma `0019` de drop deixaria em `main`, para sempre, um par add+backfill+drop de uma coluna que nunca existiu em produção, além de uma `0018` cujo backfill não serve para nada.

**Verificação:** `git diff origin/main -- drizzle/` vazio, e `bun run db:migration` (`drizzle-kit generate`) não gera arquivo nenhum depois de reverter o schema. Se gerar, schema e snapshot divergiram e a reversão está incompleta.

**Única ressalva:** um banco **local de desenvolvimento** em que alguém rodou `bun run db:migrate` nesta branch fica com a coluna `plan_chosen_at` órfã e uma linha a mais em `__drizzle_migrations`. É inofensivo: a coluna é anulável e o Drizzle ignora colunas fora do schema, e a próxima migration real terá `when` maior e será aplicada normalmente. Para limpar, basta `ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "plan_chosen_at"` à mão nesse banco.

## Mapped Changes

**Voltam exatamente ao conteúdo de `origin/main`:**

- **`src/core/infra/database/drizzle/schemas/billing_schemas.ts`**: sai a coluna `plan_chosen_at`
- **`drizzle/meta/_journal.json`**: sai a entrada `0018`
- **`src/billing/domain/entity/subscription.ts`**: saem `plan_chosen_at`, `recordPlanChoice` e `needs_plan_choice`
- **`src/billing/domain/repository/subscription_repository.ts`**: sai `recordPlanChoiceIfAbsent`
- **`src/billing/infra/database/postgres_repository/subscription_postgres_repository.ts`**: sai `recordPlanChoiceIfAbsent` e o campo em `save()`
- **`src/billing/application/use_case/grant_plan.ts`**: sai `recordPlanChoice()`
- **`src/billing/application/use_case/sync_subscription_from_gateway.ts`**: saem as duas chamadas de `recordPlanChoice`
- **`src/billing/application/use_case/get_subscription_status.ts`**: sai `needs_plan_choice` e a dependência de `SubscriptionRepository`
- **`src/billing/presentation/controller/get_subscription_status.controller.ts`**: sai o campo do `outputSchema`, da descrição e do exemplo
- **`src/billing/presentation/mcp_tool/get_subscription_status.mcp_tool.ts`**: descrição original
- **`src/core/infra/mcp/routes.ts`**: sai `makeConfirmFreePlanChoiceTool()`
- **`tests/core/mcp_routes.test.ts`**: sai `confirm_free_plan_choice` da lista
- **`tests/billing/subscription_entitlement_service.test.ts`**: sai o stub de `recordPlanChoiceIfAbsent`

**Apagados:**

- **`drizzle/0018_tired_blue_marvel.sql`** e **`drizzle/meta/0018_snapshot.json`** (D-6)
- **`src/billing/application/use_case/confirm_free_plan_choice.ts`** (D-2)
- **`src/billing/presentation/mcp_tool/confirm_free_plan_choice.mcp_tool.ts`** (D-4)
- **`tests/billing/subscription_plan_choice.test.ts`**, **`tests/billing/plan_choice_recorded_by_gateway.test.ts`** e **`tests/billing/plan_choice_backfill_migration.test.ts`**: testam só o que saiu

**Alterados:**

- **`src/billing/presentation/controller/confirm_free_plan_choice.controller.ts`**: renomeado a partir do caso de uso (ex.: `ensure_free_subscription.controller.ts`). Chama `EnsureFreeSubscriptionUseCase` com `{ user_id: user.id }`. A OpenAPI descreve "garante a assinatura; cria o Free se não houver; nunca troca plano", com respostas `204`, `401` e `404` (catálogo sem `free`)
- **`src/billing/infra/di/billing_di.ts`**: saem as fábricas de `ConfirmFreePlanChoice*`, e o construtor de `GetSubscriptionStatusUseCase` volta ao original. A fábrica do controller reusa `makeEnsureFreeSubscriptionUseCase()`
- **`src/core/infra/http/routes/routes.ts`**: a rota ganha `allowWithoutPlatformAccess: true` (D-3)
- **`tests/billing/confirm_free_plan_choice.test.ts`**: reescrito como teste da rota do Free (ex.: `tests/billing/ensure_free_subscription_route.test.ts`); ver task 1
- **`tests/billing/get_subscription_status.test.ts`**: asserção de ausência de `needs_plan_choice`; ver task 2
- **`CLAUDE.md`**: ver task 4

**Sem mudança (ficam como na PR):** `create_checkout_session.ts`, `create_checkout_session.controller.ts`, `create_billing_portal_session.ts`, `tests/billing/create_checkout_session.test.ts`, `tests/billing/create_billing_portal_session.test.ts`.

## Tasks

A PR #80 já está publicada: tudo vai em commits novos, sem reescrever o histórico.

1. **Rota do Free sobre `EnsureFreeSubscriptionUseCase`, sem tool MCP** (D-2, D-3, D-4)
   - Apagar `ConfirmFreePlanChoiceUseCase` e a tool `confirm_free_plan_choice`. Renomear e reescrever o controller. Ajustar `billing_di.ts` (só as fábricas da confirmação). Colocar `allowWithoutPlatformAccess: true` na rota em `routes.ts`. Tirar a tool de `src/core/infra/mcp/routes.ts` e de `tests/core/mcp_routes.test.ts`.
   - Testes: reescrever `tests/billing/confirm_free_plan_choice.test.ts` (novo nome) com os casos:
     - conta **sem** `Subscription` → `204`; passa a existir uma assinatura no plano `free`, `active`, com `current_period_end` nulo; existe uma entrada `started` no Histórico; `GET /billing/subscription` agora dá `has_platform_access: true`. Isso prova ao mesmo tempo que a rota é alcançável sem platform access e que ela desbloqueia esse caso
     - Free existente → `204`; mesmo `id` de assinatura, `updated_at` intacto, nenhuma entrada nova no Histórico
     - Pro do gateway (`active` e `trialing`) → `204`; `plan_id`, `status` e `external_reference` intactos
     - conta bloqueada **com** assinatura (`blockUser` de `tests/helpers/block_user.ts` → `payment_failed`) → `204`, não `403`; o `GET` segue `has_platform_access: false` com o mesmo `blocked_reason`
     - Pro vencido (`period_expired`) e Pro cancelado → `204`; plano e status intactos
     - sem sessão → `401`
     - admin sem assinatura → `204` e ganha o Free
   - Sai o que testava `recordPlanChoiceIfAbsent`, o `404` por falta de assinatura, o `403` do portão e a tool.
   - Dependencies: none
2. **Tirar `needs_plan_choice` da leitura de status** (D-1)
   - `get_subscription_status.ts`, o controller, a descrição da tool e o construtor em `billing_di.ts` voltam a `origin/main`.
   - Testes: em `tests/billing/get_subscription_status.test.ts`, afirmar que o corpo do `GET` não tem a chave `needs_plan_choice`.
   - Dependencies: task 1 (as duas mexem em `billing_di.ts`)
3. **Remover `plan_chosen_at` do modelo e do banco** (D-1, D-6)
   - Reverter o schema Drizzle, `Subscription`, a interface e a implementação do repositório, `GrantPlanUseCase` e `SyncSubscriptionFromGatewayUseCase`. Apagar a `0018` (sql + snapshot + entrada do journal). Reverter o stub em `tests/billing/subscription_entitlement_service.test.ts`. Apagar `subscription_plan_choice.test.ts`, `plan_choice_recorded_by_gateway.test.ts` e `plan_choice_backfill_migration.test.ts`.
   - Verificar `git diff origin/main -- drizzle/` vazio e que `bun run db:migration` não gera arquivo.
   - Dependencies: tasks 1, 2 (os consumidores de `needs_plan_choice` e `recordPlanChoiceIfAbsent` precisam sair antes, para o `typecheck` seguir verde)
4. **`CLAUDE.md`**
   - Reescrever "Escolha de plano após o cadastro" em poucas linhas:
     - a tela é só do front e aparece uma vez; a API não tem pendência nem coluna
     - `POST /billing/subscription/free-plan` é o gatilho sob demanda de `EnsureFreeSubscriptionUseCase` (cria o Free sem assinatura, no-op com assinatura, nunca troca plano, registra `started`)
     - `allowWithoutPlatformAccess: true` com o motivo de D-3
     - no fluxo normal a chamada é no-op, porque o cadastro espera o handler
     - manter o link para este plano
   - Em "Bounded Context `billing`", acrescentar a rota do Free à lista de exceções do portão e trocar "uma conta sem `Subscription` fica bloqueada até intervenção manual" pela saída via rota do Free.
   - Em "Demais exceções" da superfície MCP, acrescentar a garantia da assinatura Free com o motivo de D-4 (platform access, não capacidade).
   - Manter o parágrafo das URLs de retorno como está.
   - Dependencies: tasks 1, 2, 3
5. **Verificação final**
   - `bun run typecheck`, `bun run lint:check`, `bun run format:check` e `bun run test` verdes.
   - `grep -rn "plan_chosen_at\|needs_plan_choice\|recordPlanChoice\|confirm_free_plan_choice\|ConfirmFreePlanChoice" src tests drizzle CLAUDE.md` vazio.
   - `git diff origin/main --stat` restrito a: Checkout/Portal (`return_to` e `/app`) e seus testes; controller, DI e rota do Free com o teste dela; `get_subscription_status.test.ts`; `CLAUDE.md`; este plano.
   - Dependencies: task 4
6. **Revisão de segurança** (Analista)
   - Foco:
     - rota de escrita com `allowWithoutPlatformAccess: true` (tabela de D-3; nenhuma conta com assinatura muda de estado)
     - alvo só pela sessão (IDOR, mass assignment)
     - escrita autenticada por cookie passando por `assertSameSiteRequest`
     - ausência de rate limit (D-2 e contrato)
     - corrida do duplo clique (risco aceito em D-2)
     - `return_to` sem caminho vindo do chamador (D-5)
     - exceção MCP de D-4
   - Registrar o resultado neste plano.
   - Dependencies: task 5

## Revisão de Segurança

**Analista de Segurança, 2026-09-16.** Escopo: `git diff origin/main` da branch `feat/plan-choice-after-signup`, com foco em `8c05aae`…`5e07a1e`. Além da leitura do código, uma sonda descartável (não commitada) rodou contra o servidor de teste: 20 chamadas paralelas numa conta sem assinatura, escrita por cookie com e sem `Origin` da allowlist, e uma conta `trial_expired` enviando corpo forjado.

**Resultado: nenhum achado crítico nem moderado.** Os quatro achados abaixo são informativos e nenhum bloqueia o merge.

### Verificações que passaram

- **Exceção ao portão de platform access (D-3).** `EnsureFreeSubscriptionUseCase` retorna antes de ler o catálogo quando existe qualquer linha em `subscriptions` para o `user_id`, sem olhar o status (`ensure_free_subscription.ts:25-28`). Nenhuma conta bloqueada com assinatura muda de estado. Isso está coberto por teste para `payment_failed` e para Pro ativo, em trial, vencido e cancelado, e a sonda confirmou `trial_expired`: a conta segue `trialing`, com `blocked_reason: "trial_expired"`. Nenhum caminho apaga só a assinatura: a única remoção é o cascade do purge LGPD (`auth_postgres_repository.ts:138`). Por isso não dá para fabricar o estado "sem assinatura" e ganhar um segundo trial pelo Checkout, que só oferece trial com `trial_ends_at === null`.
- **Concorrência (D-2).** Na sonda, 20 POSTs paralelos deram 1×`204` e 19×`500`, todos com o corpo genérico `{"message":"Internal server error"}`. Ficou 1 linha em `subscriptions` e 1 entrada `started` no Histórico. A restrição `subscriptions_user_id_unique` (`drizzle/0007_robust_cobalt_man.sql:31`) barra o segundo `INSERT`, e o `dispatch` só roda depois do `save` (`ensure_free_subscription.ts:43-45`). Por isso a chamada perdedora não emite `SubscriptionStartedEvent`, cujo único handler é o do Histórico. A janela acontece uma vez na vida da conta: depois que a linha existe, toda chamada é `204` sem escrita, e o `500` não se repete.
- **IDOR e mass assignment.** O controller não declara `inputSchema` e ignora a requisição. O alvo vem só de `user.id` da sessão (`ensure_free_subscription.controller.ts:32-35`). Na sonda, um corpo com o `user_id` de outra conta, `plan_code: "pro"` e `status: "active"` recebeu `204`: a outra conta continuou sem linha e a assinatura do chamador ficou intacta.
- **CSRF.** `assertSameSiteRequest` roda em toda rota autenticada antes de `authenticate`, com ou sem `allowWithoutPlatformAccess` (`http_controller_adapter.ts:497`). Na sonda, cookie com `Origin: https://evil.example` deu `403`, cookie sem `Origin` deu `403` e nenhuma assinatura foi criada. Com a origem da allowlist, `204`. O cookie ainda é `SameSite=Lax`. E o pior caso de um CSRF aqui seria criar o Free de uma vítima sem assinatura, que é o próprio comportamento desejado.
- **Open redirect (D-5).** `return_to` é `z.enum(CHECKOUT_RETURN_TARGETS)` (`create_checkout_session.controller.ts:22`) e vira caminhos fixos sob `FRONT_BASE_URL` (`create_checkout_session.ts:24-36`). O Portal usa uma constante (`create_billing_portal_session.ts:14`). Um teste HTTP ainda trava a regra: `https://evil.example/phish`, `/app/settings/billing`, `//evil.example`, `BILLING` e `""` dão `422` (`tests/billing/create_checkout_session.test.ts:396-419`).
- **Exceção MCP (D-4).** Procede. `/mcp` exige `has_platform_access` de todo não-admin (`src/core/infra/mcp/routes.ts:254-258`), e `SubscriptionEntitlementService` nunca concede acesso sem assinatura. A tool seria um no-op para todo não-admin que chegasse até ela.
- **LGPD.** Nenhum dado pessoal novo. A rota grava a mesma linha e a mesma entrada de Histórico que o cadastro já grava (execução de contrato), e as duas têm `ON DELETE cascade` a partir de `users`. A saída de `plan_chosen_at` reduz o que fica armazenado.
- **Resíduos.** `git diff origin/main -- drizzle/ src/core/infra/database/` está vazio: schema, snapshots e journal são idênticos a `main`. Não há `plan_chosen_at`, `needs_plan_choice`, `recordPlanChoice` nem `confirm_free_plan_choice` em `src`, `drizzle` ou `CLAUDE.md`. Em `tests`, as únicas ocorrências são as asserções de ausência de `get_subscription_status.test.ts:54,82`, que a task 2 pediu. A exceção fica na documentação OpenAPI do Checkout (I-1).

### Achados

**INFORMATIVO I-1: resíduo de "escolha de plano" na OpenAPI do Checkout**

- Onde: `src/billing/presentation/controller/create_checkout_session.controller.ts:46`
- Problema: a descrição termina com "Creating a session never records the initial plan choice — only the subscription actually starting does.". A API não registra mais escolha nenhuma (D-1), então o `/docs` descreve um estado que não existe. O trecho "where the initial plan choice happens" também amarra o contrato da API a uma tela do front.
- Impacto: documentação enganosa para integradores e para a IA que lê o spec. Sem impacto de segurança.
- Correção: apagar a última frase e encurtar o trecho do `onboarding` para "`onboarding` returns to the app home.".

**INFORMATIVO I-2: o `500` da corrida loga SQL, parâmetros e stack**

- Onde: `src/core/infra/http/adapters/http_controller_adapter.ts:333` (erro não mapeado numa rota que não é de protocolo), disparado por `subscription_postgres_repository.ts:144`
- Problema: na sonda, cada chamada perdedora logou em `ERROR` a mensagem do Drizzle (`Failed query: insert into "subscriptions" ... params: <id>, <created_at>, <updated_at>, <user_id>, <plan_id>, active, ...`) com o stack. Hoje os parâmetros são só identificadores e datas, sem nome nem email. O volume é limitado a uma janela por conta. O risco foi aceito em D-2, e esta revisão concorda.
- Impacto: ruído em alerta de erro, porque um duplo clique vira um `ERROR` com stack. Pela LGPD, o log leva o `user_id` pseudonimizado, como outros logs já levam.
- Recomendação (opcional): se o ruído incomodar em produção, o caminho barato é um método de repositório com `insert ... on conflict (user_id) do nothing returning id`, usado só por `EnsureFreeSubscriptionUseCase`, que despacha o evento apenas quando uma linha volta. **Nunca** `on conflict (user_id) do update`: isso transformaria uma corrida com o webhook na sobrescrita de uma assinatura Pro pelo Free.

**INFORMATIVO I-3: rota sem rate limit**

- Onde: `src/core/infra/http/routes/routes.ts:335-339`
- Análise: cada chamada custa a leitura da sessão, a do usuário e uma leitura indexada de `subscriptions` (o `touch` da sessão tem throttle), sem chamada ao gateway. A escrita acontece no máximo uma vez na vida da conta. O perfil é o mesmo de `GET /billing/subscription` e `GET /billing/subscription/history`, também alcançáveis sem platform access e sem limite. A rota não abre superfície nova de abuso. No caso operacional de catálogo sem `free`, cada chamada gera um `404` logado em `ERROR`: um flood de log autenticado igual ao de qualquer rota que responde `404`.
- Recomendação (opcional): para ficar uniforme com Checkout e Portal, um `userRateLimitPolicy` de cerca de 30 chamadas por minuto por usuário.

**INFORMATIVO I-4: as garantias da corrida não têm teste de regressão**

- Onde: `tests/billing/ensure_free_subscription_route.test.ts`
- Problema: a integridade do risco aceito em D-2 depende de três fatos que nenhum teste trava: a unicidade de `subscriptions.user_id`, `save()` fazer `INSERT` em vez de upsert por `user_id`, e o `dispatch` vir depois do `save`. Um refactor que mude qualquer um deles passaria na suíte e poderia duplicar o Histórico ou sobrescrever uma assinatura.
- Recomendação: um teste que dispare cerca de 5 chamadas paralelas numa conta sem assinatura e afirme **só o estado final**: exatamente 1 linha, exatamente 1 entrada `started`, e nenhuma resposta fora de `204`/`500`, sem fixar quantos `500` saem. Com menos valor, também faltam o `404` com catálogo sem `free` e um teste de CSRF específico da rota. O teste genérico de CSRF já existe em `tests/auth/session_cookie.test.ts:173,232`.
