# POST /waitlist — endpoint público de lista de espera

## Context

A landing page (`https://www.sogio.app`) tem um formulário de lista de espera que já está pronto no
front, mas não tem para onde postar. O contrato de entrada foi derivado do código do cliente e está
no artifact "POST /waitlist" (29 ago 2026).

Este é o **único endpoint público de escrita do produto**: quem chama é um visitante anônimo, sem
sessão, direto do navegador. Nada disso existe hoje no repositório — `grep` por `waitlist`, `lead`,
`marketing` e `landing` em `src/**` e `*.md` não retorna nada.

Resultado esperado: o formulário grava o lead e a pessoa vê a tela de sucesso.

## Personas

- **Arquiteto** (`opus`) — já consultado neste planejamento (BC novo, agregado, invariantes).
- **Desenvolvedor** (`sonnet`) — implementa as tasks.
- **Analista de Segurança** (`opus`) — revisão final obrigatória: rota pública de escrita + dado
  pessoal sob LGPD.

## Decisões já tomadas com o usuário

| Pergunta                  | Decisão                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| Corpo do `201`            | Só `{ "id": "<uuid>" }`. Sem `position` — não vaza o tamanho da base. |
| Rota de leitura dos leads | Nenhuma nesta entrega. Leitura é `SELECT` direto no Postgres.         |
| Nome do bounded context   | `marketing` (`src/marketing/`).                                       |

## Decisões arquiteturais

**BC novo `marketing`, com agregado próprio `WaitlistLead`.** O lead é persistido, tem id e chave
natural (o WhatsApp normalizado) — é agregado de verdade, não um lote efêmero como um import. Não
cabe em `auth` (não é identidade, não tem senha, não vira `User`) nem em `backoffice` (não é
configuração da aplicação).

**CORS: `corsPolicy: "public"` no controller, não uma entrada nova em `CORS_ALLOWED_ORIGINS`.**
`CorsMiddleware.handlePreflightRequest` responde **403** quando a origem não está na allowlist
(`src/core/presentation/middleware/cors.middleware.ts:41-46`) — e o contrato proíbe 403. Além disso,
a allowlist é a lista de origens que ganham `Access-Control-Allow-Credentials: true`; a landing não
precisa disso e não deveria entrar lá. `corsPolicy: "public"` já existe para exatamente este caso
(discovery docs OAuth e `/mcp`): `Allow-Origin: *`, sem credenciais, preflight sempre 200 — e
funciona nas URLs de preview da Vercel sem mexer em env.

**Sem tool MCP — exceção documentada.** `CLAUDE.md` isenta "links públicos não autenticados". Não há
usuário logado a quem escopar a ação; uma IA no `/mcp` age em nome de um usuário, e um visitante
anônimo não é um.

**Idempotência por WhatsApp em uma única escrita atômica.** O contrato exige `201` quando o número já
existe, atualizando nome e faixa. Um `leadOfWhatsapp()` seguido de `save()` perde a corrida no
duplo-clique (dois POSTs simultâneos → violação de unique → 500). O repositório faz
`insert(...).onConflictDoUpdate({ target: whatsapp })` e devolve o `id` persistido — uma ida ao
banco, sem transação, sem corrida. `consented_at` fica **fora** do `set`: a data do primeiro
consentimento não é sobrescrita.

**`property_count` é `varchar` + `z.enum` no domínio, não `pgEnum`.** É uma faixa comercial de
marketing e vai mudar mais que um enum de domínio; um `pgEnum` transformaria "trocar as faixas do
formulário" em migration de tipo Postgres.

**Normalização do WhatsApp mora na entidade**, como método estático privado — mesmo padrão de
`ExternalBookingSource.#normalizePlatformName`. O repositório não tem VO de telefone e o projeto não
tem precedente de criar um (`Tenant.phone` também valida inline).

## Mapped Changes

**Schema e migration**

- `src/core/infra/database/drizzle/schemas/marketing_schemas.ts` _(novo)_ — tabela `waitlist_leads`:
  `...baseSchema`, `name varchar(255) notNull`, `whatsapp varchar(15) notNull unique`,
  `property_count varchar(10) notNull`, `source varchar(50) notNull`,
  `consented_at timestamp(withTimezone, mode:"date") notNull`.
- `src/core/infra/database/drizzle/schemas/../schema.ts` (`src/core/infra/database/drizzle/schema.ts`)
  — acrescentar `export * from "./schemas/marketing_schemas";`.
- `drizzle/NNNN_*.sql` + `drizzle/meta/` — gerados por `bun run db:migration`, não escritos à mão.

**Domain — `src/marketing/domain/`**

