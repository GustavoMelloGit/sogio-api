# Capacidades por plano

## Objective

Criar um conceito genérico de **capacidade de plano** — o que cada plano permite ou limita — para que novas travas comerciais entrem no produto declarando um dado, não escrevendo um mecanismo novo. Hoje existe exatamente uma trava por plano (`max_properties`, uma coluna dedicada consultada num único use case) e nenhuma forma de expressar "esse caso de uso é só do Pro". A entrega absorve `max_properties` no mecanismo novo, para que ele nasça validado contra o único consumidor real em produção em vez de especulativo.

## Personas

- **Arquiteto** (`arquiteto.md`, opus) — dono desta análise; define linguagem ubíqua, invariantes I-4/I-5 e onde cada checagem vive.
- **Desenvolvedor** (`desenvolvedor.md`, sonnet) — implementa as tasks; várias rodam em paralelo (ver dependências).
- **Analista de Segurança** (`analista_seguranca.md`, opus) — revisão final obrigatória. Foco declarado: a trava é fail-open por construção (ver Decisão 3), então o risco é entregar recurso pago de graça, não bloquear indevidamente.

## Decisões arquiteturais

### D-1 — Linguagem ubíqua

| Termo                                              | Significado                                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capacidade** (`Capability`)                      | Uma alavanca comercial: algo que um plano permite ou limita. Identificada por uma chave estável.                                                   |
| **Capacidade de acesso** (`access`)                | Booleana. Tem ou não tem. Cobre o caso 1 do pedido ("ter ou não acesso a um caso de uso").                                                         |
| **Capacidade de limite** (`limit`)                 | Numérica. Tem, até um teto. Cobre o caso 2 ("acesso, mas limitado"). `max_properties` é a primeira.                                                |
| **Registro de capacidades** (`CapabilityRegistry`) | A declaração **em código** de quais capacidades existem: chave, tipo, valor padrão, se é obrigatória no gateway, rótulo humano, chave de metadata. |
| **Conjunto de capacidades** (`CapabilitySet`)      | Os valores já resolvidos para uma assinatura concreta. Vive dentro do `Entitlement`, ao lado de `has_platform_access`.                             |

Deliberadamente **não** se chama "feature flag". Uma capacidade existe porque o negócio cobraria por ela. Se a resposta para "eu venderia isso separado?" for não, é feature flag e não entra no registro — senão o `billing` vira o catálogo de todas as funcionalidades do produto e passa a ser tocado por toda entrega.

### D-2 — Registro em código, valores no gateway

O **conjunto de capacidades que existem** é código: uma capacidade só existe porque algum use case a consulta, e isso é um deploy de qualquer forma. O **valor de cada uma por plano** vem do metadata do Price, igual `max_properties` e `trial_days` hoje. Mudar o que o Pro libera continua sendo mexer no dashboard, sem deploy.

Cada entrada do registro declara sua própria `metadata_key`. Consequência deliberada: **`sogio_max_properties` permanece com o nome que já está no dashboard do Stripe em produção** — a chave interna (`max_properties`) e a chave de metadata são coisas separadas. Renomear para `sogio_cap_max_properties` exigiria editar o dashboard antes do deploy, e a janela entre os dois deixaria a capacidade obrigatória ausente, invalidando a entrada de catálogo inteira (o parser hoje descarta a entrada toda nesse caso).

### D-3 — Ausência usa o padrão do registro, não bloqueia

I-3 já vale para planos ("ausência nunca aposenta"). Esta entrega estende a mesma ideia para capacidades: um Price que não declara uma capacidade recebe o **valor padrão declarado no registro**, não "não tem".

Isso é uma escolha consciente de degradar aberto.

> **Correção pós-revisão de segurança.** A justificativa original desta decisão era falsa e foi reescrita. Ela dizia: "a reconciliação de catálogo do boot é não-fatal, e sob fail-closed uma falha de rede no boot escureceria o produto para todos os pagantes de uma vez". **Essa reconciliação de boot não existe** — foi removida em `30592e8 refactor: drop boot-time catalog reconciliation`. O Arquiteto a leu numa linha desatualizada do `CLAUDE.md` (desatualizada desde aquele commit) e não conferiu contra `src/index.ts`. Hoje a reconciliação só roda por ação deliberada de um admin em `POST /billing/catalog/sync`, com alguém olhando o resultado. A decisão de degradar aberto **permanece**, pelo motivo abaixo; o cenário que a autorizava não.

