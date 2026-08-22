# CLAUDE.md

Este arquivo fornece orientações ao Claude Code (claude.ai/code) ao trabalhar com este repositório.

## Personas e Orquestração

Este projeto utiliza um sistema de personas especialistas. **O Orquestrador é o ponto de entrada obrigatório para toda e qualquer tarefa.** Leia o arquivo abaixo antes de qualquer planejamento, desenvolvimento ou revisão:

```
.claude/personas/orquestrador.md
```

O Orquestrador decide quais personas invocar, em que ordem e quando. Nunca invoque outra persona diretamente — tudo passa pelo Orquestrador primeiro.

Todas as personas disponíveis estão em `.claude/personas/*.md`.

## Comandos

```bash
# Desenvolvimento
bun run dev          # Inicia o servidor de desenvolvimento com hot reload
bun run start        # Inicia o servidor de produção

# Build
bun run build        # Compila TypeScript + Bun build para executável (./out)

# Qualidade de Código
bun run lint         # ESLint com auto-fix
bun run lint:check   # ESLint sem fix (CI)
bun run format       # Formatação com Prettier
bun run format:check # Verificação do Prettier (CI)

# Banco de Dados (Drizzle ORM)
bun run db:push       # Envia o schema para o banco
bun run db:migration  # Gera arquivos de migration
bun run db:migrate    # Executa migrations pendentes
```

```bash
# Testes
bun run db:push:test  # Cria o schema `test` no banco e aplica o schema Drizzle (obrigatório antes do primeiro run)
bun run test          # Executa todos os testes
```

Os testes ficam em `tests/<bounded context>/<test name>.test.ts`.

> **Pré-requisito**: o arquivo `.env.test` na raiz do projeto deve conter a variável `DATABASE_URL` com as credenciais reais do banco local, a variável `API_BASE_URL` (ex: `http://localhost:4000`) — obrigatória fora de `development` desde a introdução dos documentos de descoberta OAuth —, a variável `FRONT_BASE_URL` (ex: `http://localhost:5173`) — obrigatória fora de `development` desde a introdução do `/authorize` (redirect de consentimento do protocolo OAuth) —, as variáveis `RESEND_API_KEY` e `PASSWORD_RESET_EMAIL_FROM` — obrigatórias fora de `development` desde a introdução da recuperação de senha por email —, e as variáveis `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` — obrigatórias fora de `development` desde a integração com o gateway de pagamento; em `test` todas podem ser valores fake, já que os adapters Resend e Stripe nunca são exercidos de verdade nos testes (a verificação de assinatura do webhook é testada localmente, assinando o payload com o mesmo segredo fake — ver `tests/billing/stripe_webhook_verifier.test.ts`).

## Arquitetura

**Sogio API** é um backend de gestão de aluguel de imóveis construído com Bun + TypeScript + PostgreSQL (Drizzle ORM). Segue **Clean Architecture** com separação estrita de camadas.

### Estrutura de Camadas

Cada módulo de negócio (`auth`, `booking`, `property_management`, `finance`, `billing`, `notification`) possui quatro camadas:

```
src/[modulo]/
├── domain/         # Entidades, interfaces de repositório, value objects, eventos, policies
├── application/    # Use cases, serviços, DTOs, event handlers
├── infra/          # Repositórios Drizzle, container DI, integrações externas
└── presentation/   # Controllers HTTP e tools MCP
```

O módulo `src/core/` provê infraestrutura compartilhada: tipo base de entidade, erros customizados, interface `UseCase`, roteamento HTTP, configuração do DI e setup do banco.

### Padrões Principais

**Entidades** usam um campo privado `#data` com schema Zod. Dois factories estáticos: `create()` para objetos novos, `reconstitute()` para carregar do banco. Getters expõem dados como read-only. Toda entidade estende `BaseEntity` com `id`, `created_at`, `updated_at`, `deleted_at`.

**Use Cases** implementam `UseCase<Input, Output>`. Dependências injetadas via construtor. `execute(input, user)` retorna um DTO (nunca uma entidade bruta). Lançam erros tipados (`ConflictError`, `ResourceNotFoundError`, etc.).

