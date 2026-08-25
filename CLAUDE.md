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
bun run db:push:test  # Cria o banco de teste desta worktree e aplica o schema Drizzle
bun run db:prune:test # Dropa os bancos de teste órfãos (worktrees que já não existem)
bun run test          # Executa todos os testes
```

Os testes ficam em `tests/<bounded context>/<test name>.test.ts`.

**Cada worktree tem o seu próprio banco de teste.** O nome sai do path da worktree (`tests/test_database.ts`): a worktree principal continua usando o banco declarado no `DATABASE_URL` do `.env.test` (`sogio_test`), e cada worktree em `.claude/worktrees/<branch>` usa `sogio_test_<slug>_<hash-do-path>`. O preload `tests/preload_test_database.ts` roda antes de `tests/setup.ts`, cria o banco se ele não existir, aplica o schema Drizzle e só então reescreve `process.env.DATABASE_URL` — por isso `environments.ts` nunca pode ser importado por esse módulo, e por isso `db:push:test` deixou de ser obrigatório antes do primeiro run (continua existindo para preparar o banco sem rodar a suíte). O custo é ~1,8 s por execução, contra uma suíte de ~40 s.

**Push que falha derruba e recria o banco.** `drizzle-kit push` abre prompt interativo quando o schema do banco diverge do da branch de um jeito ambíguo (uma coluna some e outra aparece: é rename ou drop+add?) — e, sem TTY, ele imprime o erro em `stderr` mas **sai com código 0**, deixando o banco divergente e a suíte quebrando longe da causa. Por isso `pushSchema` trata `stderr` não vazio como falha, e não só o exit code. Se o banco já existia, a resposta é dropar e recriar do zero: um banco de teste não tem dado que valha a pena preservar, e trocar de branch dentro de uma worktree é rotina. Num banco recém-criado a falha é propagada — ali ela é bug de verdade.

Sem isso, dois agentes em worktrees diferentes se destroem: o helper `truncate()` (`tests/helpers/database.ts`) roda `TRUNCATE ... CASCADE`, então uma suíte apaga as fixtures da outra no meio do run. Nunca apontar duas worktrees para o mesmo banco.

> **Pré-requisito**: o arquivo `.env.test` (gitignored, copiado para cada worktree) deve conter a variável `DATABASE_URL` com as credenciais reais do banco local, a variável `API_BASE_URL` (ex: `http://localhost:4000`) — obrigatória fora de `development` desde a introdução dos documentos de descoberta OAuth —, a variável `FRONT_BASE_URL` (ex: `http://localhost:5173`) — obrigatória fora de `development` desde a introdução do `/authorize` (redirect de consentimento do protocolo OAuth) —, as variáveis `RESEND_API_KEY` e `PASSWORD_RESET_EMAIL_FROM` — obrigatórias fora de `development` desde a introdução da recuperação de senha por email —, e as variáveis `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` — obrigatórias fora de `development` desde a integração com o gateway de pagamento; em `test` todas podem ser valores fake, já que os adapters Resend e Stripe nunca são exercidos de verdade nos testes (a verificação de assinatura do webhook é testada localmente, assinando o payload com o mesmo segredo fake — ver `tests/billing/stripe_webhook_verifier.test.ts`).

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

**Cada diretório de uma camada tem um significado, e o lint o defende.** `application/service/` é para **application services**: objetos que coordenam colaboradores para cumprir uma tarefa da aplicação, mais as portas de saída que a aplicação declara para a infra implementar (`Hasher`, `CredentialVerifier`) — nunca regra de negócio própria, nunca função livre (`sogio/service-only-service-objects` só deixa exportar classe e interface). `application/content/` é para o **texto que um BC endereça a um usuário**, resolvido por idioma: corpo de email, descrição de lançamento. Funções puras, sem colaborador. `notification` é a exceção documentada — o texto dele mora dentro do `NOTIFICATION_TYPE_REGISTRY`, porque ali "que tipos existem" e "o que cada um diz" são a mesma declaração. Regra de negócio vai para `domain/`. Nenhuma das regras de lint consegue provar que uma classe **é** um application service; o que elas provam é que o arquivo publica a **forma** certa, e isso já força a pergunta na hora de escrever.

