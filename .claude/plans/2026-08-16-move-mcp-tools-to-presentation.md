# Mover as tools MCP para a camada `presentation` do BC

## Objective

As tools MCP vivem hoje em `src/core/infra/mcp/tools/`, centralizadas em `infra`. Uma tool MCP faz exatamente o trabalho de um controller — adapta um protocolo externo a um caso de uso, valida input, formata output — então o lugar dela é a camada `presentation` do BC dono do caso de uso, não um diretório único em `core/infra`. Refactor de movimentação: zero mudança de comportamento, zero mudança de contrato do protocolo (nomes de tool, schemas de input, annotations e outputs permanecem byte-a-byte iguais).

## Personas

- **Arquiteto** (`.claude/personas/arquiteto.md`) — decisões deste plano.
- **Desenvolvedor** (`.claude/personas/desenvolvedor.md`) — execução.
- **Revisor** (`.claude/personas/revisor.md`) — revisão final.
- **Analista de Segurança** — **não necessário**. Justificativa em "Nota de segurança".

---

## Decisões

### D1 — Pasta: `presentation/mcp_tool/`, arquivos `<nome>.mcp_tool.ts`

O projeto já usa `presentation/<papel>/` + `<nome>.<papel>.ts`: `presentation/controller/book_stay.controller.ts`, `presentation/middleware/auth.middleware.ts`. Aplicando a mesma regra: `presentation/mcp_tool/book_stay.mcp_tool.ts`.

Por que `mcp_tool` e não `tool` ou `mcp`:

- `controller/` significa HTTP implicitamente porque é o único protocolo daquela pasta. Ao lado dele, `tool/` sozinho não diz de qual protocolo é. O projeto já prefixa tudo do protocolo com `mcp_` (`mcp_server.ts`, `mcp_error_mapper.ts`, `McpToolDefinition`, `registerMcpTool`).
- `mcp/` (sem `tool`) descreveria um protocolo, não um papel — quebra a simetria com `controller`/`middleware`, que são papéis.

O sufixo `.mcp_tool.ts` não é redundante, é necessário: **9 das 11 tools colidem por basename com um controller existente** (`book_stay`, `cancel_stay`, `record_expense`, `delete_property` e as 5 de `property_setting`). Sem sufixo, `book_stay.ts` e `book_stay.controller.ts` ficariam indistinguíveis em busca fuzzy e em abas de editor.

### D2 — `McpToolDefinition` vai para `src/core/presentation/mcp_tool/mcp_tool.ts`

`core/presentation/` já tem `controller/`, `middleware/` e `open_api/`. O contrato HTTP mora em `core/presentation/controller/controller.ts`; o contrato MCP passa a morar em `core/presentation/mcp_tool/mcp_tool.ts`, exatamente paralelo. Move-se `McpToolDefinition` e `McpToolInput`.

O wiring do SDK (`registerMcpTool`) **fica em infra** e o arquivo é renomeado para `src/core/infra/mcp/mcp_tool_adapter.ts` — nome que espelha `core/infra/http/adapters/http_controller_adapter.ts` e, mais importante, evita dois arquivos `mcp_tool.ts` em camadas diferentes (confusão real, inclusive no nome do teste).

### D3 — O barrel some; registro passa a ser feito pelo DI container do BC

Esta é a decisão de maior impacto e a que sustenta o refactor.

Observação que motiva: `core/infra/http/routes/routes.ts` **não importa controller nenhum**. Ele pede ao DI container (`propertyDi.makeBookStayController()`). Já `mcp/routes.ts` importa as 11 tools direto de um barrel. As duas superfícies deveriam ter a mesma forma.

Além disso, mover a tool para `presentation` mantendo a assinatura atual `makeBookStayTool(propertyDi)` **criaria uma violação de camada nova**: um arquivo em `booking/presentation/` importando e invocando `booking/infra/di/property_di` para construir a própria dependência — exatamente o que o DI container existe para evitar. Trocaríamos uma violação por outra.

Decisão:

1. Cada tool passa a receber **o use case** em vez do container. Cada uma usa exatamente **um** use case hoje (verificado nas 11), então é uma linha por arquivo.
2. Cada `[Module]Di` ganha um factory `make<X>Tool()` que devolve a `McpToolDefinition`, exatamente como já faz `make<X>Controller()`.
3. `mcp/routes.ts` deixa de importar tools e passa a chamar `dependencies.propertyManagementDi.makeListPropertiesTool()` etc. — mesma forma do `routes.ts` do HTTP.
4. O barrel `tools/index.ts` é **deletado**, sem substituto. Não existe nenhum outro barrel em `src/` (era o único), e um barrel por BC não teria precedente nem utilidade com 1–7 exports.

