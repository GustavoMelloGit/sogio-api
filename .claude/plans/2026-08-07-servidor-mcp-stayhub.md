# Servidor MCP do StayHub

## Objective

Expor operações de negócio do StayHub como tools MCP, permitindo que agentes LLM
reservem estadias, lancem despesas e consultem estadias em nome de um usuário
autenticado — sem duplicar regra de negócio e sem quebrar a Clean Architecture.

Duas decisões de domínio tomadas junto ao usuário entram no escopo por serem
pré-condição das tools: o código de entrada passa a ser gerado pelo sistema e a
categoria de despesa passa a ser vocabulário fechado.

## Personas

- **Arquiteto** — análise de domínio e decisões arquiteturais (este documento)
- **Analista de Segurança** — obrigatório: novo canal de escrita, novo modelo de
  confiança (agente autônomo), geração de segredo de fechadura e falha de
  autorização pré-existente identificada
- **Desenvolvedor** — implementação
- **Revisor** — revisão de aderência arquitetural

## Decisões do Usuário (2026-08-07)

1. **Entrance code**: passa a ser gerado pelo sistema; deixa de ser input de quem chama.
2. **Categoria de despesa**: vocabulário fechado com os 6 valores já praticados
   pelo frontend — `MANUTENÇÃO`, `ESTADIA`, `AQUISIÇÕES`, `FINANCIAMENTO`,
   `GASTOS_FIXOS`, `OUTROS`.
3. **Escopo v1**: as 3 tools entram juntas, incluindo reservar estadia.
4. **Rastreabilidade agente vs app**: fora de escopo. Não sobrecarregar `source`.

## Contexto Levantado

Use cases existentes que atendem as 3 tools (nenhum caso de uso novo é necessário):

| Tool             | Use case existente          | DI                                      | Recebe `user`? | Valida posse? |
| ---------------- | --------------------------- | --------------------------------------- | -------------- | ------------- |
| Reservar estadia | `BookStayUseCase`           | `PropertyDi.makeBookStayUseCase()`      | Sim            | Sim           |
| Lançar despesa   | `RecordExpenseUseCase`      | `FinanceDi.makeRecordExpenseUseCase()`  | **Não**        | **Não**       |
| Listar estadias  | `FindPropertyStaysUseCase`  | `StayDi.makeFindPropertyStaysUseCase()` | via `user_id`  | Sim           |
| (apoio) Imóveis  | `FindUserPropertiesUseCase` | `PropertyManagementDi`                  | via `user_id`  | Sim           |

Achados relevantes da investigação:

- `BookStayUseCase` é o **único** caminho de criação de `Stay`.
  `ReconcileExternalBookingsUseCase` apenas reporta divergências, não cria.
- `UpdateStayUseCase` **não** permite alterar `entrance_code` — ele é write-once.
- `Stay` já grava a invariante `entrance_code` com exatamente 7 caracteres
  (`src/booking/domain/entity/stay.ts`), divergindo da linguagem registrada na
  persona ("tamanho mínimo, tamanho exato varia por modelo de fechadura").
- `ESTADIA` já é usada pelo sistema como categoria de **receita**, gravada pelos
  handlers `RecordRevenueOnStayPaymentConfirmed` e `RevertRevenueOnStayCancel`.
- `LedgerEntry.reconstitute()` valida pelo mesmo schema da criação — fechar o
  vocabulário no schema quebraria a leitura de registros históricos fora do conjunto.
- Divergência de limite: coluna `category` é `varchar(100)`, schema da entidade é `max(50)`.
- O frontend envia `entrance_code` em `BookStayForm.tsx` e `ReconcileStayForm.tsx`.

## Mapped Changes

- **`src/core/infra/mcp/`** (novo) — camada de transporte MCP, peer de
  `src/core/infra/http/`. Servidor, registro de tools, adaptador de erros e
  resolução de identidade. Depende **apenas** dos containers DI.
- **`src/booking/domain/service/`** — novo serviço de domínio gerador de código
  de entrada; encapsula formato e fonte de aleatoriedade.
- **`src/booking/application/use_case/property/book_stay.ts`** — `entrance_code`
  deixa de ser input obrigatório; passa a ser gerado quando ausente.
