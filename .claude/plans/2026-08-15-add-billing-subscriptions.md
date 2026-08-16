# Bounded Context `billing` — Planos e Assinaturas Recorrentes

## Objective

Introduzir o modelo de monetização SaaS do Sogio: a plataforma passa a cobrar do proprietário (`User`) uma assinatura recorrente a um plano do catálogo. O novo bounded context `billing` torna-se a **autoridade única** sobre duas perguntas que hoje ninguém responde: "esta conta pode usar a plataforma?" e "esta conta pode criar mais uma propriedade?". Esta entrega cobre domínio, persistência, use cases e o enforcement cross-BC — sem rotas HTTP de billing e sem integração real com gateway de pagamento.

---

## Personas

- **Arquiteto** (`.claude/personas/arquiteto.md`) — autor deste plano
- **Desenvolvedor** (`.claude/personas/desenvolvedor.md`) — execução das tasks
- **Analista de Segurança** (`.claude/personas/analista_seguranca.md`) — revisão obrigatória das tasks 12–14 (gate de acesso no adaptador HTTP e no transporte MCP: um `fail-open` acidental aqui é uma falha de autorização, não um bug de billing)

---

## 1. Análise de Negócio

O Sogio deixa de ser uma ferramenta de uso irrestrito e passa a ter um modelo de receita próprio. O que a alteração resolve:

- **Para o negócio**: cria a fonte de receita da plataforma (B2B, cobrada do proprietário), com um plano `Free` que serve de funil de entrada (1 propriedade) e um plano `Pro` pago (5 propriedades).
- **Para o proprietário**: uma conta nova é imediatamente utilizável, sem cartão, com limite claro. Ao crescer, faz upgrade. Ao cancelar, mantém o que já pagou até o fim do ciclo. Se um pagamento falhar, não é desligado na hora — existe um período de tolerância.
- **Para o operador**: o catálogo de planos é dado, não código. Preço, limite e período de trial mudam sem deploy.

Distinção de domínio que precisa ficar explícita e que motiva o BC separado: **`finance` é o ledger do proprietário** (quanto ele ganhou/gastou com os imóveis dele); **`billing` é o ledger do Sogio sobre o proprietário** (quanto ele deve à plataforma). São dois dinheiros diferentes, com dois donos diferentes. Misturá-los no `finance` faria a receita da plataforma aparecer como despesa/receita de imóvel — corrupção direta do relatório financeiro que o produto já entrega.

---

## 2. Análise de Domínio

### 2.1 Linguagem Ubíqua (termos novos)

| Termo              | Significado no domínio                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plan**           | Item do catálogo comercial do Sogio: nome, preço, intervalo de cobrança e limites. Entidade persistida, nunca enum em código.                                |
| **Subscription**   | O vínculo entre uma conta (`User`) e um `Plan`. Uma conta tem exatamente uma.                                                                                |
| **Entitlement**    | O _direito de uso_ derivado de uma Subscription num instante: tem acesso à plataforma? até quantas propriedades? É um **valor calculado**, nunca uma coluna. |
| **Billing period** | A janela já paga (`current_period_start` → `current_period_end`). Nula para plano perpétuo (Free).                                                           |
| **Grace period**   | Janela após uma falha de pagamento em que o acesso é mantido (`past_due`).                                                                                   |
| **Plan limit**     | Teto de recursos do plano. Hoje só `max_properties`.                                                                                                         |

### 2.2 Agregados novos

**`Plan`** — _Aggregate Root_, catálogo. Campos (nível de domínio):

- `code` — chave natural imutável e única (`free`, `pro`). **Existe porque o código precisa referenciar o plano Free sem hardcodar um UUID** (o handler de criação de conta depende disso).
- `name` — nome comercial exibível
- `price_amount` — inteiro em centavos, mesma convenção de `LedgerEntry.amount`
- `billing_interval` — enum com um único membro hoje: `monthly`
- `max_properties` — inteiro ≥ 1
- `trial_days` — inteiro ≥ 0; `0` = plano sem trial
- `external_price_reference` — string opaca anulável (id do preço no gateway futuro)
- `+ BaseEntity` (`id`, `created_at`, `updated_at`, `deleted_at`)

Invariantes:

- `code` único entre planos não removidos; imutável após criação
- `price_amount ≥ 0`; `max_properties ≥ 1`
- Um `Plan` **nunca é deletado fisicamente** — só `deleted_at` (deixa de ser oferecido). Subscriptions existentes precisam continuar resolvendo o plano delas.
- `price_amount = 0` ⇒ plano perpétuo (não gera ciclo de cobrança)

