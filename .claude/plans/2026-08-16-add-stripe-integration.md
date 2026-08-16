# Integração com Stripe — cobrar de verdade pelo plano Pro

> Terceira branch da pilha: `main` ← `add-billing-subscriptions` (PR #34) ← `add-subscription-history` (PR #35, mergeada na branch anterior) ← **`add-stripe-integration`**. A base desta branch **não** é `main`.

## Objective

Fechar o único buraco que impede o `billing` de gerar receita: hoje o entitlement pago pode ser concedido, mas **nada nunca é cobrado**. Esta entrega liga o BC a um gateway real (Stripe) por três caminhos — **Checkout hospedado** para a primeira assinatura, **Customer Portal hospedado** para tudo depois dela, e **webhook** para que o estado local siga o gateway — sem que `domain` ou `application` conheçam uma única linha de vocabulário Stripe.

O gateway passa a ser a **fonte de verdade sobre dinheiro e período**; o `billing` continua sendo a fonte de verdade sobre **entitlement**. O webhook é o único ponto onde os dois se encontram.

---

## Personas

- **Arquiteto** (`.claude/personas/arquiteto.md`) — autor deste plano
- **Desenvolvedor** (`.claude/personas/desenvolvedor.md`) — execução das tasks
- **Analista de Segurança** (`.claude/personas/analista_seguranca.md`) — revisão **obrigatória** das tasks 3, 7, 8, 9, 10 e 11. Esta é a entrega mais sensível do projeto até aqui: um endpoint público que, se aceitar um payload forjado, entrega plano pago de graça a qualquer um; e duas rotas novas na lista de exceções do gate fail-closed da DA-9.

---

## 1. Análise de Negócio

O `billing` entregou catálogo, assinatura, entitlement, gate fail-closed e histórico auditável. Falta o óbvio: **cobrar**. Hoje o plano `pro` custa R$ 49,90 no papel e R$ 0,00 na prática.

O que cada ator ganha:

- **Proprietário**: um botão "Assinar o Pro" que leva a uma página de pagamento do Stripe, e depois um botão "Gerenciar assinatura" que leva ao portal do Stripe, onde ele troca de plano, atualiza o cartão, baixa recibo e cancela — tudo sem que a Sogio implemente nenhuma dessas telas nem toque em dado de cartão.
- **Negócio**: receita recorrente de verdade, com dunning (retentativa de cobrança), recibos e faturas fornecidos pelo Stripe.
- **Sogio como engenharia**: **zero escopo PCI**. Nenhum número de cartão passa pelo servidor, pelo log ou pelo banco. Essa é a razão pela qual Checkout + Portal hospedados foram escolhidos em vez de Stripe Elements.

Duas fronteiras de responsabilidade que precisam ficar explícitas e que governam todo o desenho abaixo:

| Pergunta                                              | Quem responde |
| ----------------------------------------------------- | ------------- |
| Quanto custa, quando cobra, cobrou?, o cartão passou? | **Stripe**    |
| Este usuário pode usar a plataforma? Quantos imóveis? | **`billing`** |

O webhook existe exclusivamente para traduzir a primeira coluna na segunda.

---

## 2. Análise de Domínio

### 2.1 Linguagem Ubíqua (termos novos)

| Termo                     | Significado no domínio                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Gateway de pagamento**  | O sistema externo que cobra. O domínio nunca diz "Stripe"; diz "gateway". Só `billing/infra/gateway/` conhece o nome do fornecedor.                                                                          |
| **Checkout**              | A sessão hospedada em que o proprietário informa o meio de pagamento e assina pela primeira vez. Produz uma URL; a Sogio só redireciona.                                                                     |
| **Portal de cobrança**    | A sessão hospedada em que o proprietário gerencia a assinatura já existente (upgrade, downgrade, cartão, cancelamento, recibos). Também é só uma URL.                                                        |
| **Evento do gateway**     | Um fato que o gateway afirma sobre a assinatura. Chega assinado, pode chegar repetido e pode chegar fora de ordem.                                                                                           |
| **Referência externa**    | As strings opacas que já existem (`external_reference`, `external_customer_reference`, `external_price_reference`). Deixam de ser decorativas e passam a ser **a chave de identidade** entre os dois mundos. |
| **Renovação** (`renewed`) | Um novo ciclo pago abriu **sem troca de plano**. É o quinto tipo de transição do Histórico da Assinatura, previsto na R-7 da entrega anterior.                                                               |

### 2.2 Nenhum agregado novo de negócio

`Plan`, `Subscription` e `SubscriptionHistoryEntry` continuam sendo os únicos agregados. `Invoice` e `Payment` **continuam fora** — o Stripe já é o registro canônico de fatura e recibo, e o portal já os expõe ao usuário. Duplicá-los aqui criaria uma segunda verdade sobre dinheiro que ninguém pediu.

Entra **uma** estrutura nova, e ela não é de negócio: o **registro de eventos do gateway já processados**, uma tabela de idempotência (§3, DA-7). Não é agregado, não tem comportamento, não aparece em nenhuma resposta de API.

### 2.3 O gateway é a fonte de verdade do período — o domínio precisa aceitar isso

Hoje `Subscription.activate()` calcula `current_period_end` sozinho, via `BillingCyclePolicy.nextPeriodEnd(now, interval)`. Depois do Stripe isso vira um **bug de cobrança silencioso**: o Stripe tem âncora de faturamento, proração, retentativa e fim de trial próprios, então o período dele e o nosso divergem em horas ou dias. E como o `SubscriptionAccessPolicy` decide acesso lendo `current_period_end`, a divergência aparece como _"paguei e fui bloqueado"_ ou _"parei de pagar e continuo dentro"_.

**Decisão: as transições que o webhook dirige recebem a data do gateway explicitamente; `BillingCyclePolicy` continua existindo para o caminho interno.**

- `activate({ ..., period_end })` — quando `period_end` vem preenchido, é usado literalmente e a policy não é consultada.
- `changePlan({ ..., period_end })` — idem, repassando para `activate`.
- `startTrial(trial_days, now)` ganha a forma alternativa `startTrialUntil(trial_ends_at)` — o fim do trial também é do gateway.

Rejeitado: **manter a aritmética local e ignorar as datas do Stripe**. É a alternativa que parece mais limpa (o domínio não recebe datas de fora) e é a pior: produz uma divergência que ninguém observa até o cliente reclamar de bloqueio depois de pagar.

Rejeitado: **remover `BillingCyclePolicy`**. Ela continua sendo o único lugar de aritmética de ciclo do caminho **interno** (`GrantPlanUseCase`, plano Free, testes) e o dono de `gracePeriodEnd`.

### 2.4 As transições precisam ficar idempotentes — senão o webhook entra em loop

Este é o achado mais importante da leitura do código atual. As transições foram escritas para um chamador humano, que erra uma vez e recebe um 409. O chamador agora é uma máquina que **reentrega o mesmo fato várias vezes** e trata qualquer não-2xx como "falhei, tento de novo" — até desativar o endpoint.

| Transição hoje                                   | Cenário real de webhook                                                  | Consequência sem mudança                     |
| ------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------- |
| `markPastDue` exige `status === "active"`        | falha de cobrança durante `trialing`, ou 2ª retentativa já em `past_due` | `ConflictError` → 409 → retentativa infinita |
| `cancel` recusa `status === "canceled"`          | reentrega de `customer.subscription.deleted`                             | `ConflictError` → 409 → retentativa infinita |
| `startTrial` recusa se `trial_ends_at` já existe | reentrega de um evento de trial                                          | `ConflictError` → 409 → retentativa infinita |
| não há como gravar `external_*`                  | qualquer evento                                                          | impossível ligar os dois mundos              |

Regras novas (todas com justificativa de negócio, nenhuma é afrouxamento gratuito):

1. **`markPastDue` aceita `active`, `trialing` e `past_due`; recusa só `canceled`.** Quando já está `past_due`, **mantém o `grace_period_ends_at` original** — a tolerância é ancorada na _primeira_ falha. Sem essa regra, cada retentativa do Stripe empurraria o prazo +7 dias e um inadimplente ficaria meses com acesso.
2. **`cancel` é idempotente**: já cancelada ⇒ não-op, sem exceção e **sem publicar um segundo evento** (o histórico não pode registrar dois cancelamentos do mesmo fato).
3. **`linkCustomer(reference)`** — grava `external_customer_reference`. **Write-once**: trocar um valor já preenchido por outro diferente é `ConflictError`. Apontar a assinatura para outro cliente do gateway é mandar a fatura para outra pessoa — é exatamente o erro que não pode ser silencioso.
4. **`external_reference` acompanha a ativação** — é passado dentro de `activate`/`changePlan`, nunca por um setter solto. Assinatura do gateway e período do gateway são o mesmo fato e devem se mover juntos. Diferente do cliente, ele **pode** mudar: cancelar no portal e reassinar cria uma assinatura nova no Stripe.
5. **`external_event_at`** (campo novo, anulável) — o instante, no relógio do gateway, do último evento já aplicado. Uma transição dirigida por um evento **mais antigo** que esse valor é descartada. É a defesa contra a reentrega tardia que reaplica um fato vencido (ver DA-8).

> Nada disso enfraquece as invariantes originais. A proibição de reentrar em `trialing` continua valendo (§2.5), o Free continua sem período, e cancelar plano perpétuo continua proibido.

### 2.5 Trial pago via Stripe — dentro do escopo, e por quê

O plano `pro` já anuncia `trial_days: 14` no seed. Duas saídas coerentes existiam:

- **(A)** zerar o trial no seed e cobrar na hora;
- **(B)** delegar o trial ao Stripe (`trial_period_days` na sessão de checkout) e espelhar `trialing` + `trial_end` localmente.

**Decisão: (B).** Um trial de 14 dias é a alavanca de conversão de um produto de R$ 49,90/mês, e (A) obriga alguém a lembrar de reverter o seed depois. O custo de (B) é uma forma alternativa de `startTrial` que aceita a data pronta — exatamente o mesmo padrão da §2.3, então não é uma segunda mecânica, é a mesma.

Duas regras não negociáveis que vêm junto:

- A sessão de checkout só pede `trial_period_days` quando `subscription.trial_ends_at === null`. Sem isso, **cancelar e reassinar vira trial infinito de graça** — a invariante anti-farming da entrega original existia justamente para isso e seria contornada por fora, pelo Stripe.
- Se mesmo assim o gateway reportar `trialing` para quem já usou trial, o sync **loga em `error` e trata como `active`** com `period_end = trial_end`. Honramos o período que o gateway afirma; recusamos rotular de trial o que a invariante diz que não pode ser.

### 2.6 Eventos de Domínio

Nenhum evento existente muda de significado. Entra **um**:

| Evento                     | Novo | Disparado por                                                                        | Consumido por                        | Tipo de entrada |
| -------------------------- | ---- | ------------------------------------------------------------------------------------ | ------------------------------------ | --------------- |
| `SubscriptionRenewedEvent` | ✅   | `SyncSubscriptionFromGatewayUseCase`, quando o período avança **sem** troca de plano | `RecordHistoryOnSubscriptionRenewed` | `renewed`       |

É literalmente o evento que a **R-7 da entrega anterior** previu ("renovação de ciclo não é troca de plano e **não deve** ser publicada como tal — quando o webhook existir, ele traz seu próprio evento"). O webhook existe agora; o evento entra agora. `SubscriptionHistoryEntry` ganha o tipo `renewed` e a refinement `renewed ⇒ resulting_status = active`.

Os outros três caminhos reusam o que já existe: `SubscriptionPlanChangedEvent` (troca de plano vinda do portal), `SubscriptionPaymentFailedEvent` (falha de cobrança), `SubscriptionCanceledEvent` (cancelamento no portal).

**Regra anti-ruído (importante):** o Stripe dispara `customer.subscription.updated` por motivos triviais (metadado, meio de pagamento padrão, retentativa agendada). O sync só publica evento quando **`plan_id`, `status` ou `current_period_end` efetivamente mudaram**. Sem essa regra o Histórico da Assinatura — cujo valor inteiro é ser legível — vira log de máquina.

---

## 3. Decisões Arquiteturais

### DA-1 — A porta `PaymentGateway` finalmente é criada, em `application`, e são **duas**

A DA-6 da entrega original recusou criar a porta _"sem implementação e sem chamador"_. As duas condições caíram. Criam-se **duas** portas, porque as direções são opostas:

- **`billing/application/gateway/payment_gateway.ts`** — saída. `createCustomer`, `createCheckoutSession`, `createBillingPortalSession`. Fala em referências opacas e URLs; nunca em objetos do fornecedor.
- **`billing/application/gateway/gateway_webhook_verifier.ts`** — entrada. Recebe `{ raw_payload, signature }` e devolve um **`GatewayBillingEvent`** — união discriminada **no nosso vocabulário** — ou lança `UnauthorizedError`.

O verifier é o que mantém a promessa da DA-6 intacta: o `switch` do orquestrador é sobre `checkout_completed | subscription_state_changed | subscription_ended | payment_failed`, **não** sobre strings do Stripe. Trocar de fornecedor é escrever um segundo adaptador.

**Por que em `application/` e não em `domain/service/`** (que foi o que a DA-6 sugeriu de passagem): "sessão de checkout" e "URL do portal" não são linguagem de domínio — nenhuma invariante de `Subscription` as menciona, nenhuma entidade as chama. Colocá-las em `domain/` importaria vocabulário de integração para dentro da camada que a DA-6 se comprometeu a manter limpa. O precedente do repositório sustenta os dois lados (`EmailService` em `core/application/email/`, `DeviceManagement` em `booking/domain/service/`); a distinção usada aqui é: **o domínio chama? então é porta de domínio. Só o use case chama? então é porta de application.** Aqui só use cases chamam.

O adaptador vive em **`billing/infra/gateway/`** — exatamente onde a DA-6 disse que viveria.

### DA-2 — A verificação de assinatura acontece **dentro** do use case, não no controller

`ProcessGatewayWebhookUseCase.execute({ raw_payload, signature })` chama o verifier como **primeira instrução**. O controller é uma casca de ~10 linhas: lê `request.rawBody`, lê `request.headers["stripe-signature"]`, delega.

Por que não verificar no controller (que seria o instinto): porque então existiria um caminho — qualquer chamador futuro, um teste, uma tool — capaz de invocar o orquestrador com um evento **não verificado**. Com a verificação dentro, **não existe entrada não autenticada para a máquina de estados**. A fronteira de confiança e a fronteira do use case são a mesma linha.

Regras que o Analista de Segurança deve verificar linha a linha:

1. **`STRIPE_WEBHOOK_SECRET` ausente ⇒ a rota falha**, sempre. Nunca existe um ramo `if (NODE_ENV === "development") skipVerification`. Esse ramo é a forma canônica de vazar plano pago para produção.
2. **Verifica-se o corpo cru** (`request.rawBody`), nunca um objeto reserializado. `JSON.stringify(body)` reordena/normaliza e quebra a assinatura — e quem quebra a assinatura é tentado a desligá-la.
3. **Tolerância de timestamp mantida no default do SDK** (5 min). É o que impede replay de um payload legítimo capturado.
4. **`rawBody === null` ou header ausente ⇒ 401**, sem tocar no banco.
5. **Nenhum campo do payload identifica o usuário por si só.** O usuário é resolvido **no nosso banco**, por `external_customer_reference` / `external_reference`; `client_reference_id` (que fomos **nós** que gravamos na criação da sessão) é aceito apenas no evento de checkout, como rede de segurança.

### DA-3 — Códigos de resposta do webhook são contrato operacional, não estética

O Stripe reentrega qualquer não-2xx com backoff por dias e, com falha persistente, **desativa o endpoint**. Portanto:

| Situação                                       | Resposta              | Por quê                                              |
| ---------------------------------------------- | --------------------- | ---------------------------------------------------- |
| Assinatura inválida / ausente                  | **401**               | Não é para reentregar; é para investigar             |
| Evento já processado (idempotência)            | **200**               | Reentrega normal do Stripe; não é erro               |
| Tipo de evento que não tratamos                | **200**               | Ignorar barulho sem provocar retentativa             |
| Assinatura local inexistente para a referência | **200** + log `error` | Reentregar não conserta; alguém precisa olhar        |
| Falha transitória (banco fora)                 | **500**               | É exatamente quando queremos a retentativa do Stripe |
| Estado já é o estado alvo                      | **200**               | Consequência direta da §2.4 — nunca 409              |

**Nenhum `ConflictError` pode chegar ao adaptador vindo do webhook.** Se chegar, vira 409 e o Stripe entra em loop. Essa é a razão de existir a §2.4.

### DA-4 — Checkout: `POST /billing/checkout-session`, e a porta se fecha depois da primeira assinatura

`CreateCheckoutSessionUseCase({ plan_code }, user)`:

1. `planOfCode` — inexistente ou `deleted_at` ⇒ `ResourceNotFoundError` (mesmo tratamento do `GrantPlanUseCase`).
2. `plan.is_perpetual` ⇒ `ValidationError`. Não existe checkout do plano Free.
3. `plan.external_price_reference` nulo ⇒ **`IllegalStateError` (500)**. É erro de configuração nossa, não do cliente — 404/422 mentiria sobre a causa.
4. Assinatura do usuário inexistente ⇒ `ResourceNotFoundError`.
5. **Já existe assinatura viva no gateway** (`external_reference != null` **e** `status ∈ {trialing, active, past_due}`) ⇒ `ConflictError` apontando para o portal. Sem essa trava, um segundo checkout cria uma **segunda assinatura no Stripe e cobra duas vezes** — o pior bug possível desta feature. Com `status = canceled` a porta reabre: a assinatura no gateway não existe mais.
6. Cliente no gateway: se `external_customer_reference` é nulo, cria e grava **atomicamente** (DA-6).
7. Cria a sessão: `mode: subscription`, `line_items: [{ price: plan.external_price_reference, quantity: 1 }]`, `customer`, `client_reference_id: user.id`, e `trial_period_days` **somente** se `subscription.trial_ends_at === null` (§2.5).
8. Devolve `{ url }`.

**`success_url`/`cancel_url` são derivadas de `frontBaseUrl` e de constantes no código — nunca de input do request.** Aceitar URL de retorno do cliente é open redirect assinado pela nossa credencial. Paths propostos: `${frontBaseUrl}/billing/checkout/success` e `${frontBaseUrl}/billing/checkout/canceled`.

Rota **`authenticated: true`, `allowWithoutPlatformAccess: true`** — ver DA-5. Com `rateLimitPolicy` (`peer-ip`), porque cada chamada cria objetos no Stripe.

### DA-5 — As duas rotas novas de pagamento **têm** que ser isentas do gate fail-closed

`allowWithoutPlatformAccess: true` em `/billing/checkout-session` e `/billing/portal-session`.

O argumento é curto e decisivo: **quem está bloqueado é exatamente quem precisa pagar.** Um usuário com `period_expired` ou `payment_failed` depois da tolerância recebe 403 em tudo. Se a rota de pagamento também estiver atrás do gate, a única saída do bloqueio fica atrás do bloqueio — o cliente quer pagar e o produto não deixa. É a mesma classe de armadilha que a DA-9 da entrega original evitou ao isentar `GET /billing/subscription`.

A R-5 daquela entrega exige justificativa no PR para toda adição a essa lista; esta é a justificativa. As duas rotas **não expõem nada do produto**: devolvem uma URL do Stripe escopada ao cliente do próprio chamador.

### DA-6 — Vínculo do cliente do gateway é gravado **atomicamente**, não em read-modify-write

Dois cliques em "Assinar" produzem duas execuções concorrentes que leem `external_customer_reference = null` e criam **dois** clientes no Stripe — e a segunda gravação sobrescreve a primeira, deixando um cliente órfão com meio de pagamento anexado.

Solução no mesmo espírito da correção de TOCTOU da cota de propriedades já feita nesta pilha: `SubscriptionRepository.linkCustomerReferenceIfAbsent(subscription_id, reference): Promise<string>` — um `UPDATE ... WHERE external_customer_reference IS NULL`, devolvendo **a referência efetiva** (a que estava lá, se já estava). O use case usa o retorno, não o que ele mesmo criou. Cliente órfão no Stripe é inofensivo; assinatura apontando para o cliente errado não é.

### DA-7 — Idempotência: `claim` antes de processar, `release` se falhar

Tabela `processed_gateway_events` (`external_event_id` **único**, `type`, `occurred_at`). Interface `ProcessedGatewayEventRepository`:

```
claim(event_id, type, occurred_at): Promise<boolean>   // INSERT ... ON CONFLICT DO NOTHING
release(event_id): Promise<void>                        // só no caminho de falha
```

- `claim` devolvendo `false` ⇒ já processado ⇒ **200 imediato**, sem tocar na assinatura. Como é `INSERT ... ON CONFLICT`, duas entregas concorrentes do mesmo evento não têm janela de corrida — diferente de um `SELECT` seguido de `INSERT`.
- Se o processamento **falhar**, o claim é liberado antes de propagar, para que a retentativa do Stripe tenha efeito. Risco residual (crash entre claim e release deixa um evento nunca processado) documentado em R-6; é estritamente menor que o risco oposto (processar duas vezes e duplicar entrada de histórico).

A tabela **não tem `user_id`** — logo não entra na questão de `ON DELETE cascade`/LGPD que a DA-6 da entrega anterior tratou. Guarda apenas ids de evento do gateway.

### DA-8 — Ordem de eventos: o gateway não garante, então o domínio se defende

O Stripe não garante ordem de entrega. O caso concreto e provável: a retentativa de um `invoice.payment_failed` das 03h chega às 05h, **depois** de um `customer.subscription.updated` das 04h que recuperou a assinatura — e um cliente adimplente é marcado `past_due`.

Defesa mínima e barata: a coluna `external_event_at` (§2.4, item 5). Toda transição dirigida por evento carrega o `created` do evento; se for **anterior** ao `external_event_at` gravado, o evento é descartado com log `info` e responde 200. Uma coluna anulável e três linhas no use case.

Alternativa rejeitada: buscar o estado atual no Stripe a cada evento (`subscriptions.retrieve`) para desempatar. Resolve mais casos, mas transforma cada webhook em uma chamada de rede síncrona no caminho crítico, com a latência e o modo de falha do Stripe dentro do nosso 200. Fica registrado como evolução se a ordem virar problema real.

### DA-9 — Eventos do Stripe tratados: **cinco**, mapeados para **quatro** eventos normalizados

| Evento do Stripe                                                  | Evento normalizado           | Por que está no escopo                                                                |
| ----------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `checkout.session.completed`                                      | `checkout_completed`         | Único que carrega `client_reference_id` — rede de segurança do vínculo de identidade  |
| `customer.subscription.created` + `customer.subscription.updated` | `subscription_state_changed` | O cavalo de batalha: ativação, renovação, upgrade/downgrade pelo portal, recuperação  |
| `customer.subscription.deleted`                                   | `subscription_ended`         | Cancelamento efetivado                                                                |
| `invoice.payment_failed`                                          | `payment_failed`             | Único que carrega o **código de recusa**, que o histórico já sabe guardar em `reason` |

Qualquer outro tipo: **200 e ignorado**, com log `debug`.

**Decisão explícita: `past_due`/`unpaid` vindos de `customer.subscription.updated` são ignorados.** A falha de cobrança é tratada **só** por `invoice.payment_failed`. Os dois descrevem o mesmo fato; consumir os dois grava **duas** entradas `payment_failed` no histórico para uma única falha. Escolhe-se o que traz mais informação.

Mapeamento de `subscription_state_changed` (status do Stripe → transição nossa):

| Status no gateway                | Transição                                             | Entrada no histórico           |
| -------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `active`, preço = plano atual    | `activate({ period_end, external_reference })`        | `renewed` (se o período mudou) |
| `active`, preço = outro plano    | `changePlan({ ..., period_end, external_reference })` | `plan_changed`                 |
| `trialing`, nunca usou trial     | `startTrialUntil(trial_end)`                          | `plan_changed`                 |
| `trialing`, já usou trial        | trata como `active` + log `error` (§2.5)              | `renewed` / `plan_changed`     |
| `past_due`, `unpaid`             | **ignorado** (vem por `invoice.payment_failed`)       | —                              |
| `canceled`, `incomplete_expired` | mesmo caminho de `subscription_ended`                 | `canceled`                     |
| `incomplete`, `paused`           | ignorado, log `debug`                                 | —                              |

Resolução de plano: `PlanRepository.planOfExternalPriceReference(price_id)`. **Se nenhum plano casar, o plano local não muda** — só o período é sincronizado, com log `error`. Um preço criado no dashboard e não mapeado não pode derrubar o entitlement de um cliente pagante.

### DA-10 — `SubscribeToPlan` vira `GrantPlan`; `CancelSubscription` passa a receber `user_id`

O achado de segurança da entrega original ("`SubscribeToPlan` concede entitlement pago sem nenhuma confirmação de pagamento") foi sobre **exposição**, não sobre existência. A conclusão continua a mesma — e agora fica pior por um motivo novo: depois do checkout, o nome `SubscribeToPlanUseCase` **é uma armadilha**. O "assinar um plano" do usuário passa a ser `CreateCheckoutSessionUseCase`; quem vier depois e ler `SubscribeToPlanUseCase` ao lado dele tem todo motivo para achar que aquilo é a rota que falta plugar.

**Decisão:**

- **Renomear `SubscribeToPlanUseCase` → `GrantPlanUseCase`.** Mecanismo interno/administrativo: concede plano **sem cobrança**. Sem rota, sem tool MCP, hoje e sempre — a menos que ganhe `adminOnly: true` numa entrega futura de backoffice (contas cortesia, remediação de suporte, parcerias). "Grant" diz o que é: uma concessão, não uma compra.
- **`CancelSubscriptionUseCase` muda `Input` para `{ user_id }`** e deixa de receber `User` — exatamente o formato que `MarkSubscriptionPastDueUseCase` já adotou. Assim o caminho `subscription_ended` do webhook **reusa o use case existente**, em vez de reimplementar a transição. Continua sem rota: cancelar é pelo portal.
- `MarkSubscriptionPastDueUseCase` é reusado como está pelo caminho `payment_failed` (só ganha a passagem de `occurred_at` do gateway, para a DA-8).

Nenhum use case é removido. O que muda é o nome, o `Input` e a documentação de que **nenhum dos dois é caminho de produção para o usuário final**.

### DA-11 — Sincronização de catálogo é manual, mas o `price_id` não é copiado à mão para o banco

Decisão fechada com o usuário: o catálogo é criado no dashboard do Stripe. Só que o `seedPlans` usa `onConflictDoNothing`, então rodá-lo de novo **não** preencheria `external_price_reference` do plano `pro`, e sem esse campo o checkout devolve 500 (DA-4, item 3).

Solução mínima: variável de ambiente **opcional** `STRIPE_PRO_PRICE_ID`. Quando presente, o seed faz `onConflictDoUpdate` **apenas dessa coluna** para o plano `pro`. Ausente, o comportamento é o de hoje. Zero ritual de SQL manual, idempotente, e o dado continua sendo do banco — a env var é só o canal de entrega.

### DA-12 — Nenhuma tool MCP, nenhuma rota de admin

Coerente com a DA-4 da entrega de histórico. Pagamento não é caso de uso de agente, e cada tool amplia a superfície de acesso delegado. Uma superfície de backoffice de billing (ver plano de assinatura de terceiro, conceder cortesia) é follow-up natural, com consumidor de verdade, e não entra aqui.

---

## 4. Escopo — o que fica de fora, deliberadamente

| Fora do escopo                                         | Por quê                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `Invoice` / `Payment` como entidades                   | O Stripe já é o registro canônico e o portal já os expõe. Duplicar cria segunda verdade sobre dinheiro. |
| Sincronização automática de catálogo (`Plan` → Stripe) | Decidido com o usuário (manual)                                                                         |
| Proração de upgrade/downgrade                          | É do portal, por decisão de produto                                                                     |
| Cupons, promoções, impostos (Stripe Tax)               | Configuráveis no dashboard depois, sem tocar em código                                                  |
| Emails de dunning e `trial_will_end`                   | O Stripe envia; duplicar exigiria composer novo e decisão de conteúdo                                   |
| Rotina de expurgo de `processed_gateway_events`        | A tabela cresce por evento; volume irrelevante no horizonte visível (R-7)                               |
| Multi-moeda                                            | `Plan` não tem moeda — problema herdado (R-4 da entrega original), não criado aqui                      |
| Backoffice de billing / tools MCP                      | DA-12                                                                                                   |

**Dentro do escopo, e isso é o ponto:** renovação (`renewed`). Não é refinamento futuro. Sem sincronizar o período nas renovações, **todo cliente Pro é bloqueado ~30 dias depois de pagar** — exatamente o modo de falha que a DA-3 da entrega original evitou para o Free. Entregar checkout sem renovação é entregar um produto pago quebrado no segundo mês.

---

## 5. Riscos e Questionamentos

### R-1 — 🔴 Um webhook sem verificação de assinatura é plano Pro grátis para qualquer um

O endpoint é público (`authenticated: false`) e o efeito dele é conceder entitlement pago. Um `curl` com o JSON certo bastaria. Mitigações na DA-2, todas obrigatórias, e a task 11 tem dois testes que **precisam** existir: assinatura forjada ⇒ 401 e nenhuma escrita; header ausente ⇒ 401 e nenhuma escrita.

Modo de falha mais provável na prática: alguém adiciona um bypass "só em dev" para conseguir testar com `curl` e ele vaza para produção. Está proibido por escrito na DA-2 e é item de checklist do Analista de Segurança.

### R-2 — 🔴 A paywall pode trancar o cliente do lado de fora da própria caixa registradora

Se `/billing/checkout-session` ou `/billing/portal-session` ficarem gated (DA-5), um usuário com período expirado não consegue pagar. O sintoma é indistinguível de "o produto não funciona" e o efeito é perda direta de receita. Teste explícito exigido na task 15: conta **bloqueada** recebe **200** nas duas rotas.

### R-3 — 🟠 Sem a §2.4, o webhook entra em loop e o Stripe desativa o endpoint

Retentativa em cima de `ConflictError` é permanente por construção — o estado que causa o 409 não muda sozinho. Depois de dias de falha o Stripe desativa o endpoint e **para de entregar tudo**, inclusive os eventos que funcionavam. O sintoma aparece longe da causa (assinaturas param de renovar). Por isso a §2.4 é task própria e com revisão de segurança.

### R-4 — 🟠 Duplo checkout = dupla cobrança

Coberto pela trava do item 5 da DA-4. Registrado à parte porque é o risco de maior custo direto ao cliente e o mais fácil de perder numa refatoração futura ("por que essa checagem está aqui?"). Teste obrigatório.

### R-5 — 🟠 Trial farming por fora, via Stripe

Cancelar e reassinar pediria `trial_period_days` de novo se a checagem `trial_ends_at === null` (§2.5) sumir. A invariante do domínio continua lá, mas ela **não protege sozinha**: o Stripe concederia o trial e o nosso sync tentaria `startTrial` num agregado que recusa — resultado é divergência (Stripe não cobra, nós logamos erro). O ponto de defesa efetivo é a criação da sessão.

### R-6 — 🟠 `claim` sem `release` por crash deixa evento nunca processado

Consequência da DA-7. Se o processo morrer entre o `claim` e o `release`, a retentativa do Stripe é ignorada como duplicata e o fato se perde silenciosamente. Mitigação: log `error` no caminho de falha com o `external_event_id`, suficiente para reprocessar pelo dashboard do Stripe ("Resend event") depois de apagar a linha. A alternativa (claim depois de processar) troca essa perda rara por dupla escrita de histórico em concorrência, que é pior.

### R-7 — 🟡 `processed_gateway_events` cresce sem expurgo

Uma linha por evento entregue. Para a base atual é irrelevante; com milhares de assinantes, dezenas de milhares de linhas por ano. Índice único já cobre a única consulta. Registrado para não virar surpresa.

### R-8 — 🟡 `price_amount` local e preço do Stripe podem divergir

Catálogo manual (DA-11). Se o operador mudar o preço no dashboard e não no banco, a Sogio **exibe** um valor e o Stripe **cobra** outro. O valor cobrado é sempre o do Stripe. Sem defesa automática nesta entrega; o `Plan` local passa a ser, na prática, material de vitrine. Mesma observação vale para moeda (R-4 da entrega original).

### R-9 — 🟡 `.env.test` precisa das duas variáveis novas antes de qualquer teste rodar

`environments.ts` valida no import: com as refinements "obrigatória fora de `development`", `NODE_ENV=test` **exige** `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET`. Faltando qualquer uma, **a suíte inteira nem inicia** — e a mensagem de erro não vai parecer relacionada ao Stripe. Valores fake bastam (o adaptador nunca é exercido de verdade, mesmo padrão já usado para `RESEND_API_KEY`). Precisa constar na task 1 e no `CLAUDE.md`.

### R-10 — 🟡 Terceira branch empilhada; nada disso existe em produção ainda

`add-billing-subscriptions` (PR #34) e `add-subscription-history` (PR #35) ainda não chegaram na `main`. A R-2 da entrega anterior já pedia que as duas subissem juntas; agora são três. Decisão de release, não de código — mas subir o `billing` sem esta branch significa expor uma paywall que ninguém consegue pagar.

### R-11 — 🟢 O `finance` ainda não reconhece receita da plataforma

`opens_paid_cycle` continua sem consumidor, agora com dados de verdade passando por ele. Segue sendo escopo do `finance`, fora daqui. Registrado para o Revisor não ler como lacuna desta entrega.

### Q-1 — ⚠️ Precisa de decisão do usuário: o `pro` continua com 14 dias de trial?

O plano recomenda **sim** (§2.5, opção B), com o trial administrado pelo Stripe. É a única decisão deste plano com efeito de produto, e é a que dá para cortar se a entrega precisar encolher: cortá-la significa `trial_days: 0` no seed e remover a forma `startTrialUntil` + o ramo `trialing` do mapeamento da DA-9. **Se o usuário não se manifestar, seguir com a recomendação.**

### Q-2 — ⚠️ Precisa de confirmação: os paths de retorno no front

`success_url`, `cancel_url` e `return_url` são constantes derivadas de `frontBaseUrl` (DA-4). Proposta: `/billing/checkout/success`, `/billing/checkout/canceled`, `/billing`. Se o `sogio-front` usa outros, é troca de três strings — mas precisa ser combinado, senão o cliente termina o pagamento e cai num 404.

---

## 6. Mapeamento de Mudanças

### Arquivos novos — `src/billing/`

**Application — portas e contrato do gateway**

- `application/gateway/payment_gateway.ts` — porta de saída: `createCustomer`, `createCheckoutSession`, `createBillingPortalSession`
- `application/gateway/gateway_webhook_verifier.ts` — porta de entrada: `verify({ raw_payload, signature }) → GatewayBillingEvent`
- `application/gateway/gateway_billing_event.ts` — união discriminada normalizada (`checkout_completed`, `subscription_state_changed`, `subscription_ended`, `payment_failed`), no vocabulário da Sogio

**Application — use cases**

- `application/use_case/create_checkout_session.ts` (DA-4)
- `application/use_case/create_billing_portal_session.ts`
- `application/use_case/process_gateway_webhook.ts` — verifica, faz `claim`, despacha (DA-2, DA-7)
- `application/use_case/sync_subscription_from_gateway.ts` — o mapeamento da DA-9
- `application/use_case/bind_gateway_customer.ts` — caminho `checkout_completed`

**Application — handler**

- `application/handler/record_history_on_subscription_renewed.ts`

**Domain**

- `domain/event/subscription_renewed_event.ts` — construtor por objeto, como os três da entrega anterior
- `domain/repository/processed_gateway_event_repository.ts` — só `claim` e `release` (DA-7)

**Infra / Presentation**

- `infra/gateway/stripe_payment_gateway.ts` — **o único arquivo que importa o SDK do Stripe** (junto com o verifier)
- `infra/gateway/stripe_webhook_verifier.ts` — `constructEventAsync`, tolerância default, tradução para `GatewayBillingEvent`
- `infra/database/postgres_repository/processed_gateway_event_postgres_repository.ts`
- `presentation/controller/create_checkout_session.controller.ts`
- `presentation/controller/create_billing_portal_session.controller.ts`
- `presentation/controller/stripe_webhook.controller.ts` — sem `openApiSpec` (não se documenta endpoint de máquina no spec público)

### Arquivos modificados

- `src/billing/domain/entity/subscription.ts` — `linkCustomer`; `period_end`/`external_reference` explícitos em `activate` e `changePlan`; `startTrialUntil`; `markPastDue` tolerante e com tolerância ancorada; `cancel` idempotente; campo `external_event_at` (§2.3, §2.4)
- `src/billing/domain/entity/subscription_history_entry.ts` — tipo `renewed` + refinement `renewed ⇒ active`
- `src/billing/domain/repository/subscription_repository.ts` — `subscriptionOfExternalCustomerReference`, `subscriptionOfExternalReference`, `linkCustomerReferenceIfAbsent` (DA-6)
- `src/billing/domain/repository/plan_repository.ts` — `planOfExternalPriceReference`
- `src/billing/infra/database/postgres_repository/subscription_postgres_repository.ts` — os três métodos acima + persistir `external_event_at`
- `src/billing/infra/database/postgres_repository/plan_postgres_repository.ts` — a busca por `external_price_reference`
- `src/billing/application/use_case/subscribe_to_plan.ts` → **renomear** para `grant_plan.ts` / `GrantPlanUseCase` (DA-10)
- `src/billing/application/use_case/cancel_subscription.ts` — `Input = { user_id }`, sem `User`; idempotente quando já cancelada (DA-10, §2.4)
- `src/billing/application/use_case/mark_subscription_past_due.ts` — aceita `occurred_at` do gateway (DA-8)
- `src/billing/infra/database/seed_plans.ts` — `onConflictDoUpdate` de `external_price_reference` quando `STRIPE_PRO_PRICE_ID` existe (DA-11)
- `src/billing/infra/di/billing_di.ts` — gateway, verifier, repositório de idempotência, use cases e controllers novos, e o **sexto** `register()` (`SubscriptionRenewedEvent`)
- `src/core/infra/database/drizzle/schemas/billing_schemas.ts` — `processedGatewayEventsTable`; `external_event_at` em `subscriptions`; **índices únicos** em `subscriptions.external_reference`, `subscriptions.external_customer_reference` e `plans.external_price_reference` (a resolução de identidade do webhook precisa ser provadamente não ambígua)
- `drizzle/00XX_*.sql` — migration gerada
- `src/core/infra/config/environments.ts` — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (obrigatórias fora de `development`), `STRIPE_PRO_PRICE_ID` (opcional)
- `src/core/infra/http/routes/routes.ts` — três rotas novas; as duas autenticadas com `allowWithoutPlatformAccess: true` (DA-5); o webhook com `authenticated: false`
- `package.json` — dependência `stripe`
- `CLAUDE.md` — variáveis novas, pré-requisito do `.env.test` (R-9), parágrafo do gateway na seção do BC `billing`
- `.claude/personas/arquiteto.md` — `SubscriptionRenewedEvent` na tabela de eventos; nota de que o período de assinatura paga é fornecido pelo gateway

### Testes — `tests/billing/`

- `stripe_webhook_signature.test.ts` — o teste que prova que a defesa existe
- `stripe_checkout_session.test.ts`
- `stripe_billing_portal.test.ts`
- `gateway_subscription_sync.test.ts`

---

## 7. Tasks

1. **Variáveis de ambiente, dependência e `.env.test`** — `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` (refinements "obrigatória fora de `development`", espelhando `RESEND_API_KEY`), `STRIPE_PRO_PRICE_ID` opcional; `bun add stripe`; valores fake no `.env.test` (R-9); linha de pré-requisito no `CLAUDE.md`.
   - Dependências: nenhuma

2. **Contrato do gateway** — `PaymentGateway`, `GatewayWebhookVerifier` e a união `GatewayBillingEvent`, todos em `billing/application/gateway/`, sem nenhuma menção a Stripe (DA-1).
   - Dependências: nenhuma

3. **Transições de `Subscription` para o mundo do gateway** — `linkCustomer` (write-once), `period_end` e `external_reference` explícitos em `activate`/`changePlan`, `startTrialUntil`, `markPastDue` tolerante com tolerância ancorada na primeira falha, `cancel` idempotente, campo `external_event_at` (§2.3, §2.4). Teste unitário por regra.
   - Dependências: nenhuma
   - **Revisão obrigatória: Analista de Segurança** (é a camada de invariantes em que o webhook se apoia; um afrouxamento a mais aqui é entitlement de graça)

4. **`renewed` no Histórico** — tipo novo em `SubscriptionHistoryEntry` + refinement, `SubscriptionRenewedEvent` (construtor por objeto), `RecordHistoryOnSubscriptionRenewed` (§2.6).
   - Dependências: nenhuma

5. **Schema e migration** — `processedGatewayEventsTable` (`external_event_id` único, sem `user_id`), `external_event_at` em `subscriptions`, índices únicos em `subscriptions.external_reference`, `subscriptions.external_customer_reference` e `plans.external_price_reference`; gerar migration.
   - Dependências: task 3

6. **Repositórios** — `planOfExternalPriceReference`; `subscriptionOfExternalCustomerReference`, `subscriptionOfExternalReference` e `linkCustomerReferenceIfAbsent` (`UPDATE ... WHERE ... IS NULL`, devolvendo a referência efetiva — DA-6); `ProcessedGatewayEventRepository` com `claim`/`release` (DA-7).
   - Dependências: tasks 3, 5

7. **Adaptadores Stripe** — `StripePaymentGateway` e `StripeWebhookVerifier` em `billing/infra/gateway/`, os **únicos** arquivos que importam o SDK. `constructEventAsync` com tolerância default; tradução dos cinco tipos da DA-9 para os quatro eventos normalizados; `apiVersion` fixada.
   - Dependências: tasks 1, 2
   - **Revisão obrigatória: Analista de Segurança** (verificação de assinatura, corpo cru, tolerância de timestamp)

8. **`CreateCheckoutSessionUseCase`, controller e rota** — os oito passos da DA-4, incluindo a trava anti-dupla-assinatura e o `trial_period_days` condicional; URLs de retorno derivadas de `frontBaseUrl`, nunca do request; rota `POST /billing/checkout-session` com `allowWithoutPlatformAccess: true` e `rateLimitPolicy`.
   - Dependências: tasks 2, 6
   - **Revisão obrigatória: Analista de Segurança** (DA-5, dupla cobrança, trial farming, open redirect)

9. **`CreateBillingPortalSessionUseCase`, controller e rota** — resolve `external_customer_reference` **da assinatura do chamador**, nunca do request; ausente ⇒ `ConflictError`; rota `POST /billing/portal-session` com `allowWithoutPlatformAccess: true`.
   - Dependências: tasks 2, 6
   - **Revisão obrigatória: Analista de Segurança** (escopo por chamador — vazar a referência de cliente de terceiro dá acesso à fatura alheia)

10. **`ProcessGatewayWebhookUseCase` e os caminhos por evento** — verificação **dentro** do use case (DA-2), `claim`/`release` (DA-7), guarda de `external_event_at` (DA-8), e o despacho: `BindGatewayCustomer` (checkout), `SyncSubscriptionFromGateway` (DA-9), `CancelSubscriptionUseCase` reusado (fim), `MarkSubscriptionPastDueUseCase` reusado (falha). Regra anti-ruído da §2.6.
    - Dependências: tasks 3, 4, 6, 7, 12
    - **Revisão obrigatória: Analista de Segurança** (identidade resolvida só pelo nosso banco; nenhum `ConflictError` escapando)

11. **Controller e rota do webhook** — `POST /billing/webhooks/stripe`, `authenticated: false`, sem `inputSchema`, sem `openApiSpec`, lendo `rawBody` e `headers["stripe-signature"]`; `rateLimitPolicy` generosa (guarda de inundação, não de throughput); os códigos de resposta da DA-3.
    - Dependências: task 10
    - **Revisão obrigatória: Analista de Segurança** (R-1 — é o endpoint mais sensível do projeto)

12. **`GrantPlanUseCase` e `CancelSubscriptionUseCase` (DA-10)** — renomear `SubscribeToPlanUseCase`; mudar o `Input` de `CancelSubscription` para `{ user_id }` e torná-lo idempotente; atualizar `BillingDi` e os testes existentes; documentar em ambos que não são caminho de produção para o usuário final.
    - Dependências: task 3

13. **Seed com o `price_id` do Pro (DA-11)** — `onConflictDoUpdate` apenas de `external_price_reference` quando `STRIPE_PRO_PRICE_ID` estiver presente; decidir `trial_days` conforme Q-1.
    - Dependências: tasks 1, 5

14. **Wiring no `BillingDi`** — gateway, verifier, repositório de idempotência, use cases e controllers novos, e o **sexto** `register()` no construtor. Continua **uma única instância** (DA-7 da entrega anterior).
    - Dependências: tasks 7, 8, 9, 10, 11, 12

15. **Testes** —
    (a) **assinatura forjada ⇒ 401 e nenhuma escrita**; **header ausente ⇒ 401 e nenhuma escrita** (R-1 — usar `Stripe.webhooks.generateTestHeaderString` com um segredo conhecido para o caso positivo);
    (b) mesmo `external_event_id` entregue duas vezes ⇒ uma única transição e um único registro de histórico (DA-7);
    (c) evento com `created` anterior ao `external_event_at` ⇒ descartado, 200 (DA-8);
    (d) `subscription_state_changed` com `active` e período novo ⇒ entrada `renewed`; com preço de outro plano ⇒ `plan_changed`; sem mudança material ⇒ **nenhuma entrada** (§2.6);
    (e) `invoice.payment_failed` duas vezes ⇒ `grace_period_ends_at` **não se move** (§2.4);
    (f) `customer.subscription.deleted` duas vezes ⇒ um único `canceled`, 200 nas duas (§2.4);
    (g) segundo checkout com assinatura viva ⇒ `ConflictError` (R-4);
    (h) checkout de quem já usou trial ⇒ sessão **sem** `trial_period_days` (R-5);
    (i) conta **bloqueada** recebe **200** em `/billing/checkout-session` e `/billing/portal-session` (R-2);
    (j) plano sem `external_price_reference` ⇒ 500 tipado, não 404;
    (k) tipo de evento desconhecido ⇒ 200 e nenhuma escrita.
    - Dependências: task 14

16. **Documentação** — `CLAUDE.md` (variáveis, `.env.test`, parágrafo do gateway) e `.claude/personas/arquiteto.md` (`SubscriptionRenewedEvent`, período fornecido pelo gateway).
    - Dependências: task 15

> **Paralelismo**: tasks 1, 2, 3 e 4 são independentes e rodam juntas. Depois, `3 → 5 → 6` e `1+2 → 7` correm em paralelo, e a 12 sai junto assim que a 3 fechar. As tasks 8 e 9 são independentes entre si a partir da 6. A task 10 é o ponto de junção real; 11, 14, 15 e 16 são sequenciais no fim.
>
> **Decisões pendentes do usuário**: Q-1 (trial de 14 dias no Pro — recomendação: manter) e Q-2 (paths de retorno no front). Nenhuma das duas bloqueia as tasks 1–7.

---

## 8. Diretrizes para o Desenvolvedor

1. **A palavra "Stripe" só aparece em `billing/infra/gateway/`, em `environments.ts`, no nome do controller de webhook e no path da rota.** Em `domain/` e `application/` é sempre "gateway". Um `grep -r "stripe" src/billing/domain src/billing/application` tem que voltar vazio.
2. **Nunca existirá um bypass de verificação de assinatura.** Nem "só em dev", nem por flag. Se testar com `curl` for difícil, use `stripe listen` — é para isso que ele existe.
3. **Verifique o corpo cru.** `request.rawBody`, nunca `JSON.stringify(request.body)`.
4. **Nenhum `ConflictError` sai do caminho do webhook.** "Já está no estado alvo" é sucesso (DA-3). Se aparecer um 409 num teste de webhook, é bug do plano sendo cumprido errado.
5. **A tolerância do `past_due` é ancorada na primeira falha.** Não recalcule `gracePeriodEnd` numa reentrega; seria dar prazo extra a cada retentativa do Stripe.
6. **O período da assinatura paga vem do gateway.** Se aparecer `BillingCyclePolicy.nextPeriodEnd` no caminho do webhook, a divergência da §2.3 voltou.
7. **`trial_period_days` só quando `trial_ends_at === null`.** É a defesa efetiva contra trial farming (R-5); a invariante do agregado sozinha não protege.
8. **URLs de retorno nunca vêm do request.** Constantes sobre `frontBaseUrl`.
9. **O usuário é resolvido no nosso banco.** Por `external_customer_reference`/`external_reference`; `client_reference_id` só no evento de checkout, e mesmo assim só para _ligar_ referências — nunca para conceder acesso direto.
10. **`claim` antes de processar, `release` no `catch`.** E log `error` com o `external_event_id` quando liberar (R-6).
11. **Entrada de histórico só quando algo mudou de verdade** — `plan_id`, `status` ou `current_period_end` (§2.6). O Stripe é barulhento.
12. **Renovação é `renewed`, nunca `plan_changed`.** A R-7 da entrega anterior existe exatamente para impedir esse atalho.
13. **`BillingDi` continua instanciado uma única vez.** Agora com seis registros de handler.
14. **Comentários de no máximo uma linha**, conforme preferência registrada do usuário.
15. **Commit por task**, Conventional Commits em inglês.