- `entity/waitlist_lead.ts` _(novo)_ — `waitlistLeadSchema = baseEntitySchema.extend({...})` com
  `name: z.string().trim().min(2).max(255)`, `whatsapp: z.string().regex(/^\d{10,11}$/)`,
  `property_count: z.enum(["1", "2-3", "4-10", "10+"])`, `source: z.string().max(50)`,
  `consented_at: z.date()`. `create()` / `reconstitute()` / getters, campo `#data`, estende
  `BaseEntity`. `#normalizeWhatsapp` remove tudo que não é dígito **antes** do `regex` — assim
  `(11) 98765-4321` passa e 9 ou 12 dígitos caem em `422`. `#normalizeSource` faz `trim` +
  `toLowerCase`, default `"landing"`.
- `repository/waitlist_lead_repository.ts` _(novo)_ — `interface WaitlistLeadRepository { joinWaitlist(lead: WaitlistLead): Promise<string> }`.
  O nome diz o comando (grava-ou-atualiza-e-devolve-o-id), no idioma de `saveNewWithinQuota`.

**Application — `src/marketing/application/`**

- `use_case/join_waitlist.ts` _(novo)_ — `JoinWaitlistUseCase implements UseCase<Input, Output>`.
  `Input = { name; whatsapp; property_count; source? }`, `Output = { id: string }`.
  Monta `WaitlistLead.create({ ..., consented_at: new Date() })` e devolve o id que
  `joinWaitlist()` retornou (na atualização é o id **antigo**, não o gerado pelo `create`).
  **Não recebe `User`** — assinatura de `UseCase` aceita `user` opcional no caminho público.
  Um `ZodError` do `create()` é convertido em `ValidationError` → `422` com `{ message }`.

**Infra — `src/marketing/infra/`**

- `database/postgres_repository/waitlist_lead_postgres_repository.ts` _(novo)_ — o upsert descrito
  acima, com `.returning({ id: waitlistLeadsTable.id })`.
- `di/marketing_di.ts` _(novo)_ — `MarketingDi` no molde de `BackofficeDi`:
  `makeJoinWaitlistUseCase()` e `makeJoinWaitlistController()`.

**Presentation — `src/marketing/presentation/`**

- `controller/join_waitlist.controller.ts` _(novo)_:
  ```ts
  path = "/waitlist";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;
  parameterSource = "json" as const;
  corsPolicy = "public" as const;
  rateLimitPolicy = { keyDimension: "peer-ip", windowMs: 10 * 60 * 1000, maxAttempts: 5 };
  openApiSpec = { tags: ["Marketing"], requestBody: bodyFromZod(...), responses: { "201": ..., "422": validationErrorResponse(), "429": errorResponse(...) } };
  ```
  `handle()` devolve um `ControllerHttpResponse({ status: 201, body: { id } })` — o retorno solto do
  adapter é `200`, e o contrato pede `201`.
- **Sem** `mcp_tool/` — ver "Decisões arquiteturais".

**Rotas**

- `src/core/infra/http/routes/routes.ts` — `import { MarketingDi }`, `const marketingDi = new MarketingDi();`,
  `const marketingControllers: Route[] = [{ authenticated: false, controller: marketingDi.makeJoinWaitlistController() }];`
  e incluir `marketingControllers` no array `controllers`. O handler `OPTIONS` é registrado
  automaticamente pelo loop que monta o `routeMap`.

**Testes**

- `tests/marketing/join_waitlist.test.ts` _(novo)_ — `truncate(["waitlist_leads"])` no `beforeEach`
  (o helper já chama `resetSharedRateLimiter()`, então o teste de `429` não contamina os outros).

## Reuso — nada disto é escrito de novo

- `baseSchema` / `baseEntitySchema` / `WithoutBaseEntity` — `src/core/domain/entity/base_entity.ts`.
- `UseCase<I, O>` — `src/core/application/use_case/use_case.ts`.
- `Controller`, `ControllerRequest`, `ControllerHttpResponse` — `src/core/presentation/controller/controller.ts`.
- `RateLimitPolicy` — `src/core/application/rate_limit/rate_limit_policy.ts`; a aplicação é
  automática no `BunHttpControllerAdapter`, **antes** do parse do corpo.
- `ValidationError` → `422 { message }` — `errorCodeMap` em
  `src/core/infra/http/adapters/http_controller_adapter.ts:235`.
- `bodyFromZod`, `responseFromZod`, `errorResponse`, `validationErrorResponse` —
  `src/core/infra/http/swagger/schema_helpers.ts`.
- `api()` e `truncate()` — `tests/helpers/server.ts` e `tests/helpers/database.ts`.
- Padrão de entidade com normalização: `src/booking/domain/entity/external_booking_source.ts`.
- Padrão de Di mínimo: `src/backoffice/infra/di/backoffice_di.ts`.

