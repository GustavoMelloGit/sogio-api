# Exclusão de propriedade — a saída de autosserviço que hoje não existe

> Empilhado em cima de `add-billing-subscriptions` (base: `ff2a667`, "fix: verify property ownership before recording revenue"), **não** de `main`.
> Desbloqueia o **R-6** de `.claude/plans/2026-08-16-add-quota-enforcement.md`, que ficou pausado esperando esta entrega.

## Objective

Dar ao proprietário a capacidade de **excluir uma propriedade** — hoje inexistente em qualquer superfície (HTTP ou MCP). Sem ela, uma conta que caiu do Pro para o Free com 5 propriedades não tem nenhuma ação de autosserviço capaz de a trazer de volta para dentro da cota: a única saída é voltar a pagar. Esta entrega cria a rota `DELETE /property/:property_id` com **soft delete**, define o que acontece com tudo que está pendurado na propriedade (estadias, ledger, configurações, sincronização iCal, hóspedes) e fecha os 17 pontos do código que hoje leriam uma propriedade excluída como se ela existisse.

---

## Personas

- **Arquiteto** (`.claude/personas/arquiteto.md`, `model: opus`) — autor deste plano
- **Desenvolvedor** (`.claude/personas/desenvolvedor.md`, `model: sonnet`) — execução das tasks
- **Analista de Segurança** (`.claude/personas/analista_seguranca.md`, `model: opus`) — revisão **obrigatória** das tasks 4, 6 e 7. Três motivos independentes: (i) a task 6 corrige um IDOR pré-existente descoberto neste levantamento — `FindPropertyFinancialMovementsUseCase` não verifica dono nenhum (**R-1**); (ii) a entrega é uma operação **destrutiva** sobre inventário do usuário, e a ordem `404 antes de 409` é o que impede a resposta virar oráculo de existência (**DA-8**); (iii) o critério de "a propriedade excluída sumiu de todo lugar?" é uma varredura de 17 pontos em 3 bounded contexts (**§2.3**) — errar um é vazamento silencioso.

---

## 1. Análise de Negócio

### O problema

O produto tem um caminho de entrada sem caminho de saída. `property_management` expõe **create, update, findAll, findOne** e o CRUD de `PropertySetting` — e nada mais. O schema tem `deleted_at` em toda tabela via `baseSchema`, `PropertyRepository.countFromUser` já filtra por ele, e `PropertyOwnershipPolicy` já trata `property.deleted_at` como 404 desde a entrega de Property Settings — mas **nenhum caminho de usuário escreve nessa coluna**. A infraestrutura de exclusão existe inteira e nunca foi ligada.

Três consequências, em ordem de gravidade:

1. **A cota vira uma prisão.** Combinada com a DA-11 de billing (downgrade não é bloqueado, a conta fica grandfathered acima do teto), a ausência de exclusão faz o enforcement de cota — a próxima entrega — deixar de ser "reduza ou faça upgrade" e virar "pague ou fique em modo somente-leitura para sempre". Um proprietário que quer voltar ao Sogio com **uma** propriedade não tem como.
2. **Inventário sujo permanente.** Propriedade vendida, contrato encerrado, cadastro duplicado, teste feito no onboarding — tudo fica no dashboard para sempre, contaminando KPIs e a lista de propriedades.
3. **Suporte manual.** Hoje a única exclusão possível é um `UPDATE` manual no banco por alguém com acesso de produção. Isso não escala e não é auditável.

### O que a entrega dá ao proprietário

Controle sobre o próprio inventário, com uma promessa estreita e honesta: **excluir uma propriedade a remove da sua visão do produto, sem destruir o histórico contábil no banco e sem tocar em nenhuma estadia em curso** — porque a exclusão é recusada enquanto houver estadia futura ou em andamento (DA-4). Nenhum hóspede é surpreendido, nenhuma fechadura é destravada por acidente, nenhum lançamento financeiro é apagado.

### O que esta entrega explicitamente NÃO é

- **Não é exclusão de conta.** `AuthPostgresRepository.purgeUserData` continua sendo o caminho de LGPD (hard delete, exigência legal). São mecanismos diferentes com justificativas diferentes — ver DA-1.
- **Não é lixeira / restauração.** Não há rota de restore, nem `restore()` na entidade, nem `?include_deleted`. Soft delete aqui é escolha de **reversibilidade operacional** (um `UPDATE` de suporte desfaz um engano), não uma feature de produto. Ver DA-9.
- **Não é cascata destrutiva.** A exclusão **não** cancela estadias, **não** apaga `LedgerEntry`, **não** apaga `PropertySetting`, **não** apaga `ExternalBookingSource`. Ver DA-5, DA-6, DA-7.
- **Não é o enforcement de cota.** Aquele plano (`2026-08-16-add-quota-enforcement.md`) continua separado e passa a estar desbloqueado depois desta entrega.
- **Não muda o `blocked_reason` nem a DA-9 de billing.** Uma conta bloqueada por assinatura vencida continua bloqueada, inclusive para excluir. Ver DA-10.

---

## 2. Análise de Domínio

### 2.1 Linguagem Ubíqua

| Termo                    | Significado                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Excluir propriedade**  | Marcar `Property.deleted_at`. O verbo do produto é **excluir/delete**, não "arquivar" nem "desativar" — o código já fala essa língua (`deleted_at`, `PropertyOwnershipPolicy`, `DeletePropertySettingController`). Não inventar sinônimo.      |
| **Propriedade excluída** | `deleted_at IS NOT NULL`. Invisível em toda superfície de leitura e escrita do usuário; a linha permanece no banco.                                                                                                                            |
| **Propriedade ativa**    | `deleted_at IS NULL`. Já é a semântica de `countFromUser`.                                                                                                                                                                                     |
| **Estadia pendente**     | Estadia da propriedade com `check_out >= agora` e `deleted_at IS NULL` — cobre a **futura** e a **em andamento** de uma vez. É exatamente a semântica que `StayRepository.allFutureFromProperty` já implementa. É o que **impede** a exclusão. |
| **Histórico contábil**   | As `LedgerEntry` da propriedade. Preservadas no banco, deixam de ser servidas. Ver DA-6 e R-4.                                                                                                                                                 |