O motivo real é a assimetria dos erros. `required: true` já cobre o que não pode faltar — é por isso que `max_properties` invalida a entrada inteira quando ausente. O fail-open governa portanto apenas capacidade que o dashboard **ainda não declarou**: negá-la puniria todo assinante por um campo que ninguém preencheu, enquanto concedê-la entrega recurso de graça até alguém notar. O primeiro é quebra de produto para quem paga; o segundo é receita perdida e recuperável.

Isso só se sustenta enquanto o fail-open for **visível**. Dois logs sustentam a decisão, e remover qualquer um deles a invalida: um `warn` por entrada de catálogo aceita no parser (batelado, listando as chaves que caíram no padrão, emitido só depois de todas as validações), e o `warn` de `SyncPlanCatalogEntryUseCase` alimentado por `CapabilitySet.fallbacks` no caminho de escrita.

Exceção declarada por capacidade: o registro tem um campo `required`. `required: true` significa que a ausência **invalida a entrada de catálogo inteira**, exatamente como `sogio_max_properties` se comporta hoje. `max_properties` nasce `required: true` — assim o comportamento atual é preservado ao pé da letra, e um Price de Pro com a chave digitada errada continua sendo rejeitado em vez de virar silenciosamente um plano de 1 imóvel.

### D-4 — Variação qualitativa se modela como várias booleanas

O pedido cita "a feature ser limitada/diferente entre planos". "Limitada" é a capacidade de limite. "Diferente" (ex.: Free exporta CSV, Pro exporta CSV e PDF) se modela como **duas capacidades de acesso** (`export_csv`, `export_pdf`), não como um terceiro tipo com valor de conjunto/enum.

Motivo: um tipo de conjunto exige inventar um formato de serialização em metadata (lista separada por vírgula? JSON dentro de string?) e um vocabulário de valores válidos por capacidade, antes de existir um único caso real que precise disso. Duas booleanas compõem, são triviais de parsear e de exibir na página de preços. Se um dia aparecer uma capacidade com dez variantes mutuamente exclusivas, aí sim se adiciona o terceiro tipo — com um caso concreto na mão.

### D-5 — Duas formas de aplicar, porque são dois problemas

O projeto já tem os dois padrões e eles não são intercambiáveis:

- **Capacidade de acesso → declarativa, no adaptador.** A rota declara `requiredCapability` em `routes.ts` e o `BunHttpControllerAdapter` aplica, no mesmo lugar onde já aplica o portão de platform access. A tool MCP declara o mesmo campo em `McpToolDefinition` e o dispatch aplica. O use case não sabe que a trava existe.
- **Capacidade de limite → imperativa, no use case.** Só o use case sabe quantos itens já existem e o que está sendo consumido. É o que `CreatePropertyUseCase` já faz, dentro da transação de contagem de `saveNewWithinQuota` — e essa atomicidade não pode ser perdida.

Tentar unificar as duas num mecanismo só significaria ou levar contagem de recursos para o adaptador, ou levar decisão de rota para dentro do domínio. Nenhum dos dois se sustenta.

### D-6 — Uma única resolução de entitlement por requisição

O portão de platform access já faz um `entitlementOf(user.id)` por requisição autenticada. A checagem de capacidade **reusa esse mesmo objeto** — não pode virar uma segunda ida ao banco. No adaptador HTTP isso significa resolver o entitlement uma vez e usá-lo nas duas checagens; hoje a resolução está dentro do `if` do portão de acesso e precisa sair dele quando a rota declara `requiredCapability`.

Corolário: `requiredCapability` e `allowWithoutPlatformAccess` são ortogonais, mas combiná-los é quase certamente um erro de configuração — uma rota alcançável por conta bloqueada não deveria depender de capacidade. A combinação não é proibida em código; fica registrada aqui como cheiro a ser questionado em revisão.

### D-7 — Persistência em `jsonb`, validação permissiva na leitura

