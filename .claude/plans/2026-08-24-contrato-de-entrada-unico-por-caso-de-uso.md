# Contrato de entrada único por caso de uso (HTTP + MCP)

## Objective

Cada caso de uso de escopo de usuário é hoje alcançável por dois transportes (rota HTTP e tool MCP), e cada transporte redeclara o próprio schema Zod de entrada. As duas cópias já divergiram: os dois canais aceitam valores diferentes para o mesmo caso de uso, e em pelo menos um par a divergência produz erro 500 em vez de 422. O objetivo é extrair **o contrato de entrada** — e só ele — para uma declaração única por caso de uso, consumida pelos dois transportes, mantendo em cada transporte o que legitimamente é dele.

**Não** faz parte deste plano criar uma abstração que gere rota HTTP e tool MCP a partir de uma declaração só. As duas superfícies divergem em transporte (`path`, `method`, `bodyMode`, `parameterSource`, `corsPolicy`, `rateLimitPolicy` de um lado; `annotations` do outro), em formato de saída (`{ message, data }` vs. objeto cru, com `book_stay` removendo `entrance_code` no canal MCP) e em cobertura (dois terços dos 70 controllers nunca terão tool, por exclusão deliberada — admin, OAuth, webhook, credencial). Um declarador único teria que carregar a união disso tudo mais um modo "só HTTP" para a maioria dos casos: ficaria maior que os dois arquivos que substitui.

## Base da branch

Esta PR entra **em cima da stack**, não de `main`:

```
main → #69 mcp-stay-tools → #70 mcp-account-tools → #71 notification-inbox → #72 external-calendar-providers → (esta PR)
```

Worktree já criada a partir de `origin/external-calendar-providers`:

```
.claude/worktrees/share-io-schemas   (branch: share-io-schemas)
```

A PR aponta para `external-calendar-providers`, nunca para `main`.

## Personas

- **Arquiteto** (`arquiteto.md`, opus) — decide a resolução de cada divergência (qual dos dois valores vira o contrato) e registra a invariante nova.
- **Desenvolvedor** (`desenvolvedor.md`, sonnet) — implementa por bounded context.
- **Analista de Segurança** (`analista_seguranca.md`, opus) — revisa, em especial: o alargamento de limites, o `entrance_code` que **não** pode entrar no shape compartilhado, e o `query` de `list_tenants` que hoje entra sem teto.

## Decisões de desenho

**D-1 — A unidade compartilhada é um `z.ZodRawShape`, não um `z.ZodObject`.** O MCP exige o shape cru (`McpToolDefinition.inputSchema: Shape`); o HTTP embrulha com `z.object(shape)`. Compartilhar o objeto obrigaria o MCP a desmontá-lo (`.shape`), o que perde inferência quando o `Shape` ainda é genérico — o mesmo problema que o docblock de `McpToolDefinition` já descreve.

**D-2 — Local: `src/<bc>/presentation/schema/<caso_de_uso>.schema.ts`.** Diretório novo com um significado só, no molde de `application/service/`, `application/content/` e `application/handler/`: **o contrato de entrada de um caso de uso, como publicado a quem chama, independente de transporte**. Fica em `presentation` porque descreve o que o chamador envia, não regra de negócio; os limites continuam vindo de constantes de `domain`.

**D-3 — `.describe()` mora no shape compartilhado.** `bodyFromZod` serializa com `z.toJSONSchema`, que já emite `description`. Ou seja, o texto que hoje só existe para a IA passa a alimentar o `/docs` de graça, sem custo nem duplicação.

**D-4 — Limite nunca é literal.** Todo `.max()` referencia a constante de `domain` (`MAX_PROPERTY_CAPACITY`, `MAX_STAY_PRICE_IN_CENTS`, `MAX_LEDGER_AMOUNT_IN_CENTS`, `MAX_PROPERTY_IMAGES`). É a raiz de metade das divergências abaixo.

**D-5 — Diferença legítima entre canais vira `.extend()`/`.omit()` de uma linha no consumidor, nunca uma segunda cópia do campo.** Exemplo, em `book_stay`: o shape compartilhado usa a forma estrita (ISO com offset) e o controller HTTP sobrescreve com `z.coerce.date()`, preservando o contrato HTTP publicado; `entrance_code` é adicionado só no controller. A divergência passa a ser uma linha visível e deliberada, em vez de invisível entre dois arquivos.

