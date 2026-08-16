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

Cada módulo de negócio (`auth`, `booking`, `property_management`, `finance`, `billing`) possui quatro camadas:

```
src/[modulo]/
├── domain/         # Entidades, interfaces de repositório, value objects, eventos, policies
├── application/    # Use cases, serviços, DTOs, event handlers
├── infra/          # Repositórios Drizzle, container DI, integrações externas
└── presentation/   # Controllers HTTP
```

O módulo `src/core/` provê infraestrutura compartilhada: tipo base de entidade, erros customizados, interface `UseCase`, roteamento HTTP, configuração do DI e setup do banco.

### Padrões Principais

**Entidades** usam um campo privado `#data` com schema Zod. Dois factories estáticos: `create()` para objetos novos, `reconstitute()` para carregar do banco. Getters expõem dados como read-only. Toda entidade estende `BaseEntity` com `id`, `created_at`, `updated_at`, `deleted_at`.

**Use Cases** implementam `UseCase<Input, Output>`. Dependências injetadas via construtor. `execute(input, user)` retorna um DTO (nunca uma entidade bruta). Lançam erros tipados (`ConflictError`, `ResourceNotFoundError`, etc.).

**Controllers** implementam `Controller` (`path`, `method`, `handle()`). Validam input com Zod (lançam `ValidationError` em caso de falha). Retornam um DTO — o adaptador HTTP serializa para JSON.

**Containers DI** — cada módulo tem uma classe `[Module]Di` (`AuthDi`, `StayDi`, `PropertyDi`, `FinanceDi`). Factory methods nomeados `make[Componente]` montam as dependências. Instâncias criadas uma única vez em `routes.ts`.

**Tratamento de Erros** — use cases lançam erros tipados; o adaptador HTTP mapeia os nomes de erro para status codes: `ValidationError` → 422, `ConflictError` → 409, `ResourceNotFoundError` → 404, `UnauthorizedError` → 401, `IllegalStateError` → 500.

**Exclusão de propriedade** (`DELETE /property/:property_id`) é soft delete — só marca `Property.deleted_at`, sem cascata sobre estadias, `LedgerEntry`, `PropertySetting` ou `ExternalBookingSource`, que continuam no banco e só deixam de ser servidos. `PropertyOwnershipPolicy` é o portão único de posse+`deleted_at` para todo use case property-scoped nos BCs `property_management`, `booking` e `finance` — nunca duplicar essa checagem inline. `PropertyPostgresRepository.propertyOfId` deliberadamente **não** filtra `deleted_at`: ele sustenta a decisão INSERT-vs-UPDATE de `save()`, e filtrar ali faria a própria escrita do soft delete falhar com 500. Uma propriedade com estadia futura ou em andamento não pode ser excluída (409) — a checagem atravessa para `booking` por uma porta (`PropertyOccupancy`) declarada em `property_management` e implementada em `booking`, preservando a direção de dependência `booking → property_management`.

**Autenticação** — JWT Bearer tokens. `SessionManager` cria/valida tokens. O middleware de auth extrai o usuário e o repassa ao controller. Rotas declaram `authenticated: boolean` em `routes.ts`.

**Superfície MCP obrigatória** — todo caso de uso ou endpoint novo nasce com a **tool MCP correspondente, na mesma entrega**. O produto tem que funcionar independente de UI: o backend concentra as regras de negócio e uma IA conectada ao `/mcp` deve conseguir executar todas as ações do sistema. As tools ficam em `src/core/infra/mcp/tools/` e são registradas em três pontos (barrel `tools/index.ts`, imports de `mcp/routes.ts` e o array `tools` de `makeMcpRequestHandler`), sempre sobre as **mesmas instâncias de DI** que o HTTP usa. Únicas exceções: material de credencial (cadastro, login, troca e recuperação de senha), o próprio protocolo OAuth que emite o token do `/mcp` e seus documentos de descoberta, webhooks de terceiros, links públicos não autenticados, exclusão de conta por LGPD, sessões de pagamento que devolvem URL para um humano abrir, e rotas de operação (`/health`, `/docs`). Toda exceção usada precisa estar registrada no plano da entrega.

### Bounded Context `billing`

Modelo de monetização SaaS: cada `User` tem exatamente uma `Subscription`, vinculada a um `Plan` do catálogo (`free` ou `pro`, semeados via `bun run db:seed`). O **entitlement** (acesso à plataforma + `max_properties`) é sempre **derivado** de `Subscription` + `Plan` no momento da leitura (`SubscriptionAccessPolicy`), nunca uma coluna persistida — não há scheduler no projeto para expirar períodos automaticamente. `EntitlementService` (`billing/application/service/`) é o Open Host Service que `core/infra/http`, `core/infra/mcp` e `property_management` consomem via interface, nunca a infraestrutura de `billing` diretamente.