**`Subscription`** — _Aggregate Root_, 1:1 com `User`. Campos:

- `user_id` — **único** (um usuário, uma assinatura)
- `plan_id` — referência ao `Plan` vigente
- `status` — `trialing` | `active` | `past_due` | `canceled`
- `current_period_start`, `current_period_end` — anuláveis; `null` = perpétuo (Free)
- `trial_ends_at` — anulável
- `canceled_at` — anulável
- `grace_period_ends_at` — anulável; preenchido ao entrar em `past_due`
- `external_reference` — string opaca anulável (assinatura no gateway)
- `external_customer_reference` — string opaca anulável (cliente no gateway)
- `+ BaseEntity`

Invariantes:

- Exatamente uma `Subscription` por `user_id` (garantida por índice único no banco, não só em código)
- `status = trialing` ⇒ `trial_ends_at` presente e futuro no momento da transição
- Uma subscription que **já teve** `trial_ends_at` preenchido nunca volta a `trialing` (impede farming de trial via Pro → Free → Pro; não exige campo extra)
- `status = active` em plano com `price_amount > 0` ⇒ `current_period_end` presente
- Plano com `price_amount = 0` ⇒ `current_period_*` nulos
- `status = past_due` ⇒ `grace_period_ends_at` presente
- `status = canceled` ⇒ `canceled_at` presente
- Cancelar uma assinatura de plano perpétuo (Free) é **proibido** (`ConflictError`) — não há ciclo a encerrar; encerrar conta é `purgeUserData` no `auth`

### 2.3 Não vira entidade nesta entrega

`Invoice`, `Payment`, `SubscriptionHistory` — dependem de gateway real. Ficam fora, e o desenho abaixo (eventos de domínio em toda transição) permite materializá-las depois sem reescrever o agregado.

### 2.4 Eventos de Domínio

| Evento                                  | Owner (produtor) | Disparado por                                                  | Consumido por                                                                                                                     |
| --------------------------------------- | ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `UserCreatedEvent` (**novo**)           | `auth`           | `RegisterUserUseCase`, após persistir o usuário                | `billing` → `StartFreeSubscriptionOnUserCreated`                                                                                  |
| `SubscriptionActivatedEvent` (**novo**) | `billing`        | `SubscribeToPlanUseCase`, ao entrar em `active` num plano pago | **ninguém nesta entrega** — é o gancho declarado para o `finance` lançar receita da plataforma no futuro (ponto 2 dos requisitos) |
| `SubscriptionCanceledEvent` (**novo**)  | `billing`        | `CancelSubscriptionUseCase`                                    | ninguém nesta entrega                                                                                                             |

> Os dois eventos de `billing` são publicados mas não têm handler registrado. Isso é intencional e barato (uma classe de 10 linhas cada): eles são o contrato que o `finance` vai consumir, e publicá-los desde já evita ter que reabrir os use cases depois. **Não** criar handlers vazios.

---

## 3. Decisões Arquiteturais

### DA-1 — `billing` é um BC novo, irmão de `finance`

`src/billing/{domain,application,infra}`. **Sem `presentation/`** nesta entrega (requisito 4). O `finance` não é tocado: continua sendo o ledger por propriedade.

### DA-2 — Entitlement é **derivado**, nunca armazenado

Não existe cron/scheduler no projeto. Se "acesso" fosse uma coluna, ela ficaria errada no instante em que um período vencesse e nada rodasse para virar o status. Portanto:

- `SubscriptionAccessPolicy` (`billing/domain/policy/`) é uma **função pura**: `(Subscription, Plan, now) → Entitlement`.
- Não existe status `expired` persistido. "Expirado" é o que a policy _conclui_ de `canceled` + `now > current_period_end`, ou de `past_due` + `now > grace_period_ends_at`.
- Consequência direta e desejada: o requisito 10 ("não implementar expiração automática de grace period") sai de graça — a expiração é avaliada na leitura.

Tabela de decisão da policy (`has_platform_access`):