### 2.2 A que contexto pertence a exclusão

`Property` (o catálogo do imóvel) é agregado de **`property_management`**, e é `PropertyRepository` que escreve nessa linha. A exclusão pertence, sem ambiguidade, a `property_management`. `BookingProperty` é o outro agregado sobre a **mesma linha** (`propertiesTable`), mas `booking` é conformista de leitura: nunca escreveu em `properties` e não deve começar agora.

A "Observação Arquitetural Importante" da persona não é ferida: `DeletePropertyUseCase` não lê capacidade, não reserva nada, não conhece `Stay`. Ele faz uma única pergunta ao mundo de fora — _"esta propriedade tem estadia pendente?"_ — e essa pergunta é feita por uma **porta declarada em `property_management`**, não importando `booking`. Ver DA-3, que é a decisão mais delicada do plano.

### 2.3 Levantamento: tudo que referencia uma `Property` hoje

Este é o cerne do trabalho. Levantado no código, não presumido. **Nenhum destes filtra `deleted_at` hoje** (salvo onde indicado), portanto todos leriam uma propriedade excluída como existente.

#### `property_management`

| Ponto                                                                                   | Situação hoje                                                               | O que precisa acontecer                                       |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `PropertyPostgresRepository.propertyOfId`                                               | não filtra                                                                  | **NÃO filtrar** — carga é load-bearing para `save()`. Ver R-2 |
| `PropertyPostgresRepository.allFromUser`                                                | não filtra                                                                  | filtrar `deleted_at IS NULL`                                  |
| `PropertyPostgresRepository.countFromUser`                                              | **já filtra**                                                               | nada                                                          |
| `PropertyPostgresRepository.saveNewWithinQuota`                                         | **já filtra** (conta dentro da transação)                                   | nada                                                          |
| `FindPropertyUseCase` (`GET /property/:id`)                                             | checagem inline sem `deleted_at`                                            | passar pela `PropertyOwnershipPolicy`                         |
| `UpdatePropertyUseCase` (`PATCH /property/:id`)                                         | checagem inline sem `deleted_at`                                            | passar pela `PropertyOwnershipPolicy`                         |
| `FindUserPropertiesUseCase` (`GET /property/user/all` **e** tool MCP `list_properties`) | usa `allFromUser`                                                           | corrigido pelo filtro no repositório                          |
| `CreatePropertyUseCase`                                                                 | correto                                                                     | nada                                                          |
| 5 use cases de `PropertySetting` (HTTP + 5 tools MCP)                                   | **já corretos** — usam `PropertyOwnershipPolicy`, que já trata `deleted_at` | **nada** — é o retorno de investimento da policy já existente |

#### `booking`

| Ponto                                                                                  | Situação hoje                                                               | O que precisa acontecer                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `BookingPropertyPostgresRepository.propertyOfId`                                       | não filtra                                                                  | filtrar `deleted_at IS NULL`                             |
| `BookingPropertyPostgresRepository.allFromUser`                                        | não filtra                                                                  | filtrar `deleted_at IS NULL`                             |
| `BookStayUseCase` (HTTP + tool MCP `book_stay`)                                        | inline, sem `deleted_at`                                                    | corrigido pelo filtro no repositório de `booking`        |
| `CreateExternalBookingSourceUseCase`                                                   | inline, sem `deleted_at`                                                    | idem                                                     |
| `ReconcileExternalBookingsUseCase` (sync iCal)                                         | itera `allFromUser`                                                         | idem — a sync para sozinha. Ver DA-7                     |
| `GetStayUseCase`, `UpdateStayUseCase`, `CancelStayUseCase`, `FindPropertyStaysUseCase` | resolvem a `Property` de `property_management` para posse, sem `deleted_at` | passar pela policy com rótulo `"Stay"` (DA-2)            |
| `GetDashboardOverviewUseCase` (`GET /dashboard/overview`)                              | `PropertyRepository.allFromUser`                                            | corrigido pelo filtro em `property_management`           |
| `TenantPostgresRepository.findByOwnerProperties` (`GET /tenants`)                      | join em `properties` sem `deleted_at`                                       | filtrar. Ver R-5 (menor convicção do plano)              |
| `StayPostgresRepository.dashboardStats`                                                | recebe `propertyIds` já filtrados                                           | nada                                                     |
| `GetPublicStayUseCase` (`/public/booking/stay/:id`, sem auth)                          | não resolve `Property`                                                      | **nada** — e é deliberado. Ver DA-4                      |
| `PostgresBookingPolicy.isBookingAllowed`                                               | só olha `stays`                                                             | nada (nenhuma estadia nova alcança propriedade excluída) |

#### `finance`

| Ponto                                                                        | Situação hoje                                              | O que precisa acontecer             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| `RecordExpenseUseCase`                                                       | inline, sem `deleted_at`                                   | passar pela policy                  |
| `RecordRevenueUseCase`                                                       | inline, sem `deleted_at` (posse já corrigida em `ff2a667`) | passar pela policy                  |
| `FindPropertyFinancialMovementsUseCase`                                      | 🔴 **nenhuma verificação de posse**                        | posse + `deleted_at`. **R-1**       |
| `LedgerEntryPostgresRepository.monthlyRevenueForProperties`                  | recebe `propertyIds` já filtrados                          | nada                                |
| Handlers `RecordRevenueOnStayPaymentConfirmed` / `RevertRevenueOnStayCancel` | escrevem direto no repositório                             | **nada** — e é deliberado. Ver DA-5 |

#### Banco — topologia de chaves estrangeiras (decide soft vs hard delete)