**Controllers** implementam `Controller` (`path`, `method`, `handle()`). Validam input com Zod (lançam `ValidationError` em caso de falha). Retornam um DTO — o adaptador HTTP serializa para JSON.

**Containers DI** — cada módulo tem uma classe `[Module]Di` (`AuthDi`, `StayDi`, `PropertyDi`, `FinanceDi`). Factory methods nomeados `make[Componente]` montam as dependências. Instâncias criadas uma única vez em `routes.ts`.

**Tratamento de Erros** — use cases lançam erros tipados; o adaptador HTTP mapeia os nomes de erro para status codes: `ValidationError` → 422, `ConflictError` → 409, `ResourceNotFoundError` → 404, `UnauthorizedError` → 401, `IllegalStateError` → 500.

**Exclusão de propriedade** (`DELETE /property/:property_id`) é soft delete que **cancela em cascata** as estadias futuras da propriedade — `Stay.cancel()` para cada uma, revertendo a receita no ledger. `LedgerEntry`, `PropertySetting` e `ExternalBookingSource` nunca são tocados, apenas deixam de ser servidos. `PropertyOwnershipPolicy` é o portão único de posse+`deleted_at` para todo use case property-scoped nos BCs `property_management`, `booking` e `finance` — nunca duplicar essa checagem inline. `PropertyPostgresRepository.propertyOfId` deliberadamente **não** filtra `deleted_at`: ele sustenta a decisão INSERT-vs-UPDATE de `save()`, e filtrar ali faria a própria escrita do soft delete falhar com 500. O `409` sobrevive **estreitado**: só bloqueia quando há um hóspede no imóvel agora (`check_in <= agora AND check_out >= agora`) — uma estadia futura nunca bloqueia, é cancelada. A checagem e a liberação da ocupação atravessam para `booking` por uma porta (`PropertyOccupancy.releaseFutureOccupancy`, um comando com um callback de regra — mesmo idioma de `PropertyRepository.saveNewWithinQuota`) declarada em `property_management` e implementada em `booking`, preservando a direção de dependência `booking → property_management` e mantendo a regra do 409 dentro de `property_management`. Tudo roda dentro de uma única transação (`TransactionRunner`, `core/application/transaction/`, implementada sobre `db.transaction` com o executor publicado via `AsyncLocalStorage` — ver `core/infra/database/drizzle/transaction_context.ts`): qualquer falha no meio da cascata, incluindo a corrida em que uma estadia futura vira "em andamento" entre a leitura e o cancelamento, aborta a operação inteira com `409`, sem rastro parcial. A rota retorna `200` com `{ "canceled_stays": N }`, não `204`. Essa garantia de "tudo ou nada" depende de uma invariante que **precisa continuar sendo verdadeira**: nenhum handler de `StayCanceledEvent` pode ter efeito fora do Postgres enquanto rodar dentro dessa transação — hoje só existe `RevertRevenueOnStayCancel`, que só escreve no ledger; o dia em que um segundo handler for registrado (ex.: remover a senha da fechadura), o efeito externo tem que ser pós-commit, idempotente e retentável, nunca dentro da transação. Um teste (`tests/property_management/delete_property.test.ts`) trava essa invariante contando os handlers registrados em `StayCanceledEvent`.

**Autenticação** — JWT Bearer tokens. `SessionManager` cria/valida tokens. O middleware de auth extrai o usuário e o repassa ao controller. Rotas declaram `authenticated: boolean` em `routes.ts`.

**Superfície MCP obrigatória** — todo caso de uso ou endpoint novo **de escopo de usuário** nasce com a **tool MCP correspondente, na mesma entrega**. O produto tem que funcionar independente de UI: o backend concentra as regras de negócio e uma IA conectada ao `/mcp` deve conseguir executar todas as ações **do próprio usuário**. As tools ficam em `src/<bc>/presentation/mcp_tool/` e são registradas em dois pontos (factory `make<X>Tool()` no Di do BC, array `tools` de `makeMcpRequestHandler`), sempre sobre as **mesmas instâncias de DI** que o HTTP usa.