Consequência boa: os **três** pontos de registro de uma tool nova (barrel, imports de `routes.ts`, array `tools`) viram **dois** (factory no Di do BC, array em `routes.ts`) — idênticos aos dois do HTTP (factory no Di, entrada em `routes.ts`).

Alternativa considerada e rejeitada: mover as tools mantendo `makeXTool(di)` e trocar o barrel por 11 imports diretos em `mcp/routes.ts`. É menos edição (~20 linhas a menos), mas deixa `presentation → infra/di` de pé, o que anula o motivo do refactor.

Direção de dependência resultante, idêntica à do HTTP:
`core/infra/mcp/routes.ts` → `<bc>/infra/di` → `<bc>/presentation/mcp_tool` → `core/presentation/mcp_tool` + `<bc>/application/use_case`.

### D4 — Mapeamento tool → BC (verificado arquivo a arquivo, não pelo nome)

| Tool                      | Destino                                                                             | Use case injetado (hoje via Di)                           |
| ------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `book_stay`               | `src/booking/presentation/mcp_tool/book_stay.mcp_tool.ts`                           | `PropertyDi.makeBookStayUseCase()`                        |
| `cancel_stay`             | `src/booking/presentation/mcp_tool/cancel_stay.mcp_tool.ts`                         | `StayDi.makeCancelStayUseCase()`                          |
| `list_stays`              | `src/booking/presentation/mcp_tool/list_stays.mcp_tool.ts`                          | `StayDi.makeFindPropertyStaysUseCase()`                   |
| `list_properties`         | `src/property_management/presentation/mcp_tool/list_properties.mcp_tool.ts`         | `PropertyManagementDi.makeFindUserPropertiesUseCase()`    |
| `delete_property`         | `src/property_management/presentation/mcp_tool/delete_property.mcp_tool.ts`         | `PropertyManagementDi.makeDeletePropertyUseCase()`        |
| `create_property_setting` | `src/property_management/presentation/mcp_tool/create_property_setting.mcp_tool.ts` | `PropertyManagementDi.makeCreatePropertySettingUseCase()` |
| `get_property_setting`    | `src/property_management/presentation/mcp_tool/get_property_setting.mcp_tool.ts`    | `PropertyManagementDi.makeGetPropertySettingUseCase()`    |
| `update_property_setting` | `src/property_management/presentation/mcp_tool/update_property_setting.mcp_tool.ts` | `PropertyManagementDi.makeUpdatePropertySettingUseCase()` |
| `delete_property_setting` | `src/property_management/presentation/mcp_tool/delete_property_setting.mcp_tool.ts` | `PropertyManagementDi.makeDeletePropertySettingUseCase()` |
| `list_property_settings`  | `src/property_management/presentation/mcp_tool/list_property_settings.mcp_tool.ts`  | `PropertyManagementDi.makeListPropertySettingsUseCase()`  |
| `record_expense`          | `src/finance/presentation/mcp_tool/record_expense.mcp_tool.ts`                      | `FinanceDi.makeRecordExpenseUseCase()`                    |

Duas armadilhas confirmadas na leitura:

- **`list_properties` NÃO é do `booking`.** Apesar do nome, ele usa `PropertyManagementDi.makeFindUserPropertiesUseCase()` — é `property_management`.
- **`book_stay` usa `PropertyDi`, não `StayDi`** (`BookStayUseCase` vive em `PropertyDi`), mas ambos são do BC `booking`. Só muda de qual container vem o factory.

`booking/presentation/mcp_tool/` fica **plano** (3 arquivos), sem os subdiretórios `property/`/`stay/` que `controller/` tem — aqueles existem por causa dos 10 controllers do BC; 3 tools não justificam.

### D5 — Gotchas verificados