| FK                                        | `ON DELETE`                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `stays.property_id → properties`          | **cascade**                                                                |
| `ledger_entries.property_id → properties` | **cascade**                                                                |
| `external_booking_sources.property_id`    | **no action**                                                              |
| `property_settings.property_id`           | **no action**                                                              |
| `properties.address_id → addresses`       | cascade (direção inversa — o endereço **não** é apagado junto; fica órfão) |

### 2.4 Eventos de domínio: nenhum é necessário

Não existe hoje evento com `property_id` cujo handler precise reagir a uma exclusão. Os dois handlers do `finance` (`StayBookedEvent`, `StayCanceledEvent`) são disparados por fatos de **estadia**, e a DA-4 garante que uma propriedade excluída não tem estadia pendente. Ver DA-11 para a rejeição explícita de `PropertyDeletedEvent`.

---

## 3. Decisões Arquiteturais

### DA-1 — Soft delete, confirmado. E não é a mesma decisão de `purgeUserData`

**Decisão: marcar `deleted_at`, manter a linha.** Quatro razões, em ordem de força:

1. **Hard delete destruiria o histórico financeiro em silêncio.** `ledger_entries.property_id` e `stays.property_id` são `ON DELETE cascade`. Um `DELETE FROM properties` apagaria, sem aviso e sem recuperação, todo o ledger e todas as estadias daquele imóvel. Um clique de UI não pode ter esse alcance.
2. **Hard delete simplesmente falharia.** `external_booking_sources` e `property_settings` referenciam `properties` com `ON DELETE no action`. É exatamente o problema documentado no comentário de `purgeUserData`, que precisou apagar essas duas tabelas explicitamente e em ordem. Replicar isso aqui significaria escrever uma orquestração de exclusão em cascata de quatro tabelas em três bounded contexts — muito código destrutivo para um requisito que não pede destruição.
3. **Não há exigência legal.** `purgeUserData` é hard delete porque a LGPD manda apagar dado pessoal quando o titular pede a exclusão da **conta**. Excluir uma propriedade não é um pedido de exclusão de dado pessoal: é uma decisão de inventário do próprio proprietário sobre um bem dele. A justificativa que força o hard delete lá não existe aqui.
4. **É o padrão da casa.** Toda entidade estende `BaseEntity` com `deleted_at`; `Stay.cancel()`, `PropertySetting.softDelete()` e `countFromUser` já operam nessa semântica. E `PropertyOwnershipPolicy` **já** foi escrita antecipando propriedade excluída — o comentário dela diz literalmente _"or keep operating on settings scoped to a property the owner already deleted"_. Esta entrega é a metade que faltava de uma decisão já tomada.

### DA-2 — `PropertyOwnershipPolicy` vira o portão único, com rótulo de recurso opcional

A policy já responde exatamente à pergunta certa e colapsa os três casos — inexistente, de outro dono, excluída — em `ResourceNotFoundError` (404). O que falta é ser usada em todo lugar.

Alteração mínima: um segundo parâmetro opcional com o nome do recurso, default `"Property"`.

```
ensureOwnership(property, user, resourceLabel = "Property"): Property
```

Motivo do parâmetro: quatro use cases de `booking` (`GetStay`, `UpdateStay`, `CancelStay`, `FindPropertyStays`) hoje lançam deliberadamente `ResourceNotFoundError("Stay")` quando o chamador não é dono da propriedade — dizer "Property" ali confirmaria ao estranho que existe uma propriedade por trás daquela estadia. O parâmetro preserva essa escolha e permite um portão só.

Sem o parâmetro, o Desenvolvedor faria checagem inline em `booking` e o plano voltaria a ter dois mecanismos.

**Passam a usar a policy:** `FindProperty`, `UpdateProperty` (property_management); `RecordExpense`, `RecordRevenue`, `FindPropertyFinancialMovements` (finance); `GetStay`, `UpdateStay`, `CancelStay`, `FindPropertyStays` (booking, com rótulo `"Stay"`).

### DA-3 — A pergunta "tem estadia pendente?" atravessa contextos por uma **porta declarada em `property_management`**

Esta é a decisão que mais fácil sairia errada.

`DeletePropertyUseCase` vive em `property_management` e precisa de um fato que só `booking` conhece. O reflexo é publicar um Open Host Service em `booking` e consumi-lo de `property_management` — espelhando a DA-2/DA-8 do plano de cota. **Isso está errado aqui**: aquele plano estabelece `booking → property_management` (`PropertyQuotaService`). Adicionar `property_management → booking` fecharia um **ciclo** conceitual entre as camadas `application` dos dois contextos — precisamente o que a DA-11 de billing rejeitou nominalmente para o par `billing ⇄ property_management`.

**Decisão: inversão de dependência.** A interface é declarada em `property_management` (o contexto que **precisa** do fato) e implementada em `booking` (o contexto que **tem** o fato):

```
src/property_management/domain/service/property_occupancy.ts   (interface)
    hasPendingStays(property_id: string): Promise<boolean>

src/booking/application/service/stay_property_occupancy.ts     (implementação)
    sobre StayRepository.allFutureFromProperty
```

Direção da dependência de código: **`booking → property_management`**, a mesma de todas as outras 7 importações que já existem. Zero ciclo. `property_management` não ganha nenhuma importação nova.

Decisões dentro desta:

- **Nome no vocabulário de `property_management`, não de `booking`.** A interface fala de "ocupação" da propriedade, não de `Stay` — o contexto que declara a porta não deve aprender o vocabulário do outro. `hasPendingStays` é o limite aceitável de vazamento (é o termo do produto, e "estadia" já é palavra do domínio compartilhado).
- **Retorna `boolean`, não lança.** Ao contrário do idioma `ensure*` das policies: aqui quem decide o que fazer com o fato é o use case, e a porta é uma **consulta**, não uma regra. Manter a regra ("não se exclui propriedade ocupada") dentro de `property_management` é o ponto todo da inversão.
- **Reusa `StayRepository.allFutureFromProperty`** (`check_out >= now`, `deleted_at IS NULL`) — a semântica já é exatamente "futura ou em andamento". Um `count` dedicado seria mais barato, mas é otimização; registrado, não feito.
- **Interface de um método só**, sem parâmetro de usuário: a posse já foi resolvida antes de chamá-la (DA-8). Interface estreita para não haver o que abusar.