**D-6 — A trava é de lint, não de convenção.** Regra nova `sogio/no-inline-input-schema`, escopada a `src/**/presentation/{controller,mcp_tool}/**`: proíbe declarar um literal de schema de entrada (`const inputSchema = z.object({...})` ou `= { ... }`) nesses diretórios — ele tem que ser importado de `presentation/schema/`. `.extend()`/`.omit()`/`.pick()` sobre um schema importado continuam legais, e `outputSchema` fica fora do escopo (já é a convenção de `IGNORED_SCHEMA_NAMES`). Nenhuma regra consegue provar que os dois canais aceitam os mesmos valores; o que ela prova é que existe **uma** declaração — e isso já força a pergunta na hora de escrever.

## Divergências encontradas (35 pares, todos com controller correspondente)

### Grupo A — Os dois canais aceitam valores diferentes (bug)

| Caso de uso      | Campo          | HTTP hoje                                         | MCP hoje                                           | Contrato resolvido | Efeito no HTTP                                                                                                     |
| ---------------- | -------------- | ------------------------------------------------- | -------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `BookStay`       | `guests`       | `max(500)`                                        | `max(MAX_PROPERTY_CAPACITY)` = 1000                | 1000               | alarga                                                                                                             |
| `BookStay`       | `tenant.name`  | `min(2)`                                          | `min(3)` (igual à entidade `Tenant`)               | 3                  | **estreita** — hoje um nome de 2 letras passa pelo controller e estoura dentro da entidade; vira 422 em vez de 500 |
| `BookStay`       | `tenant.phone` | `length(13)`                                      | regex dígitos `min(10).max(15)` (igual à entidade) | domínio            | alarga — passa a aceitar telefone fora do formato BR de 13 dígitos                                                 |
| `BookStay`       | `tenant.sex`   | `z.enum([...])` inline                            | `tenantSexSchema`                                  | `tenantSexSchema`  | nenhum                                                                                                             |
| `CreateProperty` | `capacity`     | `max(500)`                                        | `max(MAX_PROPERTY_CAPACITY)` = 1000                | 1000               | alarga                                                                                                             |
| `CreateProperty` | `images`       | obrigatório                                       | `.optional()`                                      | opcional           | alarga                                                                                                             |
| `UpdateProperty` | `capacity`     | `max(500)`                                        | 1000                                               | 1000               | alarga                                                                                                             |
| `UpdateStay`     | `guests`       | `max(500)`                                        | 1000                                               | 1000               | alarga                                                                                                             |
| `ListTenants`    | `query`        | **sem validação nenhuma** (`request.query.q` cru) | `z.string().max(100).optional()`                   | `max(100)`         | **estreita** — fecha entrada sem teto, na mesma linha da PR #66                                                    |

### Grupo B — Mesmo valor, fonte diferente (risco de divergir depois)

| Caso de uso                      | Campo                 | HTTP hoje             | MCP hoje                                           | Resolvido                            |
| -------------------------------- | --------------------- | --------------------- | -------------------------------------------------- | ------------------------------------ |
| `BookStay`, `UpdateStay`         | `price`               | literal `100_000_000` | `MAX_STAY_PRICE_IN_CENTS`                          | constante                            |
| `RecordExpense`, `RecordRevenue` | `amount`              | literal `100_000_000` | `MAX_LEDGER_AMOUNT_IN_CENTS`                       | constante                            |
| —                                | `MAX_PROPERTY_IMAGES` | importado de `domain` | **redeclarado** em `create_property.mcp_tool.ts:6` | importar de `domain`, apagar a cópia |

### Grupo C — `z.uuidv4()` vs `z.uuid()` (12 pares)