**Um caso de uso alcançável pelos dois transportes tem um contrato de entrada só.** HTTP e MCP são dois transportes sobre o mesmo caso de uso, então os campos que um chamador pode enviar, seus tipos e seus limites são **uma** declaração, em `src/<bc>/presentation/schema/<caso_de_uso>.schema.ts`. A unidade compartilhada é um `z.ZodRawShape` — um objeto simples de campos Zod — e não um `z.ZodObject`, porque `McpToolDefinition.inputSchema` recebe o shape cru e o controller embrulha com `z.object(shape)`. O `.describe()` mora no shape compartilhado: ele é o prompt da tool para uma IA e, via `bodyFromZod`/`z.toJSONSchema`, vira a descrição do campo no `/docs` — o mesmo texto serve aos dois públicos sem custo. Todo `.max()` numérico referencia a constante de `domain`, nunca um literal. Diferença legítima entre os canais é um `.extend()`/`.omit()` visível no consumidor, **nunca** uma segunda cópia do campo: `book_stay` aceita `z.coerce.date()` no HTTP e exige ISO-8601 com offset explícito no MCP, porque uma IA inventa datetime sem fuso; e `entrance_code` é só do HTTP, porque é senha real de fechadura e nunca pode entrar no contexto de uma IA. Travado pela regra ESLint `sogio/no-inline-input-schema`, escopada a `presentation/controller/` e `presentation/mcp_tool/`.

**Uma regra entre campos é declarada uma vez e aplicada nos dois canais.** O shape compartilhado é um saco de campos, e uma regra que restringe o **objeto inteiro** (`from <= to`, "ao menos uma preferência") não cabe nele — foi assim que `list_stays` passou a aceitar `from > to` e devolver lista vazia em silêncio enquanto o HTTP devolvia 422. Essas regras moram no mesmo arquivo de `presentation/schema/`, como um `InputRule` (`core/presentation/schema/input_rule.ts`): `message`, `path`, `isSatisfiedBy`. O controller a compõe com `withRules(z.object(shape), regra)`; a tool chama `assertRules(input, regra)` na primeira linha do handler, porque `McpToolDefinition.inputSchema` é um shape cru e não há onde pendurar um `refine`. Nenhum `.refine()`/`.superRefine()` pode nascer dentro de `presentation/controller/` ou `presentation/mcp_tool/` — travado por teste, junto com a exigência de que toda regra exportada seja referenciada pelos **dois** lados do par.

Isso nasceu de uma duplicação que já tinha divergido: os dois canais aceitavam valores diferentes para o mesmo caso de uso — `capacity` e `guests` limitados a 500 no HTTP e a `MAX_PROPERTY_CAPACITY` (1000) no MCP, `tenant.name` com `min(2)` no HTTP contra o `min(3)` que a entidade `Tenant` exige (um nome de 2 letras virava 500, não 422), `tenant.phone` exigindo exatamente 13 dígitos no HTTP contra 10–15 no MCP, `list_tenants` sem validação nenhuma no HTTP, e `MAX_PROPERTY_IMAGES` redeclarado dentro de uma tool. Schema de **saída** fica de fora: `outputSchema` existe só para o `/docs` e a tool MCP não publica nenhum, então ali não há duplicação a matar.

**`application/handler/` só tem event handler** — um arquivo ali exporta uma classe que implementa `EventHandler`, e nada mais. O que um handler usa mas não é handler (compositor de texto, busca auxiliar, derivação pura) vai para `application/service/` ou `domain/`: o diretório é a lista do que um BC reage, e um helper à deriva ali faz essa lista deixar de significar algo. Travado pela regra ESLint `sogio/handler-only-event-handlers` — helper não exportado dentro do próprio arquivo do handler continua permitido, assim como export de tipo.

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

O mecanismo genérico de notificação proativa. Um BC de origem publica um evento de domínio que já existe; um handler em `notification/application/handler/` chama `NotificationService.notify()` e **nada mais acontece de forma síncrona** — o serviço resolve as preferências do usuário, valida o payload contra o contrato do tipo e grava uma linha `pending` por canal habilitado. A entrega efetiva é feita depois, por `DeliverPendingNotificationsUseCase`.