- **Sem import cruzado presentation → infra no contrato.** Depois da separação, `core/presentation/mcp_tool/mcp_tool.ts` importa apenas `zod` (type), `ToolAnnotations` de `@modelcontextprotocol/sdk/types.js` e `User` de `auth/domain`. Os dois imports de infra que existem hoje em `mcp_tool.ts` — `serializeDatesRecursively` (`core/infra/http/utils/date_serializer`) e `mapErrorToToolResult` (`core/infra/mcp/mcp_error_mapper`) — são usados **só** por `registerMcpTool`, que fica em infra. A separação é limpa por construção, sem nenhum ajuste extra. Precedente: `core/presentation/controller/controller.ts` também importa `zod` + um tipo de OpenAPI + uma entidade de domínio.
- **Imports de `core` dentro das tools continuam válidos** (só mudam de profundidade relativa): `core/domain/value_object/setting_value` (create/update_property_setting) e `core/application/dto/pagination` (list_stays, list_property_settings).
- **`mcp_server.ts` e `mcp_error_mapper.ts` não se movem.** `mcp_server.ts` só precisa trocar o import: `registerMcpTool` de `./mcp_tool_adapter`, `McpToolDefinition` de `../../presentation/mcp_tool/mcp_tool`.
- **Nenhuma regra de ESLint de fronteira de camada existe** (`eslint.config.js` não tem `no-restricted-imports`/`no-restricted-paths`/`boundaries`), então nada quebra nem passa a ser detectado automaticamente. O refactor é convenção, não é imposto por tooling.
- **13 arquivos de teste** referenciam os caminhos atuais (lista completa abaixo). Nenhum outro consumidor: as demais menções em `grep` são a planos históricos em `.claude/plans/` (registro histórico — **não atualizar**) e a comentários que citam `core/infra/mcp/routes.ts`, que não se move.
- **`book_stay` exporta `inputSchema`** (consumido por `tests/booking/book_stay_tool.test.ts`) e `record_expense` também tem export adicional. Manter todos os exports públicos como estão.
- **Preservar verbatim** o strip de `entrance_code` no handler de `book_stay` — é a garantia de que a senha física da fechadura nunca entra no contexto de um LLM.

---

## Mapped Changes

**Contrato (core)**

- `src/core/presentation/mcp_tool/mcp_tool.ts` — **novo**. Recebe `McpToolDefinition` e `McpToolInput`, com os comentários existentes.
- `src/core/infra/mcp/mcp_tool.ts` → `src/core/infra/mcp/mcp_tool_adapter.ts` — fica só `registerMcpTool`; passa a importar o tipo de `core/presentation`.
- `src/core/infra/mcp/mcp_server.ts` — só os dois imports.

**Tools (11 arquivos movidos)** — ver tabela D4. Cada um: novo caminho/nome, parâmetro passa de `<X>Di` para o use case, import do tipo passa a apontar para `core/presentation/mcp_tool/mcp_tool`, profundidades relativas ajustadas. Corpo e conteúdo do protocolo inalterados.

- `src/core/infra/mcp/tools/index.ts` — **deletado**.
- `src/core/infra/mcp/tools/` — diretório deixa de existir.

**DI containers (+11 factories)**

- `src/booking/infra/di/property_di.ts` — `makeBookStayTool()`
- `src/booking/infra/di/stay_di.ts` — `makeCancelStayTool()`, `makeListStaysTool()`
- `src/property_management/infra/di/property_management_di.ts` — 7 factories
- `src/finance/infra/di/finance_di.ts` — `makeRecordExpenseTool()`

**Composição**

- `src/core/infra/mcp/routes.ts` — remove o bloco de import das 11 tools; o array `tools` passa a chamar os factories dos containers. `McpRouteDependencies`, o gate de identidade, o gate de entitlement, CORS e `no-store` **não mudam**. A ordem das 11 entradas do array deve ser preservada.

**Testes (13)**

- `tests/core/mcp_tool.test.ts` → renomear para `tests/core/mcp_tool_adapter.test.ts` (testa `registerMcpTool`); atualizar import.
- `tests/booking/book_stay_tool.test.ts`, `tests/booking/cancel_stay_tool.test.ts`, `tests/booking/list_stays.test.ts`
- `tests/finance/record_expense_tool.test.ts`
- `tests/property_management/list_properties.test.ts`, `delete_property_tool.test.ts`, `create_property_setting_tool.test.ts`, `get_property_setting_tool.test.ts`, `update_property_setting_tool.test.ts`, `delete_property_setting_tool.test.ts`, `list_property_settings_tool.test.ts`, `delete_property_mcp_sweep.test.ts`

Em todos: import de `registerMcpTool` passa a `src/core/infra/mcp/mcp_tool_adapter`; import da tool passa ao novo caminho; a construção passa de `makeXTool(new XDi())` para `new XDi().makeXTool()`. **Nenhuma asserção muda** — se alguma precisar mudar, o refactor deixou de ser neutro e deve parar.

