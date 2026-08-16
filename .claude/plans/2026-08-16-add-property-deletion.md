# Exclusão de propriedade — a saída de autosserviço que hoje não existe

> Empilhado em cima de `add-billing-subscriptions` (base: `ff2a667`, "fix: verify property ownership before recording revenue"), **não** de `main`.
> Desbloqueia o **R-6** de `.claude/plans/2026-08-16-add-quota-enforcement.md`, que ficou pausado esperando esta entrega.

> ## ⚠️ REVISÃO 2 — 2026-08-16, depois do PR #37
>
> O usuário reverteu duas decisões deste plano **depois** de ele ter sido implementado, revisado pelo Analista de Segurança e virado o PR #37:
>
> - **DA-4** (recusar a exclusão com 409 quando há estadia **pendente** — futura **ou** em andamento) → **revertida em parte**. A exclusão passa a **cancelar as estadias futuras em cascata**, tudo ou nada, e o 409 sobrevive **estreitado** para o único caso de estadia **em andamento agora**. Ver **§8.2**.
> - **DA-12** (sem tool MCP `delete_property`) → **revertida**, e a exigência virou **regra permanente do projeto**. Ver **§8.6**.
>
> As §§1–7 abaixo são o registro da decisão **original** e ficam intactas de propósito: uma reversão consciente é informação, e quem ler o plano precisa ver o argumento que foi derrubado, não só o que sobreviveu. Onde uma decisão foi revista há um marcador `⚠️ REVISTO` apontando para a §8.
>
> **A §8 tem precedência sobre qualquer coisa em conflito nas §§1–7.**

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

> ⚠️ **PARCIALMENTE REVISTO — ver §8.3 (DA-3-R).** A inversão de dependência (porta em `property_management`, implementação em `booking`) **sobrevive inteira** e é o que torna a cascata possível sem fechar ciclo. O que muda é a natureza da porta: ela deixa de ser uma **consulta** (`hasPendingStays → boolean`) e vira um **comando** (`releaseFutureOccupancy`), com a regra de negócio viajando por um callback, no idioma de `saveNewWithinQuota`. O parágrafo "Retorna `boolean`, não lança" abaixo está superado na forma; o princípio dele — a regra fica em `property_management` — continua honrado.

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

> ⚠️ **REVISTO EM PARTE — ver §8.2 (DA-4-R).** A exclusão passa a **cancelar** as estadias futuras em cascata: para elas o 409 deixa de existir. O 409 **sobrevive**, estreitado ao único caso de estadia **em andamento agora**. Os dois argumentos abaixo contra a cascata foram respondidos por duas decisões do usuário — estadia em andamento não é cancelada (resolve o conflito com `Stay.cancel()`) e tudo ou nada (resolve o estado parcial). O texto original fica como registro do que foi derrubado — e da parte que resistiu.

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

> ⚠️ **REVERTIDA — ver §8.6 (DA-12-R).** O usuário estabeleceu regra permanente: **todo caso de uso/endpoint novo nasce com a tool MCP correspondente**. O objetivo declarado é que o produto funcione independente de UI. A tool entra nesta entrega.

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

> ⚠️ **REAVALIADO — ver §8.7.** A janela muda de forma (agora é entre o cancelamento em cascata e o commit) e a consequência **piora**: a estadia que entrar na janela vira uma reserva futura viva numa propriedade excluída, sem ninguém que possa cancelá-la. A decisão de aceitar continua de pé, mas o registro do risco muda de peso.

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

> ⚠️ **ESCALADO PARA 🔴 — ver §8.7 (R-11).** Sob a DA-4 original a lacuna era contida (não se excluía propriedade com estadia pendente). Com a cascata, o sistema passa a cancelar N estadias de uma vez e a deixar N códigos de fechadura válidos numa propriedade que ninguém mais gerencia.

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

---

# 8. Revisão 2 — cascata de cancelamento e superfície MCP obrigatória

> Escrita em 2026-08-16, **depois** do PR #37. Incremental sobre o que já está implementado na branch `add-property-deletion` (11 commits, de `1eff183` a `fdc0c52`). Nada aqui é "do zero".

## 8.1 O que mudou, e por quê

Duas decisões de produto do usuário derrubam partes do desenho original:

**Mudança 1 — a cascata que a DA-4 rejeitou vira requisito.** Excluir a propriedade passa a cancelar as estadias automaticamente, sem bloquear. A posição do usuário: avisar sobre as consequências é responsabilidade do frontend; o backend executa a regra de negócio. Duas decisões dele respondem diretamente às duas objeções da DA-4:

| Objeção original da DA-4                                                              | Resposta do usuário                                                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Stay.cancel()` proíbe cancelar estadia iniciada ⇒ a cascata seria parcialmente impossível | **Estadia em andamento não é cancelada.** Só as futuras. A invariante deixa de ser contrariada. |
| A cascata poderia falhar no meio, deixando estado parcial (N estornos no ledger)       | **Tudo ou nada.** Qualquer falha ⇒ nada é aplicado, o usuário recebe erro e tenta de novo.       |

Ambas as respostas são boas e derrubam as objeções como estavam escritas. Restaram duas consequências que esta revisão levantou:

- **R-10 — a estadia em andamento sobrevivendo numa propriedade invisível.** ✅ **Resolvido:** o usuário aceitou a recomendação do Arquiteto de manter o 409 **estreitado** ao caso "há hóspede no imóvel agora". A cascata sobre as estadias futuras é integral; a órfã deixa de ser possível. Ver **§8.2** e o box no **R-10**.
- **R-11 — os códigos de fechadura dos cancelamentos em cascata.** ⚠️ **Aceito como dívida priorizada**, fora desta entrega. É o único risco 🔴 que ela deixa em aberto.

**Estado das decisões: as 4 pendências da §8.10 estão fechadas.** O plano está pronto para execução.

**Mudança 2 — MCP é requisito permanente.** Todo caso de uso/endpoint novo nasce com a tool MCP correspondente, para que o produto funcione independente de UI. A DA-12 é revertida e a regra é registrada no `CLAUDE.md`.

## 8.2 DA-4-R — Excluir a propriedade **libera a ocupação futura**; só a estadia **em andamento** bloqueia

> **✅ Decisão do usuário fechada (§8.10, item 1):** o 409 estreito foi aceito. Cancela-se em cascata tudo que é futuro; a exclusão é recusada **exclusivamente** enquanto houver hóspede no imóvel **agora**. A DA-4 original barrava também por estadia futura — que é o caso comum — e era isso que tornava a rota inútil na prática. O portão que sobra custa ao dono a espera até o check-out do hóspede atual: dias, não meses.

**Predicado exato, por situação da estadia:**

| Situação da estadia | Predicado                                                        | O que acontece                                                    |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Em andamento**    | `deleted_at IS NULL AND check_in <= agora AND check_out >= agora` | **Bloqueia a exclusão** → `ConflictError` (409). Nada é aplicado. |
| **Futura**          | `deleted_at IS NULL AND check_in > agora`                        | **Cancelada** — `Stay.cancel()` + `StayCanceledEvent`             |
| **Passada**         | `check_out < agora`                                              | Intocada                                                          |
| **Já cancelada**    | `deleted_at IS NOT NULL`                                         | Intocada (`Stay.cancel()` lançaria `IllegalStateError`)           |

Mensagem do 409, em inglês e acionável — substitui a da DA-4:

```
This property has a guest checked in right now. You can delete it once the current stay ends.
```

**Por que essa forma elimina a estadia órfã (R-10):** depois da exclusão, a propriedade não tem estadia futura (foram todas canceladas), não tem estadia em andamento (senão teria bloqueado) e não pode receber estadia nova (toda superfície de escrita 404 nela). Sobram só estadias passadas e canceladas — que não têm hóspede dentro do imóvel nem nada a gerenciar. **A classe inteira do problema desaparece**, e com ela a necessidade de o dono ter visibilidade de uma estadia numa propriedade que ele mesmo excluiu.

### Semântica e query — confirmadas, sem método novo de repositório

`StayRepository.allFutureFromProperty` devolve `check_out >= agora AND deleted_at IS NULL`, que é exatamente a **união** dos dois conjuntos que interessam. A partição é feita **no serviço**, em memória, por `check_in <= agora`:

- `check_in <= agora` → **em andamento** (o `check_out >= agora` já veio da query);
- `check_in > agora` → **futura**.

**Decisão: não criar método novo de repositório.** Três razões:

1. a partição precisa dos **dois** conjuntos na mesma operação (um para bloquear, outro para cancelar) — dois métodos seriam duas idas ao banco para responder à mesma pergunta;
2. `allFutureFromProperty` já é consumido por `ReconcileExternalBookingsUseCase`; reusá-lo sem tocar evita regressão colateral;
3. a invariante `check_in < check_out` (validada em `Stay`) garante que `check_in > agora ⇒ check_out > agora` — ou seja, **nenhuma estadia futura escapa** da query. A cobertura é completa, não aproximada.

### A corrida do `check_in` que vira "agora" — resolvida por 409, não por skip

`Stay.cancel()` compara `check_in` com `new Date()` **no momento da chamada**, não com o instante da query. Entre o `SELECT` e o `cancel()`, uma estadia classificada como futura pode começar.

Na revisão anterior a saída proposta era **pular** essa estadia. Com o 409 estreito isso ficou **errado**: pular produziria exatamente a órfã que a decisão #1 existe para eliminar — propriedade excluída com hóspede dentro. A saída correta agora é a **oposta**: rechecar `check_in > new Date()` imediatamente antes de cada `cancel()` e, se alguma já começou, **abortar a operação inteira com o mesmo `ConflictError`**. A transação faz rollback, o usuário recebe um 409 correto, e na tentativa seguinte a estadia já é classificada como em andamento pelo caminho normal. A corrida vira o comportamento certo em vez de um 500 ou de uma órfã.

### Forma revisada do use case (substitui a da DA-8)

```
DeletePropertyUseCase.execute({ property_id }, user):
  1. property = propertyRepository.propertyOfId(property_id)
  2. PropertyOwnershipPolicy.ensureOwnership(property, user)          → 404
  3. transactionRunner.run(async () => {                                ← DA-13
       canceled = await propertyOccupancy.releaseFutureOccupancy(
         property.id,
         ensureNoStayInProgress                                         → 409
       )
       property.softDelete()
       await propertyRepository.save(property)
     })
  4. return { canceled_stays: canceled }