**São duas portas, e a separação é o ponto do desenho.** `NotificationService` (`application/service/`) é o Open Host Service que os outros BCs consomem — mesmo padrão de `EntitlementService` — e **não conhece canal nenhum**. `NotificationChannel` (`domain/service/`) tem uma implementação por canal; hoje só `EmailNotificationChannel`. Se o caso de uso escolhesse o canal, preferência de usuário seria impossível (quem decide o canal é a preferência, em runtime) e todo canal novo obrigaria a editar todo caso de uso. `EmailService` **não foi alterado**: continua sendo transporte burro, e o channel é quem sabe compor assunto e corpo — o mesmo princípio que o docblock de `EmailService` já declarava.

**A tabela `notifications` é a fila.** Não há Redis nem lib de fila: o volume é de dezenas/dia e a VPS é pequena, então uma dependência que custaria 30-50MB ociosos para reimplementar o que o Postgres já faz não se paga. `claimDue` **arrenda** o lote em vez de só lê-lo — `FOR UPDATE SKIP LOCKED` mais um empurrão em `next_attempt_at` dentro da mesma transação —, de modo que uma segunda drenagem concorrente passa direto em vez de entregar duas vezes; o arrendamento expira sozinho, então um processo que morre no meio da entrega não deixa a linha presa para sempre. Falha de entrega nunca propaga: `markFailed` conta a tentativa, agenda backoff exponencial (1, 2, 4, 8 min) e desiste em `MAX_DELIVERY_ATTEMPTS`, virando `failed` — terminal, nunca mais retentado.

**O timer mora em `src/index.ts` e em nenhum outro lugar.** A suíte de testes importa `routes.ts` para montar o servidor; um `setInterval` iniciado ali dispararia entre arquivos de teste, batendo no banco fora do controle de qualquer teste. O use case é testado direto, nunca esperando o timer.

`NOTIFICATION_TYPE_REGISTRY` (`domain/notification_type/`) é a declaração em código dos tipos que existem — `key`, `label`, canais padrão, `optional`, o schema Zod do `payload` e o `content` por idioma. Um tipo com `optional: false` é sempre entregue e `PUT /notifications/preferences` recusa desligá-lo com 422. Preferência ausente **nunca é erro**: cai no default, mesmo idioma de `CapabilitySet.of()` (I-4). Tipo desconhecido chegando em `notify()` é logado e descartado, nunca lançado — uma notificação mal declarada não pode derrubar a operação de negócio que a originou.

Os eventos ligados hoje são `SubscriptionPaymentFailedEvent` e `SubscriptionTrialEndingEvent` — este último nasce do webhook `customer.subscription.trial_will_end` do Stripe, normalizado como `subscription_trial_will_end` e traduzido em evento de domínio por `AnnounceTrialEndingUseCase`; o gateway avisa sozinho, então não é preciso varrer assinaturas atrás de trials vencendo. Deliberadamente **não** foram ligados os eventos de estadia: `StayCanceledEvent` está sob a invariante DA-13/R-15 e travado por teste, e mexer nela merece PR própria. `notifications.user_id` e `notification_preferences.user_id` referenciam `users` com `ON DELETE cascade`, então o purge LGPD já leva tudo junto — há teste travando isso.

**O texto é renderizado na entrega, no idioma do destinatário.** `notifications` não guarda `title`/`body`: guarda `type` + `payload` (`jsonb`), os fatos do evento, independentes de idioma. `NotificationContentRenderer` (`domain/service/`) produz o par título/corpo imediatamente antes de chamar o canal, usando o `locale` e o `time_zone` do usuário — que chegam pelo `NotificationRecipient`, já montado pelo join que `claimDue` fazia para pegar nome e email, sem query nova. O canal recebe o conteúdo pronto e continua sem conhecer idioma. Consequência aceita: quem troca de idioma entre a criação e a entrega recebe no idioma **novo**.

**I-N1 — nenhum texto voltado ao usuário nasce em um handler.** Handler publica fatos, nunca strings de conteúdo nem `Intl.DateTimeFormat`. Sem essa trava, cada notificação nova reintroduz o português fixo no código. Travada por teste (`tests/notification/notification_locale.test.ts`).