## Regras de lint que este código precisa satisfazer

- `sogio/zod-string-max` — toda `z.string()` precisa de `.max()`.
- `sogio/zod-format-shorthand` — `z.uuid()`, nunca `z.string().uuid()`.
- Arquivos em `snake_case.ts`, classes em `PascalCase`, campos privados com `#`.
- Sem comentários no código, salvo se pedidos.

## Tasks

1. **Schema e migration** — criar `marketing_schemas.ts`, exportar no barrel `schema.ts`, rodar
   `bun run db:migration` e conferir o SQL gerado.
   - Dependências: nenhuma
2. **Domain** — `WaitlistLead` + `WaitlistLeadRepository`.
   - Dependências: nenhuma
3. **Repositório Postgres** — o upsert `onConflictDoUpdate` com `.returning()`.
   - Dependências: tasks 1, 2
4. **Use case** — `JoinWaitlistUseCase`.
   - Dependências: task 2
5. **Controller + Di + rota** — `JoinWaitlistController`, `MarketingDi`, entrada em `routes.ts`.
   - Dependências: tasks 3, 4
6. **Testes** — `tests/marketing/join_waitlist.test.ts`, cobrindo a lista de aceite do contrato.
   - Dependências: task 5
7. **Documentar em `CLAUDE.md`** — uma seção curta sobre o BC `marketing` e o registro da exceção de
   MCP (link público não autenticado).
   - Dependências: task 5

> Tasks 1, 2 e 4 podem rodar em paralelo. 3 depende de 1 e 2.

## Verification

Lista de aceite do contrato, traduzida em teste (`tests/marketing/join_waitlist.test.ts`):

| Cenário                                                 | Esperado                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| POST válido sem cabeçalho de autenticação               | `201`, corpo `{ id: <uuid string> }`                                                  |
| POST válido **com** `Authorization: Bearer lixo`        | `201`, header ignorado                                                                |
| Mesmo WhatsApp duas vezes, nome e faixa diferentes      | `201` nas duas, 1 linha no banco, nome e faixa atualizados, `consented_at` inalterado |
| `whatsapp` com 9 ou 12 dígitos                          | `422` com `{ message }`                                                               |
| `whatsapp` mascarado `"(11) 98765-4321"`                | `201`, gravado como `11987654321`                                                     |
| `property_count: "5"`                                   | `422` com `{ message }`                                                               |
| Corpo vazio                                             | `422` com `{ message }`                                                               |
| `source` ausente                                        | `201`, gravado como `"landing"`                                                       |
| `OPTIONS /waitlist` com `Origin: https://www.sogio.app` | `200` + `Access-Control-Allow-Origin: *`                                              |
| 6ª requisição do mesmo IP em 10 min                     | `429` + header `Retry-After`                                                          |
| Nenhum cenário de entrada                               | nunca `401`, nunca `403`                                                              |

Comandos:

```bash
bun run test
bun run lint:check
bun run format:check
```

Teste manual, com o servidor em `bun run dev`:

```bash
curl -i -X POST "http://localhost:4000/waitlist" \
  -H "Content-Type: application/json" \
  -H "Origin: https://www.sogio.app" \
  -d '{"name":"Maria Silva","whatsapp":"11987654321","property_count":"2-3","source":"landing"}'
```

## Limitação conhecida, aceita

O corpo do `429` é `{ "error": "rate_limited" }`, não `{ "message": ... }` — é o formato global de
`buildRateLimitedResponse` (`http_controller_adapter.ts:295`), compartilhado por todas as rotas com
rate limit. O contrato pede `message`, mas também diz que a landing exibe uma mensagem genérica em
qualquer falha. Mudar o formato mexeria em toda rota limitada do projeto; fica fora desta entrega.

## Depois do merge — passos de operação

1. `bun run db:migrate` no ambiente de produção.
2. Nada a fazer em `CORS_ALLOWED_ORIGINS`: `corsPolicy: "public"` é por rota.
3. LGPD — apagar um lead a pedido é, por ora, `UPDATE waitlist_leads SET deleted_at = now() WHERE
whatsapp = '...'` direto no banco. Uma rota administrativa para isso é escopo próprio.

## Fluxo de branch

```bash
git fetch origin
git worktree add .claude/worktrees/waitlist-endpoint -b waitlist-endpoint origin/main
git merge --ff-only origin/main
cd .claude/worktrees/waitlist-endpoint && cp ../../../.env.test .env.test && bun install
```

Commits e `gh pr create` a partir da worktree; ao final `git worktree remove` + `bun run db:prune:test`.

> Ao aprovar, copiar este arquivo para
> `.claude/plans/2026-08-29-endpoint-publico-de-lista-de-espera.md` (regra `mapping-requires-plan.md`).