| status     | condição                      | acesso | `blocked_reason`        |
| ---------- | ----------------------------- | ------ | ----------------------- |
| `trialing` | `now ≤ trial_ends_at`         | sim    | —                       |
| `trialing` | `now > trial_ends_at`         | não    | `trial_expired`         |
| `active`   | período nulo (plano perpétuo) | sim    | —                       |
| `active`   | `now ≤ current_period_end`    | sim    | —                       |
| `active`   | `now > current_period_end`    | não    | `period_expired`        |
| `past_due` | `now ≤ grace_period_ends_at`  | sim    | —                       |
| `past_due` | `now > grace_period_ends_at`  | não    | `payment_failed`        |
| `canceled` | `now ≤ current_period_end`    | sim    | —                       |
| `canceled` | `now > current_period_end`    | não    | `subscription_canceled` |

`max_properties` do Entitlement vem sempre do `Plan` da Subscription, **inclusive quando o acesso está bloqueado** (o limite não é a defesa nesse caso; o bloqueio total é).

### DA-3 — Plano Free é **perpétuo**, com período nulo

Se o Free tivesse `current_period_end`, todo usuário gratuito seria bloqueado ~30 dias após o cadastro, porque não há nada rodando para renovar o ciclo. `price_amount = 0` ⇒ período nulo ⇒ acesso permanente. Esta é a decisão que impede o modo de falha mais provável desta feature.

### DA-4 — `billing_interval` é enum de um membro, não `interval` + `interval_count`

Rejeitado o formato Stripe (`interval` + `interval_count`). Razão: `interval_count` obriga hoje a aritmética de N meses sem nenhuma demanda de negócio. A extensibilidade real não está no formato da coluna, está em **haver um único lugar que calcula período** — `BillingCyclePolicy.nextPeriodEnd(start, interval)` em `billing/domain/policy/`. Adicionar `yearly` depois é um membro no enum e um `case` nessa função.

### DA-5 — Trocar de plano **muta** a Subscription existente

Uma Subscription por usuário, alterada in-place em upgrade/downgrade. Alternativa (nova Subscription por troca) foi rejeitada: transformaria a pergunta central — "qual é a assinatura vigente?" — numa regra de desempate, num caminho que roda a cada requisição autenticada. O histórico é uma necessidade real, mas é preocupação de auditoria/faturamento, não do agregado que decide acesso; os eventos de domínio da seção 2.4 permitem reconstruí-lo depois.

### DA-6 — Nenhuma interface `PaymentGateway` é criada agora

Requisito 3 (domínio/application não conhecem Stripe) é honrado por três medidas concretas, **sem criar uma porta sem implementação e sem chamador** (que nasceria errada e viraria dead code):

1. Referências ao provedor existem apenas como **strings opacas anuláveis** (`external_reference`, `external_customer_reference`, `external_price_reference`). Nenhum código de domínio as interpreta. Adicioná-las agora custa 3 colunas anuláveis; adicioná-las depois custa migration + backfill contra um gateway vivo.
2. Todo método de domínio de `Subscription` é **transição pura, sem I/O** (`activate`, `startTrial`, `markPastDue`, `cancel`, `changePlan`). Não há ponto onde uma chamada de rede caberia dentro do agregado.
3. **Contrato do seam documentado** (para a entrega futura): o adaptador Stripe viverá em `billing/infra/gateway/`, será chamado a partir de um use case novo (`ConfirmSubscriptionPayment`, disparado por webhook), e o único efeito dele sobre o domínio será chamar as transições acima com datas já resolvidas. Nenhum use case desta entrega muda para isso acontecer.

> Se o usuário preferir a interface explícita desde já, é uma reversão localizada (um arquivo em `billing/domain/service/payment_gateway.ts`) — mas a recomendação do Arquiteto é não criar.

### DA-7 — Integração cross-BC (a): auto-criação da Subscription Free via evento

Reusa exatamente o padrão `StayBookedEvent` → `RecordRevenueOnStayPaymentConfirmed`:

```
auth: RegisterUserUseCase → dispatch(UserCreatedEvent)
                                   ↓ (inMemoryEventDispatcher)
billing: StartFreeSubscriptionOnUserCreated (registrado no construtor de BillingDi)
             → EnsureFreeSubscriptionUseCase (idempotente)
```

- O evento é **do `auth`** (produtor é o dono, como `booking` é dono de `StayBookedEvent`). O `auth` não sabe que billing existe.
- `BillingDi` registra o handler no construtor, espelhando `FinanceDi`. Como esse registro **não é idempotente**, `BillingDi` deve ser instanciado **uma única vez** em `routes.ts` e a mesma instância repassada adiante — a advertência já documentada em `core/infra/mcp/routes.ts`.
- O handler delega a `EnsureFreeSubscriptionUseCase`, que é **idempotente**: se já existe Subscription para o usuário, não faz nada. Isso torna reexecução/backfill seguros.