### DA-4 — Propriedade com estadia pendente **não** pode ser excluída → `ConflictError` (409)

**Decisão: recusar.** As duas alternativas — excluir mesmo assim, ou cancelar as estadias em cascata — são ambas piores, e por motivos concretos:

**Por que não excluir mesmo assim:**

- A estadia carrega um `entrance_code` que foi **fisicamente programado numa fechadura** (`StayBookedEvent` → `CreateTempPasswordOnBook` → `TuyaDeviceManagement.setTempPassword`). Não existe, em lugar nenhum do código, um caminho que **remova** essa senha. O hóspede continuaria entrando no imóvel, e o proprietário não teria mais nenhuma tela onde ver aquela estadia. É consequência física, não de dado.
- `GET /public/booking/stay/:stay_id` é **não autenticado** — o link do próprio hóspede. Continuaria funcionando (corretamente, ver DA-4 abaixo), produzindo o pior estado possível: uma estadia visível para o hóspede e invisível para o dono.

**Por que não cancelar em cascata:**

- Cada cancelamento dispara `StayCanceledEvent` → `RevertRevenueOnStayCancel`, que grava um estorno no ledger. Um `DELETE` que emite N lançamentos financeiros de estorno é um efeito colateral desproporcional e surpreendente.
- A invariante existente **"estadias iniciadas não podem ser canceladas"** (`Stay.cancel()` lança `IllegalStateError`) tornaria a cascata **parcialmente impossível** justamente no caso que mais importa: a estadia em andamento. O `DELETE` falharia no meio, com parte das estadias já cancelada e o ledger já estornado.

Recusar **reusa** a invariante em vez de brigar com ela. O proprietário cancela as estadias futuras pela rota que já existe, espera a estadia em curso terminar, e então exclui. O fluxo é mais longo, mas cada passo é uma decisão explícita dele.

Erro: `ConflictError` → **409** (já mapeado no adaptador HTTP e no `mcp_error_mapper`). Mensagem em inglês, acionável:

```
This property has upcoming or in-progress stays. Cancel them before deleting it.
```

**Corolário — `GetPublicStayUseCase` fica intocado, e é deliberado.** Ele não resolve `Property` hoje. Como a DA-4 garante que uma propriedade excluída não tem estadia pendente, o único link público que sobreviveria aponta para estadia **passada** — informação que o hóspede já teve e que não vaza nada sobre o inventário atual do dono. Acrescentar a checagem ali custaria uma consulta a `properties` numa rota pública sem auth, em troca de nada.

### DA-5 — `LedgerEntry`: preservar no banco, parar de servir

**Decisão: nenhuma escrita.** Nem apagar, nem soft-deletar, nem estornar. As linhas ficam exatamente como estão.

- Dado contábil é dado fiscal. O proprietário pode precisar dele para imposto anos depois. Um clique de UI não pode destruí-lo.
- Como a propriedade vira 404 em `GET /finance/properties/:id/movements` (task 6) e some de `allFromUser`, o histórico **deixa de ser alcançável** pela API. Isso é uma **lacuna real de produto**, não um detalhe: "excluí a propriedade e perdi o relatório de despesas de 2026". Registrada em **R-4** como candidata a entrega própria (relatórios históricos que atravessam propriedades excluídas), fora do escopo daqui.
- **Consequência no dashboard:** `monthly_revenue` passa a ignorar a propriedade excluída retroativamente, porque `GetDashboardOverviewUseCase` monta `propertyIds` a partir de `allFromUser`. Estadias e receita somem **juntas** — a alternativa (esconder as estadias e manter a receita) daria KPIs incoerentes. Aceito, e é a escolha consistente.

**Os dois handlers de evento do `finance` ficam de fora, deliberadamente.** `RecordRevenueOnStayPaymentConfirmed` e `RevertRevenueOnStayCancel` escrevem direto no `LedgerEntryRepository`, sem passar por use case. Nada neste plano os afeta, e assim deve permanecer: eles reagem a fatos de estadia já consumados, e a DA-4 garante que não há estadia pendente numa propriedade excluída.

### DA-6 — `Property.softDelete()` **não** redige endereço nem imagens

`PropertySetting.softDelete()` zera `value` e `description`. Não replicar aqui:

- A redação lá existe porque `PropertySetting` é um armazenamento de conteúdo **arbitrário fornecido pelo usuário**, cuja linha precisa sobreviver indefinidamente para sustentar o índice único parcial `(property_id, key)`. Problema diferente.
- Aqui, apagar nome e endereço tornaria **inúteis** as `LedgerEntry` e `Stay` preservadas — um lançamento contábil de um imóvel sem nome não serve para nada.
- E destruiria a reversibilidade operacional que é a razão de ser do soft delete (DA-9).
- A exigência legal de apagar dado pessoal continua atendida pelo caminho certo: `purgeUserData` (exclusão de conta), que é hard delete de verdade.

> Nota para o Revisor: a divergência de comportamento entre `PropertySetting.softDelete()` e `Property.softDelete()` é deliberada e está justificada aqui. Não tratar como inconsistência.

### DA-7 — `ExternalBookingSource`: nenhuma escrita; a sync para sozinha

O único caminho que lê fontes externas é `ReconcileExternalBookingsUseCase.#reconcileForProperty`, invocado exclusivamente a partir de `propertyRepository.allFromUser(user.id)`. Com o filtro de `deleted_at` nesse repositório (task 5), a propriedade excluída deixa de ser iterada e **a sincronização iCal para, sem nenhuma escrita**.

Não soft-deletar as fontes:

- `ExternalBookingSource` não tem `softDelete()` e `ExternalBookingSourcePostgresRepository.save()` só faz `INSERT` — não há caminho de update. Criar um é trabalho real por zero ganho comportamental.
- Manter as linhas torna a reversão operacional (DA-9) **completa**: restaurar a propriedade restaura a sync.
- `CreateExternalBookingSourceUseCase` passa a rejeitar propriedade excluída pelo filtro em `BookingPropertyPostgresRepository.propertyOfId`.

⚠️ **Ponto para o Analista de Segurança:** a `sync_url` de Airbnb/Booking é uma URL-segredo (quem a tem lê o calendário) e permanece no banco após a exclusão. É a mesma postura do ledger e do endereço — dado retido, não servido. Se for considerado inaceitável, a resposta correta é redigir a `sync_url` no soft delete, o que quebra a reversão. Registrado para decisão.

### DA-8 — Forma do use case e ordem das checagens

```
DeletePropertyUseCase.execute({ property_id }, user):
  1. property = propertyRepository.propertyOfId(property_id)
  2. PropertyOwnershipPolicy.ensureOwnership(property, user)      → 404
  3. if (await propertyOccupancy.hasPendingStays(property.id))    → 409
  4. property.softDelete()
  5. await propertyRepository.save(property)
```

- **A ordem `404 antes de 409` é obrigatória e é item de revisão de segurança.** Invertida, o 409 confirmaria a um estranho que a propriedade existe **e** que ela tem hóspedes agendados. Nunca 403 — a policy nunca emite 403.
- **Passo 4 é uma operação total, não lança.** `Property.softDelete(): void` apenas marca `deleted_at` e `updated_at`, mutando in-place (mesmo estilo de `changeDetails`, ao contrário do estilo imutável de `PropertySetting`). Deliberadamente **não** imita `Stay.cancel()`, que lança `IllegalStateError` para estado repetido: `IllegalStateError` mapeia para **500**, e um duplo-clique do usuário viraria erro de servidor. O portão contra estado repetido é o passo 2, que já devolve 404 para propriedade excluída.
- **Passo 5 reusa `PropertyRepository.save()`.** `#updateProperty` faz `.set(property.data)` e `property.data` inclui `deleted_at` — nenhum método novo de repositório é necessário. Ver R-2, que é a armadilha embutida nisso.
- `Output`: `void`. O controller devolve `undefined` → **204**, espelhando `DeletePropertySettingController`.

### DA-9 — Soft delete é reversível no banco; a exclusão é **definitiva no produto**

Duas afirmações que convivem, e a distinção precisa estar na descrição da rota:

- **No banco**, um `UPDATE properties SET deleted_at = NULL` de suporte desfaz um engano. Essa é a razão de ser do soft delete aqui.
- **No produto**, a exclusão é definitiva: sem rota de restore, sem lixeira, sem `?include_deleted`, sem `restore()` na entidade. O `openApiSpec` deve dizer que a operação é permanente, para que ninguém — usuário ou frontend — construa modelo mental de lixeira.

Restauração é uma segunda feature, não um apêndice: precisaria de checagem transacional de cota na volta (restaurar acima do teto tem de ser barrado, espelhando `saveNewWithinQuota`), de resolução de conflito de estadias reaparecendo, e de UI própria. Se um dia existir, é adição estritamente compatível — nunca uma surpresa de contrato.

### DA-10 — A rota **não** recebe `allowWithoutPlatformAccess`

Avaliado e rejeitado. Uma conta com assinatura vencida é bloqueada em toda rota `authenticated: true` (DA-9 de billing), e excluir propriedade **não desbloqueia nada** — só o pagamento restaura `has_platform_access`. A exceção existe para rotas sem as quais o usuário não consegue se desbloquear (conta própria, LGPD, checkout, portal); esta não é uma delas. Fail-closed por padrão.

Importante não confundir os dois estados: a conta **acima da cota** — a que esta entrega existe para socorrer — tem `has_platform_access: true` (a assinatura dela está em dia; o que está fora do lugar é o inventário). Ela passa pelo portão normalmente e o autosserviço funciona. Registrado aqui para que o Revisor veja que foi considerado.

### DA-11 — Nenhum `PropertyDeletedEvent`

Rejeitado explicitamente:

- **Nenhum handler teria trabalho.** `booking`, `finance` e as configurações ficam corretos puramente por filtrar/portar em `deleted_at` na leitura. É o mesmo princípio já codificado para `Entitlement`: **derivado na leitura, nunca materializado** — e pelo mesmo motivo (não há scheduler nem garantia de consistência de projeção neste projeto).
- **Um evento convidaria à cascata destrutiva.** O handler "óbvio" seria cancelar estadias e apagar configurações — exatamente o que a DA-4, a DA-5 e a DA-7 decidiram não fazer, e que dispararia estornos financeiros em massa.
- **A cota não precisa dele:** `countFromUser` já filtra `deleted_at`, então a conta volta a caber no plano no instante do `UPDATE`.

Contra-argumento registrado, não resolvido: se um dia a exclusão precisar **provocar** efeito (desvincular a fechadura inteligente, notificar hóspede, encerrar contrato por propriedade), o evento passa a ser necessário. Aí é entrega própria.

### DA-12 — Sem tool MCP `delete_property`

`delete_property_setting` existe como tool porque seu raio de destruição é uma chave de configuração. Uma propriedade inteira, com exclusão definitiva do ponto de vista do produto (DA-9), não é operação que se entrega a um agente LLM por padrão. Decisão deliberada, registrada para que a ausência não pareça esquecimento. Reavaliável depois, com confirmação explícita no protocolo.

---

## 4. Riscos e Questionamentos

### R-1 — 🔴 Descoberto no levantamento: `FindPropertyFinancialMovementsUseCase` não verifica dono nenhum (IDOR)

`FindPropertyFinancialMovementsController.handle(request)` nem recebe o `user`, e o use case vai direto ao repositório:

