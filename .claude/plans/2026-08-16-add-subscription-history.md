# Histórico da Assinatura — registro auditável do ciclo de vida

> Empilhado em cima de `add-billing-subscriptions` (PR #34, ainda aberto). A base desta branch é `add-billing-subscriptions`, **não** `main`.

## Objective

Dar resposta à pergunta que o modelo atual não responde — "quando esta assinatura começou, e o que aconteceu com ela desde então?". A `Subscription` muta in-place a cada troca de plano (DA-5 da entrega anterior), então o registro vivo só conhece o **agora**. Esta entrega introduz o **Histórico da Assinatura**: um registro append-only, gravado no banco, de cada transição relevante do ciclo de vida, alimentado por eventos de domínio e exposto ao próprio usuário por uma rota HTTP.

Não cobre `Invoice`/`Payment` — histórico de pagamento real depende do gateway, que ainda não existe.

---

## Personas

- **Arquiteto** (`.claude/personas/arquiteto.md`) — autor deste plano
- **Desenvolvedor** (`.claude/personas/desenvolvedor.md`) — execução das tasks
- **Analista de Segurança** (`.claude/personas/analista_seguranca.md`) — revisão obrigatória da task 9 (a rota nova entra na lista de exceções fail-closed da DA-9 e expõe dados de billing do usuário; um escopo errado aqui vaza histórico de terceiro) e da task 2 (`ON DELETE cascade` — ver R-1, a exclusão LGPD quebra sem isso)

---

## 1. Análise de Negócio

Três perguntas de negócio, hoje sem resposta:

1. **"Desde quando este cliente é nosso cliente?"** — hoje só existe `subscriptions.created_at`, que é o instante da linha, não um fato de negócio, e some no dia em que a assinatura for recriada por qualquer motivo.
2. **"Este cliente já foi Pro? Quando fez upgrade? Quando caiu para Free?"** — hoje impossível: a troca de plano sobrescreve `plan_id`. Perde-se conversão, churn, tempo médio até upgrade — as métricas que justificam o produto pago existir.
3. **"Por que este cliente está bloqueado, e desde quando?"** — o `Entitlement` responde _que_ está bloqueado, nunca _quando começou_. Suporte hoje não tem o que olhar.

O que a entrega dá a cada ator:

- **Proprietário**: uma linha do tempo da própria assinatura na rota `GET /billing/subscription/history` — "começou no Free em 15/08", "assinou o Pro em 20/09 (teste até 04/10)", "pagamento falhou em 15/11". É a evidência que ele pede antes de reclamar de cobrança.
- **Negócio**: base bruta para conversão/churn sem depender do gateway.
- **Suporte/auditoria**: um registro que ninguém edita. É a diferença entre "o cliente diz que cancelou" e "o cliente cancelou em 12/07 às 14h32".

**O que esta entrega explicitamente NÃO é**: não é histórico de pagamento. Não há `Invoice`, não há `Payment`, não há valor cobrado nem recibo. É o histórico do **vínculo contratual**, não do dinheiro. Confundir os dois na comunicação com o usuário é o principal risco de expectativa desta entrega (ver R-6).

---

## 2. Análise de Domínio

### 2.1 Linguagem Ubíqua

| Termo                                                         | Significado                                                                                                                                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Histórico da Assinatura**                                   | A sequência ordenada de tudo que aconteceu com a assinatura de uma conta.                                                                                                               |
| **`SubscriptionHistoryEntry`**                                | Uma linha desse histórico: um fato imutável, datado, sobre uma transição da assinatura.                                                                                                 |
| **Transição** (`type`)                                        | O que aconteceu: `started`, `plan_changed`, `payment_failed`, `canceled`.                                                                                                               |
| **`resulting_status`**                                        | O status em que a assinatura ficou **imediatamente depois** da transição. Fato registrado, não derivado na leitura.                                                                     |
| **`access_until`**                                            | Até quando o acesso ficou garantido **por causa daquela transição**. Fim do trial, fim do ciclo pago ou fim da tolerância. `null` = perpétuo (Free).                                    |
| **Ciclo pago aberto** (`has_paid_cycle` / `opens_paid_cycle`) | A assinatura entrou num ciclo de cobrança de verdade — nem trial, nem plano perpétuo. Derivado dentro do agregado; é o fato que substitui o antigo `SubscriptionActivatedEvent` (§2.4). |

#### Por que `SubscriptionHistoryEntry` e não "log"

"Log" é vocabulário de operação (stdout, arquivo, rotação), não de negócio — um log pode ser truncado e ninguém se importa; este registro não pode. O projeto já tem um conceito de linha append-only num registro de negócio: **`LedgerEntry`** no `finance`. Reusar o sufixo `Entry` faz o conceito novo cair numa categoria que o time já entende, com as mesmas propriedades (só se acrescenta, nunca se corrige, e a ordem cronológica é a informação). Alternativas descartadas: `SubscriptionEvent` (colide com `DomainEvent`, que é outra coisa e vive na mesma pasta `domain/event/`), `SubscriptionTimeline` (termo de UI), `SubscriptionAudit` (termo de compliance, não de billing).

### 2.2 Natureza do conceito: Entity imutável, agregado próprio

**Decisão: é uma Entity com `BaseEntity`, com um único factory `record()`, sem nenhum mutator, e é um agregado próprio — não faz parte do agregado `Subscription`.**

Justificativa em três pontos:

1. **Fora do agregado `Subscription`.** A `Subscription` é carregada em **toda requisição autenticada** (gate da DA-9). Se o histórico fosse parte do agregado, a decisão de acesso passaria a arrastar N linhas de auditoria a cada request. O histórico referencia a `Subscription` por id, como `LedgerEntry` referencia `Property` por id.
2. **Mantém `BaseEntity` apesar de `updated_at`/`deleted_at` serem letra morta.** Toda tabela do projeto espalha `baseSchema` e toda entidade espalha `baseEntitySchema`; um formato bespoke seria a única exceção do repositório e obrigaria `reconstitute` a divergir do padrão. O custo são duas colunas nunca escritas depois do insert. A imutabilidade não vem do formato — vem da ausência de mutators e da interface do repositório (§2.5).
3. **Um factory, não quatro.** `record()` recebe os dados já resolvidos pelo handler. As garantias por tipo de transição ficam nas refinements do schema Zod (§2.3), no mesmo estilo que `subscriptionSchema` já usa para `trial_ends_at`/`grace_period_ends_at`/`canceled_at`.

Não é Aggregate Root no sentido de ter comportamento e invariantes que evoluem — é um **fato registrado**. `@kind Entity` no docblock, sem `Aggregate Root`.

### 2.3 Dados gravados em cada entrada

| Campo                                          | Tipo              | Conteúdo                                                                                       |
| ---------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `id`, `created_at`, `updated_at`, `deleted_at` | `baseSchema`      | `created_at` = instante do insert (tempo de sistema). `updated_at`/`deleted_at` nunca tocados. |
| `subscription_id`                              | uuid, FK          | → `subscriptions.id`, **`ON DELETE cascade`** (ver R-1)                                        |
| `user_id`                                      | uuid, FK          | → `users.id`, **`ON DELETE cascade`**. Denormalizado de propósito (ver abaixo)                 |
| `plan_id`                                      | uuid, FK          | → `plans.id`. O plano vigente **depois** da transição                                          |
| `type`                                         | varchar(30)       | `started` \| `plan_changed` \| `payment_failed` \| `canceled`                                  |
| `resulting_status`                             | varchar(20)       | status da `Subscription` logo após a transição                                                 |
| `occurred_at`                                  | timestamptz NN    | tempo de **negócio**, vindo do `DomainEvent.occurred_at`                                       |
| `access_until`                                 | timestamptz NULL  | até quando o acesso ficou garantido por essa transição; `null` = perpétuo                      |
| `reason`                                       | varchar(255) NULL | só para `payment_failed`: string opaca (código de recusa do gateway futuro)                    |

**Por que `occurred_at` além de `created_at`**: são coisas diferentes no minuto em que existir webhook ou backfill — o gateway informa uma falha de pagamento ocorrida às 03h e o insert acontece às 03h02, e um backfill insere hoje um fato de março. Uma coluna, e a alternativa (descobrir depois que a linha do tempo está errada) exige migration com dados vivos.

**Por que `user_id` denormalizado** (a `Subscription` é 1:1 com `User`, então seria derivável por join): a consulta é "meu histórico" e o escopo de autorização vira um `WHERE user_id = :caller` direto, sem join. Um join a mais entre o predicado de segurança e a linha é exatamente onde vaza dado de terceiro. Uma coluna uuid pelo predicado de autorização ser trivialmente auditável é barato.

**Por que `access_until` em vez de `period_start` + `period_end` + `trial_ends_at` + `grace_period_ends_at`**: as quatro datas respondem à mesma pergunta em contextos diferentes — "até quando o acesso está garantido". `resulting_status` desambigua qual delas é sem perda de informação:

| `resulting_status` | o que `access_until` significa         |
| ------------------ | -------------------------------------- |
| `trialing`         | fim do trial                           |
| `active`           | fim do ciclo pago (`null` se perpétuo) |
| `past_due`         | fim da tolerância                      |
| `canceled`         | fim do ciclo já pago                   |

`period_start` sai de graça: para `plan_changed`, o início do período **é** o `occurred_at` da entrada. Resultado: 9 colunas de significado de negócio, sem `jsonb` e sem campo genérico de "detalhes" que vira lixeira sem schema. (Há precedente de `jsonb` no projeto — `app_settings.value`, `property_settings.value` — mas ali o conteúdo é genuinamente arbitrário; aqui não é.)

Refinements no schema Zod (mesmo estilo de `subscriptionSchema`):

- `reason` presente ⇒ `type = payment_failed`
- `type = payment_failed` ⇒ `resulting_status = past_due` **e** `access_until` presente
- `type = canceled` ⇒ `resulting_status = canceled`
- `type = started` ⇒ `resulting_status ∈ {active, trialing}`

**Rejeitado: `previous_plan_id`.** É redundante com a sequência — o plano anterior é o `plan_id` da entrada anterior do mesmo usuário. Guardar um dado derivável da própria série é convite a divergência.

### 2.4 Eventos de Domínio

#### O buraco que precisa ser tapado primeiro

`SubscribeToPlanUseCase` hoje publica `SubscriptionActivatedEvent` **só quando** `status === "active" && plan.price_amount > 0`. Enumerando os caminhos reais de troca de plano:

| Caminho                      | status resultante | evento hoje | histórico se consumíssemos `Activated` |
| ---------------------------- | ----------------- | ----------- | -------------------------------------- |
| free → pro, nunca usou trial | `trialing`        | **nenhum**  | ❌ perdido                             |
| free → pro, já usou trial    | `active`          | Activated   | ✅                                     |
| pro → free (downgrade)       | `active`, preço 0 | **nenhum**  | ❌ perdido                             |
| pro cancelado → pro de novo  | `active`          | Activated   | ✅                                     |

Dois dos quatro caminhos são invisíveis — e o primeiro deles é **o caminho principal de conversão para o plano pago**. Consumir `SubscriptionActivatedEvent` no histórico entregaria um histórico com buraco no evento mais importante do funil.

Logo, é preciso um evento disparado em **toda** troca de plano bem-sucedida: `SubscriptionPlanChangedEvent`. O tipo de entrada correspondente chama-se `plan_changed` — além de tapar o buraco, é linguagem melhor: descreve o que **o usuário fez** ("trocou de plano"), não o que o sistema concluiu ("ativou").

#### `SubscriptionActivatedEvent` é absorvido, não preservado (Q-1 — resolvido)

A primeira versão deste plano propunha manter os dois eventos: `plan_changed` para o histórico e `activated` intocado como gancho de receita para o `finance`. **Isso estava errado, por um defeito que o próprio desenho de dois eventos cria.**

No caminho "free → pro, já usou trial", os dois eventos descrevem **o mesmo ato** e seriam disparados juntos, na mesma chamada de `SubscribeToPlanUseCase`. Dois eventos para um fato é armadilha montada: no dia em que o `finance` registrar um handler em `subscription_plan_changed` sem perceber que `subscription_activated` já cobre o caso (ou vice-versa), a receita é lançada em dobro. Um evento redundante e sem consumidor é exatamente o tipo de seam que a entrega anterior se comprometeu a não criar (DA-6 anterior: "não criar uma porta sem implementação e sem chamador, que nasceria errada e viraria dead code").

**Decisão: existe um único evento de troca de plano, `SubscriptionPlanChangedEvent`, e `SubscriptionActivatedEvent` é removido.**

##### Por que isso não empurra regra de negócio para fora do domínio

A objeção legítima a unificar é: o `finance`, quando existir, precisa saber se a transição é uma **ativação paga de verdade**. Se tivesse que recomputar `status === "active" && plan.price_amount > 0`, teria que carregar o `Plan` do `billing` para ler o preço — uma leitura cross-BC que hoje não existe e que engrossaria a dependência que a DA-8 anterior manteve fina de propósito. Esse receio é real; a resposta não é manter dois eventos, é **o evento carregar a classificação já resolvida**.

E ela pode ser resolvida **dentro do agregado**, sem o `Plan`: `Subscription` já sabe se abriu um ciclo pago, porque só `activate({ is_perpetual: false })` preenche `current_period_end`. Getter derivado na entidade:

```
has_paid_cycle  ⇔  status === "active" && current_period_end !== null
```

Verificação contra todas as transições existentes:

| transição                           | status resultante | `current_period_end` | `has_paid_cycle` | correto? |
| ----------------------------------- | ----------------- | -------------------- | ---------------- | -------- |
| `create` no Free (perpétuo)         | `active`          | `null`               | `false`          | ✅       |
| `create` em plano pago sem trial    | `active`          | preenchido           | `true`           | ✅       |
| `startTrial`                        | `trialing`        | `null`               | `false`          | ✅       |
| `activate({ is_perpetual: true })`  | `active`          | `null`               | `false`          | ✅       |
| `activate({ is_perpetual: false })` | `active`          | preenchido           | `true`           | ✅       |
| `markPastDue`                       | `past_due`        | preenchido           | `false`          | ✅       |
| `cancel`                            | `canceled`        | preenchido           | `false`          | ✅       |

É **exatamente equivalente** à condição de hoje (`is_perpetual ⇔ price_amount === 0`, e o use case sempre passa `plan.is_perpetual` para `changePlan`), só que derivada de estado que o agregado já possui, em vez de recomputada no use case a partir do `Plan`. O evento carrega o valor amostrado logo após a transição, no campo **`opens_paid_cycle`**.

Resultado líquido: a regra "o que conta como ativação paga" sai do `SubscribeToPlanUseCase` (onde está hoje, fora do agregado) e passa a viver **num único lugar, dentro de `Subscription`**. O consumidor futuro do `finance` faz `if (!event.opens_paid_cycle) return;` — lê uma flag, não reimplementa regra, não carrega `Plan`. O acoplamento fica **menor** do que na proposta de dois eventos, não maior.

Nome: `opens_paid_cycle`, não `is_billable_activation`. "Billable" é vocabulário do `finance` presumindo o que o consumidor vai fazer com o fato; o `billing` afirma o fato ("esta transição abriu um ciclo pago") e deixa a decisão de reconhecer receita com quem é dono dela.

##### O que se perde, e por que é aceitável

Quando o gateway existir, haverá **renovação**: um novo ciclo pago abre **sem troca de plano**. `SubscriptionPlanChangedEvent` seria mentira nesse caso, e o `finance` vai precisar de um evento próprio — que teria sido justamente o papel de um `SubscriptionActivatedEvent` preservado.

Mesmo assim, remover agora é o certo: esse evento futuro nasce do `ConfirmSubscriptionPayment` (webhook), com dados que ainda não existem (id da fatura, valor efetivamente pago, período confirmado pelo gateway). Preservar hoje uma classe de 12 linhas com uma assinatura adivinhada não adianta trabalho nenhum — quem escrever o webhook vai reescrevê-la de qualquer jeito, e no meio tempo ela fica no código como armadilha de duplicação. Registrado em R-7.

#### Quadro final

| Evento                           | Novo?           | Disparado por                                             | Consumido pelo histórico | Tipo de entrada  |
| -------------------------------- | --------------- | --------------------------------------------------------- | ------------------------ | ---------------- |
| `SubscriptionStartedEvent`       | ✅              | `EnsureFreeSubscriptionUseCase` — **só no ramo que cria** | sim                      | `started`        |
| `SubscriptionPlanChangedEvent`   | ✅              | `SubscribeToPlanUseCase`, após todo `changePlan`          | sim                      | `plan_changed`   |
| `SubscriptionPaymentFailedEvent` | ✅              | `MarkSubscriptionPastDueUseCase` (novo, §3 DA-5)          | sim                      | `payment_failed` |
| `SubscriptionCanceledEvent`      | —               | `CancelSubscriptionUseCase` (já existe)                   | sim                      | `canceled`       |
| `SubscriptionActivatedEvent`     | ❌ **removido** | —                                                         | —                        | —                |

**Os eventos carregam os fatos, não só os ids.** `SubscriptionStartedEvent` e `SubscriptionPlanChangedEvent` levam `status`, `trial_ends_at`, `current_period_end` e `opens_paid_cycle`; `SubscriptionPaymentFailedEvent` leva `grace_period_ends_at` e `reason`; `SubscriptionCanceledEvent` ganha `current_period_end`. Motivo: o handler **não pode reler a `Subscription`** para montar a entrada — o registro tem que gravar o que era verdade no instante da transição, não o que é verdade no instante da leitura. Reler introduz uma corrida silenciosa que corrompe justamente o dado auditável.

`opens_paid_cycle` vai também no `SubscriptionStartedEvent`, apesar de o cadastro sempre cair no Free hoje: é a mesma derivação, mantém os dois eventos simétricos e evita que um consumidor futuro de receita precise tratar os dois de formas diferentes. Custa uma linha.

Estender `SubscriptionCanceledEvent` é seguro porque ele ainda não tem nenhum consumidor.

**Construtor com objeto, não posicional.** Os eventos existentes usam 3 parâmetros posicionais; os novos chegam a 7, metade deles datas anuláveis intercambiáveis. Posicional aí é fábrica de bug silencioso. Os três eventos novos recebem um único parâmetro de objeto. Desvio consciente do estilo vizinho.

#### Idempotência do `started` (ponto crítico)

`EnsureFreeSubscriptionUseCase` é chamado pelo fluxo normal (`StartFreeSubscriptionOnUserCreated`, reagindo a `UserCreatedEvent`) e será chamado por um backfill idempotente no futuro. Ele retorna cedo quando já existe assinatura.

**O dispatch de `SubscriptionStartedEvent` vai dentro do ramo que cria, depois do `save` — nunca antes do `if (existing) return`.** Consequência desejada: qualquer chamador (handler, script de backfill, teste) herda semântica exatamente-uma-vez sem precisar saber disso. Duas entradas `started` para a mesma conta seria a corrupção mais visível possível deste registro ("sua assinatura começou duas vezes").

Alternativa descartada: fazer o use case retornar `{ created: boolean }` e deixar cada chamador decidir se dispara. Move a responsabilidade para N chamadores; o primeiro que esquecer duplica.

Corrida entre duas chamadas concorrentes: ambas podem passar pelo `if (existing)`, mas o índice único em `subscriptions.user_id` faz o segundo `save` estourar antes do dispatch. No máximo uma entrada. Comportamento pré-existente, inalterado.

### 2.5 Imutabilidade em nível de aplicação

A `SubscriptionHistoryRepository` expõe **exatamente**:

```
append(entry): Promise<void>              // INSERT puro — nunca upsert
historyOfUser(user_id, pagination)        // leitura paginada, ordenada
```

Nada de `save`, `update`, `delete`, `remove`. Note o contraste deliberado com `SubscriptionPostgresRepository.save`, que faz select-então-update-ou-insert: aqui `append` é `db.insert(...)` e ponto. A entidade não tem mutator nenhum e usa `readonly #data` (como `Plan`, não como `Subscription`). Sem trigger nem constraint no Postgres, conforme decidido.

---

## 3. Decisões Arquiteturais

### DA-1 — Quatro handlers finos, um por evento

Rejeitado o handler genérico único com `switch (event.name)`: `EventHandler<T>` é genérico por evento, então um handler polivalente teria que se declarar `EventHandler<DomainEvent>` e recuperar os campos por cast — trocando checagem de tipo por convenção, no exato código cuja função é não errar o dado gravado.

Quatro classes em `billing/application/handler/`, nomes no estilo do `finance` (`RecordRevenueOnStayPaymentConfirmed`):

- `RecordHistoryOnSubscriptionStarted`
- `RecordHistoryOnSubscriptionPlanChanged`
- `RecordHistoryOnSubscriptionPaymentFailed`
- `RecordHistoryOnSubscriptionCanceled`

Cada uma é um mapeador: recebe o evento, dobra `status` + `trial_ends_at` + `current_period_end` (ou `grace_period_ends_at`) em `access_until`, monta a entrada e delega. ~15 linhas cada.

### DA-2 — `RecordSubscriptionHistoryEntryUseCase`: o único escritor, e ele **não propaga exceção**

Os quatro handlers delegam a um único use case, que faz `append` e **captura, loga em nível `error` e retorna**.

Por quê isso importa: o `inMemoryEventDispatcher` é síncrono e a cadeia real é

```
RegisterUserUseCase → dispatch(UserCreated) → StartFreeSubscriptionOnUserCreated
   → EnsureFreeSubscription → save → dispatch(SubscriptionStarted)
       → RecordHistoryOnSubscriptionStarted → append
```

Sem o catch, uma falha ao gravar **auditoria** derruba o **cadastro de usuário** — depois de o usuário e a assinatura já estarem persistidos, sem transação abrangendo os dois. O mesmo vale para `SubscribeToPlan` e `CancelSubscription`: a assinatura já foi salva quando o handler roda; deixar a exceção subir devolve 500 para uma operação que **deu certo**, e o cliente conclui que a troca de plano falhou quando ela não falhou.

Assimetria consciente com `RecordRevenueOnStayPaymentConfirmed`, que **não** captura: perder um lançamento de receita é um bug de dinheiro que precisa gritar na hora; perder uma linha de auditoria é uma lacuna que precisa gritar no log sem derrubar a escrita de negócio que já foi confirmada.

O `try/catch` fica em **um** lugar (o use case), não replicado nos quatro handlers. É a única razão de existir essa camada — sem ela, os handlers chamariam o repositório direto, como no `finance`.

Risco aceito e registrado em R-3.

### DA-3 — A rota é `GET /billing/subscription/history`, escopada ao próprio usuário

- Path aninhado sob `/billing/subscription` — o histórico pertence à assinatura do chamador, e a rota deixa isso explícito.
- **O `user_id` nunca vem do request.** O use case recebe só `pagination` no `Input`; o dono sai do `user` que o adaptador injeta. Não existe parâmetro de path/query que aceite id de usuário — não há como errar o escopo por engano.
- Paginado, reusando `paginationInputSchema` / `PaginatedResult` (precedente: `FindPropertyFinancialMovementsController`). Sem paginação, uma conta antiga devolveria a série inteira.
- Ordenação **`occurred_at DESC, created_at DESC, id DESC`**. O desempate não é preciosismo: `started` e `plan_changed` podem cair no mesmo milissegundo num teste ou num backfill, e ordenação não determinística faz linha se repetir ou sumir entre páginas.
- Resposta enriquecida com `plan_code` e `plan_name` via join com `plans` — um UUID de plano não é renderizável. O repositório devolve `SubscriptionHistoryEntryWithPlan`, espelhando o `SubscriptionWithPlan` que já existe.

Formato da resposta:

```jsonc
{
  "data": [
    {
      "id": "…",
      "type": "plan_changed",
      "resulting_status": "trialing",
      "plan_id": "…",
      "plan_code": "pro",
      "plan_name": "Pro",
      "occurred_at": "2026-09-20T13:05:00.000Z",
      "access_until": "2026-10-04T13:05:00.000Z",
      "reason": null,
    },
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "total_pages": 1,
    "has_next": false,
    "has_previous": false,
  },
}
```

### DA-4 — A rota entra na lista de exceções do gate fail-closed (DA-9 anterior)

`allowWithoutPlatformAccess: true`, pelo mesmo motivo de `GET /billing/subscription`: é a rota que responde _"por que estou bloqueado e desde quando"_. Trancá-la atrás do bloqueio produz o loop em que o usuário não consegue ver a causa do próprio bloqueio. Não expõe nada do produto — só fatos de billing da própria conta.

A R-5 da entrega anterior exige justificativa no PR para toda adição a essa lista; esta é a justificativa, e a task 9 vai à revisão do Analista de Segurança.

**Sem rota de admin nesta entrega.** Consultar histórico de terceiro tem valor real para suporte, mas não existe nenhuma superfície de backoffice que consuma isso hoje, e criá-la agora abre exposição de dado de outro usuário sem consumidor. A modelagem já deixa o caminho pronto (basta um controller admin sobre um `historyOfSubscription`); fica como follow-up natural.

**Sem tool MCP.** Consultar a própria fatura via agente não é caso de uso do produto, e cada tool amplia a superfície de acesso delegado.

### DA-5 — `markPastDue()` ganha um chamador real: `MarkSubscriptionPastDueUseCase`

O enunciado é claro em não querer outro seam morto. Duas coisas diferentes:

- O **handler está ligado**: registrado no dispatcher, no construtor do `BillingDi`. No instante em que qualquer coisa publicar `SubscriptionPaymentFailedEvent`, a entrada é gravada. Isso já não é seam morto — é fio energizado.
- O **produtor** ainda não existe em produção, porque não há gateway, webhook nem scheduler. Qualquer produtor "de verdade" hoje seria encenação.

**Decisão: criar `MarkSubscriptionPastDueUseCase`** — carrega a assinatura, calcula a janela de tolerância, chama `markPastDue`, salva e publica o evento. É exatamente a forma que o `ConfirmSubscriptionPayment` (webhook Stripe futuro, DA-6 anterior) vai chamar. Ganho concreto: a transição passa a ser testável ponta a ponta pelo mesmo caminho que a produção vai usar, em vez de um teste cutucando o dispatcher na mão. Custo: ~30 linhas. Coerente com a R-6 anterior, que já aceitou use cases sem chamador HTTP.

**Sem rota HTTP** — nem admin. Marcar uma conta como inadimplente na mão é alavanca de operação, e inventar produto aqui não é papel desta entrega.

A janela de tolerância é aritmética de ciclo ⇒ vai para `BillingCyclePolicy` como `gracePeriodEnd(now)`, o ponto único já estabelecido pela DA-4 anterior. **Duração: 7 dias** (decidido — Q-2), como constante nomeada dentro da policy, não como argumento do use case.

### DA-6 — `ON DELETE cascade` nas duas FKs de identidade

`PurgeUserDataUseCase` (LGPD) faz `DELETE FROM users`. `subscriptions.user_id` já é `ON DELETE cascade`. Se a tabela nova referenciasse `subscriptions.id` ou `users.id` com o `no action` padrão do Drizzle, **a transação de exclusão de conta passaria a falhar** — o usuário perderia a capacidade de excluir a própria conta, que é justamente a rota que a DA-9 anterior isentou do paywall por ser obrigação legal.

É a mesma classe de bug já documentada em comentário no `auth_postgres_repository.ts` (linhas 91-95, sobre `property_settings` / `external_booking_sources`). Ambas as FKs — `subscription_id` e `user_id` — são `ON DELETE cascade`. `plan_id` fica `no action`: planos nunca são deletados fisicamente, só `deleted_at` (invariante da entrega anterior).

### DA-7 — `BillingDi` continua sendo instanciado exatamente uma vez

O construtor passa a fazer **cinco** `register()` no dispatcher compartilhado (o de `UserCreatedEvent` + os quatro do histórico). O registro não é idempotente: uma segunda instância grava **duas** entradas por transição. A advertência já existe em `routes.ts` e em `core/infra/mcp/routes.ts`; esta entrega multiplica por cinco o custo de violá-la. Ordem entre os `register()` é irrelevante (nomes de evento distintos) — o que importa é que todos aconteçam no construtor, antes de qualquer dispatch.

### DA-8 — Nada de backfill: esta entrega tem que chegar em produção junto com o `billing`

O `billing` ainda não foi mergeado (PR #34 aberto) e não há assinatura em produção. Logo, não existe assinatura pré-existente sem entrada `started` — **desde que as duas coisas subam juntas**.

Se o `billing` for para produção antes desta branch, toda conta criada nesse intervalo fica permanentemente sem o fato "começou em X", e a correção vira um script sintetizando entradas a partir de `subscriptions.created_at` — um fato inventado dentro de um registro que existe para não ter fato inventado. Ver R-2.

---

## 4. Riscos e Questionamentos

### R-1 — 🔴 FK sem cascade quebra a exclusão de conta (LGPD)

Descrito na DA-6. É o risco de maior severidade do plano porque a falha aparece longe da causa: quem for excluir a conta recebe erro de constraint numa transação que não menciona billing. Revisão do Analista de Segurança na task 2 e teste explícito na task 11.

### R-2 — 🟠 Ordem de merge das duas branches

Esta branch está empilhada sobre `add-billing-subscriptions`. Se o `billing` for promovido sozinho para produção, ver DA-8. **Recomendação: mergear as duas juntas, ou esta imediatamente depois.** Decisão de release, não de código.

### R-3 — 🟠 Uma falha de escrita do histórico é engolida (só loga)

Consequência direta da DA-2. Se o `append` falhar (banco fora, constraint), a transição de negócio se completa e o histórico fica com um buraco silencioso — e como o registro é append-only, não há autocorreção na leitura seguinte. Mitigação: log em nível `error` com `subscription_id`, `type` e `occurred_at`, suficiente para reconstruir a entrada na mão.

A alternativa (deixar estourar) troca "lacuna rara na auditoria" por "cadastro de usuário e troca de plano falhando por causa da auditoria", que é estritamente pior. Um outbox transacional resolveria de verdade, mas não há precedente no projeto e seria a entrega inteira.

### R-4 — 🟡 Crescimento da tabela

Cresce por transição, não por tempo — uma conta típica gera 1 a 5 linhas na vida inteira. Sem risco real no horizonte visível. O índice `(user_id, occurred_at DESC)` cobre a única consulta existente. Registrado para não voltar como surpresa quando existir renovação automática mensal (aí sim vira ~12 linhas/ano/conta, e ainda é irrelevante).

### R-5 — 🟡 Uma nova exceção na lista fail-closed

Ver DA-4. Toda entrada nessa lista aumenta a superfície acessível a uma conta bloqueada. Aqui é dado da própria conta, sem efeito colateral, mas o Analista de Segurança precisa confirmar que o escopo por `user.id` não tem caminho alternativo (nenhum parâmetro de request influencia o filtro).

### R-6 — 🟡 O usuário pediu "histórico de pagamento"; isto é histórico de assinatura

Não há valor cobrado, recibo, meio de pagamento nem status de fatura — depende do gateway (adiado de propósito). O que se entrega é o ciclo de vida do vínculo. A rota e a UI não devem se chamar "pagamentos"; `plan_changed` com `resulting_status: active` num plano pago é o mais próximo de "cobrança" que existe, e ainda assim é **compromisso**, não **pagamento confirmado**. Quando `Invoice`/`Payment` existirem, viram um registro irmão — não um campo a mais aqui.

### R-7 — 🟡 Renovação vai precisar de um evento próprio quando o gateway existir

`SubscriptionPlanChangedEvent` só cobre transições em que o plano muda. Renovação de ciclo (mesmo plano, novo período) não é troca de plano e **não deve** ser publicada como tal — seria fato falso num registro auditável. Quando o webhook de pagamento existir, ele traz seu próprio evento (`SubscriptionRenewedEvent` ou equivalente, definido por quem conhecer o contrato do gateway) e o histórico ganha um quinto tipo de transição, `renewed`.

Registrado para que a ausência de cobertura de renovação seja lida como escopo, não como esquecimento — e para que ninguém "resolva" o problema publicando `plan_changed` numa renovação.

### R-8 — 🟢 O gancho de receita do `finance` deixa de existir como classe

`SubscriptionActivatedEvent` é removido (§2.4). O contrato que ele representava não se perde: está em `SubscriptionPlanChangedEvent.opens_paid_cycle`, derivado dentro do agregado. Registrado para o Revisor não tratar a remoção como regressão do que a entrega anterior prometeu, e para o `finance` futuro saber onde procurar.

### Q-1 — ✅ Resolvido: um único evento, com classificação derivada no agregado

**Decisão do usuário: unificar.** `SubscriptionActivatedEvent` é removido; `SubscriptionPlanChangedEvent` é o único evento de troca de plano e carrega `opens_paid_cycle`, derivado de `Subscription.has_paid_cycle` dentro do agregado. A análise completa — incluindo por que a proposta original de dois eventos criava risco de lançamento duplo de receita, e por que unificar **reduz** o acoplamento em vez de aumentá-lo — está na §2.4. Reflexo nas tasks 4 e 7.

### Q-2 — ✅ Resolvido: janela de tolerância de **7 dias**

**Decisão do usuário: 7 dias.** `BillingCyclePolicy.gracePeriodEnd(now)` devolve `now + 7 dias`, com o número como constante nomeada dentro da policy — não como argumento do `MarkSubscriptionPastDueUseCase`. Manter a regra na policy preserva o ponto único de aritmética de ciclo estabelecido pela DA-4 anterior; passá-la como input faria a regra de negócio nascer fora do domínio, no chamador futuro (webhook).

### Q-3 — ✅ Resolvido: sem rota de admin nesta entrega

**Decisão do usuário: não incluir**, conforme a recomendação da DA-4 — não existe superfície de backoffice que consuma isso hoje, e criá-la agora abre exposição de dado de outro usuário sem consumidor. O caminho fica preparado: quando houver demanda de suporte, é `historyOfSubscription(user_id)` no repositório + um controller `adminOnly: true`, sem tocar em nada do que esta entrega constrói.

---

## 5. Mapeamento de Mudanças

### Arquivos novos

**Domain — `src/billing/domain/`**

- `entity/subscription_history_entry.ts` — entidade imutável, schema Zod com as refinements da §2.3, factory `record()` + `reconstitute`, `readonly #data`, sem mutators
- `repository/subscription_history_repository.ts` — interface com **apenas** `append` e `historyOfUser`; tipo `SubscriptionHistoryEntryWithPlan`
- `event/subscription_started_event.ts` — construtor por objeto
- `event/subscription_plan_changed_event.ts` — construtor por objeto
- `event/subscription_payment_failed_event.ts` — construtor por objeto

**Application — `src/billing/application/`**

- `use_case/record_subscription_history_entry.ts` — escritor único; captura e loga, não propaga (DA-2)
- `use_case/get_subscription_history.ts` — leitura paginada escopada ao `user` do contexto
- `use_case/mark_subscription_past_due.ts` — chamador real de `markPastDue` (DA-5)
- `handler/record_history_on_subscription_started.ts`
- `handler/record_history_on_subscription_plan_changed.ts`
- `handler/record_history_on_subscription_payment_failed.ts`
- `handler/record_history_on_subscription_canceled.ts`

**Infra / Presentation — `src/billing/`**

- `infra/database/postgres_repository/subscription_history_postgres_repository.ts` — `append` = `db.insert` puro; `historyOfUser` com join em `plans`, ordenação determinística e `COUNT` para o total
- `presentation/controller/get_subscription_history.controller.ts` — espelha `get_subscription_status.controller.ts` (OpenAPI via `responseFromZod`/`errorResponse`) e o parsing de paginação de `find_property_financial_movements.controller.ts`

**Testes — `tests/billing/`**

- `subscription_history.test.ts`
- `subscription_history_route.test.ts`

### Arquivos modificados

- `src/core/infra/database/drizzle/schemas/billing_schemas.ts` — `subscriptionHistoryEntriesTable` (`ON DELETE cascade` nas duas FKs de identidade — DA-6), índice `(user_id, occurred_at DESC)`, relations com `plans`/`subscriptions`/`users`
- `drizzle/00XX_*.sql` — migration gerada
- `src/billing/domain/entity/subscription.ts` — getter derivado `has_paid_cycle` (§2.4); nenhuma mudança de estado ou transição
- `src/billing/domain/event/subscription_canceled_event.ts` — passa a carregar `current_period_end`
- `src/billing/domain/policy/billing_cycle_policy.ts` — `gracePeriodEnd(now)` = `now + 7 dias`, com o valor como constante nomeada na policy (Q-2)
- `src/billing/application/use_case/ensure_free_subscription.ts` — recebe `EventDispatcher`; publica `SubscriptionStartedEvent` **dentro do ramo que cria**, após o `save` (§2.4)
- `src/billing/application/use_case/subscribe_to_plan.ts` — publica `SubscriptionPlanChangedEvent` em toda troca; **remove** o dispatch de `SubscriptionActivatedEvent` e a condição `status === "active" && price_amount > 0` (a classificação passa a vir de `subscription.has_paid_cycle`)
- `src/billing/application/use_case/cancel_subscription.ts` — passa `current_period_end` ao evento
- `src/billing/infra/di/billing_di.ts` — repositório novo, os quatro handlers, os três use cases novos, o controller novo, e os quatro `register()` no construtor (DA-7)
- `src/core/infra/http/routes/routes.ts` — rota `GET /billing/subscription/history` em `billingControllers` com `allowWithoutPlatformAccess: true` (DA-4)
- `CLAUDE.md` — parágrafo sobre o histórico na seção do BC `billing`
- `.claude/personas/arquiteto.md` — `SubscriptionHistoryEntry` e os três eventos novos nas tabelas de agregados e eventos; **remover a linha de `SubscriptionActivatedEvent`** (linha 82), substituindo pela de `SubscriptionPlanChangedEvent`

### Arquivo removido

- `src/billing/domain/event/subscription_activated_event.ts` — absorvido por `SubscriptionPlanChangedEvent` + `opens_paid_cycle` (§2.4). Sem consumidor, sem teste, um único ponto de dispatch — a remoção é local e verificável por `grep`.

---

## 6. Tasks

1. **Entidade `SubscriptionHistoryEntry`** — schema Zod sobre `baseEntitySchema` com os 9 campos da §2.3 e as quatro refinements; factory `record()` + `reconstitute`; `readonly #data`; nenhum mutator.
   - Dependências: nenhuma

2. **Schema Drizzle e migration** — `subscriptionHistoryEntriesTable` com `ON DELETE cascade` em `subscription_id` e `user_id` (DA-6/R-1), `no action` em `plan_id`, índice `(user_id, occurred_at DESC)`, relations; gerar migration.
   - Dependências: nenhuma
   - Revisão obrigatória: Analista de Segurança (cascade × `purgeUserData`)

3. **Interface `SubscriptionHistoryRepository`** — só `append` e `historyOfUser`; tipo `SubscriptionHistoryEntryWithPlan`. Nenhum método de update/delete (§2.5).
   - Dependências: task 1

4. **Getter `has_paid_cycle` e eventos de domínio** — getter derivado em `Subscription` (§2.4); `SubscriptionStartedEvent`, `SubscriptionPlanChangedEvent`, `SubscriptionPaymentFailedEvent` (construtor por objeto, carregando os fatos da §2.4, incluindo `opens_paid_cycle`); extensão de `SubscriptionCanceledEvent` com `current_period_end`; **remoção de `subscription_activated_event.ts`**. Teste unitário do getter cobrindo as sete linhas da tabela de verificação da §2.4.
   - Dependências: nenhuma

5. **Repositório Postgres** — `append` como `INSERT` puro; `historyOfUser` com join em `plans`, ordenação `occurred_at DESC, created_at DESC, id DESC` e `COUNT` para o `total`.
   - Dependências: tasks 2, 3

6. **`RecordSubscriptionHistoryEntryUseCase` e os quatro handlers** — o escritor único que captura-e-loga (DA-2) e os quatro mapeadores evento → entrada, incluindo a dobra em `access_until`.
   - Dependências: tasks 3, 4

7. **Publicação dos eventos nos use cases existentes** — `EnsureFreeSubscription` (só no ramo que cria — §2.4), `SubscribeToPlan` (publica `SubscriptionPlanChangedEvent` em todo `changePlan` e **remove** o dispatch condicional de `SubscriptionActivatedEvent`), `CancelSubscription` (`current_period_end`). Confirmar com `grep` que não sobrou nenhuma referência a `SubscriptionActivated`/`subscription_activated` no código.
   - Dependências: task 4

8. **`MarkSubscriptionPastDueUseCase` e `BillingCyclePolicy.gracePeriodEnd`** — `gracePeriodEnd(now)` = `now + 7 dias` (Q-2), constante nomeada na policy; chamador real de `markPastDue`, publicando `SubscriptionPaymentFailedEvent` (DA-5). Sem rota.
   - Dependências: task 4

9. **`GetSubscriptionHistoryUseCase`, controller e rota** — leitura paginada escopada ao `user` do contexto (nenhum `user_id` vindo do request), OpenAPI, e registro em `routes.ts` com `allowWithoutPlatformAccess: true`.
   - Dependências: tasks 5, 6
   - Revisão obrigatória: Analista de Segurança (escopo + exceção fail-closed)

10. **Wiring no `BillingDi`** — repositório, quatro handlers registrados no construtor (DA-7), use cases e controller novos.
    - Dependências: tasks 5, 6, 7, 8, 9

11. **Testes** —
    (a) unitário da entidade: cada refinement da §2.3 rejeita a combinação inválida;
    (b) integração: cadastro de usuário gera **exatamente uma** entrada `started`, e uma segunda chamada a `EnsureFreeSubscription` **não** gera outra (§2.4 — o teste central do plano);
    (c) integração: `SubscribeToPlan` free → pro **com trial** gera `plan_changed` com `resulting_status: trialing` e `access_until = trial_ends_at` (o caminho que hoje não geraria evento nenhum);
    (d) integração: downgrade pro → free gera `plan_changed` com `opens_paid_cycle: false`, e free → pro sem trial gera `opens_paid_cycle: true` (§2.4 — garante que o contrato herdado do `SubscriptionActivatedEvent` sobreviveu à unificação);
    (e) integração: `CancelSubscription` gera `canceled` com `access_until = current_period_end`;
    (f) integração: `MarkSubscriptionPastDue` gera `payment_failed` com `reason` e `access_until`;
    (g) rota: devolve só as entradas do chamador, em ordem decrescente, paginada; conta sem acesso à plataforma **recebe 200** (rota isenta);
    (h) **`purgeUserData` funciona com histórico presente** (R-1);
    (i) falha do `append` não derruba a operação de negócio (DA-2/R-3).
    - Dependências: task 10

12. **Documentação** — `CLAUDE.md` e `.claude/personas/arquiteto.md`.
    - Dependências: task 11

> **Paralelismo**: tasks 1, 2 e 4 são independentes e rodam juntas. Depois, `3 → 5` e `4 → 6/7/8` correm em paralelo. A task 10 é o ponto de junção; 11 e 12 são sequenciais no fim.
>
> **Nenhuma decisão pendente** — Q-1, Q-2 e Q-3 estão fechadas. O único item que não é decisão de código é a **R-2**: esta branch precisa chegar em produção junto com `add-billing-subscriptions`, ou imediatamente depois.

---

## 7. Diretrizes para o Desenvolvedor

1. **`SubscriptionStartedEvent` só no ramo que cria.** Publicar depois do `save`, dentro do `if` que criou — nunca antes do `return` de idempotência. Se o teste 11(b) não existir, essa regressão passa despercebida.
2. **O handler nunca relê a `Subscription`.** Todo dado da entrada vem do evento. Reler grava o estado do momento da leitura num registro que existe para guardar o estado do momento do fato.
3. **`append` é `db.insert`, nada mais.** Não copiar o padrão select-então-update-ou-insert de `SubscriptionPostgresRepository.save`. Não adicionar `save`, `update` nem `delete` à interface — a imutabilidade é a ausência desses métodos (§2.5).
4. **`ON DELETE cascade` nas duas FKs de identidade.** Sem isso, excluir a conta quebra (R-1). Não é preferência de estilo.
5. **Ordenação com desempate.** `occurred_at DESC, created_at DESC, id DESC`. Ordenação parcial + paginação = linha repetida ou sumida.
6. **`BillingDi` continua instanciado uma única vez.** Agora com cinco registros de handler; duas instâncias duplicam toda entrada do histórico.
7. **O use case de escrita não propaga exceção** (DA-2) — mas loga em `error` com `subscription_id`, `type` e `occurred_at`. Um `catch` silencioso sem log seria pior que o problema que resolve.
8. **O `Input` do `GetSubscriptionHistoryUseCase` não tem `user_id`.** Se aparecer, o escopo pode ser burlado por request.
9. **`opens_paid_cycle` é derivado no agregado, nunca recomputado fora dele.** Se aparecer um `plan.price_amount > 0` ou um `!plan.is_perpetual` em handler, use case de histórico ou consumidor futuro, a regra vazou do lugar único onde ela passou a viver (§2.4).
10. **Não recriar `SubscriptionActivatedEvent`.** Ele foi absorvido, não esquecido (R-8). Renovação de ciclo, quando existir, é evento próprio — nunca um `plan_changed` (R-7).
11. **Comentários de no máximo uma linha**, conforme preferência registrada do usuário.
12. **Commit por task**, Conventional Commits em inglês.
