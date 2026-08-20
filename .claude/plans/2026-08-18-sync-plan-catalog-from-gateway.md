# Catálogo de planos sincronizado a partir do gateway de pagamento

> Branch: `sync-plan-catalog-from-gateway` · Worktree: `.claude/worktrees/sync-plan-catalog-from-gateway`

## Objective

Produção está com a tabela `plans` vazia: `GET /billing/plans` devolve `[]` e todo cadastro novo nasce sem `Subscription` (o `EnsureFreeSubscriptionUseCase` não acha o plano `free`), o que o gate fail-closed converte em bloqueio total da conta. A causa é que `seedPlans()` nunca rodou em produção — e a decisão do usuário é **não** resolver isso rodando seed em produção.

A direção escolhida: **o catálogo comercial do Sogio passa a ser propriedade do gateway de pagamento**. O Stripe deixa de ser só a fonte de verdade sobre dinheiro e passa a ser também a fonte de verdade sobre o catálogo — preço, nome, limite de propriedades e dias de trial saem do Price (campos nativos + `metadata`) e chegam aqui por dois canais: **webhooks de catálogo** (mudança incremental) e **reconciliação sob demanda** (leitura completa, resolve o bootstrap).

## Personas

| Persona                                            | Papel nesta entrega                                                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arquiteto** (`.claude/personas/arquiteto.md`)     | Este documento                                                                                                                                                             |
| **Analista de Segurança** (`analista_seguranca.md`) | **Revisão obrigatória e bloqueante** (task 14). Esta entrega abre um caminho em que **input externo escreve regra de negócio de autorização** (`max_properties`) no banco — categoricamente diferente do webhook de assinatura, que só move o estado de uma assinatura por vez |
| **Desenvolvedor** (`desenvolvedor.md`)              | Tasks 1–13, 15                                                                                                                                                             |

---

## 1. Análise de Negócio

### 1.1 O que quebra hoje

Três sintomas, uma causa:

1. `GET /billing/plans` (página pública de preços) devolve `[]`.
2. `EnsureFreeSubscriptionUseCase` lança `ResourceNotFoundError("Plan")` no handler de `UserCreatedEvent`. O handler loga e engole (o cadastro é confirmado), então **a conta nasce sem `Subscription`**.
3. `SubscriptionEntitlementService.entitlementOf` sem `Subscription` retorna `has_platform_access: false, blocked_reason: "no_subscription"`. Fail-closed. A conta está bloqueada em toda rota autenticada e no `/mcp`, e **nada no sistema volta a tentar** — não há scheduler, e o gate é read-only.

Contas já criadas nesse estado **continuam quebradas mesmo depois do catálogo ser populado**. Isso não é coberto por nenhuma parte desta entrega e precisa de um reparo explícito (task 12) — sem ele, a entrega conserta o futuro e abandona o passado.

### 1.2 O que muda para o operador

Hoje: mudar o preço do Pro = editar `seed_plans.ts`, commitar, deployar, e rodar um comando que ninguém roda. Depois: mudar o preço do Pro = editar o Price no dashboard do Stripe. O catálogo deixa de ser código e vira configuração operada por quem opera o dinheiro.

### 1.3 O que muda para o usuário final

Nada visível, e essa é a intenção. `GET /billing/plans` continua sendo a mesma rota pública, `POST /billing/checkout-session` continua recebendo `plan_code`, o entitlement continua derivado de `Subscription` + `Plan`. A única mudança de comportamento observável é que a página de preços passa a existir de fato.

---

## 2. Análise de Domínio

### 2.1 O agregado `Plan` muda de dono, não de forma

`Plan` continua sendo o mesmo agregado, com os mesmos campos. O que muda é **quem escreve nele**. Hoje: um seed em código, e um `CreatePlanUseCase` admin que nunca ganhou rota. Depois: exclusivamente o gateway, por um único escritor (`SyncPlanCatalogEntryUseCase`).

Consequência direta e desejada: `Plan` deixa de ser uma entidade anêmica (só getters) e ganha comportamento — hoje não existe nenhuma forma de atualizar ou aposentar um plano depois de criado.

### 2.2 Linguagem ubíqua — termos novos

| Termo                                    | Significado                                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Catálogo de planos**                   | O conjunto de `Plan` oferecidos. Já existia implicitamente em `allOffered()`; agora ganha nome e um dono                                                                                 |
| **Entrada de catálogo** (`GatewayCatalogEntry`) | Um Price do gateway já normalizado para o vocabulário do Sogio. **Não é um `Plan`** — é a matéria-prima da qual um `Plan` é derivado. Vive em `application/gateway/`, como `GatewayBillingEvent` |
| **Evento de catálogo** (`GatewayCatalogEvent`) | Um fato que o gateway afirma sobre o catálogo. Família irmã de `GatewayBillingEvent`, não uma variante dela (§2.6)                                                                       |
| **Sincronização de catálogo**            | Aplicar **uma** entrada/aposentadoria ao catálogo local. Push, dirigido por webhook                                                                                                     |
| **Reconciliação de catálogo**            | Ler o catálogo **inteiro** do gateway e aplicá-lo. Pull, sob demanda. É o que resolve o bootstrap                                                                                       |
| **Plano aposentado**                     | `Plan` com `deleted_at` preenchido: some da vitrine (`allOffered`), continua resolvível para quem já assina. Nunca "deletado"                                                            |

Vocabulário deliberadamente ausente: nada aqui diz "Stripe", "price", "product" fora de `billing/infra/gateway/`. `application` fala em "entrada de catálogo" e "referência de preço".

### 2.3 De onde vem cada campo — a decisão central

| Campo do `Plan`               | Origem                                                     | Natureza  |
| ----------------------------- | ---------------------------------------------------------- | --------- |
| `external_price_reference`    | `price.id`                                                 | Nativo    |
| `external_product_reference`  | `price.product` (**coluna nova**, §2.4)                    | Nativo    |
| `price_amount`                | `price.unit_amount`                                        | Nativo    |
| `billing_interval`            | `price.recurring.interval` + `interval_count`              | Nativo    |
| `deleted_at`                  | derivado de `price.active` / `product.active` / eventos `deleted` | Nativo |
| `code`                        | `metadata.sogio_plan_code`                                 | Metadata  |
| `name`                        | `metadata.sogio_plan_name`                                 | Metadata  |
| `max_properties`              | `metadata.sogio_max_properties`                            | Metadata  |
| `trial_days`                  | `metadata.sogio_trial_days`                                | Metadata  |

**Por que `name` vem de metadata e não do `product.name`.** O payload de webhook do Stripe nunca vem com `product` expandido — é só um id. Buscar o nome do Product exigiria uma chamada de rede **dentro** do caminho do webhook, cujo timeout vira retentativa. Além disso o `product.name` é o nome que aparece no Checkout hospedado e nas faturas do Stripe; o `name` do `Plan` é o nome que aparece na **nossa** vitrine. São conceitos próximos mas não idênticos, e manter o descritor inteiro do Sogio num único lugar (o `metadata` do Price) é mais legível para quem opera do que espalhá-lo entre Product e Price.

Efeito colateral disso: **eventos de Product deixam de carregar dado de negócio** e sobram apenas como sinal de aposentadoria (arquivar um Product no Stripe inutiliza seus Prices sem necessariamente disparar `price.updated`). Daí a coluna `external_product_reference`.

Prefixo `sogio_` em toda chave de metadata: o `metadata` do Price é um espaço compartilhado com qualquer outra integração futura da conta Stripe.

### 2.4 Duas colunas novas em `plans`