`plans` ganha uma coluna `capabilities jsonb NOT NULL DEFAULT '{}'` e perde `max_properties`. Não é uma tabela relacional `plan_capabilities` porque o conjunto é sempre lido inteiro junto com o plano (nunca se consulta "quais planos têm a capacidade X") e uma tabela adicionaria um join em toda resolução de entitlement, que roda em **toda requisição autenticada**.

O schema Zod do `Plan` valida `capabilities` de forma **permissiva**: chave desconhecida é aceita e ignorada, não rejeitada. Um schema estrito aqui transformaria "remover uma capacidade do código" numa quebra de produção — todo plano no banco ainda carregaria a chave antiga e `reconstitute()` passaria a lançar. Quem filtra e tipa é o registro, no momento da resolução.

### D-9 — Acessor errado é erro de programação, não silêncio

`CapabilitySet` expõe `allows()` e `limitOf()`. Os dois consultam o `kind` da entrada no registro e lançam `IllegalStateError` quando o acessor não bate — `allows()` numa capacidade de limite, ou `limitOf()` numa de acesso. Sem essa guarda, `allows("max_properties")` devolveria `Boolean(1) === true` e `limitOf()` de uma booleana devolveria `Number(true) === 1`: errado nos dois sentidos, e silenciosamente.

A guarda é de **runtime**, não de tipos. Separar `CapabilityKey` em uniões por `kind` faria `AccessCapabilityKey` ser `never` enquanto não existir nenhuma capacidade de acesso, o que tornaria a trava declarativa das tasks 7 e 8 indeclarável. Quando a primeira capacidade de acesso real entrar, vale reavaliar a separação em tipos.

### D-8 — O conjunto vazio não é o conjunto padrão

`SubscriptionAccessPolicy` tem dois caminhos que precisam de atenção cirúrgica:

- **`#noSubscription()`** hoje devolve `max_properties: 0`. Com capacidades ele precisa devolver um **conjunto vazio explícito** (toda booleana `false`, todo limite `0`) — e isso **não** é o mesmo que os padrões do registro, que são os valores do nível gratuito. Usar os padrões aqui daria a uma conta sem assinatura o mesmo poder de uma conta Free.
- **`#resolveCanceled()`** hoje cai para `freePlan.max_properties` depois do fim do período. Precisa cair para o **conjunto de capacidades inteiro do plano `free`**, não só para o limite de imóveis.

## Riscos e questionamentos

| Risco                                                                                                           | Mitigação                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| O registro vira o catálogo de todas as funcionalidades do produto, e `billing` passa a ser tocado toda entrega. | Critério escrito em D-1 e replicado em `CLAUDE.md`: capacidade é alavanca comercial, não feature flag.                                               |
| Fail-open entrega recurso pago de graça sem ninguém notar.                                                      | Log em nível `warn` toda vez que uma capacidade cai no padrão por ausência no gateway. Item explícito para o Analista de Segurança.                  |
| Migration derruba a coluna e um processo antigo em execução quebra.                                             | Deploy é instância única atrás de nginx; a janela é o restart. Alternativa expand/contract (duas entregas) fica registrada como opção se isso mudar. |
| `GET /billing/subscription/status` deixa de expor `max_properties` no topo e quebra o frontend.                 | **Coordenação cross-repo necessária.** Ver Task 10 — o frontend precisa passar a ler `capabilities.max_properties`.                                  |
| A IA no `/mcp` recebe "seu plano não cobre isso" e não tem como dizer qual plano cobre.                         | Task 11 cria a tool MCP de status da assinatura, que hoje não existe apesar de ser um caso de uso de escopo de usuário.                              |

## Registrado para depois (revisão de segurança)

Achados aceitos e **não** corrigidos nesta entrega. Cada um tem a decisão registrada aqui em vez de virar dívida silenciosa:

- **Migration sem caminho de volta.** `0011` faz add + backfill + drop num passo. A aplicação é atômica, mas não há down migration: um rollback do binário contra o schema novo faz `planSchema.parse` lançar em toda resolução de entitlement — 500 em toda rota autenticada e no `/mcp`. Se for preciso, a recuperação é forward-only: recriar a coluna com `COALESCE((capabilities->>'max_properties')::int, 1)`.
- **Piso global de capacidade de limite.** `MIN_LIMIT_CAPABILITY_VALUE = 1` foi herdado literalmente de `max_properties` e virou global. Impede expressar "o plano Free tem 0 de X" — e a tentativa não devolve 0, rejeita a entrada de catálogo inteira. É a única parte fail-closed do mecanismo. A segunda capacidade de limite que precisar de faixa própria força mover `min`/`max` para o registro.
- **`export_reports` sem consumidor.** Continua no registro, e aparece como `false` na resposta pública de `GET /billing/plans`. Virou load-bearing: sem nenhuma capacidade de acesso, `AccessCapabilityKey` seria `never` e a tipagem de `requiredCapability` (correção C-1) não existiria. Sai do registro quando ganhar um consumidor real ou quando outra capacidade de acesso a substituir nesse papel.
- **Bypass de admin codificado em dois lugares.** No MCP, admin recebe `CapabilitySet.empty()` e é salvo pela condição `user.role !== "admin"` no adaptador. Remover essa condição achando que o conjunto passado já é o do admin negaria o admin em tudo — o conjunto vazio é o mais restritivo que existe. Um predicado único (`isExemptFromCapabilityGate`) resolveria.

## Mapped Changes

**Domínio novo (`src/billing/domain/capability/`)**

- `capability_key.ts` — o tipo das chaves; é o que os outros BCs importam.
- `capability_registry.ts` — a declaração em código: `{ key, kind: "access" | "limit", default, required, label, metadata_key }`.
- `capability_set.ts` — VO do conjunto resolvido; expõe `allows(key)` e `limitOf(key)`.

**Domínio existente**

- `src/billing/domain/entity/plan.ts` — `planSchema` troca `max_properties` por `capabilities` (record permissivo); `PlanCatalogSync` e `syncFromCatalog()` acompanham; getter `max_properties` sai.
- `src/billing/domain/value_object/entitlement.ts` — `EntitlementData` ganha `capabilities: CapabilitySet` e perde `max_properties`.
- `src/billing/domain/policy/subscription_access_policy.ts` — os quatro caminhos passam a propagar o conjunto; `#noSubscription` e `#resolveCanceled` conforme D-8.
- `src/billing/domain/policy/capability_limit_policy.ts` **(novo)** — versão genérica de `PropertyQuotaPolicy`, com a mensagem de upgrade montada a partir do `label` do registro.

**Infra do gateway**

- `src/billing/infra/gateway/stripe_catalog_entry_parser.ts` — parsing dirigido pelo registro: itera as entradas, lê `metadata_key`, aplica `required`/`default`, valida por `kind`. Continua nunca lançando.
- `src/billing/application/gateway/gateway_catalog_entry.ts` — `max_properties` vira `capabilities`.
- `src/billing/application/use_case/sync_plan_catalog_entry.ts` — monta `Plan.create()` e `PlanCatalogSync` a partir da entrada de catálogo; acompanha a troca do campo.

**Banco**

- `src/core/infra/database/drizzle/schemas/billing_schemas.ts` — `plansTable` ganha `capabilities`, perde `max_properties`.
- Migration nova — adiciona a coluna, faz backfill de `{"max_properties": <valor>}` a partir da coluna atual, dropa a coluna.
- `src/billing/infra/database/postgres_repository/plan_postgres_repository.ts` — mapeamento do `reconstitute`.
- `src/billing/infra/database/postgres_repository/subscription_postgres_repository.ts` — também reconstitui `Plan` (na leitura conjunta assinatura+plano); acompanha o mapeamento.

**Aplicação de capacidade**

- `src/core/infra/http/routes/routes.ts` — `RouteDefinition` ganha `requiredCapability?`.
- `src/core/infra/http/adapters/http_controller_adapter.ts` — novo parâmetro; entitlement resolvido uma vez (D-6); `ForbiddenError` com mensagem de upgrade.
- `src/core/presentation/mcp_tool/mcp_tool.ts` — `McpToolDefinition` ganha `requiredCapability?`.
- `src/core/infra/mcp/routes.ts` — dispatch aplica a checagem por tool; a lista de tools continua sendo montada uma única vez, fora do handler.

**Consumidores**