**Administração não entra no MCP.** Caso de uso que opera sobre a **aplicação inteira** — configuração global, dados de todos os usuários — em vez dos dados do usuário logado **não tem tool MCP**, e não é dívida a pagar depois: é exclusão deliberada. Na prática isso cobre o BC `backoffice` inteiro e qualquer rota `adminOnly`. O MCP existe para o usuário dirigir a própria conta; administrar a plataforma não é ação de usuário.

Demais exceções: material de credencial (cadastro, login, troca e recuperação de senha), o próprio protocolo OAuth que emite o token do `/mcp` e seus documentos de descoberta, webhooks de terceiros, links públicos não autenticados, exclusão de conta por LGPD, sessões de pagamento que devolvem URL para um humano abrir, e rotas de operação (`/health`, `/docs`). Toda exceção usada precisa estar registrada no plano da entrega.

### Bounded Context `billing`

Modelo de monetização SaaS: cada `User` tem exatamente uma `Subscription`, vinculada a um `Plan` do catálogo (`free` e `pro`). O catálogo é propriedade do **gateway de pagamento** — ver "Catálogo de planos" abaixo; `bun run db:seed` continua existindo, mas só como fixture de `development`/`test`. O **entitlement** (acesso à plataforma + o conjunto de capacidades do plano) é sempre **derivado** de `Subscription` + `Plan` no momento da leitura (`SubscriptionAccessPolicy`), nunca uma coluna persistida — não há scheduler no projeto para expirar períodos automaticamente. `EntitlementService` (`billing/application/service/`) é o Open Host Service que `core/infra/http`, `core/infra/mcp` e `property_management` consomem via interface, nunca a infraestrutura de `billing` diretamente.

O acesso é bloqueado (fail-closed) em toda rota `authenticated: true` e em `/mcp`, exceto as rotas marcadas com `allowWithoutPlatformAccess: true` em `routes.ts` (conta própria, exclusão LGPD, higiene de apps conectados, decisão OAuth, checkout e portal de cobrança) — uma conta sem `Subscription` fica bloqueada até intervenção manual. Referências externas são strings opacas anuláveis (`external_reference`, `external_customer_reference`, `external_price_reference`); só `billing/infra/gateway/` conhece o nome do fornecedor (Stripe) — `domain` e `application` só conhecem "gateway".

Todo evento relevante do ciclo de vida da assinatura (`SubscriptionStartedEvent`, `SubscriptionPlanChangedEvent`, `SubscriptionPaymentFailedEvent`, `SubscriptionCanceledEvent`, `SubscriptionRenewedEvent`) alimenta o **Histórico da Assinatura**: um registro append-only (`SubscriptionHistoryEntry`, um agregado próprio — não faz parte de `Subscription`) exposto ao próprio usuário via `GET /billing/subscription/history` (paginado, `allowWithoutPlatformAccess: true`). O escritor único é `RecordSubscriptionHistoryEntryUseCase`, que captura e loga qualquer falha de escrita em vez de propagá-la — uma falha ao gravar auditoria nunca pode derrubar cadastro de usuário ou troca de plano, que já foram confirmados quando o handler roda. `SubscriptionPlanChangedEvent` é o único evento de troca de plano (substitui o antigo `SubscriptionActivatedEvent`, removido): carrega `opens_paid_cycle`, derivado dentro do agregado `Subscription` (`has_paid_cycle`), que é o fato que um futuro `finance` usa para reconhecer receita sem recarregar o `Plan`. `SubscriptionRenewedEvent` cobre um novo ciclo pago abrindo sem troca de plano.

#### Integração com o gateway de pagamento