- **`external_product_reference`** (`varchar(255)`, nullable, **não único** — vários Prices por Product): permite resolver `product.updated(active:false)` / `product.deleted` para os planos afetados sem uma round-trip de rede no caminho do webhook.
- **`external_event_at`** (`timestamptz`, nullable): mesmo idioma que `subscriptions.external_event_at` (DA-8 da entrega Stripe). Sem isso, uma reentrega fora de ordem de `price.updated(active:false)` chegando **depois** de `price.updated(active:true)` aposenta um plano vivo — a vitrine perde o Pro e ninguém consegue assinar até o próximo restart. É a mesma defesa, pelo mesmo motivo, no mesmo formato.

### 2.5 Invariantes de domínio — novas e preservadas

**Novas:**

- **I-1 — O `code` de um `Plan` é imutável.** Uma vez que a linha existe, nenhum evento de catálogo altera seu `code`. A identidade do plano no catálogo **é** o `code` (é a chave natural, já é `unique` no schema, e é por ela que `planOfCode("free")`, `CreateCheckoutSessionUseCase` e a API pública o encontram). O `external_price_reference` é um atributo apontando para ele, não a identidade.
- **I-2 — O plano `free` nunca é aposentado por um evento de catálogo.** É pré-condição de todo cadastro de usuário (`EnsureFreeSubscription`) e é o piso do `SubscriptionAccessPolicy` (fallback de assinatura cancelada). Aposentar o Free é uma decisão de negócio sem caminho automatizado seguro — mesma forma de "cancelar assinatura de plano perpétuo é proibido". Uma tentativa é logada e ignorada, nunca lançada.
- **I-3 — Ausência nunca aposenta.** A reconciliação só aposenta um plano diante de um **sinal explícito** de desativação (price/product inativo ou deletado). Um plano que a reconciliação simplesmente não viu (porque o Price perdeu a metadata, porque a listagem falhou no meio, porque a conta certa não foi consultada) permanece intacto. Um "sync = espelhar o gateway" ingênuo aposentaria `free` e `pro` na primeira execução contra os Prices ainda sem metadata que existem hoje em produção — outage total no ato do deploy.

**Preservadas, verificadas no código:**

- `PlanPostgresRepository.planOfCode` / `planOfId` / `planOfExternalPriceReference` **não filtram** `deleted_at`; `allOffered()` filtra. `SubscriptionPostgresRepository.currentSubscriptionWithPlanOfUser` resolve o plano por FK, sem filtro. Portanto **um plano aposentado continua resolvendo entitlement para quem já assina** e some só da vitrine — a semântica já é exatamente a desejada e **não muda nada** (§3, DA-7).
- `CreateCheckoutSessionUseCase` já rejeita `plan.deleted_at` com `ResourceNotFoundError`. Plano aposentado = ninguém novo assina, quem assina continua com o que pagou. Também não muda.
- A invariante de que "o gateway é a fonte de verdade do período de cobrança" continua intacta: esta entrega só toca o catálogo, nunca `Subscription`.

### 2.6 Eventos de catálogo são uma família irmã, não uma variante de `GatewayBillingEvent`

`GatewayBillingEvent` é uma união sobre fatos do ciclo de vida de **uma assinatura**: toda variante carrega `external_reference`/`external_customer_reference`, é resolvida contra uma `Subscription` e passa pelo `isStaleGatewayEvent(subscription, …)`. Um evento de catálogo não tem nenhuma dessas coisas. Enfiá-lo na mesma união tornaria metade dos campos opcionais e o `switch` do orquestrador teria dois blocos que não compartilham nada além do `event_id`.

Então: **duas uniões, um verificador, um orquestrador** (justificado em DA-3).

Nenhum **evento de domínio** novo. Uma mudança de catálogo não é um fato do domínio do negócio Sogio que outro contexto precise observar — é uma atualização de configuração. Se um dia o `finance` quiser reconhecer receita por mudança de preço, ele reage a `SubscriptionPlanChangedEvent`/`SubscriptionRenewedEvent`, que já existem.

---

## 3. Decisões Arquiteturais

### DA-1 — A identidade do plano no catálogo é o `code`; a referência de preço é um atributo

A sincronização casa a entrada de catálogo com um `Plan` **pelo `code`**. Se existe, atualiza (inclusive repontando `external_price_reference`). Se não existe, cria.

A alternativa (casar por `external_price_reference`) quebra no cenário mais comum de operação: arquivar `price_A` e criar `price_B` para o mesmo plano. Casando por preço, o `price.created` de `price_B` não acha linha, tenta inserir um novo `Plan` com `code: "pro"` e colide na unique de `code` → 500 → **loop de retentativa do Stripe**, exatamente a falha que a entrega anterior gastou uma decisão inteira (DA-3) para tornar impossível.

Guarda que cai fora disso e é obrigatória: **um sinal de aposentadoria só se aplica se a referência do evento é a que está atualmente ligada ao plano.** Caso contrário, o `price.updated(active:false)` de `price_A` (o preço antigo, arquivado logo depois) aposentaria o Pro que acabou de migrar para `price_B`.

### DA-2 — `code` protegido por imutabilidade + validação de forma, não por allowlist

O `code` é *load-bearing*: `SubscriptionEntitlementService` faz `planOfCode("free")` e, se não achar, **toda conta do sistema falha fechada**. O risco real é alguém digitar `fre` no dashboard e derrubar produção.

A proteção é a **I-1 (imutabilidade)**: como o `code` é a chave de casamento e nunca é alterado numa linha existente, um `sogio_plan_code: "fre"` no Price do Free **não renomeia** o plano `free` — ele cria um plano novo e inútil de code `fre`, e o `free` continua exatamente onde estava. O erro vira lixo visível na vitrine, não um outage.

Complementarmente, validação de **forma**: `^[a-z][a-z0-9_]{0,49}$` depois de `trim()`. `"pro "` com espaço vira `pro`; `"Pro"`, `"pro-plus"` ou vazio são rejeitados (entrada ignorada).

**Alternativa rejeitada: allowlist fechada (`free` | `pro`) em código.** Protege o mesmo risco, mas anula metade do objetivo da entrega — adicionar um plano `business` voltaria a exigir deploy. Dado que a imutabilidade já elimina o cenário catastrófico, o custo não se justifica.

**Efeito colateral aceito (R-4):** um `code` digitado errado cria um plano fantasma que aparece na vitrine pública até o operador corrigir.

### DA-3 — Um verificador, um orquestrador, um caminho de escrita separado

O Stripe entrega tudo num único endpoint com um único segredo. Rotear por tipo de evento exigiria olhar o corpo **antes** de verificar a assinatura — violação frontal da fronteira de confiança que DA-2 da entrega anterior estabeleceu ("verificação é a primeira instrução; não existe caminho até uma transição de domínio com evento não verificado").

Portanto:

- **`GatewayWebhookVerifier.verify` continua sendo a única porta de entrada** e passa a devolver `GatewayBillingEvent | GatewayCatalogEvent | null`.
- **`ProcessGatewayWebhookUseCase` continua sendo o único orquestrador**, dono da verificação e da idempotência — as duas coisas genuinamente compartilhadas. Seu `switch` ganha os ramos de catálogo, que delegam inteiros para `SyncPlanCatalogEntryUseCase`, exatamente como já delegam `subscription_state_changed` para `SyncSubscriptionFromGatewayUseCase`.
- **A escrita no catálogo é um use case próprio**, sem nenhuma linha em comum com o caminho de assinatura: agregado diferente, modelo de staleness diferente, semântica de falha diferente.