```ts
async execute(input: Input): Promise<Output> {
  const movements = await this.ledgerEntryRepository.findByPropertyId(...)
```

Consequência hoje, em produção: **qualquer usuário autenticado lê o ledger financeiro completo de qualquer propriedade do sistema**, de qualquer outra conta, bastando conhecer o UUID — valores, categorias e descrições de receitas e despesas alheias. É irmão do IDOR de `RecordRevenueUseCase` corrigido em `ff2a667`, mas no caminho de **leitura**, e continua aberto.

É também **bloqueador técnico desta entrega**: sem essa correção, a exclusão de propriedade seria cosmética exatamente na rota que mais precisa dela — o histórico financeiro da propriedade excluída continuaria servido para o mundo inteiro, e a promessa "excluir remove da sua visão do produto" seria falsa.

**Recomendação: corrigir aqui (task 6)**, com revisão do Analista de Segurança. Efeito colateral a mencionar no PR: a rota passa a responder **404** para propriedade de terceiro, onde hoje responde 200 com dados. Quebra de contrato desejada.

**Alternativa** — extrair para PR próprio e priorizado, se o usuário quiser o fix em produção antes desta feature. Nesse caso esta entrega fica bloqueada até o merge. **Decisão pendente — ver §7.**

### R-2 — 🔴 `propertyOfId` **precisa** continuar carregando linhas excluídas

`PropertyPostgresRepository.save()` decide entre `INSERT` e `UPDATE` chamando `propertyOfId` primeiro. Se alguém "consertar" `propertyOfId` acrescentando `isNull(deleted_at)`:

- a própria escrita do soft delete tomaria o caminho de `INSERT` → violação de chave primária → **a exclusão passa a falhar com 500**;
- e todo `save()` subsequente sobre propriedade excluída faria o mesmo.

É uma armadilha atraente, porque parece a correção óbvia e "simétrica" às outras. A separação de responsabilidades correta é: **o repositório carrega, a `PropertyOwnershipPolicy` autoriza.** `BookingPropertyPostgresRepository` pode filtrar na origem porque `booking` **nunca escreve** em `properties` — a assimetria entre os dois repositórios é intencional e precisa estar comentada no código.

Mitigação obrigatória: comentário de uma linha em `propertyOfId` + teste que exclui e reexclui a mesma propriedade esperando 404 (não 500).

### R-3 — 🟠 TOCTOU entre a checagem de estadia pendente e a marcação

Entre o passo 3 e o passo 5 da DA-8, uma reserva concorrente pode entrar. Resultado: estadia pendente numa propriedade excluída — com senha na fechadura e sem tela para o dono ver.

Probabilidade real: baixíssima (exige o **mesmo** dono disparando `DELETE` e `POST /book` no mesmo instante). Consequência: física, mas recuperável **apenas** por `UPDATE properties SET deleted_at = NULL` de suporte — `CancelStayUseCase` passa pela mesma `PropertyOwnershipPolicy` e também 404 numa propriedade excluída, então nem o próprio dono consegue cancelar a estadia por essa via. Corrigido pelo Analista de Segurança na revisão obrigatória (o texto original citava uma "rota pública de suporte" pra cancelamento que não existe).

**Recomendação: aceitar, e registrar.** A alternativa robusta existe e o projeto já tem o padrão: um `softDeleteIfUnoccupied(property, ensureUnoccupied)` no repositório, com `pg_advisory_xact_lock` namespaced por `property_id`, espelhando `saveNewWithinQuota`. Custa uma transação e um método de repositório a mais. **Decisão do usuário — ver §7.**

### R-4 — 🟠 O histórico financeiro fica preservado mas inacessível

Consequência direta da DA-5, e é a lacuna de produto mais visível da entrega: exclui a propriedade, perde o acesso ao relatório de despesas dela. O dado está no banco, mas nenhuma rota o serve.

Mitigações possíveis, todas fora do escopo: relatório financeiro consolidado por conta (não por propriedade); um `include_deleted` na listagem de movimentações, com posse verificada; exportação prévia no fluxo de exclusão. **Registrado, não resolvido.** Vale um aviso no frontend antes de confirmar a exclusão ("o histórico financeiro deixará de ser acessível") — preocupação de UI, não de backend.

### R-5 — 🟡 Hóspedes exclusivos da propriedade excluída somem de `GET /tenants`

`TenantPostgresRepository.findByOwnerProperties` faz `innerJoin` em `properties` sem filtrar `deleted_at`. Filtrar (task 5) é consistente com "tudo que é escopado pela propriedade some". Mas o efeito colateral é o proprietário **perder a lista de contatos** dos hóspedes que só se hospedaram naquele imóvel.

Hóspede que também ficou em propriedade ativa continua aparecendo (`selectDistinct` + `innerJoin`), então o dano é limitado. É a decisão de **menor convicção do plano**: consistência (esconder) versus utilidade (manter o contato). **Recomendação: esconder**, pela consistência — mas vale confirmação. **Ver §7.**

### R-6 — 🟡 A senha da fechadura sobrevive ao cancelamento, e portanto à exclusão

`CreateTempPasswordOnBook` programa a senha na fechadura via Tuya; **não existe handler nenhum que a remova** — nem no cancelamento da estadia, nem em lugar algum. É lacuna **pré-existente**, não criada aqui, e a DA-4 a contorna (não se exclui propriedade com estadia pendente). Mas o cenário "cancela a estadia futura → exclui a propriedade → a senha continua válida na fechadura até a data original" continua real.

Registrado para entrega própria (`RemoveTempPasswordOnStayCancel`, um handler de `StayCanceledEvent`). Fora do escopo.

### R-7 — 🟠 São 17 pontos de filtro em 3 bounded contexts; esquecer um é vazamento silencioso

Nenhum teste existente quebra se um dos filtros ficar de fora — a propriedade excluída simplesmente continua aparecendo em uma superfície. O sintoma seria descoberto por usuário, não por CI.