### DA-8 — Integração cross-BC (b): `EntitlementService` como Open Host Service do `billing`

O `billing` **publica seu contrato**; os consumidores dependem da abstração, não da infraestrutura:

- `billing/application/service/entitlement_service.ts` — interface `EntitlementService { entitlementOf(user_id: string): Promise<Entitlement> }`
- `billing/domain/value_object/entitlement.ts` — VO `Entitlement { has_platform_access, status, max_properties, blocked_reason? }`
- `billing/application/service/subscription_entitlement_service.ts` — implementação (repos + `SubscriptionAccessPolicy`)
- Consumidores (`core/infra/http`, `core/infra/mcp`, `property_management`) importam **`import type`** apenas a interface e o VO, e recebem a implementação por **injeção via construtor**, montada no composition root.

Alternativas rejeitadas:

- _Porta duplicada no domínio de cada consumidor_ — duplica o contrato em 3 lugares e cada cópia diverge.
- _Porta em `src/core`_ — colocaria vocabulário de billing no módulo compartilhado; `core` hoje não conhece regra de negócio de nenhum BC (só `User`, por ser identidade).

O acoplamento resultante (`property_management` → `billing`, type-only) é consistente com o que o projeto já faz: `core`, `booking` e `property_management` já importam `User` de `auth`, e `FinanceDi` já monta um repositório concreto de `property_management`. Aqui o acoplamento é estritamente melhor que o precedente: é sobre uma **interface publicada**, não sobre uma classe de `infra`.

### DA-9 — Enforcement de bloqueio total: dois gates de transporte, fail-closed com opt-out

Existem **dois** pontos onde uma identidade é resolvida antes de despachar trabalho, e ambos precisam do gate:

1. `core/infra/http/adapters/http_controller_adapter.ts` — após `AuthMiddleware.handle()` e após a checagem `adminOnly`
2. `core/infra/mcp/routes.ts` — após `identityResolver.resolveRequester()`, antes de instanciar o `McpServer`

Decisões:

- **Fail-closed**: toda rota `authenticated: true` é gated por padrão. O tipo `Route` em `routes.ts` ganha `allowWithoutPlatformAccess?: boolean` (mesmo estilo de `adminOnly`) e a exceção é declarada rota a rota. Opt-in seria fail-open — errado por construção.
- **MCP é bloqueado por inteiro** quando não há acesso: não existe nenhuma tool MCP de normalização de conta, então não há exceção a modelar. Resposta `403` no formato de erro MCP já existente (`mcp_error_mapper`).
- **Admins (`role === "admin"`) passam sempre.** Staff não pode ser trancada para fora do backoffice por um problema de assinatura.
- Erro lançado: `ForbiddenError` (já mapeado para **403** no adaptador). Não criar tipo de erro novo — mapear um nome novo exigiria tocar `errorCodeMap`, e 403 é a semântica correta.
- **O gate NÃO fica dentro de `AuthMiddleware`.** Autenticação (quem é você) e entitlement (você pode usar isso) são decisões distintas; embutir uma na outra faria toda chamada a `handleOptional()` — usada no fluxo OAuth — carregar uma consulta de billing sem necessidade. O gate é um passo separado, adjacente, no mesmo adaptador.

**Rotas que precisam de `allowWithoutPlatformAccess: true`** (um usuário bloqueado tem que conseguir ver e normalizar a própria conta — errar aqui tranca o usuário para fora de forma irrecuperável):

- `authDi.makeGetUserController()` — ler a própria conta
- `authDi.makePurgeUserDataController()` — excluir a conta nunca pode ficar atrás de paywall (LGPD)
- `authDi.makeListConnectedAppsController()` e `makeDisconnectAppController()` — higiene de segurança
- `authDi.makeDecideAuthorizationRequestController()` — é etapa de protocolo OAuth; quebrá-la produziria erro fora do protocolo (as tools em si já ficam bloqueadas no gate do `/mcp`)
- Rotas `authenticated: false` não são afetadas por construção

Todo o resto (booking, stays, finance, property_management, tenants, dashboard, backoffice) fica gated.

### DA-10 — Enforcement de limite de plano: policy no `property_management`