A tabela `processed_gateway_events` é reusada sem mudança de schema (a chave é o `event_id` do gateway, e `type` já é `varchar` livre).

### DA-4 — O caminho de catálogo **nunca lança**

Esta é a regra dura da entrega, e é a herança direta da invariante estabelecida pela integração Stripe: *uma exceção escapando do caminho do webhook vira loop de retentativa até o Stripe desativar o endpoint*.

Um evento de catálogo malformado é o caso **esperado**, não o excepcional — a metadata é string livre digitada num dashboard. Um `ValidationError` ali seria um endpoint desativado por causa de um typo.

Contrato:

- Um parser em `infra/gateway/` converte Price bruto → `GatewayCatalogEntry` **ou `null`**. Ele nunca lança.
- `SyncPlanCatalogEntryUseCase` recebe entrada já válida, e as suas próprias recusas (I-1, I-2, staleness, referência não-ligada) são **log + return**, nunca throw.
- Erro de infraestrutura (banco fora) continua propagando normalmente — aí a retentativa do Stripe é exatamente o comportamento certo, e o `release` do claim já existente cobre.

**Tabela de validação (as regras que o parser aplica):**

| Situação                                                        | Resultado                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `sogio_plan_code` ausente ou fora da forma                       | **Entrada ignorada.** É o caso normal: qualquer Price da conta que não seja catálogo do Sogio |
| `sogio_plan_name` ausente ou vazio                               | **Entrada ignorada**                                                        |
| `sogio_plan_name` > 100 chars                                    | **Clampado** para 100 (campo de exibição, erro não-semântico)               |
| `sogio_max_properties` ausente, não-inteiro, ou fora de `[1, 10000]` | **Entrada ignorada.** Nunca assumir default: chutar alto abre o paywall, chutar baixo tranca quem pagou |
| `sogio_trial_days` **ausente**                                   | `0`. Ausência é uma afirmação clara ("sem trial")                            |
| `sogio_trial_days` presente e inválido (`"-1"`, `"quinze"`, > 365) | **Entrada ignorada.** Presente-e-errado é engano, e não se chuta em cima de engano |
| `unit_amount` nulo (preço tiered/metered)                        | **Entrada ignorada**                                                        |
| `currency !== "brl"`                                             | **Entrada ignorada.** `plans` não tem coluna de moeda — um preço em USD entraria como se fosse R$ |
| `recurring` ausente (preço avulso), ou `interval !== "month"`, ou `interval_count !== 1` | **Entrada ignorada.** `billingIntervalSchema` só conhece `monthly`; um preço anual entrando como mensal é mentira de precificação |

Princípio por trás da tabela: **campo semântico errado invalida a entrada inteira; campo de exibição errado é normalizado.**

### DA-5 — Bootstrap: reconciliação, com dois gatilhos

O problema mais sério: webhook só dispara quando algo muda. Com `plans` vazia e o Stripe estático, nenhum evento nasce e o banco fica vazio para sempre. Sem resposta a isso, a entrega não resolve o problema que a originou.

**Decisão: `ReconcilePlanCatalogFromGatewayUseCase` — lê todos os Prices do gateway e aplica cada um pelo mesmo `SyncPlanCatalogEntryUseCase` do webhook. Dois gatilhos:**

1. **No boot da aplicação** (em `src/index.ts`, depois do `checkDatabaseConnection`, antes do `Bun.serve`). Awaited, mas **qualquer falha é logada e engolida** — o servidor sobe de qualquer jeito, com o que já estiver no banco. É o que faz um ambiente novo (sandbox recriado, banco restaurado, segundo alvo de deploy) se auto-popular sem ninguém cutucar o dashboard.
   - Pulada quando `STRIPE_SECRET_KEY` está ausente (development) e quando `NODE_ENV === "test"` — a suíte de testes nunca fala com a rede.
   - Deve ser tolerante a concorrência (dois processos subindo juntos): as escritas são upserts idempotentes e uma colisão de unique é tratada como no-op, não como falha.
2. **Rota administrativa `POST /billing/catalog/sync`** (`adminOnly: true`, `allowWithoutPlatformAccess: true`). Para quando o operador mexeu no catálogo e não quer esperar um restart, ou quando webhooks foram perdidos.
   - A isenção do gate é **obrigatória, não estética**: se a reconciliação de boot falhar (Stripe fora no momento do deploy) com o banco vazio, **a própria conta do admin está bloqueada** e ele não conseguiria chamar a rota que conserta o catálogo. É a mesma forma do DA-5 da entrega Stripe ("a única saída do paywall não pode estar atrás do paywall").

**Alternativas rejeitadas:**

- *Só a rota admin, sem boot* — mantém o deadlock acima e não cobre ambiente novo.
- *Só o boot, sem rota* — força restart para toda correção de catálogo.
- *Pedir para o operador forçar uma edição no dashboard* — funciona uma vez, não é documentável como procedimento, e não cobre recuperação de desastre.

**Nota sobre o cutover específico de produção:** a ordem escolhida é **gateway primeiro, deploy depois** (§7), e nela quem faz o bootstrap é a reconciliação de boot — que o próprio `pm2 restart` no fim do `deploy.yml` dispara, sem passo extra. Isso é deliberado: a reconciliação é o mecanismo do qual todo ambiente futuro depende, e é melhor exercitá-la em voz alta neste deploy, com três caminhos de recuperação disponíveis, do que deixá-la mascarada pelo webhook e descobrir que está quebrada meses depois. Ver R-6.

### DA-6 — `PaymentGateway` ganha uma leitura, e ela devolve vocabulário do Sogio

`PaymentGateway.listCatalogEntries(): Promise<GatewayCatalogEntry[]>`. A porta continua honrando DA-1 da entrega Stripe: entra vocabulário do Sogio, sai vocabulário do Sogio, nenhum tipo `Stripe.*` cruza para `application`. Entradas inválidas são descartadas dentro de `infra` pelo **mesmo parser** que o verificador de webhook usa — um único lugar decide o que é uma entrada de catálogo válida.

Deve listar também Prices **inativos** (com `is_offered: false` na entrada), porque desativação é o sinal explícito de aposentadoria que a I-3 exige.

### DA-7 — Aposentadoria: a semântica atual já está certa; só falta o verbo

Confirmado por leitura do código (§2.5): plano aposentado some da vitrine e continua resolvendo entitlement e histórico de quem assina. **Nada dessa semântica muda.**

O que falta é comportamento no agregado, que hoje é puramente read-only:

- `Plan.syncFromCatalog(entry, external_event_at)` — aplica os campos vindos do gateway. Nunca toca `code` (I-1). **Des-aposenta** (`deleted_at = null`) quando a entrada volta a ser oferecida — reativar um Price no Stripe é o caminho de volta.
- `Plan.retire(external_event_at)` — preenche `deleted_at`. Idempotente: já aposentado é no-op silencioso, nunca `ConflictError` (DA-4).

Ambos gravam `external_event_at` e são recusados quando o evento é mais antigo que o já aplicado (§2.4). A reconciliação **ignora a checagem de staleness** e carimba `external_event_at = now`: ela lê a verdade corrente do gateway, é por definição a informação mais fresca, e a partir dali eventos de webhook anteriores a essa leitura são legitimamente descartáveis.

`PlanRepository` ganha `plansOfExternalProductReference(reference): Promise<Plan[]>` para resolver os eventos de Product.

### DA-8 — Eventos do gateway tratados: **seis**, mapeados para **quatro** eventos de catálogo