Mitigação obrigatória: o teste de varredura da task 8 (`propriedade excluída não aparece em nenhuma das 8 superfícies de leitura`) é **não-negociável** e deve cobrir HTTP **e** as tools MCP (`list_properties`, `book_stay`, e as 5 de settings), porque as tools não passam pelo adaptador HTTP.

### R-8 — 🟢 A `address` fica órfã

`properties.address_id → addresses` é o sentido em que a propriedade referencia o endereço; excluir a propriedade (mesmo hard) não apagaria a linha de `addresses`. Com soft delete a questão nem se coloca — e a reversão precisa do endereço intacto. `purgeUserData` já cuida disso na exclusão de conta. **Nenhuma ação.**

### R-9 — 🟢 Sequenciamento com o plano de enforcement de cota

Depois desta entrega, o plano de cota fica desbloqueado (seu R-6 era exatamente isto), e a **DA-7 dele muda**: a mensagem do 403 volta a ser `"Remove properties or upgrade your plan to add new records."`, que lá está explicitamente condicionada à existência desta rota. Hand-off registrado.

---

## 5. Mapeamento de Mudanças

### Arquivos novos

- **`src/property_management/domain/service/property_occupancy.ts`** — interface `PropertyOccupancy` com `hasPendingStays(property_id): Promise<boolean>`. Docblock de uma linha registrando que é a porta declarada por `property_management` e implementada por `booking` (DA-3), e por que a direção é essa.
- **`src/booking/application/service/stay_property_occupancy.ts`** — implementação sobre `StayRepository.allFutureFromProperty`. Zero regra própria.
- **`src/property_management/application/use_case/delete_property.ts`** — `DeletePropertyUseCase`, forma exata da DA-8.
- **`src/property_management/presentation/controller/delete_property.controller.ts`** — `DELETE /property/:property_id`, `inputSchema` estrito com `property_id` uuid, `rateLimitPolicy` espelhando `DeletePropertySettingController` (`peer-ip`, 60s, 30), `openApiSpec` com 204/401/404/409 e descrição afirmando que a exclusão é permanente (DA-9).
- **`tests/property_management/delete_property.test.ts`** — caminho feliz, posse, estado repetido, 409, e a varredura de invisibilidade do R-7.

### Arquivos alterados

**`property_management`**

- `domain/entity/property.ts` — `softDelete(): void` (marca `deleted_at` + `updated_at`, in-place, sem lançar — DA-8).
- `domain/policy/property_ownership_policy.ts` — terceiro parâmetro opcional `resourceLabel = "Property"` (DA-2). Comportamento default inalterado.
- `application/use_case/find_property.ts` — inline → `PropertyOwnershipPolicy`. Passa a receber `User` em vez de `user_id`.
- `application/use_case/update_property.ts` — idem.
- `infra/database/postgres_repository/property_postgres_repository.ts` — `allFromUser` filtra `deleted_at IS NULL`; **comentário em `propertyOfId`** explicando por que ele **não** filtra (R-2).
- `infra/di/property_management_di.ts` — construtor passa a receber `PropertyOccupancy`; `makeDeletePropertyUseCase()` e `makeDeletePropertyController()`.
- `presentation/controller/find_property.controller.ts`, `update_property.controller.ts` — repassar `user` em vez de `user.id`, se a assinatura do use case mudar.

**`booking`**

- `infra/database/postgres_repository/booking_property_repository.ts` — `propertyOfId` e `allFromUser` filtram `deleted_at IS NULL`, com comentário registrando a assimetria deliberada com `PropertyPostgresRepository` (booking nunca escreve em `properties`).
- `infra/database/postgres_repository/tenant_postgres_repository.ts` — `findByOwnerProperties` acrescenta `isNull(propertiesTable.deleted_at)` (R-5).
- `application/use_case/stay/get_stay.ts`, `update_stay.ts`, `cancel_stay.ts`, `find_property_stays.ts` — inline → `PropertyOwnershipPolicy.ensureOwnership(property, user, "Stay")`.
- `infra/di/stay_di.ts` — ajuste se a assinatura dos use cases acima mudar (`user_id` → `User` em `find_property_stays`).
- `presentation/controller/stay/find_property_stays.controller.ts` — idem.

**`finance`**

- `application/use_case/record_expense.ts`, `record_revenue.ts` — inline → `PropertyOwnershipPolicy`.
- `application/use_case/find_property_financial_movements.ts` — 🔴 **R-1**: recebe `PropertyRepository` por construtor, `execute(input, user)`, resolve a propriedade e passa pela policy antes de tocar no ledger.
- `presentation/controller/find_property_financial_movements.controller.ts` — `handle(request, user)`; `openApiSpec` já declara 404.
- `infra/di/finance_di.ts` — injetar `PropertyRepository` em `makeFindPropertyFinancialMovementsUseCase`.

**`core` / composition root**

- `src/core/infra/http/routes/routes.ts` — construir a implementação de `PropertyOccupancy` (a partir de `PropertyDi`/`StayDi`, ou diretamente sobre `StayPostgresRepository`) **antes** de `propertyManagementDi` e passá-la ao construtor; registrar a rota `DELETE /property/:property_id` em `propertyManagementControllers` com `authenticated: true` e **sem** `allowWithoutPlatformAccess` (DA-10). ⚠️ Ordem de construção: `propertyManagementDi` já é construído depois de `stayDi`, então não há inversão de TDZ — **confirmar** ao mexer.
- `src/core/infra/mcp/routes.ts` — **sem alteração** (DA-12). Listado para registrar que foi verificado.

**Documentação**

- `CLAUDE.md` — parágrafo curto na seção de arquitetura: exclusão de propriedade é soft delete; `PropertyOwnershipPolicy` é o portão único; `propertyOfId` **não** filtra `deleted_at` de propósito; propriedade com estadia pendente não é excluível.

---

## 6. Tasks