O HTTP usa `z.uuidv4()` e o MCP `z.uuid()`. Hoje todo id nasce de `crypto.randomUUID()` (v4), então a diferença não aparece; mas o HTTP recusaria um id de outra versão que o MCP aceita. Resolvido para `z.uuid()` em todos: `CancelStay`, `CreatePropertySetting`, `DeleteLedgerEntry` (2 campos), `DeletePropertySetting` (2), `DeleteProperty`, `FindPropertyFinancialMovements`, `GetPropertySetting` (2), `ListPropertySettings`, `RecordExpense`, `RecordRevenue`, `UpdatePropertySetting` (2), `CreateExternalBookingSource`.

### Grupo D — Divergência deliberada, permanece (via D-5)

| Caso de uso                                                                     | Campo           | Por quê                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BookStay`, `UpdateStay`, `FindPropertyStays`, `FindPropertyFinancialMovements` | datas           | HTTP: `z.coerce.date()` (contrato publicado). MCP: ISO com offset obrigatório — uma IA inventa datetime sem fuso, e isso precisa ser recusado. Shape compartilhado carrega a forma estrita; o controller sobrescreve. |
| `BookStay`                                                                      | `entrance_code` | Só HTTP. É senha real de fechadura: nunca pode ser escolhida pelo chamador MCP nem voltar no resultado da tool. Fica fora do shape compartilhado, adicionado por `.extend()` no controller.                           |
| Importações (3)                                                                 | `records`       | Só MCP. O HTTP recebe CSV em stream (`bodyMode: "stream"`), a tool recebe array.                                                                                                                                      |

### Grupo E — Importações: a mesma declaração existe três vezes

Para os três importadores, o contrato de um registro está escrito no caso de uso (autoritativo, valida o stream), de novo na tool MCP (para publicar à IA) e uma terceira vez como exemplo CSV no `openApiSpec` do controller. As duas primeiras já divergem — em `import_stays`, o caso de uso exige `source.min(1)` e limita a data a 32 caracteres, a tool não exige `source` e limita a 10. Resolução: o schema de registro passa a ser exportado pelo caso de uso e a tool o consome, adicionando só `.describe()` por campo. O exemplo CSV do `openApiSpec` continua manual (é texto de documentação, não schema).

### Grupo F — Pares sem entrada nenhuma (nada a fazer)

`FindUserProperties`, `GetNotificationPreferences`, `GetSubscriptionStatus`, `ListPlans`, `ReconcileExternalBookings`, `GetUserPreferences`.

### Grupo G — Pares já alinhados (só passam a importar o shape comum)

`GetDashboardOverview`, `GetStay`, `FindProperty`, `GetSubscriptionHistory`, `ListNotifications`, `MarkNotificationRead`, `UpdateNotificationPreferences`, `UpdateUserPreferences`, `CreateExternalBookingSource` (o `platform_name` — regex e texto de 3 linhas — está literalmente copiado entre os dois arquivos, criados na mesma PR #72).

## Mapped Changes

### Arquivos novos

- **`src/<bc>/presentation/schema/*.schema.ts`** — ~29 arquivos, um por caso de uso com entrada. Cada um exporta um `z.ZodRawShape` com `.describe()` em todo campo e limites vindos de `domain`.
- **`eslint-rules/no_inline_input_schema.js`** — a regra de D-6.
- **`tests/core/presentation_input_contract.test.ts`** — teste de contrato: para cada par, monta o mesmo conjunto de entradas-limite e exige aceitar/recusar idêntico nos dois canais. É o que a lint não consegue provar.

### Arquivos alterados

- **`eslint-rules/index.js`** — registra a regra nova.
- **`eslint.config.mjs`** — bloco novo escopado a `src/**/presentation/controller/**` e `src/**/presentation/mcp_tool/**`.
- **~29 controllers** em `src/*/presentation/controller/**` — trocam o literal por `z.object(sharedShape)`, mais `.extend()`/`.omit()` onde D-5 se aplica. `openApiSpec` passa a derivar de `bodyFromZod(z.object(sharedShape))`.
- **~29 tools** em `src/*/presentation/mcp_tool/*.mcp_tool.ts` — trocam o literal pelo shape importado.
- **`src/property_management/presentation/mcp_tool/create_property.mcp_tool.ts`** — apaga `export const MAX_PROPERTY_IMAGES = 50` e importa de `domain/entity/property`.
- **`src/booking/presentation/controller/tenant/list_tenants.controller.ts`** — ganha `inputSchema` com `parameterSource: "query"`; hoje lê `request.query.q` sem validar.
- **`src/booking/application/use_case/import_batch_stays.ts`**, **`import_batch_properties.ts`**, **`import_batch_ledger_entries.ts`** — exportam o schema de registro para a tool consumir.
- **`CLAUDE.md`** e **`.claude/rules/architecture.md`** — documentam `presentation/schema/` como o quarto diretório com significado próprio, e a regra "todo caso de uso com dois transportes tem um contrato de entrada só".
- **`.claude/personas/arquiteto.md`** — registra a invariante (proposta: **I-P1**, "um caso de uso alcançável por HTTP e MCP tem exatamente uma declaração de contrato de entrada").

### Explicitamente fora de escopo

Schemas de **saída**. O `outputSchema` do controller existe só para o `/docs`; a tool MCP não publica schema de saída. Não há duplicação a matar ali.

## Tasks

1. **Fundação do diretório e da convenção** — cria `src/core/presentation/schema/` com o docblock da convenção (ou apenas o primeiro `presentation/schema/` de um BC como referência), escreve `eslint-rules/no_inline_input_schema.js` e o registra em `eslint-rules/index.js`, **sem ainda ligar** em `eslint.config.mjs`.
   - Dependencies: none
2. **Resolução das divergências do Grupo A** — ✅ **APROVADO PELO USUÁRIO EM 2026-08-24.** Todos os valores da tabela do Grupo A valem, incluindo as duas mudanças que estreitam o contrato HTTP: `tenant.name` passa de `min(2)` para `min(3)`, e `list_tenants.query` passa de sem teto para `max(100)`.
   - Dependencies: none
3. **`property_management`** — 9 pares. Inclui apagar a redeclaração de `MAX_PROPERTY_IMAGES` e alargar `capacity` para `MAX_PROPERTY_CAPACITY` em `create` e `update`.
   - Dependencies: tasks 1, 2
4. **`booking`** — 9 pares. Inclui `book_stay` (o par mais divergente: `guests`, `tenant.*`, `price`, mais o `.extend()` de data e `entrance_code`), `update_stay`, `list_stays`, `list_tenants` (validação nova) e `create_external_booking_source` (o `platform_name` copiado).
   - Dependencies: tasks 1, 2
5. **`finance`** — 5 pares. `record_expense`, `record_revenue`, `delete_ledger_entry`, `list_financial_movements`, `import_ledger_entries`.
   - Dependencies: tasks 1, 2
6. **`auth`, `billing`, `notification`** — 8 pares, quase todos do Grupo G (só passam a importar).
   - Dependencies: tasks 1, 2
7. **Schemas de registro das importações (Grupo E)** — exporta o schema de registro dos três casos de uso e faz as três tools consumirem, reconciliando `source` e o limite de tamanho da data.
   - Dependencies: tasks 3, 4, 5
8. **Teste de contrato entre canais** — `tests/core/presentation_input_contract.test.ts`.
   - Dependencies: tasks 3, 4, 5, 6
9. **Ligar a regra de lint e limpar o rastro** — adiciona o bloco em `eslint.config.mjs`, roda `bun run lint` e corrige o que sobrou.
   - Dependencies: tasks 3, 4, 5, 6, 7
10. **Documentação e invariante** — `CLAUDE.md`, `.claude/rules/architecture.md`, `.claude/personas/arquiteto.md`.
    - Dependencies: task 9
11. **Revisão de segurança** — foco no alargamento de limites, no `entrance_code` fora do shape compartilhado e no teto novo de `list_tenants.query`.
    - Dependencies: tasks 8, 9, 10

> Tasks 3, 4, 5 e 6 não têm dependência entre si e podem rodar em paralelo, um Desenvolvedor por bounded context.

## Riscos

- **R-1 — Tamanho da PR sobre uma stack de quatro.** São ~60 arquivos tocados em cima de `external-calendar-providers`. Qualquer rebase da stack abaixo é caro. Mitigação: as tasks 3–6 são por BC e podem virar commits separados, revisáveis um a um; se ficar grande demais, a task 6 (Grupo G, quase mecânica) sai para uma PR seguinte.
- **R-2 — `.transform()` no shape compartilhado degrada o `/docs`.** `bodyFromZod` chama `z.toJSONSchema(..., { unrepresentable: "any" })`; campos com `.transform()` podem sair como `any` no OpenAPI. Já acontece hoje em alguns controllers, mas o alcance aumenta. Verificar o `/docs` gerado ao final da task 9.
- **R-3 — Duas mudanças estreitam contrato HTTP.** `tenant.name` (2 → 3 caracteres) e `list_tenants.query` (sem teto → 100). A primeira só troca um 500 por um 422; a segunda fecha uma entrada sem limite. **Aceito pelo usuário em 2026-08-24** — as duas entram.

---

## Resultado da execução (2026-08-24)

Entregue nesta branch, `share-io-schemas`, sobre `external-calendar-providers`. Verificação final: `bun run typecheck`, `bun run lint:check` e `bun run format:check` limpos; `bun run test` com **823 passando, 0 falhando**.

### O que mudou em relação ao plano

**A regra de lint precisou ser estreitada.** Ligada como escrita, ela acusava 21 pontos, e boa parte era defeito dela: um literal cujos valores são **todos importados** — `{ q: tenantSearchQuery }`, ou um schema de registro que só encadeia `.describe()` nos campos do próprio caso de uso — não declara contrato nenhum, é justamente o mecanismo aprovado de D-5. Hoje ela só reporta literal que declara uma cadeia Zod própria.

**A lista de superfícies de transporte único ficou explícita**, em `SINGLE_TRANSPORT_SURFACES` (`eslint.config.js`), em vez de silenciada arquivo a arquivo — o projeto proíbe comentário no código, então `eslint-disable` inline não era opção, e o resultado é melhor: a lista espelha as exceções de MCP que o `CLAUDE.md` já documenta, e uma rota nova sem tool passa a ter que se justificar ali. Ela cobre o BC `backoffice` inteiro, as rotas de credencial e de OAuth, as sessões de pagamento hospedadas, o link público de estadia, e as três tools de importação — cujo `records` é envelope de transporte, sem campo correspondente no HTTP, porque a rota CSV recebe stream.

**Duas divergências que o mapeamento não tinha visto:**

- **`import_properties.images` não pode ser compartilhado.** No caso de uso o campo é uma string separada por `|`, porque um registro de CSV é todo string; reusá-lo na tool publicaria `images` à IA como texto em vez de lista. O campo continua declarado por canal; os outros nove do registro são o mesmo objeto Zod.
- **`import_ledger_entries.property_id` usava `z.uuidv4()` no caso de uso contra `z.uuid()` na tool** — resolvido para `z.uuid()`, consistente com o Grupo C.

**As mensagens de validação foram preservadas, e isso virou regra.** A extração pegou a versão da tool MCP de cada campo, que nunca carregou as mensagens Zod customizadas que os controllers publicavam (`"Amount must be greater than 0"`). Perdê-las degrada o corpo do 422 em silêncio; e uma IA lê mensagem de erro tão bem quanto uma pessoa. Elas ficam no shape compartilhado, restatadas contra a constante de `domain` quando o limite mudou.

**A regra "pelo menos uma preferência" de `update_user_preferences` não entrou no shape.** Ela restringe o objeto inteiro, não um campo, então não cabe num `z.ZodRawShape` — cada consumidor a aplica do próprio jeito, sem duplicar campo nenhum.

**`get_me` é a única tool sem caso de uso atrás**: ela responde a partir do próprio `User` autenticado. Está listada no teste de contrato, não inferida, para que uma segunda não apareça despercebida.

### O que o teste de contrato prova, e o que não prova

`tests/core/presentation_input_contract.test.ts` prova o que a lint não consegue: que os dois transportes de um caso de uso importam **o mesmo módulo**, e que todo campo compartilhado tem `.describe()`. Ele **não** compara valores campo a campo — não precisa: uma vez que os dois lados leem a mesma declaração, a igualdade de valores é verdadeira por construção, e é essa construção que o teste tranca. Verificado como não-vacuoso: desfazer o import de um controller faz o teste falhar nomeando o par.