| Evento Stripe                    | Evento de catálogo (vocabulário Sogio) | Efeito                                                                 |
| -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| `price.created`, `price.updated` | `catalog_entry_changed`                | Cria/atualiza o plano do `code` da entrada; aposenta se `active: false` |
| `price.deleted`                  | `catalog_entry_retired`                | Aposenta o plano ligado àquela referência de preço                     |
| `product.created`, `product.updated` | `catalog_product_offering_changed`  | Aposenta / des-aposenta todos os planos ligados àquele Product          |
| `product.deleted`                | `catalog_product_retired`              | Aposenta todos os planos ligados àquele Product                        |

**Aviso operacional importante:** na prática o Stripe **arquiva**, não deleta. Um Price já usado em uma assinatura não pode ser deletado — só recebe `active: false`. Um Product só é deletável se não tiver nenhum Price. Logo `price.deleted`/`product.deleted` são caminhos quase mortos, e **o caminho real de aposentadoria é arquivar** (`active: false`), que chega como `price.updated`/`product.updated`. O usuário pediu explicitamente o tratamento de `deleted`; ele fica, é trivial, mas a instrução ao operador é **arquivar**, não procurar botão de deletar.

### DA-9 — Guarda de `livemode` no verificador — vale para os eventos de assinatura também

Todo evento do Stripe carrega `livemode: boolean`. Um `STRIPE_WEBHOOK_SECRET` de endpoint test-mode configurado por engano em produção faria eventos de teste **passarem na verificação de assinatura** (o segredo é legítimo para aquele endpoint) e reescreverem o catálogo real — inclusive `max_properties`.

**Decisão (fecha Q-1): a regra é binária, sobre um único predicado.**

```
esperado = (NODE_ENV === "production")
se (event.livemode !== esperado) → rejeita
```

Rejeição é `null` (200, sem escrita, log de `warn`), nunca exceção. Fica no verificador compartilhado, **antes** do `#normalize` — então vale para os eventos de assinatura já existentes tanto quanto para os de catálogo. É um endurecimento que nasce por causa do catálogo e melhora os dois caminhos.

**Sobre `sandbox`:** `NODE_ENV` ainda admite `development | test | sandbox | production` em `environments.ts`, mas **não existe ambiente `sandbox` na prática** — só local/teste e produção/live. O predicado acima trata `sandbox` junto com os não-produção sem precisar mencioná-lo, o que é o comportamento certo hoje. **Não remover o valor do enum nesta entrega** — não é escopo. Fica registrado que ele é um valor morto, e que o dia em que alguém criar de fato um ambiente `sandbox` precisará decidir explicitamente de que lado da linha de `livemode` ele fica; a regra binária torna essa decisão visível em vez de silenciosa.

### DA-10 — `seedPlans()` sobrevive rebaixado a fixture de desenvolvimento e teste

Análise das dependências: `tests/setup.ts` chama `seedPlans()` no preload, e 10+ arquivos de teste fazem `planOfCode("pro")` / `planOfCode("free")`. A suíte precisa continuar **offline** — nenhum teste pode depender de uma chamada real ao Stripe. E `development` não tem `STRIPE_SECRET_KEY`, então a reconciliação também não roda lá.

**Decisão:**

- `seedPlans()` **fica**, com o papel explicitamente redefinido para fixture local/teste. O comentário do arquivo e o `db:seed` devem dizer isso — não é mecanismo de produção, e nunca entra no `deploy.yml`.
- **O ramo `STRIPE_PRO_PRICE_ID` sai.** O único trabalho daquela variável era levar o `price_id` até o banco; isso agora é feito pelo gateway. Ela é removida de `environments.ts`, do `CLAUDE.md` e do arquivo de seed. Fechar o canal manual é o sinal mais legível de que o dono do catálogo mudou.
- `tests/billing/seed_plans.test.ts` é reescrito (dois dos três casos testam justamente o ramo removido).

**Alternativa rejeitada: deletar o seed e fazer os testes reconciliarem contra o Stripe.** Amarra a suíte à rede e a uma conta externa; inaceitável.

### DA-11 — `CreatePlanUseCase` é removido

É código morto: nenhum controller, nenhuma tool MCP, referenciado só pela própria factory do `BillingDi`. Com o gateway como fonte de verdade, um plano criado à mão nasce órfão (sem referência de preço, invisível ao webhook) e ainda pode colidir no `code` com uma entrada legítima que chegue depois. Remover é o que torna "o gateway é dono do catálogo" verdadeiro em vez de aspiracional.

### DA-12 — Nenhuma tool MCP

Sincronizar catálogo opera sobre a **aplicação inteira**, não sobre os dados do usuário logado. Cai na exclusão deliberada documentada em `CLAUDE.md` e em `.claude/rules/architecture.md` ("Administração não entra no MCP", e "qualquer rota `adminOnly`"). A rota nova é `adminOnly`. `GET /billing/plans` já é pública e não autenticada. **Não é dívida** — é exclusão por desenho, e deve estar registrada assim para o Revisor não sinalizar.

---

## 4. Escopo — o que fica de fora, deliberadamente

- **Moeda e internacionalização.** `plans` não tem coluna de moeda; entradas não-BRL são ignoradas (DA-4). Suportar múltiplas moedas é outra entrega.
- **Intervalos além de mensal.** `billingIntervalSchema` só conhece `monthly`. Plano anual é outra entrega.
- **Migrar assinantes entre Prices.** Repontar `external_price_reference` do plano não mexe em nenhuma `Subscription` existente. Migração de assinante é operação do dashboard do Stripe.
- **Reconciliação periódica / scheduler.** Não existe scheduler no projeto e esta entrega não introduz um. Boot + rota admin + webhook são os três gatilhos.
- **UI de administração de catálogo.** O dashboard do Stripe **é** a UI. Foi essa a escolha.
- **Expurgo de `processed_gateway_events`** (R-7 da entrega anterior) — continua em aberto, agora com mais eventos entrando.

---

## 5. Riscos e Questionamentos

> Os três primeiros riscos foram levantados antes da decisão e o usuário reafirmou a direção. Ficam registrados como riscos assumidos conscientemente, **não como objeções a re-litigar**.

### R-1 — 🔴 Regra de negócio de autorização passa a ser editável de um dashboard, sem revisão, sem PR, sem rollback

`max_properties` é um limite de autorização: é o que `property_management` consulta para decidir se o usuário pode criar mais um imóvel. Depois desta entrega, esse número é editável por qualquer pessoa com acesso ao dashboard do Stripe, sem code review, sem histórico no git, sem CI, e com efeito imediato em produção.

O raio de explosão de um login do Stripe comprometido cresce de "reembolsos e preços" para "os limites de autorização do produto". Um `sogio_max_properties: 10000` no Price do Free torna o Free ilimitado instantaneamente; um `price_amount: 0` no Pro torna o Pro grátis.

**Mitigações desta entrega:** validação de faixa (`[1, 10000]`), guarda de `livemode` (DA-9), imutabilidade do `code` (DA-2), proteção do Free (I-2). **Nenhuma delas mitiga um ator autenticado no dashboard.** Isso é inerente à direção escolhida.

Desde a decisão de executar §7 via API, some-se: **acesso programático à API do Stripe (MCP, chaves de API, agentes) também é, agora, acesso de escrita aos limites de autorização do produto.** O raio de explosão de uma chave secreta vazada cresce junto com o do dashboard. Isso reforça, e não substitui, o escopo de escrita explicitamente limitado do §7.

**Mitigações fora do escopo, recomendadas ao usuário:** 2FA obrigatório e revisão de membros na conta Stripe; rotação/escopo restrito das chaves de API usadas por ferramental; log de auditoria de toda escrita no catálogo (poderia reusar o idioma append-only de `SubscriptionHistoryEntry`, mas é outra entrega).