```

- **A ordem `404` antes de tudo continua obrigatória e continua item de revisão de segurança.** Ela protege mais do que antes: sem ela, um estranho conseguiria **cancelar reservas alheias** mandando `DELETE` num UUID adivinhado. O passo 2 é a única coisa entre um `property_id` e o cancelamento em massa das reservas de outra pessoa. O 409 continua vindo **depois** do 404, pelo motivo original (não virar oráculo de existência).
- **A checagem de estadia em andamento acontece dentro da transação**, não antes dela. Fora, haveria uma janela entre "não há hóspede" e o commit. Dentro, o rollback é total e gratuito — nada foi escrito ainda.
- **Cancelar antes de marcar `deleted_at`**, na mesma transação. A ordem inversa faria qualquer leitura interna enxergar uma propriedade já excluída.
- **A porta nunca rechecha posse** (DA-3, "interface estreita"). A posse é do passo 2 e só dele.

### Retorno da rota: `200` com `{ "canceled_stays": 3 }`

> **✅ Decisão do usuário fechada (§8.10, item 3).**

Uma cascata destrutiva que não relata o que destruiu é uma ação silenciosa; o `204` original não serve mais. Duas sub-decisões, ambas consequência do 409 estreito:

- **`surviving_in_progress_stays` é descartado.** Com a decisão #1 ele seria **sempre `0`** no caminho de sucesso — estadia em andamento agora produz 409, não 200. Um campo constante é ruído que induz o frontend a tratar um caso que não existe.
- **Contador, não lista de ids.** Devolver os ids das estadias canceladas entregaria referências mortas: no instante do commit a propriedade está soft-deletada e **todo caminho de leitura de estadia dela responde 404** (`GET /booking/stay/:id`, `GET /booking/property/:id/stays`). O frontend não teria o que fazer com os ids; o que ele mostra é "3 reservas canceladas", e é o que a tool MCP precisa para relatar ao usuário.

`openApiSpec` final: **200** (com schema de corpo), **401**, **404**, **409** (só estadia em andamento).

**O aviso prévio ao usuário não exige endpoint novo.** A posição do usuário — "avisar é responsabilidade do frontend" — já é atendível hoje: `GET /booking/property/:property_id/stays` lista as estadias da propriedade e o frontend conta as futuras antes de mostrar o diálogo de confirmação. Nada a construir no backend.

## 8.3 DA-3-R — A porta `PropertyOccupancy` sobrevive, mas vira um **comando**

A inversão de dependência da DA-3 continua correta e é justamente o que torna a cascata possível sem fechar ciclo: a regra "excluir uma propriedade libera a ocupação futura dela" é uma regra de **`property_management`**; quem sabe executá-la é **`booking`**. Direção de código continua `booking → property_management`.

O que muda é a natureza da porta — e, com o 409 estreito, ela vira **um método só que faz a checagem e a liberação atomicamente**:

```
src/property_management/domain/service/property_occupancy.ts
-   hasPendingStays(propertyId: string): Promise<boolean>
+   releaseFutureOccupancy(
+     propertyId: string,
+     ensureNoStayInProgress: (inProgressCount: number) => void
+   ): Promise<number>   // quantas estadias futuras foram canceladas
```

**O callback é o ponto todo, e é o idioma já estabelecido da casa.** É exatamente a forma de `PropertyRepository.saveNewWithinQuota(property, ensureWithinQuota)`: quem executa a operação transacional lê o fato e **entrega o fato a um callback do chamador**, que é quem lança o erro de domínio. Assim:

- a **regra** ("não se exclui propriedade com hóspede dentro") continua morando em `property_management`, junto com o `ConflictError` — `booking` não aprende regra nenhuma de exclusão de propriedade;
- a **execução** e a **atomicidade** ficam em `booking`, que é quem sabe o que é uma estadia;
- a checagem e o cancelamento acontecem na **mesma passada, dentro da mesma transação**, sem uma segunda ida ao banco e sem janela entre as duas.

Corpo da implementação (`StayPropertyOccupancy`), na ordem:

1. `allFutureFromProperty(propertyId)` — uma query, o conjunto união (§8.2);
2. particiona por `check_in <= agora` → em andamento / futuras;
3. `ensureNoStayInProgress(emAndamento.length)` → lança `ConflictError` se houver;
4. para cada futura: recheca `check_in > new Date()` e, se alguma já começou, chama `ensureNoStayInProgress(1)` — mesmo erro, mesma regra, mesma origem (§8.2, a corrida);
5. cancela via `CancelStayService`;
6. devolve a contagem.

- **`hasPendingStays` some.** O predicado dela (`check_out >= agora`, futura **ou** em andamento) é justamente o que a decisão #1 desfez. Não manter "por precaução": porta larga é porta abusável.
- O parágrafo da DA-3 "**Retorna `boolean`, não lança** … a porta é uma **consulta**, não uma regra" está **parcialmente superado, e parcialmente honrado**: a porta virou comando, mas a regra continua fora de `booking` — ela só mudou de veículo, do retorno para o callback.
- **Vocabulário:** `releaseFutureOccupancy` continua falando a língua de `property_management` ("ocupação"), não a de `booking` ("estadia"). `inProgressCount` é um número, não uma `Stay` — nenhum agregado de `booking` atravessa a fronteira.

**Para não duplicar o que "cancelar uma estadia" significa**, extrair um `CancelStayService` em `booking/application/service/` com o corpo hoje dentro de `CancelStayUseCase` (`stay.cancel()` → `saveStay` → `dispatch(StayCanceledEvent)`). Passam a usá-lo:

- `CancelStayUseCase` — mantém lookup + `PropertyOwnershipPolicy(…, "Stay")` e delega. **Comportamento externo idêntico ao de hoje**;
- `StayPropertyOccupancy.releaseFutureOccupancy` — particiona e delega, sem recheckar posse.

Sem essa extração, o despacho do `StayCanceledEvent` existiria em dois lugares e o estorno no ledger sairia de sincronia no primeiro refactor.

## 8.4 DA-13 — Até onde "tudo ou nada" é realmente garantível (a resposta honesta)

### O que foi verificado no código, não presumido

| Fato                                                                                                                  | Onde                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `StayCanceledEvent` tem **exatamente um** handler: `RevertRevenueOnStayCancel`                                        | registrado só em `finance/infra/di/finance_di.ts:37`                    |
| Esse handler faz **uma única coisa**: `ledgerEntryRepository.save(...)` — uma escrita no Postgres                      | `finance/application/handler/revert_revenue_on_stay_cancel.ts`          |
| A integração com a fechadura (`CreateTempPasswordOnBook` → Tuya) escuta **`StayBookedEvent`**, não `StayCanceledEvent` | `booking/application/handler/create_temp_password_on_book.ts`           |
| **Não existe** nenhum handler que remova a senha da fechadura no cancelamento                                          | é a lacuna pré-existente **R-6**                                        |
| O dispatcher é **síncrono e in-process** (`await Promise.all(handlers…)`), dentro da cadeia de `await` de quem despacha | `core/infra/event/in_memory_event_dispatcher.ts`                        |

**Conclusão: hoje, cancelar uma estadia não produz nenhum efeito fora do Postgres.** Portanto **"tudo ou nada" é integralmente alcançável** — não é uma promessa que não conseguimos cumprir. Uma única transação de banco cobre 100% dos efeitos: o `deleted_at` da propriedade, os N `deleted_at` das estadias e os N estornos no ledger.

### O que **não** é garantível: a permanência dessa propriedade

A garantia é **contingente, não estrutural**. Nada no código impede alguém de registrar amanhã um handler de `StayCanceledEvent` que faça uma chamada HTTP — e **R-6 é exatamente esse handler, já planejado** (`RemoveTempPasswordOnStayCancel`). No dia em que ele existir:

- a transação deixa de cobrir tudo, **silenciosamente**, sem nenhum teste quebrando;
- e pior: uma chamada HTTP à Tuya **dentro** de uma transação de banco segura a transação aberta durante a latência da rede.

**Decisão, em três partes:**

1. **Agora:** implementar tudo ou nada como uma transação de banco única. É correto e completo para o comportamento de hoje.
2. **Invariante escrita** (código + `CLAUDE.md`): *nenhum handler de `StayCanceledEvent` pode produzir efeito fora do Postgres enquanto rodar dentro da transação de exclusão*. Acompanhada de um teste que falha se um handler externo for registrado (**R-15**).
3. **Quando R-6 chegar:** a remoção da senha **não** entra na transação. Ela é um efeito **pós-commit, idempotente e retentável** (at-least-once). Se falhar, a exclusão **permanece válida** e o efeito é retentado; o que não pode acontecer é a exclusão inteira ser desfeita porque a Tuya estava fora do ar. Ou seja, o contrato final é: **tudo ou nada no banco; efeitos externos consistentes por eventualidade e idempotentes**. Isso precisa estar dito na descrição da rota e da tool no dia em que deixar de ser vácuo.

> Não existe infra de outbox no projeto (`grep -rl outbox src` → nada). Quando R-6 vier, ou se cria a menor versão disso, ou o efeito é best-effort com log — e essa escolha é da entrega do R-6, não desta.

### Como conseguir uma transação atravessando três repositórios de três BCs

**Recomendado — contexto de transação ambiente em `core`:**

- `TransactionRunner` (porta em `core/application/transaction/`) com um único `run<T>(fn): Promise<T>`;
- implementação em `core/infra/database/` sobre `db.transaction`, guardando o executor corrente num `AsyncLocalStorage` (`node:async_hooks`, suportado pelo Bun);
- um `currentExecutor()` que devolve a transação ambiente **ou** `db` quando não há nenhuma;
- **exatamente três métodos** precisam aderir para este fluxo: `PropertyPostgresRepository.save` (caminho de `UPDATE`), `StayPostgresRepository.saveStay` (e o `stayOfId` que ele usa para decidir INSERT/UPDATE) e `LedgerEntryPostgresRepository.save`. Todo o resto continua usando `db` e se comporta exatamente como hoje.

Por que ambiente e não parâmetro: um executor explícito teria que atravessar uma **porta de `domain`** (`PropertyOccupancy`) e o **dispatcher de eventos** até um handler de outro BC — arrastando um tipo do Drizzle por três fronteiras de camada e obrigando a mudar a assinatura de `EventHandler`. O `AsyncLocalStorage` mantém as assinaturas limpas e a camada intacta. O preço é implicitude, mitigado por: um arquivo só, fallback idêntico ao comportamento atual, e um teste de rollback explícito.

O projeto já tem o vocabulário para isso: o alias `DbExecutor = db | tx` existe em `property_postgres_repository.ts:17` e os métodos privados já aceitam um executor.

**Alternativas rejeitadas, registradas:**

- **(A) Executor explícito pela porta e pelo dispatcher** — vaza Drizzle para `domain` e muda a assinatura de todo `EventHandler`. Rejeitada.
- **(B) Um método de repositório em SQL cru fazendo tudo**, espelhando `AuthPostgresRepository.purgeUserData` (que já escreve em tabelas de outros BCs dentro de uma `db.transaction`, com comentário justificando). É a alternativa mais barata e tem precedente na casa. **Rejeitada** porque reimplementaria em SQL as invariantes de `Stay.cancel()` e o estorno de `RevertRevenueOnStayCancel`, contornando o domínio e os handlers — divergiria em silêncio no dia em que a regra de cancelamento mudar. Fica registrada como plano B caso o `AsyncLocalStorage` dê problema no Bun.
- **(C) Sem transação, best-effort com compensações** — rejeitada: o usuário pediu tudo ou nada, e compensar escritas de ledger é pior que uma transação.

## 8.5 DA-14 — `GetPublicStayUseCase`: o corolário da DA-4 é **restaurado**, mas por um caminho novo

A DA-4 justificava não tocar em `GET /public/booking/stay/:stay_id` assim: *"como a DA-4 garante que uma propriedade excluída não tem estadia pendente, o único link público que sobreviveria aponta para estadia passada"*.

Com o 409 estreito (decisão #1), **a conclusão volta a valer**: uma propriedade excluída não tem estadia em andamento (teria bloqueado) nem futura (foram canceladas). **Decisão: `GetPublicStayUseCase` continua intocado.** Nenhuma mudança de código.

⚠️ **Mas o caminho até a conclusão mudou, e revela um fato que a DA-4 não previa.** Antes sobravam só estadias **passadas**. Agora sobram passadas **e canceladas pela cascata** — e, verificado no código, `GetPublicStayUseCase` **não filtra `deleted_at`**: ele faz `stayOfId` e devolve `check_in`, `check_out`, `entrance_code` e o nome do hóspede sem olhar se a estadia foi cancelada.

Consequência: o hóspede de uma reserva cancelada pela cascata **continua vendo a página com o código de entrada dele**, que — por **R-11** — continua válido na fechadura. As duas lacunas se somam: a página confirma o código, e o código funciona.

Isso **não** é criado por esta entrega (cancelar uma estadia manualmente sempre teve esse efeito), mas a cascata o multiplica por N. **Registrado em R-11**, não corrigido aqui: filtrar `deleted_at` nesse endpoint é mudança de contrato de uma rota pública que hóspedes legítimos usam, e merece decisão própria junto com o R-6.

⚠️ Ponto explícito para o **Analista de Segurança**: revalidar a manutenção do endpoint sabendo que ele serve `entrance_code` de estadia cancelada.

## 8.6 DA-12-R — Tool MCP `delete_property`, e a regra permanente

**DA-12 revertida.** A tool entra nesta entrega.

O argumento original ("uma propriedade inteira não é operação que se entrega a um agente LLM por padrão") continua **factualmente verdadeiro** e agora é mais forte, não menos: a tool passa a poder excluir a propriedade **e cancelar N reservas** numa única chamada. O que mudou não é o risco — é a prioridade. O usuário estabeleceu que o produto tem que funcionar sem UI, e uma ação que existe no HTTP mas não no MCP quebra essa premissa. A resposta certa deixa de ser "não expor" e passa a ser "expor com o risco mitigado e revisado" (**R-16**).

**Forma da tool**, seguindo o padrão das 10 já existentes:

- arquivo `src/core/infra/mcp/tools/delete_property.ts`, `export function makeDeletePropertyTool(di: PropertyManagementDi)`;
- `inputSchema` com um campo, `property_id`, `.describe()`ado;
- `annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }` — igual a `cancel_stay` e `delete_property_setting`;
- **`description` obrigatoriamente explicitando a cascata** — que as reservas futuras serão canceladas, que a chamada é recusada enquanto houver hóspede no imóvel, e que a operação é permanente do ponto de vista do produto. É a única forma de "consentimento informado" que o protocolo oferece hoje;
- retorna o corpo da §8.2 (`canceled_stays`) para que o agente consiga relatar ao usuário quantas reservas foram canceladas — não `{ success: true }`;
- sem `try/catch`: `registerMcpTool` + `mapErrorToToolResult` já cobrem `ResourceNotFoundError`;
- registro em três pontos: barrel `tools/index.ts`, bloco de import de `mcp/routes.ts` e o array `tools` do `makeMcpRequestHandler`;
- **nenhuma mudança de DI** — `makeDeletePropertyUseCase()` já existe em `property_management_di.ts:90` e `propertyManagementDi` já chega ao MCP pelas mesmas instâncias singleton do HTTP.

### A regra permanente

Vai para o `CLAUDE.md` (e é candidata a virar também um passo em `.claude/rules/architecture.md`, na lista "Creating a new route", que é onde ela seria efetivamente seguida durante o desenvolvimento):

> **Todo caso de uso ou endpoint novo nasce com a tool MCP correspondente, na mesma entrega.** O produto tem que funcionar independente de UI: o backend concentra as regras de negócio e uma IA conectada ao `/mcp` deve conseguir executar todas as ações do sistema. Exceções são só as categorias abaixo, e toda exceção usada precisa estar registrada no plano da entrega: material de credencial (senha, reset), o próprio protocolo OAuth que emite o token do `/mcp`, webhooks de terceiros, links públicos não autenticados e rotas de operação (`/health`, `/docs`).

## 8.7 Riscos novos e reavaliados

### R-10 — ✅ RESOLVIDO pela decisão #1: a estadia órfã deixa de ser possível

> **Este risco foi eliminado por desenho, não mitigado.** O usuário aceitou o 409 estreito (§8.10, item 1): a exclusão é recusada enquanto houver hóspede no imóvel. Como uma propriedade excluída não pode ter estadia em andamento nem futura nem receber estadia nova, **não existe mais estadia viva numa propriedade invisível**. As duas mitigações que eu havia proposto (devolver `surviving_in_progress_stays`, avisar na descrição da rota) caem junto — não há o que mitigar. O único resíduo é a corrida do **R-3**, que é outra classe de problema (reserva nova concorrente) e continua aceita.
>
> O texto abaixo fica como registro do que teria acontecido sem essa decisão — é o argumento que a sustentou.

Consequência direta da decisão "estadia em andamento não é cancelada", **caso a exclusão não bloqueasse**. Depois da exclusão, com um hóspede dentro do imóvel:

| O dono...                            | Hoje, depois da exclusão                                     |
| ------------------------------------- | ------------------------------------------------------------ |
| vê a estadia (`GET /booking/stay/:id`) | **404** (`PropertyOwnershipPolicy` com rótulo `"Stay"`)      |
| lista as estadias da propriedade      | **404**                                                      |
| **altera** a estadia (`PATCH`)        | **404** — não dá para ajustar check-out nem código de acesso |
| cancela a estadia                     | **404** — mas já era impossível: `Stay.cancel()` recusa estadia iniciada. Perda nominal |
| vê no dashboard                       | some (KPIs e receita)                                        |
| lança despesa/receita na propriedade  | **404**                                                      |
| **O hóspede**                         | mantém o código na fechadura e o link público funcionando    |

Recuperação: **só** `UPDATE properties SET deleted_at = NULL` por suporte. Não há caminho de usuário.

Foi este quadro que motivou a recomendação do 409 estreito, aceita pelo usuário — ver o box acima.

### R-11 — 🔴 O código da fechadura sobrevive ao cancelamento — DÍVIDA PRIORIZADA, fora desta entrega

> **✅ Decisão do usuário fechada (§8.10, item 2): fica como dívida priorizada, fora do escopo desta entrega.** O usuário está ciente de que a cascata amplia a escala do problema. **É o item de maior consequência no mundo real que esta entrega cria, e o único risco 🔴 que sai dela em aberto.**

**Isto já é uma lacuna hoje, sem nenhuma cascata.** `CreateTempPasswordOnBook` programa a senha na fechadura via Tuya no `StayBookedEvent`, e **não existe handler nenhum** — em lugar algum do código — que a remova. Cancelar uma estadia futura pela rota que já está em produção (`DELETE /booking/stay/:stay_id`) **já deixa hoje** o código do hóspede válido até a data original de check-in/check-out. Quem cancela hoje já está exposto.

**O que a cascata muda é escala e intenção**, não a natureza:

| | Hoje (sem cascata) | Com a cascata |
| --- | --- | --- |
| Quantos códigos ficam órfãos por vez | 1, por ato deliberado do dono | **N**, por um único clique |
| O dono sabe quais hóspedes ficaram com acesso | sim — ele cancelou um a um | **não** — a propriedade sumiu da visão dele junto |
| Ele consegue conferir depois | sim, pela lista de estadias | **não** — `GET /booking/property/:id/stays` responde 404 |

Some-se o achado da **DA-14**: `GetPublicStayUseCase` não filtra `deleted_at`, então o hóspede da reserva cancelada **continua vendo a página com o próprio código de entrada** — a página confirma o código e o código funciona.

**Recomendação do Arquiteto para a entrega que resolver isto:** um `RemoveTempPasswordOnStayCancel` (handler de `StayCanceledEvent`) seguindo a parte 3 da **DA-13** — efeito **pós-commit, idempotente e retentável**, nunca dentro da transação de exclusão, sob pena de a Tuya fora do ar desfazer a exclusão inteira. Avaliar junto o filtro de `deleted_at` em `GetPublicStayUseCase`, que é a outra metade da mesma exposição.

**Mitigação disponível enquanto isso, sem código:** o frontend avisar, no diálogo de confirmação, que os hóspedes com reserva cancelada mantêm o código de acesso até a data original — coerente com a posição do usuário de que avisar é responsabilidade do frontend.

### R-12 — 🟠 Nenhum hóspede é avisado do cancelamento — FORA DE ESCOPO, confirmado

> **✅ Decisão do usuário fechada (§8.10, item 4): fora do escopo desta entrega, registrado como risco conhecido.**

A cascata cancela reservas confirmadas sem nenhum caminho de notificação. Existe infra de email (Resend), usada só para recuperação de senha. Hoje o hóspede descobre na chegada. Fora do escopo, mas é um buraco de produto **criado** por esta entrega — antes, todo cancelamento era um ato deliberado do dono, que presumivelmente avisava.

### R-13 — 🟠 Reserva de origem externa (Airbnb/Booking) não é cancelada na origem — FORA DE ESCOPO, confirmado

> **✅ Decisão do usuário fechada (§8.10, item 4): fora do escopo desta entrega, registrado como risco conhecido.**

Estadias criadas por `ReconcileExternalBookingsUseCase` são canceladas **localmente**; a reserva continua existindo na plataforma de origem, que a Sogio não tem como escrever. Com a sync parando (DA-7), a estadia também não reaparece. O hóspede vai aparecer no imóvel. Sem ação possível no backend; registrar.

### R-14 — 🟡 Os N estornos nascem inalcançáveis

Cada cancelamento grava um estorno em `ledger_entries`, e a propriedade excluída deixa de ser servida em `GET /finance/properties/:id/movements` (DA-5 / R-4). A integridade contábil no banco fica correta; o dono não vê nada disso. Consistente com a DA-5, mas agrava o R-4.

### R-15 — 🟠 A garantia "tudo ou nada" não é estrutural

Ver DA-13. Nada impede um handler externo de ser registrado em `StayCanceledEvent` e furar a transação em silêncio. Mitigação obrigatória: invariante escrita + teste que falhe se aparecer efeito externo no caminho de cancelamento.

### R-16 — 🟠 A tool MCP entrega uma cascata destrutiva a um agente LLM

Um `delete_property` errado por um agente exclui a propriedade **e** cancela N reservas — e nada disso é restaurável por caminho de usuário. O que a infra de MCP oferece hoje: `annotations.destructiveHint`, a `description` e o portão de entitlement por conta (`mcp/routes.ts`). O que **não existe**: confirmação por tool, escopo por tool, gate de admin por tool. Mitigações desta entrega: annotations corretas, descrição explícita da cascata e retorno dos contadores. **Revisão obrigatória do Analista de Segurança.** Lacuna estrutural ("confirmação/escopo por tool destrutiva") registrada para entrega própria — e ela vale para `cancel_stay` e `delete_property_setting`, que já estão expostas.

### R-3 — reavaliado (🟠, consequência pior) — **não é resolvido pela decisão #1**

Vale distinguir das corridas que a decisão #1 fechou. O 409 estreito e a rechecagem da §8.2 resolvem as estadias **que já existem** no momento da exclusão. O R-3 é sobre uma estadia **que ainda não existe**: uma reserva criada concorrentemente, entre a leitura da ocupação e o commit. `BookStayUseCase` não participa da transação, então nada a impede de inserir a linha nessa janela.

Resultado: uma **estadia futura viva numa propriedade excluída** — e não existe mais o caminho "cancele as estadias e tente de novo", porque `CancelStayUseCase` 404 na propriedade excluída. Probabilidade continua baixíssima (exige o mesmo dono disparando `DELETE` e `POST /book` no mesmo instante). A decisão de aceitar (§7, item 2) continua de pé.

Correção conhecida, se um dia importar: `pg_advisory_xact_lock(hashtext(property_id))` no topo da transação de exclusão **e** no caminho de escrita de `BookStayUseCase` — o padrão já existe em `property_setting_postgres_repository.ts:44`, com a mesma chave. Só funciona se **os dois lados** pegarem o lock, e `BookStayUseCase` não é transacional hoje; por isso não entra aqui. **Ponto para o Analista de Segurança confirmar a aceitação.**

## 8.8 Dívida conhecida: casos de uso sem tool MCP

Levantamento feito comparando `src/core/infra/mcp/tools/` (10 tools) com as rotas de `src/core/infra/http/routes/routes.ts`. **Não precisa ser coberto nesta entrega** — é a lista que a regra permanente da §8.6 passa a cobrar daqui para frente.

**As 10 tools que existem:** `list_properties`, `list_stays`, `book_stay`, `cancel_stay`, `record_expense`, `list_property_settings`, `get_property_setting`, `create_property_setting`, `update_property_setting`, `delete_property_setting`.

| BC                    | Sem tool MCP                                                                                                                                                                                | Observação                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `property_management` | `CreatePropertyUseCase`, `UpdatePropertyUseCase`, `FindPropertyUseCase`, **`DeletePropertyUseCase`**                                                                                        | `DeleteProperty` sai desta dívida **nesta entrega**. Um agente hoje **lista** propriedades mas não cria nenhuma |
| `booking`             | `GetStayUseCase`, `UpdateStayUseCase`, `GetDashboardOverviewUseCase`, `CreateExternalBookingSourceUseCase`, `ReconcileExternalBookingsUseCase`, `ListTenantsUseCase`                        | `ListTenants` exige acrescentar `tenantDi` a `McpRouteDependencies`                                            |
| `finance`             | `RecordRevenueUseCase`, `FindPropertyFinancialMovementsUseCase`                                                                                                                             | Assimetria gritante: `record_expense` existe, `record_revenue` não                                            |
| `billing`             | `GetSubscriptionStatusUseCase`, `GetSubscriptionHistoryUseCase`, `ListPlansUseCase`                                                                                                         | `billingDi` já chega ao MCP, mas só para `makeEntitlementService()`                                           |
| `auth`                | `ListConnectedAppsUseCase`, `RevokeConsentUseCase`, `GET /auth/me`                                                                                                                          | Exige acrescentar `authDi` a `McpRouteDependencies`                                                            |
| `backoffice`          | `CreateAppSettingUseCase`, `ListAppSettingsUseCase`, `GetAppSettingUseCase`, `UpdateAppSettingUseCase`, `DeleteAppSettingUseCase`                                                            | Exige `backofficeDi`; **e três dessas rotas são `adminOnly`, e o MCP não tem gate de admin por tool** — bloqueio estrutural, não só trabalho |

**Fora do escopo por natureza** (a regra da §8.6 já as exclui, listadas para a decisão ficar visível): protocolo OAuth (`/register`, `/authorize`, `/token`, `/revoke`, `/connect/authorize/*`), documentos de descoberta `/.well-known/*`, webhook do gateway, `GET /public/booking/stay/:id`, material de credencial (`/auth/users`, `/auth/sign-in`, `/auth/change-password`, `/auth/password-reset/*`), `DELETE /auth/me` (purge LGPD irreversível), sessões de checkout/portal (devolvem URL para um humano abrir no navegador) e ops (`/health`, `/docs`).

### 🔴 Os dois bloqueios estruturais — pautam a próxima entrega nesta frente

> **✅ Confirmado com o usuário:** a tool de exclusão de propriedade sai nesta entrega; os ~22 casos de uso restantes ficam como dívida registrada, sem plano de resolução agora. Mas os dois itens abaixo **não são trabalho de tool** — são pré-requisitos de infraestrutura. Enquanto existirem, a regra permanente da §8.6 **não é cumprível** para os BCs afetados, por mais disciplina que se tenha nas próximas entregas.

**Bloqueio 1 — três containers de DI não chegam ao MCP.** `McpRouteDependencies` recebe só `propertyDi`, `stayDi`, `financeDi`, `propertyManagementDi` e `billingDi`. **`tenantDi`, `authDi` e `backofficeDi` não são passados.** Qualquer tool em `auth` (connected apps, revogar consentimento, `/auth/me`), em tenants (`ListTenants`) ou em `backoffice` exige **primeiro** mexer no composition root. É trabalho pequeno e mecânico, mas é pré-requisito: não dá para "só escrever a tool".

**Bloqueio 2 — não existe gate de admin por tool.** O MCP tem um único portão, de **entitlement por conta**, aplicado à sessão inteira. Não há equivalente ao `adminOnly` das rotas HTTP. Três das cinco rotas de `backoffice` são `adminOnly`; expor as tools correspondentes hoje **entregaria a qualquer usuário com token de MCP** a escrita das configurações da aplicação. **As 5 tools de `backoffice` não podem ser criadas antes disso.** É bloqueio de segurança, não de conveniência.

Os dois se somam a uma terceira lacuna já registrada em **R-16**: não há confirmação nem escopo por tool destrutiva — o que já vale, hoje, para `cancel_stay` e `delete_property_setting`, e passará a valer para `delete_property`. A entrega que atacar a dívida de MCP deve resolver **autorização por tool** (admin + escopo + confirmação de destrutivas) como um item só, antes de sair escrevendo as ~22 tools.

## 8.9 Tasks incrementais (10 em diante, sobre o que já está na branch)

> As tasks 0–9 estão **concluídas** e continuam válidas, exceto onde uma task abaixo as altera. Nada é refeito do zero.

10. **Porta `PropertyOccupancy` vira comando com callback de regra** — trocar `hasPendingStays` por `releaseFutureOccupancy(propertyId, ensureNoStayInProgress): Promise<number>` em `src/property_management/domain/service/property_occupancy.ts`; reescrever o docblock (a inversão da DA-3 continua; a natureza muda para comando, e a regra viaja pelo callback no mesmo idioma de `saveNewWithinQuota` — DA-3-R).
    - Dependências: nenhuma

11. **`TransactionRunner` + executor ambiente** — porta em `core/application/transaction/`, implementação em `core/infra/database/` sobre `db.transaction` + `AsyncLocalStorage`; tornar cientes do executor ambiente **só** `PropertyPostgresRepository.save`, `StayPostgresRepository.saveStay`/`stayOfId` e `LedgerEntryPostgresRepository.save`. Fallback para `db` fora de transação ⇒ todo o resto do sistema fica com comportamento idêntico (DA-13).
    - Dependências: nenhuma

12. **`CancelStayService`** — extrair de `CancelStayUseCase` o corpo `cancel → saveStay → dispatch(StayCanceledEvent)` para `booking/application/service/`; `CancelStayUseCase` mantém lookup + posse e delega. **Refactor puro: nenhuma mudança de comportamento externo, os testes de `DELETE /booking/stay/:id` passam sem alteração** (DA-3-R).
    - Dependências: nenhuma

13. **`StayPropertyOccupancy.releaseFutureOccupancy`** — reusar `allFutureFromProperty` (sem método novo de repositório, §8.2), particionar por `check_in <= agora`, chamar `ensureNoStayInProgress(emAndamento.length)`, e para cada futura **rechecar `check_in > new Date()` imediatamente antes de `cancel()` — se alguma já começou, chamar `ensureNoStayInProgress(1)` e abortar, nunca pular** (§8.2, a corrida). Delegar ao `CancelStayService`; devolver a contagem. Nunca recheca posse.
    - Dependências: tasks 10, 12

14. **`DeletePropertyUseCase`** — manter o `ConflictError`, **estreitado** para estadia em andamento, com a nova mensagem (§8.2); injetar `TransactionRunner`; envolver checagem + liberação + `softDelete` + `save` na **mesma** transação; devolver `{ canceled_stays }`. Atualizar o docblock (hoje ele afirma "No cascade" e descreve o 409 antigo). `PropertyManagementDi.makeDeletePropertyUseCase` ganha o `TransactionRunner`. **Revisão obrigatória do Analista de Segurança** — a ordem `404` antes de qualquer cancelamento é o que impede um estranho cancelar reservas alheias por UUID adivinhado, e o `404` antes do `409` continua sendo o que impede a resposta virar oráculo de existência.
    - Dependências: tasks 11, 13

15. **`DeletePropertyController`** — `204` → `200` com schema de corpo `{ canceled_stays: number }`; **manter o `409` no `openApiSpec`**, com a descrição estreitada para "há hóspede no imóvel agora"; reescrever a `description` para declarar a cascata sobre as estadias futuras e o bloqueio pela estadia em andamento.
    - Dependências: task 14

16. **Tool MCP `delete_property`** — `src/core/infra/mcp/tools/delete_property.ts` no padrão das 10 existentes; `destructiveHint: true`, `idempotentHint: false`; `description` explicitando a cascata; retorna os contadores; registro no barrel, no bloco de imports e no array `tools` de `mcp/routes.ts`. Sem mudança de DI. **Revisão obrigatória do Analista de Segurança** (R-16 — superfície nova e destrutiva).
    - Dependências: task 14

17. **Testes** —
    - **converter** o teste de `409` por **estadia futura** (`delete_property.test.ts:184`) em teste de cascata: ⇒ `200`, `canceled_stays: 1`, estadia com `deleted_at` preenchido, propriedade excluída;
    - **manter** o teste de `409` por **estadia em andamento** (`delete_property.test.ts:213`) — continua `409`, só muda a mensagem esperada. É o teste que guarda a decisão #1;
    - **`409` é total**: propriedade com uma estadia em andamento **e** duas futuras ⇒ `409` e as **duas futuras continuam ativas**. Prova que o bloqueio não deixa rastro parcial;
    - **tudo ou nada**: forçar falha no meio da cascata (ex.: `LedgerEntryRepository.save` lançando) e asseverar que **a propriedade continua ativa, as estadias intactas e nenhum estorno foi gravado**. É o teste que dá sentido à task 11 e o mais importante desta revisão;
    - **estorno**: N cancelamentos ⇒ N `LedgerEntry` negativas em `ledger_entries` (R-14);
    - **corrida do `check_in`**: estadia cujo `check_in` acabou de passar leva a operação inteira a `409` — **nunca é pulada e nunca vira 500** (§8.2);
    - **regressão**: `DELETE /booking/stay/:stay_id` continua idêntico depois da extração do `CancelStayService` (task 12);
    - **não sobra estadia viva (R-10)**: depois de um `200`, a propriedade não tem nenhuma estadia com `deleted_at IS NULL` e `check_out >= agora`. É o teste que documenta a eliminação da órfã;
    - **MCP**: `delete_property` exclui e devolve `canceled_stays`; `409` com hóspede no imóvel; `404` em propriedade de terceiro; e a tool entra na varredura de `delete_property_mcp_sweep.test.ts`;
    - **continuam válidos sem alteração**: caminho feliz (só o status muda para `200`), `401`, os dois `404` de posse/inexistência, o `404`-não-`500` do R-2, estadia só passada, estadia futura já cancelada, preservação de `LedgerEntry`/`PropertySetting`, cota, e a **varredura de invisibilidade inteira** (R-7) — 17 pontos, nada muda neles.
    - Dependências: tasks 15, 16

18. **Documentação** — reescrever o parágrafo de exclusão de propriedade no `CLAUDE.md` (hoje ele afirma "sem cascata sobre estadias" e "não pode ser excluída (409)", ambos falsos depois da task 14); registrar a invariante do R-15 (nenhum handler de `StayCanceledEvent` com efeito fora do Postgres). A **regra permanente de MCP já foi registrada** no `CLAUDE.md` nesta revisão; avaliar replicá-la em `.claude/rules/architecture.md`, na lista "Creating a new route".
    - Dependências: task 17

> Paralelizável: tasks **10, 11 e 12** não têm dependência entre si. A 13 depende da 10 e da 12; a 14 depende da 11 e da 13; a 15 e a 16 dependem só da 14 e são paralelas entre si.

## 8.10 Decisões do usuário — Revisão 2 (todas fechadas)

**Nenhuma pendência em aberto. O plano está pronto para o Desenvolvedor.**

1. **R-10 / 409 estreito — ✅ RESOLVIDO: bloquear apenas por estadia em andamento agora.** A recomendação do Arquiteto foi aceita. Estadias futuras são canceladas em cascata, sem bloquear; a exclusão é recusada (409) só enquanto houver hóspede no imóvel. **A estadia órfã invisível deixa de ser possível** — R-10 é eliminado por desenho, não mitigado. Semântica confirmada em **§8.2**: em andamento = `check_in <= agora AND check_out >= agora AND deleted_at IS NULL`; futura = `check_in > agora AND deleted_at IS NULL`. **Sem método novo de repositório** — `allFutureFromProperty` já devolve a união dos dois e o filtro fica no serviço (§8.2, três razões). Impacto na porta em **§8.3**: um método só, `releaseFutureOccupancy(propertyId, ensureNoStayInProgress)`, com a regra viajando por callback no idioma de `saveNewWithinQuota`.
2. **R-11 / senha da fechadura — ✅ RESOLVIDO: dívida priorizada, fora desta entrega.** O usuário está ciente de que a cascata amplia a escala (N reservas canceladas = N códigos válidos) e de que **a lacuna já existe hoje, sem cascata** — cancelar uma estadia pela rota em produção já deixa o código válido. Registrado em destaque em **R-11**, junto com o achado da **DA-14** (`GetPublicStayUseCase` não filtra `deleted_at` e ainda serve o `entrance_code` da estadia cancelada). É o único 🔴 que sai desta entrega em aberto.
3. **Contrato da rota — ✅ RESOLVIDO: `200` com `{ "canceled_stays": 3 }`.** Duas sub-decisões minhas, consequência da decisão #1: **`surviving_in_progress_stays` foi descartado** (seria sempre `0` no caminho de sucesso — estadia em andamento agora produz 409, não 200; campo constante é ruído), e o corpo devolve **contagem, não lista de ids** (os ids viram referências mortas no instante do commit, porque toda leitura de estadia da propriedade excluída responde 404). Detalhamento em **§8.2**.
4. **R-12 / R-13 — ✅ RESOLVIDO: fora do escopo, registrados como risco conhecido.** Nenhum hóspede é notificado do cancelamento (só há Resend para reset de senha) e reserva de origem Airbnb/Booking é cancelada só localmente — o hóspede aparece no imóvel.

**Sobre a dívida MCP (§8.8):** a tool `delete_property` sai nesta entrega (task 16). Os ~22 casos de uso restantes ficam como dívida registrada, sem plano de resolução agora — a lista permanece no plano. Os **dois bloqueios estruturais** (containers `tenantDi`/`authDi`/`backofficeDi` que não chegam ao MCP, e ausência de gate de admin por tool) estão destacados em §8.8 e devem pautar a próxima entrega nessa frente: enquanto existirem, a regra permanente da §8.6 não é cumprível para `auth`, tenants e `backoffice`.