0. **🔴 Decisões do usuário (§7)** — R-1 (o IDOR de movimentações entra aqui ou vira PR próprio?), R-3 (guarda transacional ou aceitar o TOCTOU?), R-5 (esconder hóspedes exclusivos da propriedade excluída?). Nenhuma task começa antes.
   - Dependências: nenhuma

1. **Entidade + policy** — `Property.softDelete()` (DA-8) e `PropertyOwnershipPolicy` com `resourceLabel` opcional (DA-2). Nenhum comportamento default muda.
   - Dependências: task 0

2. **Porta `PropertyOccupancy`** — só a interface em `property_management/domain/service/`, um método, com o docblock explicando a inversão de direção da DA-3.
   - Dependências: task 0

3. **`StayPropertyOccupancy`** — implementação em `booking/application/service/` sobre `StayRepository.allFutureFromProperty`.
   - Dependências: task 2

4. **`DeletePropertyUseCase` + controller + `PropertyManagementDi`** — forma exata da DA-8, ordem `404 → 409` obrigatória, `204` no caminho feliz, `openApiSpec` afirmando permanência (DA-9). **Revisão obrigatória do Analista de Segurança.**
   - Dependências: tasks 1, 2

5. **Filtros de leitura em `property_management` e `booking`** — `PropertyPostgresRepository.allFromUser`; comentário anti-armadilha em `propertyOfId` (R-2); `BookingPropertyPostgresRepository.propertyOfId`/`allFromUser`; `TenantPostgresRepository.findByOwnerProperties` (conforme decisão do R-5).
   - Dependências: task 0
   - ⚠️ **Não** acrescentar `isNull(deleted_at)` em `PropertyPostgresRepository.propertyOfId`. Ver R-2.

6. **Portão de posse nos use cases** — `FindProperty`, `UpdateProperty` (pm); `GetStay`, `UpdateStay`, `CancelStay`, `FindPropertyStays` (booking, rótulo `"Stay"`); `RecordExpense`, `RecordRevenue` e — 🔴 **R-1** — `FindPropertyFinancialMovements` com posse **nova** (finance), mais os controllers e DIs afetados. **Revisão obrigatória do Analista de Segurança.**
   - Dependências: task 1

7. **Composition root** — instanciar `PropertyOccupancy`, injetar em `PropertyManagementDi`, registrar a rota `DELETE`. Verificar boot e que `/mcp` continua recebendo as mesmas instâncias de DI. **Revisão obrigatória do Analista de Segurança** (confirmar ausência de `allowWithoutPlatformAccess`, DA-10).
   - Dependências: tasks 3, 4, 5, 6

8. **Testes** —
   - caminho feliz: exclui propriedade sem estadia pendente → 204;
   - posse: excluir propriedade de terceiro → **404** (nunca 403, nunca 409);
   - estado repetido: excluir duas vezes → **404** na segunda, **não 500** (R-2);
   - **409**: propriedade com estadia futura e propriedade com estadia em andamento;
   - **409** não ocorre com estadia apenas passada, nem com estadia futura já cancelada;
   - **varredura de invisibilidade (R-7, o teste mais importante da entrega)**: após a exclusão, a propriedade some de `GET /property/user/all`, `GET /property/:id`, `PATCH /property/:id`, `GET /dashboard/overview` (KPIs e receita), `GET /booking/property/:id/stays`, `POST /booking/property/:id/book`, `POST /booking/property/:id/external-booking`, `GET /finance/properties/:id/movements`, `POST /finance/:id/expense`, `POST /finance/:id/revenue`, e as configurações da propriedade;
   - **cobertura pelas tools MCP**: `list_properties` não lista, `book_stay` recusa, as 5 tools de settings recusam — as tools não passam pelo adaptador HTTP;
   - **cota**: conta acima do teto que exclui uma propriedade volta a criar propriedade (`countFromUser` já filtra) — o teste que amarra esta entrega ao plano de cota;
   - **regressão de posse (R-1)**: usuário lê movimentações financeiras de propriedade de terceiro ⇒ **404**;
   - **sync iCal**: `POST /booking/reconcile-external-booking` deixa de reconciliar a propriedade excluída (DA-7);
   - `LedgerEntry` e `PropertySetting` **continuam existindo no banco** após a exclusão (DA-5, DA-6).
   - Dependências: task 7

9. **Documentação** — parágrafo no `CLAUDE.md` (DA-1, DA-2, DA-4 e R-2 em uma linha cada).
   - Dependências: task 7

> Tasks 1, 2 e 5 podem rodar em paralelo. A 3 depende só da 2. A 6 depende só da 1 e é paralela à 3, 4 e 5. A 4 depende da 1 e da 2.

---

## 7. Pendências de decisão do usuário

1. **R-1 — ✅ Resolvido: entra nesta entrega** (task 6). O IDOR de `FindPropertyFinancialMovements` é corrigido junto.
2. **R-3 — ✅ Resolvido: aceitar o TOCTOU**, registrado como dívida técnica conhecida. Sem guarda transacional nesta entrega.
3. **R-5 — ✅ Resolvido: hóspedes exclusivos da propriedade excluída somem de `GET /tenants`.** Consistência com o resto do sistema — tudo escopado pela propriedade some.
4. **DA-7 / segurança — a `sync_url` de Airbnb/Booking permanece no banco após a exclusão** (posição do usuário: nada é fisicamente apagado a não ser por purge de LGPD; soft delete vale pra todas as tabelas, sem exceção). Confirma a recomendação original do Arquiteto — a menos que o Analista de Segurança levante objeção na revisão obrigatória.

**Princípio geral confirmado pelo usuário, vale para toda a entrega**: nenhum dado é fisicamente excluído do banco em nenhuma tabela, exceto pelo fluxo de purge de dados por LGPD (`PurgeUserDataUseCase`). Toda exclusão nesta feature é soft delete — reforça DA-1 (soft delete da `Property`) e a decisão do item 4 acima.