**→ Item central da revisão do Analista de Segurança.**

### R-2 — 🔴 Um bug no parser ou na regra de aposentadoria é um outage total e imediato

Se `free` for aposentado, `allOffered()` esvazia (vitrine vazia) e, embora `planOfCode` não filtre `deleted_at`, todo o raciocínio de fallback do `SubscriptionAccessPolicy` passa a operar sobre um plano fora do catálogo. Se `free` for **removido**, todo cadastro novo volta a nascer sem `Subscription` — exatamente o incidente atual.

**Mitigações:** I-2 (Free nunca aposentado por evento), I-3 (ausência nunca aposenta), DA-1 (aposentadoria só se a referência do evento é a atualmente ligada). As três precisam de teste explícito e cada uma é um caso do checklist de revisão.

### R-3 — 🟠 Metadata é string livre; três dos quatro campos de negócio agora dependem de digitação correta

`max_properties`, `trial_days` e `code` são digitados à mão em dois ambientes (test e live) sem validação no ponto de entrada. A tabela de DA-4 transforma todo erro em "entrada ignorada" (falha silenciosa e segura) em vez de dado errado gravado — mas *silenciosa* é a palavra incômoda: o operador que digitou errado só descobre olhando o log ou a vitrine.

**Mitigação:** toda rejeição loga em nível `warn` com o `price id` e a razão. Recomenda-se que a task 15 documente a verificação de `GET /billing/plans` como passo obrigatório do setup.

### R-4 — 🟠 Um `code` digitado errado cria um plano fantasma na vitrine pública

Consequência direta e aceita de DA-2 (imutabilidade em vez de allowlist). `sogio_plan_code: "prro"` cria um plano `prro` que aparece em `GET /billing/plans`, que é rota pública. Bug de produto visível, não outage. Correção: arquivar o Price errado e recriar. Vale notar no runbook.

### R-5 — 🟠 A entrega não conserta sozinha as contas já quebradas

Contas criadas enquanto `plans` estava vazia **não têm `Subscription`**. O gate é read-only e não há scheduler: elas continuam bloqueadas para sempre depois do catálogo popular. `EnsureFreeSubscriptionUseCase` já é idempotente e foi escrito prevendo "um futuro backfill" — mas alguém precisa chamá-lo. **Task 12 é obrigatória, não opcional.** Sem ela, a entrega conserta o futuro e abandona os usuários que o incidente já atingiu.

### R-6 — 🟠 Configurar o gateway antes do deploy queima os eventos e joga o bootstrap todo na reconciliação — e mesmo assim é a ordem certa

Configurando o Stripe **agora**, antes do código estar em produção, os `price.created`/`price.updated` disparados chegam num endpoint que ainda não trata catálogo. Verifiquei o caminho no código: `StripeWebhookVerifier.#normalize` cai no `default:`, loga em `debug` e devolve `null`; `ProcessGatewayWebhookUseCase` retorna **antes** do `claim`; o controller responde **200**. Ou seja, **a janela pré-deploy é comprovadamente inerte** — nada quebra, nada entra em retentativa, nada é gravado. Os eventos simplesmente se perdem (200 não é retentado), e o bootstrap passa a depender inteiramente da reconciliação de boot.

Isso soa como perder uma rede de segurança, e por isso a recomendação anterior era a inversa. **A recomendação mudou, e o motivo é que a perda é aparente:**

1. O `deploy.yml` termina em `pm2 restart stayhub_api` — **a reconciliação de boot roda como parte do próprio deploy**, sem passo manual nenhum.
2. A reconciliação é o mecanismo do qual **todo ambiente futuro** depende (banco restaurado, alvo de deploy novo, recuperação de desastre). Exercitá-la neste deploy, em voz alta, é teste; deixá-la mascarada pelo webhook é adiar a descoberta de um bug nela para o dia em que não houver plano B.
3. Se ela falhar, ainda restam **dois** caminhos, não zero: a rota admin `POST /billing/catalog/sync` (que funciona justamente por ter `allowWithoutPlatformAccess`) e tocar qualquer Price no Stripe, que dispara `price.updated` e popula pelo webhook agora já tratado.
4. A configuração do gateway fica verificável por leitura de API **antes** de qualquer código subir, então o deploy passa a ter um único trabalho e um único modo de falha.

**Ordem recomendada, revisada: gateway primeiro, deploy depois** (§7).

### R-7 — 🟠 Reconciliação no boot torna o Stripe uma dependência de inicialização

Mitigado por desenho (falha logada e engolida, servidor sobe mesmo assim), mas continua sendo verdade que um deploy num momento de indisponibilidade do Stripe sobe com o catálogo do banco anterior. Em banco vazio + Stripe fora, o resultado é o estado atual, e o restart seguinte conserta. Aceito.

### R-8 — 🟢 Resolvido por Q-1: a conta sandbox do Stripe não precisa ser configurada nesta entrega

O plano original previa duas passagens de setup (live `acct_1U4tXYCOmGc1OKvH` e sandbox `acct_1U4tXiFiq3OP0Stz`). Com Q-1 fechada — **não existe ambiente `sandbox` na prática** — a segunda passagem some do escopo:

- `test` nunca fala com a rede (reconciliação pulada por DA-5) e tira catálogo do `seedPlans` (DA-10).
- `development` não tem `STRIPE_SECRET_KEY`, então também não reconcilia, e usa o mesmo fixture.
- Se alguém rodar `development` com uma chave test-mode real, a reconciliação roda contra a conta sandbox sem metadata: pela I-3, o resultado é **no-op** — nada criado, nada aposentado. Inofensivo.

A conta sandbox segue existindo e sem uso por esta entrega. Se um dia houver necessidade de exercitar o fluxo ponta a ponta em test mode, §7 é replicado lá sem nenhuma mudança de código.

### R-9 — 🟡 `plans.name` vem de input externo e é servido em JSON público

`GET /billing/plans` é público e devolve `name` vindo direto de metadata. Não há injeção do nosso lado (JSON, não HTML), mas o front pode renderizar sem escapar. Baixo, dado que a origem é o dashboard interno — vale a nota na revisão de segurança.

### R-10 — 🟡 Remover `STRIPE_PRO_PRICE_ID` deixa uma janela em `development`

Em dev, sem seed atualizado e sem reconciliação, `plans.external_price_reference` fica `null` e `CreateCheckoutSessionUseCase` lança `IllegalStateError`. Aceitável: dev não tem chave do Stripe e nunca conseguiu criar checkout real de qualquer forma.

### R-11 — 🟡 `external_price_reference` tem unique index; repontar planos pode colidir

Dois Prices declarando o mesmo `sogio_plan_code` fazem o segundo repontar o plano (último a chegar vence) — comportamento razoável, mas o operador pode não esperar. E se dois planos distintos apontarem para o mesmo price id, a unique estoura. O caminho de escrita precisa tratar violação de unique como recusa logada, **não** como exceção propagada (DA-4).

### R-12 — 🟠 A metadata é escrita antes do parser existir, então a chave certa é um contrato de papel

Consequência da nova ordem (R-6): o §7 grava `sogio_plan_code`, `sogio_plan_name`, `sogio_max_properties` e `sogio_trial_days` no gateway **antes** da task 5 escrever o parser que os lê. Não há nada automatizado ligando os dois lados — se o parser sair esperando `sogio_property_limit`, a divergência só aparece no deploy, como catálogo vazio e silencioso (DA-4 não lança).