- `CreatePropertyUseCase` recebe `EntitlementService` e `PropertyRepository` no construtor.
- Antes de `Property.create`, lê o entitlement, conta as propriedades **não removidas** do usuário e delega a decisão a `PropertyQuotaPolicy.ensureWithinLimit(currentCount, maxProperties)` em `property_management/domain/policy/` — mesma pasta e mesmo estilo do `PropertyOwnershipPolicy` já existente. A regra é de domínio; o use case só orquestra.
- Contagem: adicionar `countFromUser(user_id): Promise<number>` a `PropertyRepository` (`COUNT` no banco, não `allFromUser().length`).
- ⚠️ **Atenção do Desenvolvedor**: `allFromUser` hoje **não filtra `deleted_at`**. `countFromUser` precisa filtrar (`deleted_at IS NULL`), senão propriedades excluídas continuam consumindo cota. Não alterar o comportamento de `allFromUser` nesta entrega.
- Este limite é independente do bloqueio total: ele vale mesmo com a assinatura perfeitamente em dia.

### DA-11 — Downgrade não é bloqueado; a cota morde só na criação

Trocar para um plano com `max_properties` menor que a contagem atual é **permitido**; as propriedades existentes ficam grandfathered e o usuário simplesmente não cria novas até ficar abaixo do teto. Alternativa (bloquear downgrade) foi rejeitada porque exigiria `billing` consultar `property_management`, invertendo a direção da dependência estabelecida na DA-8 e criando um ciclo entre os dois BCs.

### DA-12 — Seed dos planos `free` e `pro` precisa existir em **todo** ambiente, inclusive testes

O plano `free` é pré-condição do cadastro de usuário: sem ele, `RegisterUserUseCase` quebra. E `bun run db:push:test` usa `drizzle-kit push` (aplica schema, **não** aplica migrations) — logo um seed que viva só no SQL da migration deixaria a suíte de testes quebrada. Portanto o seed é um **módulo idempotente** (`ON CONFLICT (code) DO NOTHING`, UUIDs fixos), invocável de: (i) um script `db:seed` no `package.json`, e (ii) o bootstrap de testes.

Valores (o preço do Pro é placeholder, conforme requisito 5):

| code   | name | price_amount      | interval | max_properties | trial_days |
| ------ | ---- | ----------------- | -------- | -------------- | ---------- |
| `free` | Free | `0`               | monthly  | `1`            | `0`        |
| `pro`  | Pro  | `4990` (R$ 49,90) | monthly  | `5`            | `14`       |

---

## 4. Riscos e Questionamentos

### R-1 — 🔴 O que acontece depois que uma assinatura Pro cancelada vence? (**decisão do usuário necessária**)

O requisito 9 define o que acontece _até_ o fim do ciclo, não _depois_. Duas leituras plausíveis:

- **(A) Bloqueio total** — a conta perde acesso à plataforma. É a leitura literal do requisito 11(a).
- **(B) Reversão ao Free** — a conta cai para `max_properties = 1`, mantém acesso, e as propriedades excedentes ficam grandfathered. É o comportamento usual de SaaS e é o que a própria existência de um plano Free sugere.

**Default adotado no plano: (A)**, por ser a leitura literal. Mas (B) é provavelmente o que o negócio quer, e a diferença é grande: (A) significa que um cliente que cancela perde acesso aos dados de reservas dele. Se o usuário escolher (B), a mudança é contida (a `SubscriptionAccessPolicy` passa a resolver o `Plan` Free como fallback), mas precisa ser decidida **antes** de escrever a policy (task 5).

### R-2 — 🟠 Falha do handler de criação de subscription deixa a conta órfã

O `inMemoryEventDispatcher` é síncrono e o `RegisterUserUseCase` faria `await dispatch(...)`. Se o handler do billing falhar (banco fora, plano `free` ausente), o usuário **já foi persistido** — não há transação abrangendo os dois BCs. Resultado: uma conta sem Subscription, que a DA-9 (fail-closed) bloqueia em tudo, e cujo re-cadastro colide em `ConflictError`.

Duas posturas para o caso "usuário existe, Subscription não existe":

- **(A) Fail-closed puro** — entitlement `has_platform_access: false`, `blocked_reason: no_subscription`. Conta trancada até intervenção manual/backfill.
- **(B) Self-heal na leitura** — o resolver, ao não achar Subscription, chama `EnsureFreeSubscriptionUseCase`. Conserta sozinho, mas faz um caminho de **leitura executar escrita** a cada requisição autenticada.

