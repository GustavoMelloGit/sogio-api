# Escolha de plano logo após o cadastro

## Objective

Hoje o cadastro cria uma `Subscription` no Free automaticamente (`StartFreeSubscriptionOnUserCreated` → `EnsureFreeSubscriptionUseCase`), e o sistema não consegue distinguir "escolheu o Free" de "nunca escolheu". O front vai bloquear o app logo depois do cadastro até a pessoa escolher o plano inicial — Free (confirma e segue) ou Pro (vai direto para o Checkout, com trial de 14 dias). O bloqueio precisa sobreviver a fechar a aba, trocar de dispositivo e abandonar o Checkout, então o fato "a escolha inicial já foi feita" tem que morar na API.

Na mesma entrega: as URLs de retorno do Checkout e do Portal apontam para `/settings/billing`, mas o front moveu o produto para baixo de `/app` — hoje quem volta do Stripe cai num 404.

## Personas

- **Orquestrador** — conduz o fluxo Arquiteto → Desenvolvedor → Analista de Segurança
- **Arquiteto** (`model: opus`) — este plano, vocabulário e decisões
- **Desenvolvedor** (`model: sonnet`) — implementação
- **Analista de Segurança** (`model: opus`) — revisão do `return_to` (open redirect) e da rota nova

## Contrato já combinado com o front (não reabrir)

1. `GET /billing/subscription` ganha `needs_plan_choice: boolean` — `true` só quando existe `Subscription` e a escolha inicial nunca foi registrada; `false` quando não há `Subscription` nenhuma. A tool `get_subscription_status` compartilha o caso de uso e expõe o mesmo campo.
2. `POST /billing/subscription/free-plan` — autenticada, sem corpo, `204`. Registra que a pessoa escolheu ficar no Free. Idempotente: com a escolha já registrada (inclusive numa assinatura Pro do gateway) é no-op silencioso `204`, e **nunca troca o plano**. `404` sem `Subscription`.
3. A escolha também é registrada quando uma assinatura do gateway começa/ativa/entra em trial via webhook, e quando `GrantPlanUseCase` concede um plano. Criar sessão de Checkout **não** registra — abandonar o Checkout devolve a pessoa à tela de escolha.
4. `POST /billing/checkout-session` aceita `return_to: "billing" | "onboarding"` opcional (default `"billing"`), validado por enum:
   - `billing`: `/app/settings/billing?checkout=success` e `/app/settings/billing?checkout=canceled`
   - `onboarding`: `/app?checkout=success` e `/app?checkout=canceled`
5. `POST /billing/portal-session` volta para `/app/settings/billing?portal=return`.

## Decisões arquiteturais

### D-1 — O fato é "escolha de plano", e ele pertence a `Subscription`

A escolha inicial é um fato sobre o vínculo entre o usuário e o plano — exatamente o que `Subscription` modela —, não sobre identidade (`auth`) nem sobre acesso. Fica em `billing`, dentro do agregado `Subscription`, como `plan_chosen_at` (timestamp anulável).

**Não é entitlement.** `Entitlement` é o que as travas de acesso consomem (`core/infra/http`, `core/infra/mcp`, `property_management`); a escolha de plano não libera nem bloqueia nada na API — quem bloqueia é o front. Colocar o campo no `Entitlement` faria o Open Host Service de acesso carregar estado de onboarding. `GetSubscriptionStatusUseCase` passa a ler a `Subscription` pelo repositório, além do `EntitlementService`: são duas leituras nessa rota, aceitas porque a rota não é um portão (a regra "capacidade nunca é uma segunda ida ao banco" vale para as travas, não para esta leitura).

**A API não impõe a escolha.** Nenhuma rota, tool ou portão passa a recusar quem ainda não escolheu — o bloqueio é de UX, no front. Uma conta com `needs_plan_choice: true` continua usando a API e o `/mcp` exatamente como hoje (no Free, o `/mcp` já está fechado por `ai_assistant`).

**Nome.** `plan_chosen_at` no banco e no agregado; `needs_plan_choice` na resposta HTTP e como getter derivado do agregado (`plan_chosen_at === null`), no mesmo idioma de `has_paid_cycle`. O timestamp é **escrito uma vez**: registrar de novo é no-op, então ele é sempre o instante da primeira escolha, e nunca volta a `null`.