**Mitigações:** (a) o §7 é a **especificação normativa** dos nomes de chave, e a task 5 implementa exatamente aquelas strings, sem sinônimo nem tolerância; (b) o §7 termina relendo os Prices por API e conferindo contra a própria tabela; (c) o teste do parser (task 13) usa como fixture o payload real relido no passo de verificação, e não um payload inventado.

### Q-1 — ✅ Resolvido: não existe ambiente `sandbox`; a guarda de `livemode` é binária

Só existem local/teste e produção/live. `NODE_ENV === "production"` exige `livemode: true`; qualquer outro ambiente exige `livemode: false` — um único predicado, sem enumerar ambientes (DA-9). O valor `sandbox` **permanece** no enum de `environments.ts`; removê-lo não é escopo desta entrega. Consequência secundária: a conta Stripe sandbox sai do escopo de setup (R-8).

### Q-2 — ✅ Resolvido: valores confirmados, idênticos aos do seed atual

| Plano | `sogio_max_properties` | `sogio_trial_days` | `unit_amount` |
| ----- | ---------------------- | ------------------ | ------------- |
| Free  | `1`                    | `0`                | `0` (BRL, mensal, recorrente) |
| Pro   | `5`                    | `14`               | `2500` (BRL, mensal — **já é o valor do Price live**, não muda) |

São exatamente os valores que `seedPlans()` usa hoje, o que torna o cutover uma mudança de **dono** do catálogo, não de conteúdo: nenhum usuário vê limite ou preço diferente no dia do deploy. Valores exatos a digitar estão no §7.

---

## 6. Mapeamento de Mudanças

### Arquivos novos — `src/billing/`

| Arquivo                                                         | Responsabilidade                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `application/gateway/gateway_catalog_entry.ts`                   | `GatewayCatalogEntry` — Price normalizado no vocabulário Sogio (`external_price_reference`, `external_product_reference`, `code`, `name`, `price_amount`, `billing_interval`, `max_properties`, `trial_days`, `is_offered`) |
| `application/gateway/gateway_catalog_event.ts`                   | União `GatewayCatalogEvent`: `catalog_entry_changed`, `catalog_entry_retired`, `catalog_product_offering_changed`, `catalog_product_retired` (DA-8) |
| `application/use_case/sync_plan_catalog_entry.ts`                | **Escritor único do catálogo.** Dono de I-1, I-2, I-3, staleness, DA-1 e da regra "nunca lança" (DA-4)                  |
| `application/use_case/reconcile_plan_catalog_from_gateway.ts`    | Lê `listCatalogEntries()` e delega cada entrada ao use case acima (DA-5)                                                |
| `infra/gateway/stripe_catalog_entry_parser.ts`                   | Price bruto do Stripe → `GatewayCatalogEntry \| null`. Implementa a tabela de DA-4. Compartilhado pelo verificador e pelo gateway |
| `presentation/controller/sync_plan_catalog.controller.ts`        | `POST /billing/catalog/sync`, `adminOnly`, `allowWithoutPlatformAccess` (DA-5)                                          |

### Arquivos modificados — `src/billing/`

| Arquivo                                                | Mudança                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `domain/entity/plan.ts`                                | `external_product_reference` e `external_event_at` no schema; métodos `syncFromCatalog()` e `retire()` idempotentes (DA-7) |
| `domain/repository/plan_repository.ts`                 | `plansOfExternalProductReference(reference): Promise<Plan[]>`                                                        |
| `infra/database/postgres_repository/plan_postgres_repository.ts` | Novo método; `save()` cobre as duas colunas novas; tratamento de violação de unique como recusa (R-11)      |
| `application/gateway/payment_gateway.ts`               | `listCatalogEntries(): Promise<GatewayCatalogEntry[]>` (DA-6)                                                        |
| `infra/gateway/stripe_payment_gateway.ts`              | Implementa `listCatalogEntries` (lista Prices ativos **e** inativos, expande o necessário, usa o parser compartilhado) |
| `infra/gateway/stripe_webhook_verifier.ts`             | Guarda de `livemode` (DA-9) antes do `#normalize`; normalização dos seis tipos novos (DA-8); tipo de retorno passa a `GatewayBillingEvent \| GatewayCatalogEvent \| null` |
| `application/gateway/gateway_webhook_verifier.ts`      | Tipo de retorno da porta acompanha o acima                                                                          |
| `application/use_case/process_gateway_webhook.ts`      | `#dispatch` ganha os ramos de catálogo, delegando ao `SyncPlanCatalogEntryUseCase` (DA-3)                            |
| `infra/di/billing_di.ts`                               | Factories dos use cases e do controller novos; **remove** `makeCreatePlanUseCase` (DA-11)                            |
| `infra/database/seed_plans.ts`                         | Remove o ramo `STRIPE_PRO_PRICE_ID`; comentário redefine o papel para fixture de dev/teste (DA-10)                   |
| `application/use_case/create_plan.ts`                  | **Deletado** (DA-11)                                                                                                |

### Arquivos modificados — fora de `billing/`