`billing` cobra de verdade através de três caminhos: **Checkout** hospedado (`POST /billing/checkout-session`) para a primeira assinatura, **Customer Portal** hospedado (`POST /billing/portal-session`) para tudo depois dela, e um **webhook** (`POST /billing/webhooks/stripe`, `authenticated: false`) para manter o estado local sincronizado. O gateway é a fonte de verdade sobre dinheiro e período de cobrança; `billing` continua sendo a fonte de verdade sobre entitlement. As duas rotas de pagamento têm `allowWithoutPlatformAccess: true` — uma conta bloqueada precisa conseguir pagar para se desbloquear.

A verificação da assinatura `Stripe-Signature` acontece **dentro** de `ProcessGatewayWebhookUseCase`, nunca no controller — não existe (nem pode existir) um caminho que invoque as transições de domínio com um evento não verificado, e não existe bypass "só em dev". Reentrega do mesmo evento é absorvida por uma tabela de idempotência (`processed_gateway_events`, `external_event_id` único: `claim` antes de processar, `release` só no caminho de falha). Um evento mais antigo que `Subscription.external_event_at` é descartado — defesa contra reentrega fora de ordem.

As transições dirigidas por webhook (`activate`, `changePlan`, `startTrialUntil`, `markPastDue`, `cancel`) são idempotentes: reentrada no mesmo estado nunca lança `ConflictError` — um `ConflictError` escapando do caminho do webhook é sempre um bug, porque vira um loop de retentativa do Stripe até o endpoint ser desativado. `markPastDue` tolera `active`/`trialing`/`past_due` e ancora `grace_period_ends_at` na primeira falha; `cancel` já cancelada é um no-op silencioso. `SubscribeToPlanUseCase` foi renomeado para `GrantPlanUseCase` (concede plano sem cobrar — mecanismo interno, sem rota) e `CancelSubscriptionUseCase` passou a receber `{ user_id }` em vez de `User`, para que ambos possam ser reusados pelo orquestrador do webhook.

#### Catálogo de planos

O gateway de pagamento é a fonte de verdade sobre o catálogo comercial: preço, nome, `trial_days` e os valores das capacidades vêm do Price do gateway (campos nativos + `metadata`, prefixo `sogio_`) e chegam ao Sogio por dois canais que convergem no mesmo escritor, `SyncPlanCatalogEntryUseCase` — **webhook** (`price.created/updated/deleted`, `product.created/updated/deleted`, normalizados em `GatewayCatalogEvent`, uma família irmã de `GatewayBillingEvent`, não uma variante dela) e **reconciliação sob demanda** (`ReconcilePlanCatalogFromGatewayUseCase`, que lê `PaymentGateway.listCatalogEntries()` inteiro). A reconciliação **não roda mais no boot** (removida em `30592e8`); acontece apenas em `POST /billing/catalog/sync` — `adminOnly`, `allowWithoutPlatformAccess: true` porque, contra um catálogo vazio, a própria conta do admin está bloqueada e precisa conseguir chamar a rota que o conserta. Sem tool MCP: opera sobre o catálogo da aplicação inteira, não sobre os dados do usuário logado.

Um parser único em `infra/gateway/` (`stripe_catalog_entry_parser.ts`, compartilhado pelo verificador de webhook e por `listCatalogEntries`) decide o que é uma entrada de catálogo válida e **nunca lança**: campo semântico errado (capacidade obrigatória ausente ou inválida, `trial_days` presente-e-inválido, moeda, intervalo) invalida a entrada inteira; campo de exibição errado (`name` longo) é normalizado. Três invariantes protegem o catálogo contra o próprio mecanismo que o alimenta — todas em `.claude/personas/arquiteto.md`: **I-1** (`code` é imutável — um typo no dashboard cria um plano-lixo, nunca renomeia um existente), **I-2** (o plano `free` nunca é aposentado por um evento de catálogo) e **I-3** (ausência nunca aposenta — um Price sem metadata é ignorado, não uma aposentadoria implícita).