**Default adotado: (A)**, com `EnsureFreeSubscriptionUseCase` idempotente disponível para backfill. Recomendo confirmar com o usuário — (B) é operacionalmente muito mais seguro e o custo arquitetural é modesto se restrito a esse único caso.

### R-3 — 🟠 Custo de leitura: +1 query por requisição autenticada

O gate roda em toda requisição autenticada e em toda chamada MCP. Mitigação já embutida no plano: `SubscriptionRepository.currentSubscriptionWithPlanOfUser()` traz Subscription + Plan num **único join**, então é 1 query, não 2. Cache TTL em memória (há precedente: `InMemoryRateLimiter`, `InMemoryRefreshRotationGraceCache`) fica **fora** desta entrega — cachear autorização introduz janela de staleness em que um bloqueio não pega, e isso merece decisão própria.

### R-4 — 🟡 `Plan` sem moeda

Nenhuma entidade do projeto tem moeda (`LedgerEntry.amount` também não). Mantida a premissa implícita de moeda única (BRL). Internacionalização exigirá tocar `finance` e `billing` juntos — problema que já existe, não é criado aqui.

### R-5 — 🟡 O gate é fail-closed e a lista de exceções é escrita à mão

Se o Desenvolvedor esquecer uma rota na lista da DA-9, um usuário bloqueado fica sem caminho para se desbloquear. É por isso que a revisão do Analista de Segurança nas tasks 12–14 é obrigatória e que a task 16 exige teste explícito de cada rota isenta.

### R-6 — 🟡 Sem rotas HTTP, os use cases nascem sem chamador

`CreatePlan`, `ListPlans`, `SubscribeToPlan`, `CancelSubscription` não terão consumidor nesta entrega (requisito 4). Aceito conscientemente — mas significa que **testes automatizados são o único exercício desse código**, o que torna a task 16 não-opcional.

### R-7 — 🟢 `property_management` passa a depender de `billing`

Dependência type-only sobre interface publicada, resolvida no composition root. Consistente com o repositório (ver DA-8). Registrado para que o Revisor não a trate como violação.

---

## 5. Mapeamento de Mudanças

### Arquivos novos — `src/billing/`

**Domain**

- `src/billing/domain/entity/plan.ts` — entidade `Plan` (schema Zod, `create`/`reconstitute`, getters)
- `src/billing/domain/entity/subscription.ts` — entidade `Subscription` + transições puras `startTrial`, `activate`, `markPastDue`, `cancel`, `changePlan`
- `src/billing/domain/value_object/entitlement.ts` — VO `Entitlement` + tipo `BlockedReason`
- `src/billing/domain/policy/subscription_access_policy.ts` — derivação de `Entitlement` (tabela da DA-2)
- `src/billing/domain/policy/billing_cycle_policy.ts` — `nextPeriodEnd(start, interval)`; ponto único de aritmética de ciclo
- `src/billing/domain/repository/plan_repository.ts` — `planOfId`, `planOfCode`, `allOffered`, `save`
- `src/billing/domain/repository/subscription_repository.ts` — `subscriptionOfUser`, `currentSubscriptionWithPlanOfUser`, `save`
- `src/billing/domain/event/subscription_activated_event.ts`
- `src/billing/domain/event/subscription_canceled_event.ts`

**Application**

- `src/billing/application/service/entitlement_service.ts` — **interface publicada** (contrato cross-BC)
- `src/billing/application/service/subscription_entitlement_service.ts` — implementação
- `src/billing/application/use_case/create_plan.ts`
- `src/billing/application/use_case/list_plans.ts`
- `src/billing/application/use_case/subscribe_to_plan.ts` — assinar **e** trocar de plano
- `src/billing/application/use_case/cancel_subscription.ts`
- `src/billing/application/use_case/get_subscription_status.ts` — "consultar status de acesso"
- `src/billing/application/use_case/ensure_free_subscription.ts` — idempotente
- `src/billing/application/handler/start_free_subscription_on_user_created.ts`

**Infra**

- `src/billing/infra/database/postgres_repository/plan_postgres_repository.ts`
- `src/billing/infra/database/postgres_repository/subscription_postgres_repository.ts`
- `src/billing/infra/database/seed_plans.ts` — seed idempotente (DA-12)
- `src/billing/infra/di/billing_di.ts` — `BillingDi`; registra o handler no construtor (espelha `FinanceDi`)

### Arquivos novos — fora de `billing`