`label` e `content` são `Record<Locale, ...>` **totais**: acrescentar um idioma a `SUPPORTED_LOCALES` sem traduzir um tipo existente é erro de compilação, não uma notificação saindo no idioma errado em produção. Notificação irrenderizável — tipo fora do registro ou payload que não satisfaz o contrato — vira `failed` sozinha, com o lote seguindo adiante; é a mesma decisão de fail-safe já tomada para canal inexistente.

A preferência de idioma **não vive aqui**: `locale` e `time_zone` são campos de `User` (`auth`), porque idioma serve à aplicação inteira, não só a notificações — o email de recuperação de senha e a descrição de lançamento do ledger seguem a mesma preferência. O vocabulário compartilhado (`SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `DEFAULT_TIME_ZONE`) fica em `core/domain/locale/`, já que vários BCs leem e só `auth` escreve. Leitura e escrita pelo usuário em `GET`/`PATCH /auth/me/preferences` (`allowWithoutPlatformAccess: true`, é conta própria) e nas tools `get_user_preferences`/`update_user_preferences`.

**`DisplayPreferencesService` (`auth/application/service/`)** é o Open Host Service que publica idioma e fuso de um `user_id` a quem precisa escrever um texto endereçado a alguém e não tem o `User` em mãos — mesmo papel de `EntitlementService` em `billing`. Quem o consome hoje é `finance`: a descrição de um lançamento de estadia é escrita para o dono do imóvel, mas os eventos de estadia carregam `property_id`, então o handler resolve `property_id → user_id` com o `PropertyRepository` que o `FinanceDi` já tinha e daí as preferências pelo OHS. Ausência (propriedade ou usuário sumido) cai no padrão em vez de lançar — um lançamento no idioma padrão é degradação, uma reserva que falha por causa do texto de uma descrição é quebra de produto. Descrições de ledger já gravadas **não são migradas**. `notification` deliberadamente **não** usa o OHS: no caminho de entrega a preferência já vem no join que `claimDue` faz para pegar nome e email.

As duas rotas de preferência (`GET`/`PUT /notifications/preferences`) têm as tools MCP correspondentes: são dados do próprio usuário.

**A caixa de entrada** (`GET /notifications`, paginada, e `POST /notifications/:notification_id/read`) mostra só o que foi **entregue**: a query filtra `status === "sent"`, então uma notificação `pending` ou `failed` nunca aparece — `markRead()` lança `IllegalStateError` (500) numa linha que não é `sent`, e `sent` é terminal (`markFailed` lança numa já enviada), então "aparece na lista ⟹ pode marcar como lida" vale para sempre. Uma linha irrenderizável (tipo saiu do registro, ou o payload não satisfaz mais o contrato do tipo) é omitida em vez de mostrada com texto de substituição: a saída do registro é filtrada em SQL (`total` fica exato), enquanto payload inválido é descartado no caso de uso com `warn` — nesse segundo caso, deliberadamente, uma página pode vir mais curta que `limit` com `total` ainda contando a linha. A resposta traz `unread_count` do inbox inteiro, não da página; não há filtro `unread_only` nem índice novo — o volume não pede. A posse é checada no caso de uso, não no repositório (mesmo idioma de `DeleteLedgerEntryUseCase`): ausente, de outro usuário e em estado errado colapsam no mesmo `404`. As duas rotas são `authenticated: true` sem `allowWithoutPlatformAccess` e sem `requiredCapability`, como as de preferência, e têm as tools MCP correspondentes (`list_notifications`, `mark_notification_read`) na mesma entrega. A caixa de entrada não guarda nenhum dado pessoal novo: `title`/`body` continuam sendo renderizados na leitura, a partir do mesmo `payload` que já existia — nada a mais fica persistido só para a listagem existir.

### Importação de dados em massa

Permite ao proprietário trazer para dentro do Sogio, de uma vez, o histórico que já tem em outro lugar — imóveis, estadias (inclusive passadas) e lançamentos do ledger —, em vez de recadastrar item por item. Três rotas HTTP (`POST /import/properties`, `POST /import/stays`, `POST /import/ledger-entries`) e as três tools MCP correspondentes (`import_properties`, `import_stays`, `import_ledger_entries`).

**Importação é capacidade de acesso do plano, não funcionalidade aberta.** As três rotas declaram `requiredCapability: "bulk_import"` em `routes.ts` e as três tools declaram o mesmo campo em `McpToolDefinition` — a trava é aplicada pelo `BunHttpControllerAdapter` e pelo dispatch MCP, no mesmo ponto em que aplicam o portão de platform access, e nenhum caso de uso importador sabe que ela existe. Cobrir as duas vias é obrigatório: o MCP não é uma superfície secundária, é a mesma ação do usuário por outro transporte, e uma trava só no HTTP seria contornável pedindo a importação a uma IA. `bulk_import` é `required: false` com `default: false` no registro — fail-closed, então um Price cujo `metadata` não traga `sogio_bulk_import` deixa o plano sem importação em vez de invalidar a entrada de catálogo inteira. Admin bypassa a trava de acesso nos dois adaptadores, como em qualquer capacidade de acesso; a trava de **limite** (`max_properties`) continua valendo e é aplicada depois, dentro do caso de uso — um plano pode liberar importação e ainda assim rejeitar o lote inteiro por cota.

**Não há BC `import`.** "Importação" não tem agregado — um lote nasce e morre dentro de uma requisição, não tem id, não é persistido — e um BC sem agregado seria um pacote de código com nome de contexto. O mecanismo genérico mora em `core/application/import/` (`SourceRecord`, `ImportFailure`, `ImportReport`, `ImportRejectedError`, `ImportRunner`) e em `core/infra/http/csv/` (o parser incremental); cada BC dono tem o próprio caso de uso importador (`ImportBatchPropertiesUseCase`, `ImportBatchStaysUseCase`, `ImportBatchLedgerEntriesUseCase`), que decide o que é um registro válido daquela entidade e reusa as próprias policies. Nenhuma dependência nova entre BCs nasce daqui: `core` já importava de `auth` e de `billing`, e `core/application/import/` não importa nada de nenhum BC — opera sobre um `AsyncIterable` de registros opacos e um callback.

**Tudo-ou-nada é decisão do usuário, não default técnico.** Uma linha inválida rejeita o lote inteiro e devolve as falhas por linha — nunca "parcialmente importado". Um lote de imóveis que estoura `max_properties` é rejeitado inteiro pelo mesmo `CapabilityLimitPolicy`/`saveNewWithinQuota` do caminho unitário, nunca truncado no limite. O `ImportRunner` implementa isso como **modo escrita → modo coleta**: cada registro do stream é validado e escrito normalmente até a primeira falha; a partir daí o runner para de escrever e passa a só validar e acumular falhas, até o fim do stream ou até bater `MAX_REPORTED_ERRORS`. Ao final, se houve qualquer falha, lança `ImportRejectedError` com o relatório completo; a exceção sai da transação aberta pelo `TransactionRunner` e o Postgres desfaz tudo que a fase de escrita gravou — o rollback é do banco, nunca uma compensação escrita à mão. Uma **falha de linha** vira um `ImportFailure` dentro do relatório 422 (`{ row, field, message }`); uma **falha de lote** (arquivo grande demais, coluna obrigatória ausente, cota de plano estourada) escapa como exceção e usa o mapeamento de erro normal do adaptador. Limitação honesta, que precisa aparecer na resposta (`truncated`) e no `/docs`: o relatório é **completo para falhas de forma** (campo ausente, tipo errado, data ilegível) e **best-effort para falhas de estado** (sobreposição de datas, cota) — uma vez em modo coleta não se escreve mais, então um conflito entre duas linhas ainda não processadas só aparece no reenvio.

**Memória constante é restrição dura, não otimização — a VPS é pequena.** O caso de uso recebe um `AsyncIterable<SourceRecord>` e nunca materializa os registros em array; o único crescimento de memória permitido é a lista de falhas (teto `MAX_REPORTED_ERRORS`) e o cache de propriedades do dono, memoizado num `Map` do lote (teto natural: `max_properties`). No HTTP isso significa `Controller.bodyMode = "stream"`: o adaptador (`BunHttpControllerAdapter`) **nunca** chama `request.text()` nessas três rotas — o corpo chega como `ControllerRequest.bodyStream` e é parseado incrementalmente por `readCsvRecordStream` (`core/infra/http/csv/streaming_csv_reader.ts`), uma máquina de estados sobre `ReadableStream<Uint8Array>` que decide CSV (vírgula, aspas `""`, `\n`/`\r\n`) sem bufferizar o arquivo inteiro. Declarar `bodyMode: "stream"` junto com `inputSchema` derruba o boot — não há objeto de corpo para o schema validar. **XLSX está fora de propósito**: é um ZIP, não existe parse incremental — seria preciso o arquivo inteiro em memória antes de ler a primeira célula, o que violaria a premissa de pico de memória constante. O usuário exporta para CSV.

**Os tetos**: `MAX_IMPORT_ROWS = 1000`, `MAX_REPORTED_ERRORS = 100`, `MAX_IMPORT_BYTES = 5 MB`, `MAX_IMPORT_FIELD_BYTES = 64 KB` (todos em `core/application/import/import_failure.ts` e `core/infra/http/csv/streaming_csv_reader.ts`) e `MAX_MCP_IMPORT_RECORDS = 100` para o array vindo de uma tool MCP. O teto de linhas é detectado **pelo contador**, enquanto se lê — nunca pelo tamanho declarado do arquivo, que o cliente controla — e é o que permite a entrega ser **síncrona**: mil linhas terminam em poucos segundos, dentro do tempo de uma transação aberta e do timeout de uma requisição. Nenhuma infraestrutura assíncrona entra nesta entrega — sem fila de jobs, sem endpoint de polling, sem status de importação. Se o teto se provar baixo na prática, a fila se constrói quando houver dado real, não antes.

**`StayImportedEvent`, e por que não `StayBookedEvent`.** `StayBookedEvent` tem dois handlers hoje, e um deles (`CreateTempPasswordOnBook`) chama a fechadura Tuya por HTTP. Reusá-lo na importação faria uma chamada externa por estadia importada, dentro da transação tudo-ou-nada do lote — um efeito externo, não transacional, não idempotente e não retentável dentro de uma transação que pode ser desfeita, exatamente o que a invariante de DA-13/R-15 (ver exclusão de propriedade, acima) proíbe. `StayImportedEvent` é um evento próprio, com **exatamente um** handler (`RecordRevenueOnStayImported`, em `finance`, que só escreve no ledger reusando a mesma descrição do caminho normal) — trancado por teste no mesmo molde de `event_handler_registration.test.ts`. Consequência aceita: uma estadia futura importada não tem senha provisionada na fechadura; o `entrance_code` é gerado e persistido, então o caminho unitário continua disponível para provisionar depois. Provisionar fechadura em lote é escopo próprio.

**Estadias importadas passam pelas mesmas policies de `booking`, sobreposição incluída — decisão do usuário, sem caminho paralelo de escrita.** `ImportBatchStaysUseCase` chama os mesmos colaboradores do caminho unitário (`BookingProperty.bookStay()`, que aplica capacidade e `BookingPolicy.isBookingAllowed`, e `StayRepository.saveStay()`); o que muda é só o evento anunciado ao final. As checagens de estado enxergam o próprio lote: uma estadia inserida numa linha anterior é visível para a checagem de sobreposição de uma linha seguinte, porque tudo roda dentro da mesma transação via `currentExecutor()` — sem isso, duas estadias sobrepostas entre si no mesmo arquivo seriam ambas aceitas, e o lote se apresentaria como validado sem ser.

**Exclusão de lançamento** (`DELETE /finance/properties/:property_id/movements/:entry_id`, `204`, tool MCP `delete_ledger_entry` com `destructiveHint: true`) é soft delete, e **não é estorno**. `RevertRevenueOnStayCancel` cria um contra-lançamento — uma linha nova, negativada, no ledger append-only — porque afirma um fato: "houve receita e ela foi revertida". A exclusão de lançamento marca `deleted_at` na própria linha porque afirma o oposto: "esse lançamento nunca deveria ter existido", como uma planilha importada duas vezes. Os dois mecanismos coexistem porque significam coisas diferentes, não porque um seja a evolução do outro — usar o errado corrompe o extrato nos dois sentidos. Posse atravessa `PropertyOwnershipPolicy`, como todo caso de uso property-scoped; excluir duas vezes é `404` na segunda, não erro de estado. **Nenhum handler de evento pode chamar a exclusão** — o caminho automático é sempre estorno, a exclusão é sempre um ato explícito do usuário.

**A importação não é idempotente, e isso é exclusão deliberada.** Reenviar um lote já aceito duplica tudo — não há chave externa por linha nesta entrega. A rota de exclusão de lançamento é **remediação, não idempotência**: ela não impede a duplicação, só deixa de tornar uma reimportação de despesas irreparável pelo produto. Para uma planilha de centenas de linhas duplicadas, apagar uma a uma pela listagem de movimentações é trabalho manual real; a única defesa continua sendo não reenviar um lote que já foi aceito.

**Uma data pura vira um instante no horário da propriedade, e essa conversão existe uma vez só.** `check_in`, `check_out` e `occurred_at` chegam como data de calendário (`YYYY-MM-DD` ou `DD/MM/YYYY`) — o contrato de entrada não mudou. Data de calendário não aponta para instante nenhum sozinha: transformá-la em um exige uma hora de parede e um fuso, e antes o código escolhia sozinho — meia-noite UTC no importador de estadias, meia-noite local do servidor no de lançamentos —, devolvendo a data **um dia antes** para quem lê no fuso de São Paulo (issue #59). Hoje `CalendarDate.atWallClock(time, timeZone)` (`core/domain/calendar/`) é a porta única, e nenhum importador volta a construir `new Date(...)` a partir de uma data importada. A hora vem da propriedade: as chaves `check_in_time` e `check_out_time` de `property_settings` (`"HH:MM"`), resolvidas por `PropertyCheckTimesService` — o OHS de `property_management`, no molde de `EntitlementService` — com default `14:00`/`11:00` quando a chave está ausente **ou ilegível**, caindo no padrão com `warn` em vez de lançar (mesmo idioma de `CapabilitySet.of()`, I-4). Um lançamento não tem check-in: ele ancora no **início do dia**. O fuso é o do dono, e nos dois importadores ele já está em mãos (`execute(input, user)`, com a posse do imóvel já provada) — `DisplayPreferencesService` continua sendo o caminho de quem só tem `property_id`, como `StayLedgerPreferences`. O horário do imóvel é resolvido **uma vez por lote**, memoizado ao lado do cache de propriedades (teto: `max_properties`, IM-1 intacta). Consequência que passa a ser regra e não coincidência: `10/07→15/07` e `15/07→20/07` não colidem porque `11:00 < 14:00`, e um imóvel com `check_in_time: "09:00"` e `check_out_time: "18:00"` **rejeita** a mesma virada de dia — os dois casos estão travados por teste (`tests/booking/import_stays_calendar_dates.test.ts`). A independência de fuso do processo é **provada**, não presumida: os testes rodam a mesma importação com `process.env.TZ` em UTC, `America/Sao_Paulo` e `Asia/Tokyo` e exigem o mesmo instante gravado — fixar o fuso da suíte esconderia justamente o defeito que se quer travar. Linhas já importadas **não são migradas**.

**As três rotas de importação e a de exclusão têm tools MCP correspondentes**, registradas nos dois pontos de sempre (`make<X>Tool()` no Di do BC, array `tools` de `makeMcpRequestHandler`), sobre as mesmas instâncias de DI que o HTTP usa. As tools recebem `{ records: [...] }`, um array estruturado, porque uma IA não sobe arquivo — o adaptador de stream para o array é um `async function*` trivial sobre ele, e as tools chegam no **mesmo contrato de stream** dos controllers HTTP: o caso de uso não sabe de onde os registros vieram. O layout de cada CSV vive no `openApiSpec` de cada rota, como `requestBody` `text/csv` com exemplo de cabeçalho + linha; **não há endpoint de template** — um arquivo estático sem regra de negócio divergiria do schema que valida, o exemplo no spec não.

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
