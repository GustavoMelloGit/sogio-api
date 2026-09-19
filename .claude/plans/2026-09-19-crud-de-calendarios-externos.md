# CRUD de calendários externos (`ExternalBookingSource`)

## Objective

`ExternalBookingSource` só tem criação: `POST /booking/property/:property_id/external-booking`
e a tool `create_external_booking_source`. Não há leitura, edição nem remoção
— nem por HTTP, nem por MCP. Dá para cadastrar um calendário e nunca mais
vê-lo pelo produto.

A consequência apareceu em produção: perguntado "tem alguma estadia para
reconciliar?", o `sogio-wa-bot` não tinha tool para checar se havia calendário
configurado, alcançou a mais parecida que tinha (`list_property_settings`,
outra tabela), viu lista vazia e afirmou ao usuário que nenhum calendário
estava configurado — enquanto `reconcile_external_bookings` devolvia uma
reserva real do Airbnb para o mesmo imóvel. Uma IA sem tool de leitura não
responde "não sei": ela chuta com a tool errada.

Esta entrega fecha o CRUD nos dois transportes, na mesma entrega, como a
superfície MCP obrigatória exige.

## Personas

- **Arquiteto** (`opus`) — decisões de domínio abaixo.
- **Desenvolvedor** (`sonnet`) — implementação das tasks.
- **Analista de Segurança** (`opus`) — revisão final; ver R-1 abaixo, que é
  material dela.

## Decisões de arquitetura