- `src/auth/domain/event/user_created_event.ts` — evento owned pelo `auth`
- `src/core/infra/database/drizzle/schemas/billing_schemas.ts` — `plansTable`, `subscriptionsTable` + relations
- `src/property_management/domain/policy/property_quota_policy.ts`
- `scripts/seed_plans.ts` — entrypoint do seed
- `tests/billing/*.test.ts` — ver task 16

### Arquivos modificados

- `src/core/infra/database/drizzle/schema.ts` — exportar `billing_schemas`
- `drizzle/00XX_*.sql` — migration gerada por `bun run db:migration`
- `package.json` — script `db:seed`
- `src/auth/application/use_case/register_user.ts` — recebe `EventDispatcher`; dispara `UserCreatedEvent` após persistir e **antes** de emitir a sessão
- `src/auth/infra/di/auth_di.ts` — injeta `inMemoryEventDispatcher` em `makeRegisterUserUseCase`
- `src/core/infra/http/routes/routes.ts` — instanciar `BillingDi` **uma vez**; `Route` ganha `allowWithoutPlatformAccess?: boolean`; marcar as rotas isentas da DA-9; repassar `billingDi` a `makeMcpRequestHandler`
- `src/core/infra/http/adapters/http_controller_adapter.ts` — gate de acesso após auth/adminOnly; assinatura de `BunHttpControllerAdapter` ganha o flag
- `src/core/infra/mcp/routes.ts` — gate após `resolveRequester`; `McpRouteDependencies` ganha `billingDi`
- `src/property_management/domain/repository/property_repository.ts` — `countFromUser(user_id)`
- `src/property_management/infra/database/postgres_repository/property_postgres_repository.ts` — implementação filtrando `deleted_at IS NULL`
- `src/property_management/application/use_case/create_property.ts` — recebe `EntitlementService`; aplica a policy
- `src/property_management/infra/di/property_management_di.ts` — recebe `EntitlementService` no construtor e repassa a `makeCreatePropertyUseCase`
- `CLAUDE.md` — registrar o BC `billing` na seção de Arquitetura
- `.claude/personas/arquiteto.md` — registrar `billing` na tabela de bounded contexts e os eventos novos

---

## 6. Tasks

1. **Schema Drizzle e migration do `billing`** — criar `billing_schemas.ts` (`plansTable` com `code` único; `subscriptionsTable` com `user_id` **único** e FKs para `users`/`plans`), exportar em `schema.ts`, gerar a migration.
   - Dependências: nenhuma

2. **Entidade `Plan`** — schema Zod, `create`/`reconstitute`, getters, invariantes da seção 2.2 (`price_amount ≥ 0`, `max_properties ≥ 1`, `code` imutável).
   - Dependências: nenhuma

3. **VO `Entitlement` + `BillingCyclePolicy`** — VO de leitura e a função única de aritmética de ciclo (`monthly`).
   - Dependências: nenhuma

4. **Entidade `Subscription`** — schema Zod e transições puras (`startTrial`, `activate`, `markPastDue`, `cancel`, `changePlan`), com todas as invariantes da seção 2.2, incluindo a proibição de reentrar em `trialing`.
   - Dependências: tasks 2, 3

5. **`SubscriptionAccessPolicy`** — função pura implementando exatamente a tabela da DA-2. **Confirmar R-1 antes de começar.**
   - Dependências: task 4

6. **Interfaces de repositório do `billing`** — `PlanRepository` e `SubscriptionRepository` (incl. `currentSubscriptionWithPlanOfUser`, ver R-3).
   - Dependências: tasks 2, 4

7. **Repositórios Postgres do `billing`** — implementações Drizzle das interfaces da task 6.
   - Dependências: tasks 1, 6

8. **Seed idempotente `free`/`pro`** — módulo + `scripts/seed_plans.ts` + script `db:seed` no `package.json` + wiring no bootstrap de testes (DA-12).
   - Dependências: task 7

9. **Eventos de domínio do `billing`** — `SubscriptionActivatedEvent`, `SubscriptionCanceledEvent` (publicados, sem handler).
   - Dependências: nenhuma

10. **Use cases do `billing`** — `CreatePlan`, `ListPlans`, `SubscribeToPlan`, `CancelSubscription`, `GetSubscriptionStatus`, `EnsureFreeSubscription` (idempotente). `SubscribeToPlan` publica `SubscriptionActivatedEvent`; `CancelSubscription` publica `SubscriptionCanceledEvent` e recusa plano perpétuo.
    - Dependências: tasks 5, 6, 9