### D-2 — Invariante: `plan_chosen_at` nulo implica Free e nenhuma assinatura no gateway

Toda transição que tira uma `Subscription` do Free recém-criado registra a escolha: `GrantPlanUseCase` e as duas sincronizações que colocam uma assinatura do gateway em `trialing`/`active` (`SyncSubscriptionFromGatewayUseCase.#syncTrialing` e `#syncToActive`). `cancel`/`markPastDue` só alcançam uma assinatura que tem `external_reference`, e ela só é gravada por essas mesmas sincronizações. Por isso a rota do Free não precisa conferir o plano atual: se a escolha ainda não foi registrada, a pessoa está no Free por construção.

O registro é **explícito nos casos de uso**, não escondido dentro de `activate`/`changePlan`/`startTrialUntil`: `activate` também é renovação e é chamado por `Subscription.create`; amarrar a escolha a ele esconderia a regra num efeito colateral. O instante registrado no caminho do webhook é `event.occurred_at`.

Casos que deliberadamente **não** registram:

- **Criar sessão de Checkout** — abandonar o Checkout tem que devolver a pessoa à tela.
- **`checkout_completed` (`BindGatewayCustomerUseCase`)** — o contrato amarra a escolha à assinatura começando, não ao fim da sessão. Consequência para o front: logo depois de `?checkout=success`, `needs_plan_choice` pode continuar `true` por alguns segundos, até o webhook da assinatura chegar.
- **`subscription_state_changed` com Price desconhecido no trial** (`#syncTrialing` sem plano resolvido) — nada muda localmente e o erro já é logado; é caso de catálogo quebrado, com intervenção manual.
- **`incomplete`/`paused`** — ignorados como hoje; uma assinatura `incomplete` ainda não é uma escolha consumada.

### D-3 — Confirmar o Free é uma escrita atômica, não `save()` da linha inteira

`SubscriptionPostgresRepository.save()` regrava todas as colunas. Se a confirmação do Free lesse a assinatura e salvasse a linha inteira enquanto o webhook do Pro ativa a mesma assinatura (duas abas, cliques simultâneos), a escrita velha apagaria `plan_id`/`status`/`external_reference` do Pro — e o evento do gateway já teria sido reivindicado em `processed_gateway_events`, então nada o reprocessa até o próximo evento, que pode vir dias depois: uma pessoa pagando sem o Pro. Por isso a confirmação usa `recordPlanChoiceIfAbsent(subscription_id, chosen_at)`, um `UPDATE ... SET plan_chosen_at WHERE id = ? AND plan_chosen_at IS NULL` — mesmo idioma de `linkCustomerReferenceIfAbsent`, que já existe pelo mesmo motivo (corrida entre Checkout e webhook).

Risco considerado e **não** tratado: um `save()` de linha inteira feito a partir de uma leitura anterior à confirmação poderia devolver `plan_chosen_at` a `null`. O único caminho realista é `BindGatewayCustomerUseCase` (`checkout_completed`) concorrendo com um clique no Free — e ele se corrige sozinho, porque o webhook da assinatura registra a escolha logo depois. `cancel`/`markPastDue` só tocam assinaturas que já têm a escolha registrada. Um `coalesce` em `save()` não se paga.

### D-4 — `POST /billing/subscription/free-plan` fica atrás do portão de platform access

A rota **não** declara `allowWithoutPlatformAccess`. A lista de exceções existe para rotas que uma conta bloqueada precisa alcançar para sair do bloqueio (conta própria, LGPD, Checkout, Portal). Uma conta com a escolha pendente está, por D-2, num Free perpétuo e `active` — sempre com acesso. Uma conta bloqueada nunca tem a escolha pendente, e a saída dela continua sendo Checkout/Portal.

Consequência aceita: pela API HTTP, uma conta **sem** `Subscription` toma `403` do portão antes de chegar ao `404` do caso de uso (o `404` segue alcançável para admin, que passa pelo portão, e é o que o caso de uso lança). O front nunca chama a rota nesse caso, porque `needs_plan_choice` é `false` sem `Subscription`.

Sem `rateLimitPolicy`/`userRateLimitPolicy`: é uma escrita barata, idempotente e sem efeito externo — depois da primeira chamada é uma leitura só, o mesmo custo de `GET /billing/subscription`. Mesmo tratamento das rotas de escrita de `notification`.