- **`src/booking/infra/di/property_di.ts`** — injeta o gerador.
- **`src/booking/presentation/controller/property/book_stay.controller.ts`** —
  `entrance_code` vira opcional no schema de entrada.
- **`src/finance/domain/entity/ledger_entry.ts`** — vocabulário fechado de
  categoria de despesa, validado na criação de despesa.
- **`src/finance/application/use_case/record_expense.ts`** — recebe o usuário,
  valida posse da propriedade e o tipo da categoria.
- **`src/finance/presentation/controller/record_expense.controller.ts`** —
  repassa o `user` e restringe a categoria no schema.
- **`src/core/infra/database/drizzle/schemas/finance_schemas.ts`** — alinhar o
  limite de `category` com o schema da entidade.
- **`src/index.ts`** — monta o transporte MCP no processo do servidor Bun.
- **`package.json`** — dependência do SDK MCP, isolada em `src/core/infra/mcp`.
- **`tests/booking/`, `tests/finance/`, `tests/core/`** — cobertura das mudanças.

## Tasks

1. **Verificar categorias existentes no banco** — levantar os valores distintos
   de `category` já gravados, para decidir se o fechamento do vocabulário exige
   migração de dados. Bloqueia a modelagem do vocabulário.
   - Dependencies: none
2. **Corrigir autorização de despesa** — `RecordExpenseUseCase` recebe o usuário e
   rejeita propriedade que ele não administra; controller HTTP ajustado; testes.
   - Dependencies: none
3. **Definir contrato de identidade do MCP** — o servidor exige bearer token e
   resolve o `User` pela mesma cadeia `SessionManager` + `AuthRepository`.
   Nenhum principal novo no BC Auth.
   - Dependencies: none
4. **Fechar vocabulário de categoria de despesa** — 6 valores, validados na
   criação de despesa; reconstituição permanece tolerante a valores legados.
   Alinhar limite da coluna com o da entidade.
   - Dependencies: task 1
5. **Gerador de código de entrada** — serviço de domínio no BC Booking, com fonte
   criptográfica; `BookStayUseCase` gera quando o input não traz o código;
   controller HTTP torna o campo opcional (compatibilidade com o frontend atual).
   - Dependencies: none
6. **Adaptador MCP base** — servidor, transporte, resolução de usuário por
   requisição, mapeamento dos erros tipados para erro de tool, serialização de
   datas. Sem nenhuma tool ainda.
   - Dependencies: task 3
7. **Tool de listagem de estadias (+ listagem de imóveis)** — somente leitura;
   valida a cadeia ponta a ponta com risco baixo.
   - Dependencies: task 6
8. **Tool de lançamento de despesa** — categoria restrita aos 6 valores no schema
   da tool, valor em centavos explícito.
   - Dependencies: tasks 2, 4, 6
9. **Tool de reserva de estadia** — não expõe `entrance_code`; anotada como
   destrutiva; datas em ISO-8601 com offset; preço em centavos.
   - Dependencies: tasks 5, 6
10. **Montagem no processo do servidor** — expor o transporte junto ao
    `Bun.serve` existente, reaproveitando as instâncias de DI.
    - Dependencies: tasks 7, 8, 9
11. **Revisão de segurança** — Analista de Segurança sobre superfície de escrita,
    imprevisibilidade do código de entrada, vazamento de dados de hóspede e
    ausência de idempotência.
    - Dependencies: task 10

> Tasks 1, 2, 3 e 5 podem rodar em paralelo. Tasks 7, 8 e 9 podem rodar em
> paralelo depois de suas dependências.

## Dívidas Registradas (fora de escopo)

- `Stay` fixa o código de entrada em 7 caracteres, enquanto a linguagem do
  domínio diz "mínimo, com tamanho variável por modelo de fechadura". Só há um
  modelo em operação; não mexer agora.
- `ESTADIA` significa coisas diferentes como receita e como despesa; o
  agrupamento por categoria em `find_property_financial_movements` mistura as duas.
- Não existe chave de idempotência em nenhuma operação de escrita.
- `BookStayUseCase` reaproveita o `Tenant` pelo telefone e ignora nome/sexo
  divergentes enviados na reserva.