11. **`EntitlementService` (interface + implementação) e `BillingDi`** — a interface publicada da DA-8, a implementação sobre repositórios + policy, e o container que registra `StartFreeSubscriptionOnUserCreated` no construtor.
    - Dependências: tasks 7, 10

12. **`UserCreatedEvent` e auto-criação da Subscription Free** — evento em `auth`, dispatch em `RegisterUserUseCase`, wiring em `AuthDi`, handler em `billing`. Instanciar `BillingDi` uma única vez em `routes.ts` (DA-7).
    - Dependências: task 11
    - Revisão obrigatória: Analista de Segurança

13. **Gate de acesso no adaptador HTTP** — flag `allowWithoutPlatformAccess` no tipo `Route`, gate após auth/adminOnly, bypass de admin, `ForbiddenError`, e marcação exata das rotas isentas listadas na DA-9.
    - Dependências: task 11
    - Revisão obrigatória: Analista de Segurança

14. **Gate de acesso no transporte MCP** — bloqueio total de `/mcp` para conta sem acesso, resposta 403 no formato de erro MCP existente; `billingDi` em `McpRouteDependencies`.
    - Dependências: task 11
    - Revisão obrigatória: Analista de Segurança

15. **Limite `max_properties` na criação de propriedade** — `countFromUser` (filtrando `deleted_at`), `PropertyQuotaPolicy`, injeção de `EntitlementService` em `CreatePropertyUseCase` e em `PropertyManagementDi`.
    - Dependências: task 11

16. **Testes** — (a) unitários da `SubscriptionAccessPolicy` cobrindo cada linha da tabela da DA-2, incluindo as bordas de `now`; (b) integração: cadastro cria Subscription Free; (c) integração: conta bloqueada recebe 403 em rota gated **e** 200 em cada rota isenta; (d) integração: criação de propriedade além de `max_properties` falha e dentro do limite passa; (e) `/mcp` bloqueado. Ver R-6 — sem rotas HTTP, os testes são o único exercício do código de billing.
    - Dependências: tasks 12, 13, 14, 15

17. **Documentação** — registrar o BC `billing` em `CLAUDE.md` e em `.claude/personas/arquiteto.md` (tabela de bounded contexts, agregados, eventos, invariantes).
    - Dependências: task 16

> **Paralelismo**: tasks 1, 2, 3 e 9 podem rodar simultaneamente (nenhuma dependência). Depois, `4 → 5` e `6 → 7 → 8` formam duas correntes parcialmente paralelas. Tasks 12, 13, 14 e 15 são independentes entre si e podem rodar em paralelo assim que a 11 estiver pronta — é o maior ganho de paralelismo do plano.

---

## 7. Diretrizes para o Desenvolvedor

1. **Não invente um status `expired`.** Se aparecer vontade de persistir "expirado", releia a DA-2: significa que a derivação vazou para o banco e ficará errada sem scheduler.
2. **Não deixe o Free com `current_period_end`.** É o bug que bloqueia toda a base gratuita ~30 dias após o lançamento (DA-3).
3. **`countFromUser` filtra `deleted_at IS NULL`.** `allFromUser` não filtra hoje — não copie o método existente. E não altere `allFromUser` nesta entrega.
4. **`BillingDi` é instanciado uma vez.** Registro de handler no dispatcher compartilhado não é idempotente; duas instâncias fazem o handler rodar duas vezes por evento (advertência já documentada em `core/infra/mcp/routes.ts`).
5. **O gate é fail-closed.** A lista de rotas isentas da DA-9 é normativa; qualquer rota adicionada a ela precisa de justificativa no PR.
6. **Nada de `Stripe` fora de `billing/infra/`** — e nesta entrega, nada de Stripe em lugar nenhum. Os campos `external_*` são strings opacas que nenhum código de domínio lê.
7. **Erros tipados**: limite de plano e bloqueio de acesso ⇒ `ForbiddenError` (403). Cancelar plano perpétuo ⇒ `ConflictError` (409). Plano inexistente ⇒ `ResourceNotFoundError` (404). Não adicione tipo de erro novo ao `errorCodeMap`.
8. **Comentários de no máximo uma linha**, conforme preferência registrada do usuário — mesmo que arquivos vizinhos tenham docblocks longos.
9. **Commit por task**, Conventional Commits em inglês, conforme `CLAUDE.md`.