### D-5 — `return_to` é enum fechado; a URL é montada no servidor

`return_to` nunca é um caminho: é uma chave (`billing`, `onboarding`) que o caso de uso traduz para um par de caminhos fixos, sempre prefixados por `FRONT_BASE_URL`. Qualquer outro valor é `422`. O default `"billing"` é aplicado no schema do controller, preservando o contrato de quem já chama sem o campo. As chaves e os caminhos vivem em `create_checkout_session.ts` (o caso de uso já era o dono dos caminhos); o controller importa a lista de chaves para o `z.enum`, então não há uma segunda cópia.

### D-6 — Migration com backfill

Coluna nova anulável `plan_chosen_at timestamptz` e, na mesma migration, `UPDATE "subscriptions" SET "plan_chosen_at" = "created_at" WHERE "plan_chosen_at" IS NULL` — toda conta existente conta como quem já escolheu, então ninguém de hoje vê a tela. Mesmo formato de backfill de `0013` e `0017`. Só adiciona coluna, então `drizzle-kit generate` não abre o prompt de rename.

Janela de deploy: `db:migrate` roda antes do `pm2 restart`. Quem se cadastrar entre a migration e o restart nasce com `null` pelo binário antigo e verá a tela uma vez — é o comportamento correto para uma conta nova.

A suíte aplica o schema por `push`, nunca o SQL das migrations; o backfill é testado executando os `UPDATE` do próprio arquivo da migration contra o banco de teste.

## Superfície MCP

- **`confirm_free_plan_choice` — tool nova.** É ação do próprio usuário, e nenhuma exceção documentada cobre "confirmar a escolha de plano". `get_subscription_status` passa a expor `needs_plan_choice`; sem a tool, uma IA veria a pendência sem conseguir resolvê-la. Hoje quem tem a escolha pendente está no Free e o `/mcp` está fechado para o Free por `ai_assistant` — a regra do projeto é explícita: capacidade decide quem alcança a superfície, nunca se ela nasce. A descrição da tool diz com todas as letras que ela **não** faz downgrade nem troca de plano, para uma IA não usá-la quando um assinante Pro pede para "voltar ao grátis" e reportar sucesso falso. Anotações: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`. Resposta `{ success: true }`, como `delete_ledger_entry`.
- **`POST /billing/checkout-session` e `POST /billing/portal-session`** — continuam sem tool: exceção documentada "sessões de pagamento que devolvem URL para um humano abrir". O `return_to` não muda isso.
- **Webhook** — exceção "webhooks de terceiros", como já era.

## Mapped Changes

- **`src/core/infra/database/drizzle/schemas/billing_schemas.ts`** — coluna `plan_chosen_at` em `subscriptionsTable`
- **`drizzle/0018_*.sql` + `drizzle/meta/`** — migration gerada por `bun run db:migration`, com o `UPDATE` de backfill acrescentado
- **`src/billing/domain/entity/subscription.ts`** — `plan_chosen_at` no schema, `null` em `create()`, `recordPlanChoice(chosen_at)` write-once, getters `plan_chosen_at` e `needs_plan_choice`
- **`src/billing/domain/repository/subscription_repository.ts`** — `recordPlanChoiceIfAbsent(subscription_id, chosen_at)`
- **`src/billing/infra/database/postgres_repository/subscription_postgres_repository.ts`** — implementação atômica; `save()` persiste `plan_chosen_at`
- **`src/billing/application/use_case/confirm_free_plan_choice.ts`** — caso de uso novo
- **`src/billing/application/use_case/get_subscription_status.ts`** — `needs_plan_choice`, com `SubscriptionRepository` injetado
- **`src/billing/application/use_case/grant_plan.ts`** — registra a escolha
- **`src/billing/application/use_case/sync_subscription_from_gateway.ts`** — registra a escolha em `#syncTrialing` e `#syncToActive`
- **`src/billing/application/use_case/create_checkout_session.ts`** — `return_to` e caminhos sob `/app`
- **`src/billing/application/use_case/create_billing_portal_session.ts`** — caminho sob `/app`
- **`src/billing/presentation/controller/confirm_free_plan_choice.controller.ts`** — controller novo (`204`)
- **`src/billing/presentation/controller/get_subscription_status.controller.ts`** — `needs_plan_choice` no `outputSchema` e na doc
- **`src/billing/presentation/controller/create_checkout_session.controller.ts`** — `return_to` no `inputSchema` e na doc
- **`src/billing/presentation/mcp_tool/confirm_free_plan_choice.mcp_tool.ts`** — tool nova
- **`src/billing/presentation/mcp_tool/get_subscription_status.mcp_tool.ts`** — descrição menciona `needs_plan_choice`
- **`src/billing/infra/di/billing_di.ts`** — fábricas novas e dependência nova de `GetSubscriptionStatusUseCase`
- **`src/core/infra/http/routes/routes.ts`** — rota nova
- **`src/core/infra/mcp/routes.ts`** — tool nova no array
- **`tests/billing/`** e **`tests/core/mcp_routes.test.ts`** — ver tasks
- **`CLAUDE.md`** — seção de billing