Lembretes operacionais permanentes para quem opera o dashboard do gateway: **aposentar um plano = arquivar o Price** (`active: false`) — um Price já usado numa assinatura não pode ser deletado, então `price.deleted`/`product.deleted` são caminhos quase mortos; **mudar o preço de um plano = criar um Price novo com o mesmo `sogio_plan_code`** — o plano local repontará sozinho (`external_price_reference` sempre aponta para o Price ativo mais recente do código), mas assinantes do preço antigo não são migrados automaticamente.

#### Capacidades de plano

Uma **capacidade** (`billing/domain/capability/`) é uma alavanca comercial: algo que um plano permite ou limita. Duas espécies: **capacidade de acesso** (booleana — tem ou não tem) e **capacidade de limite** (numérica — tem, até um teto; `max_properties` é a primeira). O **registro** (`CAPABILITY_REGISTRY`) é a declaração em código de quais capacidades existem — `key`, `kind`, `default`, `required`, `label`, `metadata_key`; o **conjunto** (`CapabilitySet`) são os valores já resolvidos para uma assinatura concreta, e vive dentro do `Entitlement` ao lado de `has_platform_access`.

**Capacidade não é feature flag**: ela existe porque o negócio cobraria por ela. Se a resposta a "eu venderia isso separado?" for não, é feature flag e não entra no registro — sem esse critério `billing` vira o catálogo de todas as funcionalidades do produto e passa a ser tocado em toda entrega. Variação qualitativa entre planos (Free exporta CSV, Pro exporta CSV e PDF) se modela como duas capacidades de acesso, nunca como um terceiro tipo com valor de conjunto.

**São duas travas porque são dois problemas.** Acesso é **declarativo, no adaptador**: a rota declara `requiredCapability` em `routes.ts` e o `BunHttpControllerAdapter` aplica no mesmo ponto em que aplica o portão de platform access; a tool MCP declara o mesmo campo em `McpToolDefinition` e o dispatch aplica — a tool continua listada, o que falha é a chamada, com mensagem de upgrade. O use case não sabe que a trava existe. Limite é **imperativo, no use case** (`CapabilityLimitPolicy.ensureWithinLimit`), porque só ele sabe quantos itens já existem e a contagem precisa da atomicidade da transação (`saveNewWithinQuota`). Unificar as duas exigiria levar contagem de recursos para o adaptador ou decisão de rota para dentro do domínio. O entitlement é resolvido **uma única vez por requisição** e serve às duas checagens — capacidade nunca é uma segunda ida ao banco. Admin bypassa a trava de **acesso**, nos dois adaptadores, mas **não** a de limite: `CreatePropertyUseCase` resolve o entitlement por `user_id` sem olhar `role`, então um admin sem assinatura tem limite zero. `requiredCapability` é tipado como `AccessCapabilityKey`, não `CapabilityKey` — declarar uma capacidade de limite numa rota é erro de compilação, e declará-la em rota não autenticada ou `adminOnly` derruba o boot, porque nos dois casos a trava nunca rodaria.

**Registro em código, valores no gateway.** Uma capacidade só existe porque algum use case a consulta, e isso é deploy de qualquer forma; o valor de cada uma por plano vem do `metadata` do Price, então mudar o que o Pro libera continua sendo mexer no dashboard. **Cada entrada declara sua própria `metadata_key`**: a chave interna (`max_properties`) e a chave de metadata (`sogio_max_properties`) são coisas separadas, e é por isso que `sogio_max_properties` manteve o nome que já está no dashboard em produção — renomear exigiria editar o dashboard antes do deploy, e a janela entre os dois deixaria uma capacidade `required` ausente, invalidando a entrada de catálogo inteira. O `key`, por sua vez, é imutável (**I-5**, em `.claude/personas/arquiteto.md`).