O acesso é bloqueado (fail-closed) em toda rota `authenticated: true` e em `/mcp`, exceto as rotas marcadas com `allowWithoutPlatformAccess: true` em `routes.ts` (conta própria, exclusão LGPD, higiene de apps conectados, decisão OAuth, checkout e portal de cobrança) — uma conta sem `Subscription` fica bloqueada até intervenção manual. Referências externas são strings opacas anuláveis (`external_reference`, `external_customer_reference`, `external_price_reference`); só `billing/infra/gateway/` conhece o nome do fornecedor (Stripe) — `domain` e `application` só conhecem "gateway".

Todo evento relevante do ciclo de vida da assinatura (`SubscriptionStartedEvent`, `SubscriptionPlanChangedEvent`, `SubscriptionPaymentFailedEvent`, `SubscriptionCanceledEvent`, `SubscriptionRenewedEvent`) alimenta o **Histórico da Assinatura**: um registro append-only (`SubscriptionHistoryEntry`, um agregado próprio — não faz parte de `Subscription`) exposto ao próprio usuário via `GET /billing/subscription/history` (paginado, `allowWithoutPlatformAccess: true`). O escritor único é `RecordSubscriptionHistoryEntryUseCase`, que captura e loga qualquer falha de escrita em vez de propagá-la — uma falha ao gravar auditoria nunca pode derrubar cadastro de usuário ou troca de plano, que já foram confirmados quando o handler roda. `SubscriptionPlanChangedEvent` é o único evento de troca de plano (substitui o antigo `SubscriptionActivatedEvent`, removido): carrega `opens_paid_cycle`, derivado dentro do agregado `Subscription` (`has_paid_cycle`), que é o fato que um futuro `finance` usa para reconhecer receita sem recarregar o `Plan`. `SubscriptionRenewedEvent` cobre um novo ciclo pago abrindo sem troca de plano.

#### Integração com o gateway de pagamento

`billing` cobra de verdade através de três caminhos: **Checkout** hospedado (`POST /billing/checkout-session`) para a primeira assinatura, **Customer Portal** hospedado (`POST /billing/portal-session`) para tudo depois dela, e um **webhook** (`POST /billing/webhooks/stripe`, `authenticated: false`) para manter o estado local sincronizado. O gateway é a fonte de verdade sobre dinheiro e período de cobrança; `billing` continua sendo a fonte de verdade sobre entitlement. As duas rotas de pagamento têm `allowWithoutPlatformAccess: true` — uma conta bloqueada precisa conseguir pagar para se desbloquear.

A verificação da assinatura `Stripe-Signature` acontece **dentro** de `ProcessGatewayWebhookUseCase`, nunca no controller — não existe (nem pode existir) um caminho que invoque as transições de domínio com um evento não verificado, e não existe bypass "só em dev". Reentrega do mesmo evento é absorvida por uma tabela de idempotência (`processed_gateway_events`, `external_event_id` único: `claim` antes de processar, `release` só no caminho de falha). Um evento mais antigo que `Subscription.external_event_at` é descartado — defesa contra reentrega fora de ordem.

As transições dirigidas por webhook (`activate`, `changePlan`, `startTrialUntil`, `markPastDue`, `cancel`) são idempotentes: reentrada no mesmo estado nunca lança `ConflictError` — um `ConflictError` escapando do caminho do webhook é sempre um bug, porque vira um loop de retentativa do Stripe até o endpoint ser desativado. `markPastDue` tolera `active`/`trialing`/`past_due` e ancora `grace_period_ends_at` na primeira falha; `cancel` já cancelada é um no-op silencioso. `SubscribeToPlanUseCase` foi renomeado para `GrantPlanUseCase` (concede plano sem cobrar — mecanismo interno, sem rota) e `CancelSubscriptionUseCase` passou a receber `{ user_id }` em vez de `User`, para que ambos possam ser reusados pelo orquestrador do webhook.

O catálogo (`price_id` do Stripe) é sincronizado manualmente: a variável opcional `STRIPE_PRO_PRICE_ID` faz `seedPlans()` fazer upsert de `external_price_reference` no plano `pro` a cada execução.

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
- `STRIPE_PRO_PRICE_ID` — `price_id` do Stripe para o plano Pro; opcional. Quando presente, `seedPlans()` faz upsert desse valor em `plans.external_price_reference`

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