## Tasks

1. **Schema, migration e agregado** — coluna, migration com backfill, `Subscription` com `plan_chosen_at`/`recordPlanChoice`/`needs_plan_choice`, repositório (`save` + `recordPlanChoiceIfAbsent`)
   - Dependencies: none
2. **Registro da escolha nas transições** — `GrantPlanUseCase` e `SyncSubscriptionFromGatewayUseCase`
   - Dependencies: task 1
3. **Confirmação do Free** — caso de uso, controller, rota, tool MCP, DI
   - Dependencies: task 1
4. **`needs_plan_choice` no status** — caso de uso, controller, descrição da tool, DI
   - Dependencies: task 1
5. **URLs de retorno** — `return_to` no Checkout e caminhos sob `/app` no Checkout e no Portal
   - Dependencies: none
6. **Testes** — idempotência do agregado; caso de uso e rota do Free (204, no-op em Pro sem trocar plano, 404 sem assinatura); `needs_plan_choice` no `GET`; webhook registrando a escolha (trial e active) e Checkout não registrando; URLs de retorno para os dois `return_to` e `422` para valor fora do enum; Portal; tool nova na lista do `/mcp`; backfill da migration
   - Dependencies: tasks 2, 3, 4, 5
7. **`CLAUDE.md`** — registrar escolha de plano, rota nova e URLs de retorno na seção de billing
   - Dependencies: tasks 2, 3, 4, 5
8. **Revisão de segurança**
   - Dependencies: tasks 6, 7

## Revisão de Segurança

Sem achado crítico nem moderado. Pontos verificados:

- **Open redirect (`return_to`)** — enum fechado com `z.enum`, default aplicado no schema; o caso de uso traduz a chave para caminhos constantes prefixados por `FRONT_BASE_URL`. URL absoluta, caminho, `//host`, variação de caixa e string vazia viram `422` (travado por teste). Nenhum valor do chamador chega à URL.
- **`POST /billing/subscription/free-plan`** — o alvo sai só da sessão (`user.id`), sem corpo, sem parâmetro de rota: não há IDOR nem mass assignment. Autenticada por cookie, a escrita passa por `assertSameSiteRequest` (`Origin` da allowlist), como toda escrita. A única escrita é `UPDATE ... SET plan_chosen_at WHERE id AND plan_chosen_at IS NULL`, parametrizada pelo Drizzle, e não altera plano, status nem referências do gateway — inclusive sob concorrência com o webhook (D-3).
- **Webhook** — a escolha é registrada depois da verificação de assinatura, da reivindicação de idempotência e do descarte de evento velho; nenhum caminho novo alcança transição de domínio com evento não verificado.
- **MCP** — `confirm_free_plan_choice` passa pelo mesmo portão de transporte (`ai_assistant`, platform access, 300 req/min) e pelo mesmo caso de uso; a descrição impede o uso como "downgrade" que reportaria sucesso falso.
- 🔵 **INFORMATIVO — sem rate limit dedicado na rota nova.** Escrita idempotente, sem efeito externo; depois da primeira chamada é uma leitura só. Mesmo tratamento das escritas de `notification` (D-4).
- **LGPD** — `plan_chosen_at` é metadado de uso ligado à conta, com finalidade declarada (estado de onboarding), sem dado pessoal novo; sai junto com a assinatura no purge da conta (`subscriptions.user_id` com `ON DELETE cascade`). Nenhum log novo.