| Arquivo                                                     | Mudança                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/core/infra/database/drizzle/schemas/billing_schemas.ts` | `plansTable`: `external_product_reference` (varchar 255, nullable, index não-único), `external_event_at` (timestamptz nullable) |
| `drizzle/` (migration nova)                                  | `bun run db:migration` — as duas colunas                                                          |
| `src/core/infra/http/routes/routes.ts`                       | Rota `POST /billing/catalog/sync` em `billingControllers`                                          |
| `src/core/infra/config/environments.ts`                      | **Remove** `STRIPE_PRO_PRICE_ID` (DA-10)                                                          |
| `src/index.ts`                                               | Reconciliação de catálogo no boot, não-fatal, pulada em test/sem chave (DA-5)                     |
| `CLAUDE.md`                                                  | Seção `billing`: catálogo agora vem do gateway; remove `STRIPE_PRO_PRICE_ID` da lista de env vars; documenta a rota admin nova e a exclusão de MCP |
| `.claude/personas/arquiteto.md`                              | Invariantes do domínio: I-1, I-2, I-3                                                             |
| `scripts/backfill_free_subscriptions.ts`                     | **Novo.** Reparo pontual das contas sem `Subscription` (R-5)                                       |

### Testes — `tests/billing/`

| Arquivo                                | Cobertura                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `stripe_catalog_entry_parser.test.ts`  | **Cada linha da tabela de DA-4**, uma por caso. Parser nunca lança                                                                            |
| `sync_plan_catalog_entry.test.ts`      | I-1 (`code` imutável / typo cria plano novo em vez de renomear), I-2 (Free nunca aposentado), DA-1 (aposentadoria só com referência ligada), staleness, des-aposentadoria, idempotência de `retire` |
| `reconcile_plan_catalog.test.ts`       | **I-3: reconciliação contra prices sem metadata NÃO aposenta nada** (o cenário do outage no deploy); reconciliação popula banco vazio; ignora staleness |
| `process_gateway_webhook.test.ts`      | Estendido: evento de catálogo passa pela idempotência; **evento de catálogo malformado devolve 200 e não lança** (DA-4); guarda de `livemode` (DA-9) rejeita nos dois sentidos |
| `seed_plans.test.ts`                   | Reescrito — dois dos três casos atuais testam o ramo `STRIPE_PRO_PRICE_ID` removido                                                            |

---

## 7. Configuração do gateway — executada pelo Orquestrador via API

> **Mudou desde a primeira versão deste plano.** O Orquestrador tem acesso de leitura e escrita à API do Stripe (MCP) na conta **live `acct_1U4tXYCOmGc1OKvH`**. Esta seção deixa de ser "instruções para o usuário no dashboard" e passa a ser **um roteiro de chamadas de API que o Orquestrador executa**. Só o passo 6 (verificação contra a API do Sogio já deployada) e o passo 7 (reparo) dependem do código estar em produção.
>
> Por Q-1, a conta sandbox **não** é configurada nesta entrega (R-8). Uma passagem só, na live.

### 7.0 Ordem: gateway primeiro, deploy depois

Invertida em relação à primeira versão do plano. A justificativa completa está em **R-6**; em uma linha: a janela pré-deploy é comprovadamente inerte (o código atual devolve 200 e ignora eventos de catálogo), o `pm2 restart` no fim do `deploy.yml` já dispara a reconciliação de boot, e fazer o bootstrap por ela é o que valida — em voz alta, neste deploy — o mecanismo do qual todo ambiente futuro depende.

```
7.1 … 7.5  (agora, via API)  →  merge + deploy  →  7.6 verificação  →  7.7 reparo
```

### 7.A Escopo de escrita — o que o Orquestrador pode e não pode tocar

Esta é uma conta de pagamento **live**. O escopo de escrita desta entrega é **fechado** e se resume a:

| Permitido                                                                 | Onde  |
| ------------------------------------------------------------------------- | ----- |
| `POST /v1/products` — criar o Product do Free                              | 7.2   |
| `POST /v1/prices` — criar o Price do Free                                  | 7.2   |
| `POST /v1/prices/{id}` — escrever **apenas `metadata`** no Price do Pro    | 7.3   |
| `POST /v1/webhook_endpoints/{id}` — escrever **apenas `enabled_events`**   | 7.5   |

**Fora de escopo, sem exceção:** arquivar/desativar qualquer Price ou Product existente, mexer em Customers, Subscriptions, Invoices ou reembolsos, criar endpoint de webhook novo, rotacionar segredo de webhook. Qualquer necessidade fora desta lista para a execução e volta para decisão.

### 7.B 🔴 Regra dura de `enabled_events`: é substituição, não acréscimo

`enabled_events` no endpoint de webhook do Stripe é um **conjunto que se sobrescreve por inteiro**. Enviar só os seis tipos de catálogo **remove silenciosamente** `checkout.session.completed`, `customer.subscription.created/updated/deleted` e `invoice.payment_failed` — ou seja, derruba a integração de cobrança inteira em produção, sem erro, sem alarme, e o sintoma só aparece na primeira assinatura que ninguém sincroniza.

**Procedimento obrigatório, nesta ordem:**

1. `GET /v1/webhook_endpoints` — localizar o endpoint que já aponta para `POST /billing/webhooks/stripe`. **Não criar um endpoint novo** (DA-3: um único endpoint, um único segredo).
2. Ler e **registrar** o `enabled_events` atual.
3. Escrever a **união** (atual ∪ os seis novos).
4. Reler e conferir que os antigos continuam lá.

### 7.1 — Conferir o estado de partida

`GET /v1/products` e `GET /v1/prices` na conta live. Estado esperado, levantado antes deste plano:

- Product `prod_V5HtfE1AP8RTC6` "Sogio Pro"
  - Price `price_1U57UhCOmGc1OKvHERzRLNrU` — R$25,00/mês, ativo, `metadata: {}`
  - Price `price_1U57UgCOmGc1OKvH6fqgy3IU` — R$0/mês, **inativo**, `metadata: {}`
- Nenhum Product/Price de `free`

Se o estado divergir, parar e reavaliar — o §7 assume esse ponto de partida.

### 7.2 — Criar Product + Price do Free

Product: nome "Sogio Free". Price nele, **recorrente, mensal, `unit_amount: 0`, `currency: brl`**, com:

```
sogio_plan_code      = free
sogio_plan_name      = Free
sogio_max_properties = 1
sogio_trial_days     = 0
```

Ninguém assina esse Price — ele existe puramente como catálogo, para o Free deixar de ser a única regra de negócio ainda escondida em código. `CreateCheckoutSessionUseCase` já recusa checkout de plano perpétuo (`price_amount = 0`), então não há caminho para alguém cair nele.

`sogio_trial_days = 0` é explícito de propósito: por DA-4 a ausência já significaria `0`, mas escrever o zero deixa o descritor completo e legível para quem abrir o dashboard depois.

### 7.3 — Anotar metadata no Price do Pro

`POST /v1/prices/price_1U57UhCOmGc1OKvHERzRLNrU`, **escrevendo apenas `metadata`**:

```
sogio_plan_code      = pro
sogio_plan_name      = Pro
sogio_max_properties = 5
sogio_trial_days     = 14
```

`unit_amount` **não é tocado** — o Price já é R$25,00 (`2500`), que é exatamente o valor do seed. Nada de preço muda neste cutover (Q-2).

### 7.4 — Não tocar no Price de R$0 inativo

`price_1U57UgCOmGc1OKvH6fqgy3IU` (R$0/mês, inativo, dentro do Product "Sogio Pro") **fica sem metadata**. Sem `sogio_plan_code` ele é simplesmente ignorado (DA-4). Anotá-lo com `free` criaria um plano `free` ligado ao Product errado e já nascido aposentado — exatamente o cenário que a I-2 existe para impedir, e que é melhor nunca provocar.

### 7.5 — Adicionar os seis tipos de evento ao endpoint existente

Seguindo integralmente o procedimento de **7.B**, acrescentar à união:

```
price.created  price.updated  price.deleted
product.created  product.updated  product.deleted
```

### 7.6 — Verificação (depois do deploy)

Nesta ordem:

1. **Antes do deploy:** reler por API os dois Prices anotados e conferir chave a chave contra as tabelas de 7.2 e 7.3. É a única barreira contra a divergência de nomes de chave descrita em **R-12**. Registrar aqui o `price_id` e o `product_id` do Free criados, para o plano virar o registro do que foi feito.
2. **Depois do deploy:** `GET /billing/plans` deve devolver os dois planos com `price_amount`, `max_properties` e `trial_days` corretos. **Passo obrigatório e não delegável** — toda falha de metadata é silenciosa por desenho (DA-4/R-3), então esta é a única confirmação de que o caminho funcionou de ponta a ponta.
3. Conferir no log do deploy que a reconciliação de boot rodou sem erro. Se `GET /billing/plans` vier vazio, a ordem de recuperação é: (a) `POST /billing/catalog/sync`; (b) tocar um Price no Stripe para disparar `price.updated`; (c) investigar a reconciliação.

### 7.7 — Reparar as contas quebradas

Rodar `scripts/backfill_free_subscriptions.ts` (task 12) **depois** de 7.6 passar. Sem isso, quem se cadastrou durante o incidente continua bloqueado para sempre (R-5).

### Lembretes operacionais permanentes

- **Aposentar plano = arquivar o Price** (`active: false`). O Stripe não deixa deletar Price já usado em assinatura, então `price.deleted` é caminho quase morto e não é onde se clica (DA-8).
- **Mudar preço** = criar um Price novo com o mesmo `sogio_plan_code`; o plano local repontará sozinho. Assinantes do preço antigo **não** são migrados automaticamente (§4).
- `STRIPE_PRO_PRICE_ID` deixa de existir (DA-10). Se estiver setada em algum `.env` ou secret de CI, pode ser removida.

---

## 8. Tasks

0. **⚙️ Configuração do gateway via API — executada pelo Orquestrador, ANTES do deploy** — o roteiro inteiro do §7, passos 7.1 a 7.5. Escopo de escrita fechado (7.A) e o procedimento de união de `enabled_events` (7.B) são obrigatórios. Encerra com a releitura por API do passo 7.6.1 e com os ids do Free criados registrados de volta neste plano.
   - Dependências: nenhuma. **Não bloqueia** as tasks 1–13 (que são código), mas **precisa estar concluída antes do deploy** (R-6)

1. **Schema e migration do `Plan`** — `external_product_reference` e `external_event_at` em `billing_schemas.ts`; `bun run db:migration`.
   - Dependências: nenhuma
2. **Comportamento do agregado `Plan`** — campos novos no `planSchema`; `syncFromCatalog()` e `retire()` idempotentes, nunca lançando, nunca tocando `code` (DA-7, I-1).
   - Dependências: task 1
3. **Vocabulário de catálogo em `application/gateway/`** — `GatewayCatalogEntry` e a união `GatewayCatalogEvent` (§2.2, DA-8).
   - Dependências: nenhuma
4. **`PlanRepository` + repositório Postgres** — `plansOfExternalProductReference`; `save()` cobrindo as colunas novas; violação de unique tratada como recusa logada (R-11).
   - Dependências: tasks 1, 2
5. **Parser de entrada de catálogo em `infra/gateway/`** — implementa integralmente a tabela de DA-4; nunca lança; compartilhado pelo verificador e pelo gateway.
   - Dependências: task 3
6. **`SyncPlanCatalogEntryUseCase`** — o escritor único. I-1, I-2, I-3, DA-1, staleness, "nunca lança" (DA-4).
   - Dependências: tasks 2, 3, 4
7. **Verificador de webhook** — guarda de `livemode` (DA-9) para **todos** os eventos; normalização dos seis tipos novos; porta `GatewayWebhookVerifier` com o tipo de retorno ampliado.
   - Dependências: tasks 3, 5
8. **`PaymentGateway.listCatalogEntries` + implementação Stripe** — lista Prices ativos e inativos, normaliza pelo parser da task 5 (DA-6).
   - Dependências: tasks 3, 5
9. **`ReconcilePlanCatalogFromGatewayUseCase`** — delega cada entrada à task 6; tolerante a concorrência (DA-5).
   - Dependências: tasks 6, 8
10. **Orquestrador + DI + rota admin + boot** — ramos de catálogo em `ProcessGatewayWebhookUseCase` (DA-3); factories no `BillingDi`; `POST /billing/catalog/sync` (`adminOnly`, `allowWithoutPlatformAccess`); reconciliação não-fatal em `src/index.ts`.
    - Dependências: tasks 6, 7, 9
11. **Subtrações** — deletar `CreatePlanUseCase` e sua factory (DA-11); remover o ramo `STRIPE_PRO_PRICE_ID` do seed e a variável de `environments.ts`; redefinir o papel do `seedPlans` em comentário (DA-10).
    - Dependências: task 10
12. **Script de reparo `scripts/backfill_free_subscriptions.ts`** — chama `EnsureFreeSubscriptionUseCase` (já idempotente) para todo usuário sem `Subscription` (R-5). Execução manual, uma vez, após o passo 5 do §7.
    - Dependências: nenhuma
13. **Testes** — os cinco arquivos do §6, com prioridade para os três cenários de outage (I-2, I-3 e "malformado devolve 200").
    - Dependências: tasks 10, 11
14. **🔒 Revisão do Analista de Segurança — bloqueante, antes do PR.** Escopo mínimo: (a) R-1, o novo raio de explosão de um dashboard Stripe comprometido sobre `max_properties`; (b) a guarda de `livemode` (DA-9) fecha de fato a confusão test/live; (c) nenhum caminho do catálogo lança (DA-4) — verificar inclusive violação de unique e falha de parse; (d) I-2 e I-3 são infalsificáveis, incluindo o cenário "reconciliação contra prices sem metadata"; (e) a rota admin com `allowWithoutPlatformAccess` não vira bypass de nada além dela mesma; (f) R-9, `name` de origem externa servido em JSON público; (g) a configuração do gateway feita na task 0 — confirmar por leitura de API que o `enabled_events` do endpoint **preservou** os cinco eventos de assinatura (7.B) e que nenhuma escrita saiu do escopo de 7.A.
    - Dependências: tasks 0, 13
15. **Documentação** — `CLAUDE.md` (seção `billing`: catálogo vem do gateway, rota admin nova, exclusão MCP; remover `STRIPE_PRO_PRICE_ID` da lista de env vars), `.claude/personas/arquiteto.md` (I-1, I-2, I-3), e os "lembretes operacionais permanentes" do §7 (arquivar ≠ deletar; trocar preço = Price novo com o mesmo `sogio_plan_code`) registrados onde o operador ache — eles sobrevivem ao cutover.
    - Dependências: task 11

> **Paralelização:** a task 0 é trabalho de gateway e corre em paralelo com todo o resto — só precisa estar pronta antes do deploy. Em código: tasks 1, 3 e 12 abrem juntas; depois de 3, as tasks 5 e (com 1, 2) 4 correm em paralelo; tasks 7 e 8 correm em paralelo depois de 5.
>
> **Sequência de cutover:** task 0 → merge → deploy (o `pm2 restart` do `deploy.yml` dispara a reconciliação) → §7.6 verificação → task 12 executada (§7.7).

---

## 9. Diretrizes para o Desenvolvedor

1. **A regra inegociável desta entrega: nenhum caminho de catálogo lança.** Se você se pegar escrevendo `throw new ValidationError` em qualquer lugar entre o verificador e o repositório, pare — a resposta certa é log + return. A única exceção legítima é falha de infraestrutura (banco fora), onde a retentativa do Stripe é o comportamento desejado.
2. **Ausência nunca aposenta (I-3).** É o erro mais fácil de cometer e o mais caro: "sincronizar" instintivamente vira "fazer o banco espelhar o gateway", e isso apaga `free` e `pro` no primeiro boot contra os Prices sem metadata que existem hoje em produção. Aposentadoria exige sinal explícito.
3. **Um único parser.** O verificador de webhook e o `listCatalogEntries` devem chamar exatamente o mesmo código para decidir o que é uma entrada de catálogo válida. Duas implementações divergindo é como o webhook e a reconciliação passam a discordar sobre o catálogo.
4. **`code` nunca é escrito numa linha existente.** Nem por `syncFromCatalog`, nem por um `update` solto no repositório.
5. **Reuse o idioma da entrega Stripe** em vez de inventar: `external_event_at` para staleness, `claim`/`release` para idempotência, `Logger` estruturado com o id da referência em toda recusa, porta em `application/gateway/` com implementação única em `infra/gateway/`.
6. **Q-1 e Q-2 estão fechadas — não há mais bloqueio para começar.** Duas consequências que valem para o código: a guarda de `livemode` é o predicado binário `NODE_ENV === "production"` (DA-9), sem enumerar ambientes e sem tocar no enum; e os valores de negócio do cutover são os mesmos do seed atual, então o dia do deploy não muda limite nem preço de ninguém.
7. **Os nomes das chaves de metadata são contrato, não sugestão.** `sogio_plan_code`, `sogio_plan_name`, `sogio_max_properties`, `sogio_trial_days` — exatamente essas strings, sem sinônimo, sem fallback, sem tolerância a variação. Elas já vão estar escritas no gateway antes de você escrever o parser (R-12), e o §7 é a especificação normativa. Use como fixture do teste do parser o payload real relido no passo 7.6.1, não um payload inventado.
8. Fluxo de branch, commits (Conventional Commits, um commit por modificação) e PR seguem `.claude/personas/orquestrador.md`. Todo comando roda dentro do worktree.