- `src/property_management/application/use_case/create_property.ts` — lê `entitlement.capabilities.limitOf("max_properties")`.
- `src/property_management/domain/policy/property_quota_policy.ts` — removida, substituída por `CapabilityLimitPolicy`.
- `src/billing/application/use_case/get_subscription_status.ts` — expõe `capabilities`.
- `src/billing/application/use_case/list_plans.ts` — DTO expõe `capabilities` (página de preços).
- `src/billing/presentation/mcp_tool/get_subscription_status.tool.ts` **(nova)** + registro no `BillingDi` e no array `tools`.

**Fixtures e docs**

- `tests/helpers/fixtures/plan.ts` — `free` e `pro` com `capabilities`.
- `CLAUDE.md` e `.claude/personas/arquiteto.md` — vocabulário, invariantes I-4 e I-5, critério capacidade-vs-feature-flag.

## Tasks

1. **Registro e VO de capacidade** — criar `capability_key.ts`, `capability_registry.ts` e `capability_set.ts`. Registrar `max_properties` como primeira entrada (`kind: "limit"`, `required: true`, `metadata_key: "sogio_max_properties"`, `default: 1`).
   - Dependencies: none
2. **`CapabilityLimitPolicy`** — policy genérica de limite em `billing/domain/policy/`, preservando o texto de upgrade da mensagem atual via `label`.
   - Dependencies: task 1
3. **Entidade `Plan`** — `planSchema` com `capabilities` permissivo (D-7), `PlanCatalogSync` e `syncFromCatalog()` ajustados, getter `max_properties` removido.
   - Dependencies: task 1
4. **Migration e schema Drizzle** — coluna `capabilities jsonb`, backfill a partir de `max_properties`, drop da coluna antiga; mapeamento nos dois repositórios que reconstituem `Plan`.
   - Dependencies: task 3
5. **Parser de catálogo** — parsing dirigido pelo registro, com `required`/`default` e validação por `kind`; `warn` quando cai no padrão (mitigação do fail-open). `GatewayCatalogEntry` e `SyncPlanCatalogEntryUseCase` acompanham.
   - Dependencies: tasks 1, 3
6. **`Entitlement` e `SubscriptionAccessPolicy`** — propagar o conjunto pelos quatro caminhos; conjunto vazio em `#noSubscription`, conjunto do `free` em `#resolveCanceled` (D-8).
   - Dependencies: tasks 1, 3
7. **Trava declarativa HTTP** — `requiredCapability` em `routes.ts` e no `BunHttpControllerAdapter`, com resolução única do entitlement (D-6).
   - Dependencies: task 6
8. **Trava declarativa MCP** — `requiredCapability` em `McpToolDefinition` e aplicação no dispatch; tool permanece listada, chamada falha com mensagem de upgrade.
   - Dependencies: task 6
9. **Migrar a quota de imóveis** — `CreatePropertyUseCase` passa a ler a capacidade; `PropertyQuotaPolicy` removida. A checagem continua dentro da transação de `saveNewWithinQuota`.
   - Dependencies: tasks 2, 6
10. **Expor capacidades nas leituras** — `GetSubscriptionStatusUseCase` e `ListPlansUseCase`. Requer mudança correspondente no frontend (`max_properties` deixa de existir no topo da resposta de status).
    - Dependencies: task 6
11. **Tool MCP de status da assinatura** — `get_subscription_status`, factory no `BillingDi` e registro no array `tools`. É o que torna a mensagem de upgrade acionável pela IA.
    - Dependencies: task 10
12. **Fixtures e testes** — seed com capacidades; cobertura de: padrão por ausência, `required` ausente invalidando a entrada, chave desconhecida no banco não quebrando `reconstitute`, conjunto vazio sem assinatura, fallback para `free` após cancelamento, trava HTTP, trava MCP, quota de imóveis preservada, backfill da migration.
    - Dependencies: tasks 4, 5, 7, 8, 9, 11
13. **Documentação** — `CLAUDE.md` e `arquiteto.md`: vocabulário de capacidade, I-4 (ausência usa o padrão do registro, nunca bloqueia — salvo `required`), I-5 (o `key` de uma capacidade é imutável; renomear cria uma capacidade nova que ninguém consulta), e o critério capacidade-vs-feature-flag.
    - Dependencies: task 12

> Paralelizáveis: tasks 2, 3 e 6 após a 1 (6 também espera 3); tasks 7, 8, 9 e 10 rodam em paralelo após a 6.