**DA-1 — `PropertyOwnershipPolicy` é o portão, e o BC passa a usar o
`PropertyRepository` de `property_management`.** `CreateExternalBookingSourceUseCase`
hoje duplica a checagem inline (`property.user_id !== user_id`), porque usa
`BookingPropertyRepository`, cujo `propertyOfId` devolve `BookingProperty` e
não `Property`. Isso contraria o `CLAUDE.md` ("nunca duplicar essa checagem
inline") e, pior, **não olha `deleted_at`**: o caminho atual deixa cadastrar
calendário em imóvel já excluído. Os quatro casos de uso novos usam
`PropertyRepository` + `PropertyOwnershipPolicy`, mesmo idioma de
`FindPropertyStaysUseCase` e `GetStayUseCase`, que já vivem em `booking` e já
importam de `property_management`. O caso de uso de criação é corrigido junto,
porque deixá-lo de fora manteria dois portões diferentes na mesma entidade.

**DA-2 — `allFromProperty` passa a filtrar `deleted_at`.** Hoje não filtra, e
sem isso o soft delete não desligaria nada: `ReconcileExternalBookingsUseCase`
continuaria baixando o iCal de um calendário "removido". O filtro é o que faz
a remoção significar alguma coisa.

**DA-3 — A listagem não é paginada, deliberadamente.** `list_property_settings`
é paginada e por isso a descrição da tool carrega um aviso de meia linha
pedindo à IA que pagine antes de concluir ausência. O defeito que originou esta
entrega é exatamente uma IA concluindo ausência rápido demais. Um imóvel tem
um punhado de calendários (o registro conhecido tem 8 plataformas), então
devolver todos de uma vez elimina a classe de erro em vez de documentá-la.
Não há novo risco de resposta ilimitada: `reconcile` já carrega o conjunto
inteiro pelo mesmo `allFromProperty`.

**DA-4 — Remoção é soft delete, coerente com o resto do projeto.** A linha
fica, `deleted_at` é marcado, e a entidade some de toda leitura. Remover duas
vezes é `404` na segunda.

**DA-5 — `platform_name` e `sync_url` são editáveis; `property_id` não.**
Mover um calendário de imóvel é criar outro, não editar este — mesma disciplina
de `key` imutável em `PropertySetting`. A edição reusa a normalização de
`platform_name` que `create()` já aplica (trim, maiúsculas, espaço/hífen vira
underscore), para que um valor gravado pela edição seja indistinguível de um
gravado pela criação.

**DA-6 — Sem tool nova de "testar o calendário".** Validar se a URL responde
iCal válido é trabalho de rede dentro de um request; quem já faz isso é
`reconcile_external_bookings`. Uma tool de teste seria um segundo caminho para
a mesma pergunta.

## Riscos

**R-1 — `sync_url` é uma URL-capacidade, e o soft delete não a redige.** Uma
URL de iCal do Airbnb carrega um token no próprio endereço
(`...ical/12345.ics?s=abcdef...`): quem tem a URL lê o calendário. `PropertySetting.softDelete()`
redige `value` justamente por isso, mas `external_booking_sources.sync_url` é
`notNull` no schema, então redigir exigiria migration. Risco **aceito nesta
entrega**, registrado aqui: a linha removida guarda a URL indefinidamente. Vale
uma entrega própria (tornar a coluna anulável e redigir no soft delete), não
um puxadinho desta.

**R-2 — A leitura expõe `sync_url` de volta ao chamador.** É dado do próprio
usuário, atrás de `PropertyOwnershipPolicy`, e é o que ele precisa ver para
saber qual calendário está conectado. Sem exposição não há CRUD de leitura.
Aceito, mas é o ponto a olhar na revisão de segurança.

**R-3 — Nenhum teto de calendários por imóvel.** Já era assim antes desta
entrega (a criação nunca teve limite) e a listagem não piora nada, mas com
leitura disponível o buraco fica visível. Fora de escopo.

## Mapped Changes

- **`src/booking/domain/entity/external_booking_source.ts`** — ganha `update()`
  (patch parcial de `platform_name`/`sync_url`, normalizando o primeiro e
  empurrando `updated_at`) e `softDelete()`.
- **`src/booking/domain/repository/external_booking_source_repository.ts`** —
  ganha `externalBookingSourceOfId`, `update` e `delete`.
- **`src/booking/infra/database/postgres_repository/external_booking_source_postgres_repository.ts`**
  — implementa os três; `allFromProperty` e `externalBookingSourceOfId`
  filtram `deleted_at` (DA-2).
- **`src/booking/application/use_case/property/list_external_booking_sources.ts`** — novo.
- **`src/booking/application/use_case/property/get_external_booking_source.ts`** — novo.
- **`src/booking/application/use_case/property/update_external_booking_source.ts`** — novo.
- **`src/booking/application/use_case/property/delete_external_booking_source.ts`** — novo.
- **`src/booking/application/use_case/property/create_external_booking_source.ts`** —
  troca a checagem inline por `PropertyOwnershipPolicy` (DA-1).
- **`src/booking/presentation/controller/property/*.controller.ts`** — quatro
  controllers novos sob `/booking/property/:property_id/external-booking`.
- **`src/booking/presentation/mcp_tool/*.mcp_tool.ts`** — quatro tools novas.
- **`src/booking/infra/di/property_di.ts`** — passa a instanciar o
  `PropertyPostgresRepository` de `property_management` e expõe os factories
  novos.
- **`src/core/infra/http/routes/routes.ts`** — quatro rotas novas.
- **`src/core/infra/mcp/routes.ts`** — quatro tools no array.
- **`tests/booking/external_booking_source_crud.test.ts`** — novo.
- **`CLAUDE.md`** — registra o CRUD e as decisões acima.

## Tasks

1. **Domínio e repositório** — `update()`/`softDelete()` na entidade, três
   métodos novos na interface e na implementação Postgres, filtro de
   `deleted_at` em `allFromProperty`.
   - Dependencies: none
2. **Casos de uso** — os quatro novos, mais a correção de DA-1 na criação.
   - Dependencies: task 1
3. **Controllers HTTP** — list, get, update, delete, com `openApiSpec`.
   - Dependencies: task 2
4. **Tools MCP** — as quatro correspondentes.
   - Dependencies: task 2
5. **Wiring** — `PropertyDi`, `routes.ts` e `core/infra/mcp/routes.ts`.
   - Dependencies: tasks 3, 4
6. **Testes** — CRUD completo, posse, soft delete invisível para `reconcile`,
   404 de imóvel de terceiro.
   - Dependencies: task 5
7. **Documentação** — seção no `CLAUDE.md`.
   - Dependencies: task 5

> Tasks 3 e 4 não dependem uma da outra e podem correr em paralelo.