**Documentação (regra permanente)**

- `CLAUDE.md` — bloco "Superfície MCP obrigatória": trocar `src/core/infra/mcp/tools/` por `src/<bc>/presentation/mcp_tool/` e "três pontos (barrel, imports de routes.ts, array tools)" por "dois pontos (factory `make<X>Tool()` no Di do BC, array `tools` de `makeMcpRequestHandler`)". Em "Estrutura de Camadas", `presentation/` deixa de ser "Controllers HTTP" e passa a "Controllers HTTP e tools MCP".
- `.claude/rules/architecture.md` — mesma correção na seção "Creating a new route"; e na descrição de `src/<bc>/presentation` incluir as tools MCP.
- `.claude/personas/desenvolvedor.md` — seção "Tools MCP", mesma correção; e uma linha de convenção de nome (`<nome>.mcp_tool.ts`).
- `.claude/plans/*` anteriores — **não atualizar**, são registro histórico.

---

## Tasks

1. **Separar contrato e wiring em `core`** — criar `src/core/presentation/mcp_tool/mcp_tool.ts` com `McpToolDefinition`/`McpToolInput`; renomear `src/core/infra/mcp/mcp_tool.ts` para `mcp_tool_adapter.ts` deixando só `registerMcpTool`; ajustar `mcp_server.ts`. Neste ponto o build ainda aponta para as tools no lugar antigo, que passam a importar o tipo do novo caminho.
   - Dependencies: none
2. **Mover as 3 tools do `booking`** — para `src/booking/presentation/mcp_tool/`, com sufixo `.mcp_tool.ts`, trocando o parâmetro `Di` pelo use case; adicionar `makeBookStayTool()` em `PropertyDi` e `makeCancelStayTool()`/`makeListStaysTool()` em `StayDi`.
   - Dependencies: task 1
3. **Mover as 7 tools do `property_management`** — para `src/property_management/presentation/mcp_tool/`; adicionar os 7 factories em `PropertyManagementDi`. Atenção: `list_properties` é deste BC, não do `booking`.
   - Dependencies: task 1
4. **Mover a tool do `finance`** — `record_expense` para `src/finance/presentation/mcp_tool/`; adicionar `makeRecordExpenseTool()` em `FinanceDi`.
   - Dependencies: task 1
5. **Recompor `mcp/routes.ts` e deletar o barrel** — remover o bloco de imports das tools, montar o array `tools` a partir dos factories dos containers preservando a ordem atual, apagar `src/core/infra/mcp/tools/`.
   - Dependencies: tasks 2, 3, 4
6. **Atualizar os 13 testes** — novos caminhos de import e nova forma de construção; renomear `tests/core/mcp_tool.test.ts` para `mcp_tool_adapter.test.ts`. Rodar `bun run test` e confirmar suíte verde sem alterar asserções.
   - Dependencies: task 5
7. **Atualizar a documentação da regra permanente** — `CLAUDE.md`, `.claude/rules/architecture.md`, `.claude/personas/desenvolvedor.md`.
   - Dependencies: task 5
8. **Lint, format e revisão** — `bun run lint`, `bun run format`, `bun run lint:check`; revisão final confirmando que nenhum nome de tool, schema de input, annotation ou output mudou.
   - Dependencies: tasks 6, 7

> As tasks 2, 3 e 4 são independentes entre si e podem rodar em paralelo. As tasks 6 e 7 também.

---

## Nota de segurança

**Revisão do Analista de Segurança: não necessária.** Concordo com a avaliação preliminar do Orquestrador.

- A autorização vive nos use cases e em `PropertyOwnershipPolicy`, não nas tools — nenhum desses arquivos é tocado.
- O portão de transporte de `/mcp` (`identity_resolver`, verificação de credencial OAuth, gate de entitlement DA-9, CORS público, `no-store`) está todo em `mcp/routes.ts` e **não se move**. Só o bloco de construção do array `tools` muda ali.
- `registerMcpTool` (incluindo o `mapErrorToToolResult`, que impede vazamento de detalhes internos em erro) muda de arquivo, não de conteúdo.
- Único ponto sensível que atravessa o refactor: o strip de `entrance_code` no handler de `book_stay`. Está registrado em D5 e na task 8 como item de verificação — é conferência de refactor neutro, não análise de ameaça.