`plans.capabilities` é `jsonb` (não uma tabela `plan_capabilities`: o conjunto é sempre lido inteiro junto com o plano, e um join entraria em toda requisição autenticada). A validação na leitura é **permissiva** nos dois níveis: o `planSchema` aceita e ignora chave desconhecida — um schema estrito faria "remover uma capacidade do código" virar quebra de produção, porque todo plano no banco ainda carregaria a chave antiga e `reconstitute()` passaria a lançar —, e `CapabilitySet.of()` cai no `default` do registro quando o valor está ausente ou tem o tipo errado (I-4). `required` é regra de **entrada de catálogo**, aplicada só no parser: não protege o conjunto resolvido a partir do `jsonb`. `allows()` e `limitOf()` lançam `IllegalStateError` quando o acessor não bate com o `kind` do registro — sem a guarda, `allows("max_properties")` devolveria `Boolean(1)` e `limitOf()` de uma booleana devolveria `Number(true)`: errado e silencioso nos dois sentidos.

`GET /billing/subscription` e `GET /billing/plans` expõem `capabilities` (o registro inteiro já resolvido) e **não expõem mais `max_properties` no topo da resposta** — quebra deliberada de contrato com o frontend. A tool MCP `get_subscription_status` existe para que uma IA que bateu numa trava consiga dizer ao usuário qual plano cobre o quê.

### Bounded Context `notification`

O mecanismo genérico de notificação proativa. Um BC de origem publica um evento de domínio que já existe; um handler em `notification/application/handler/` chama `NotificationService.notify()` e **nada mais acontece de forma síncrona** — o serviço resolve as preferências do usuário, renderiza título e corpo e grava uma linha `pending` por canal habilitado. A entrega efetiva é feita depois, por `DeliverPendingNotificationsUseCase`.

**São duas portas, e a separação é o ponto do desenho.** `NotificationService` (`application/service/`) é o Open Host Service que os outros BCs consomem — mesmo padrão de `EntitlementService` — e **não conhece canal nenhum**. `NotificationChannel` (`domain/service/`) tem uma implementação por canal; hoje só `EmailNotificationChannel`. Se o caso de uso escolhesse o canal, preferência de usuário seria impossível (quem decide o canal é a preferência, em runtime) e todo canal novo obrigaria a editar todo caso de uso. `EmailService` **não foi alterado**: continua sendo transporte burro, e o channel é quem sabe compor assunto e corpo — o mesmo princípio que o docblock de `EmailService` já declarava.

**A tabela `notifications` é a fila.** Não há Redis nem lib de fila: o volume é de dezenas/dia e a VPS é pequena, então uma dependência que custaria 30-50MB ociosos para reimplementar o que o Postgres já faz não se paga. `claimDue` **arrenda** o lote em vez de só lê-lo — `FOR UPDATE SKIP LOCKED` mais um empurrão em `next_attempt_at` dentro da mesma transação —, de modo que uma segunda drenagem concorrente passa direto em vez de entregar duas vezes; o arrendamento expira sozinho, então um processo que morre no meio da entrega não deixa a linha presa para sempre. Falha de entrega nunca propaga: `markFailed` conta a tentativa, agenda backoff exponencial (1, 2, 4, 8 min) e desiste em `MAX_DELIVERY_ATTEMPTS`, virando `failed` — terminal, nunca mais retentado.

**O timer mora em `src/index.ts` e em nenhum outro lugar.** A suíte de testes importa `routes.ts` para montar o servidor; um `setInterval` iniciado ali dispararia entre arquivos de teste, batendo no banco fora do controle de qualquer teste. O use case é testado direto, nunca esperando o timer.

`NOTIFICATION_TYPE_REGISTRY` (`domain/notification_type/`) é a declaração em código dos tipos que existem — `key`, `label`, canais padrão e `optional`. Um tipo com `optional: false` é sempre entregue e `PUT /notifications/preferences` recusa desligá-lo com 422. Preferência ausente **nunca é erro**: cai no default, mesmo idioma de `CapabilitySet.of()` (I-4). Tipo desconhecido chegando em `notify()` é logado e descartado, nunca lançado — uma notificação mal declarada não pode derrubar a operação de negócio que a originou.

Os eventos ligados hoje são `SubscriptionPaymentFailedEvent` e `SubscriptionTrialEndingEvent` — este último nasce do webhook `customer.subscription.trial_will_end` do Stripe, normalizado como `subscription_trial_will_end` e traduzido em evento de domínio por `AnnounceTrialEndingUseCase`; o gateway avisa sozinho, então não é preciso varrer assinaturas atrás de trials vencendo. Deliberadamente **não** foram ligados os eventos de estadia: `StayCanceledEvent` está sob a invariante DA-13/R-15 e travado por teste, e mexer nela merece PR própria. `notifications.user_id` e `notification_preferences.user_id` referenciam `users` com `ON DELETE cascade`, então o purge LGPD já leva tudo junto — há teste travando isso.

As duas rotas de preferência (`GET`/`PUT /notifications/preferences`) têm as tools MCP correspondentes: são dados do próprio usuário. A caixa de entrada in-app fica para entrega seguinte — o modelo já persiste `read_at`, só a superfície de leitura é que não existe ainda.

### Banco de Dados

Os schemas do Drizzle ORM ficam em `src/core/infra/database/drizzle/schemas/`. Repositórios usam `db.query` e DML do Drizzle. Registros são mapeados para entidades via `reconstitute()`.

### Variáveis de Ambiente

Definidas em `src/core/infra/config/environments.ts`:

- `PORT` — porta do servidor
- `DATABASE_URL` — string de conexão PostgreSQL
- `NODE_ENV` — `development | test | sandbox | production`
- `JWT_SECRET` — chave de assinatura dos tokens
- `SERVER_HOSTNAME` — endereço em que o `Bun.serve()` faz bind; default `0.0.0.0`. Em produção deve ser `127.0.0.1` (o processo fica atrás de um reverse proxy nginx). Não se chama `HOSTNAME` porque essa variável é auto-exportada pelo Docker (contém o container id) e o Bun dá precedência ao ambiente do processo sobre o `.env`
- `RESEND_API_KEY` — chave da API do Resend, usada para enviar emails transacionais (ex: recuperação de senha). Obrigatória fora de `development`
- `PASSWORD_RESET_EMAIL_FROM` — remetente (`"Nome <email>"`) usado nos emails enviados. Obrigatória fora de `development`
- `PASSWORD_RESET_REQUEST_TTL_SECONDS` — tempo de vida de um pedido de recuperação de senha, em segundos; default 1 hora
- `CORS_ALLOWED_ORIGINS` — lista opcional de origens permitidas para CORS, separadas por vírgula; se ausente, cai para `[FRONT_BASE_URL]`
- `STRIPE_SECRET_KEY` — chave secreta da API do Stripe. Obrigatória fora de `development`
- `STRIPE_WEBHOOK_SECRET` — segredo de assinatura usado para verificar o header `Stripe-Signature` no webhook. Obrigatória fora de `development`
- `NOTIFICATION_DELIVERY_INTERVAL_SECONDS` — intervalo do timer que drena a fila de notificações, em segundos; default 30
- `NOTIFICATION_DELIVERY_BATCH_SIZE` — quantas notificações cada rodada de drenagem arrenda; default 20

### Estilo de Código

Configuração do Prettier: indentação de 2 espaços, largura de linha de 80 caracteres, aspas duplas, trailing commas (ES5), ponto e vírgula obrigatório. ESLint aplica regras TypeScript strict. Husky executa lint + format no pre-commit via lint-staged.

Nomenclatura de arquivos: `snake_case.ts`. Classes: `PascalCase`. Campos privados: `#fieldName` (private class fields do TypeScript).

## Convenções de Commit

Seguir o formato **Conventional Commits**:

```
<tipo>: <descrição curta em inglês>
```

Tipos usados neste projeto:

- `feat` — nova funcionalidade ou comportamento
- `fix` — correção de bug
- `refactor` — reestruturação de código sem mudança de comportamento
- `chore` — tooling, deps, CI/CD, config, mudanças não funcionais

Regras:

- Tipo e descrição em letras minúsculas
- Sem ponto final
- Descrição resume o _o quê_, corpo (se necessário) explica o _por quê_
- Commits em inglês
- **Após cada modificação de código, criar um commit antes de continuar**
