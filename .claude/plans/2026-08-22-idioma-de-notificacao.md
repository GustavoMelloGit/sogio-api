# Idioma de notificação seguindo a preferência do usuário (issue #52)

## Objective

Hoje todo texto de notificação nasce em português dentro do handler, e toda data é formatada em `pt-BR`/`America/Sao_Paulo` fixos. Esta entrega dá ao usuário uma preferência de **idioma** e de **fuso horário** no próprio perfil, e move a produção do texto do handler para o momento da entrega, resolvida pelo idioma que o usuário escolheu.

## Decisões tomadas com o usuário

1. **A preferência vive em `auth`, no perfil do usuário** — não em `notification`. Idioma serve à aplicação inteira (email de recuperação de senha, descrição de ledger, mensagens futuras), não só a notificações.
2. **`locale` e `time_zone` são dois campos separados**, na mesma entrega, expostos pela mesma rota. São ortogonais: um brasileiro morando em Portugal quer português com fuso de Lisboa.
3. **O texto mora em código, por tipo de notificação** — no mesmo registro que já declara os tipos, no idioma do `CAPABILITY_REGISTRY`. Criar um tipo de notificação já é deploy; quem cria o tipo escreve o texto, revisado em PR.
4. **A renderização acontece na entrega, não na criação.** A notificação passa a persistir os _fatos_ do evento; o texto é produzido no idioma corrente do usuário quando a notificação sai.

## Personas

- **Arquiteto** (`arquiteto.md`, opus) — este documento.
- **Desenvolvedor** (`desenvolvedor.md`, sonnet) — implementação.
- **Analista de Segurança** (`analista_seguranca.md`, opus) — o `payload` da notificação passa a guardar fatos do evento em `jsonb`; é dado pessoal e precisa continuar caindo no purge LGPD, e o payload não pode virar depósito de dado sensível.

## Linguagem ubíqua

| Termo                               | Significado                                                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Locale**                          | O idioma escolhido pelo usuário (`pt-BR`, `en-US`). Preferência de perfil, não de notificação.                                                                                                                          |
| **TimeZone**                        | Fuso IANA escolhido pelo usuário (`America/Sao_Paulo`, `Europe/Lisbon`). Preferência de perfil.                                                                                                                         |
| **NotificationPayload** (`payload`) | Os fatos do evento que originou a notificação, persistidos e **independentes de idioma** (ex.: `grace_period_ends_at`). Chama-se `payload`, não `data`, porque `Notification.data` já é o registro inteiro da entidade. |
| **NotificationContent**             | O par título/corpo já renderizado, em um idioma concreto. Nunca é persistido.                                                                                                                                           |
| **NotificationContentRenderer**     | O serviço de domínio que resolve `NotificationContent` a partir de `(type, payload, locale, time_zone)`.                                                                                                                |

## Desenho

```
Handler (NotifyOn<Evento>)
   │  publica FATOS, nunca texto
   ▼
NotificationService.notify({ user_id, type, payload })
   │
   ▼
[ notifications ]   type + payload (jsonb)   ← sem title/body
   ▲
   │  claimDue() — já faz JOIN com users
   │  o JOIN passa a trazer locale e time_zone junto de name/email
DeliverPendingNotificationsUseCase
   │  NotificationContentRenderer.render(type, payload, recipient.locale, recipient.time_zone)
   ▼
NotificationChannel.deliver(notification, recipient, content)
```

### D1 — A preferência é do `User`, não da notificação

`locale` e `time_zone` viram campos de `User` (`auth`), com default `pt-BR` / `America/Sao_Paulo` para quem nunca configurou e para todo usuário já existente. Não é uma linha de `notification_preferences`: aquela tabela responde "quero receber X por Y", e idioma não é sobre receber nada.

### D2 — `Locale` é shared kernel, em `core`

`auth` **escreve** a preferência e `notification` **lê**. Nenhum dos dois pode depender do outro para saber o que é um idioma válido. A lista de locales suportados e o tipo `Locale` ficam em `src/core/domain/locale/`, ao lado do que `core` já provê a todos os BCs. Locales desta entrega: `pt-BR` e `en-US`.

### D3 — O texto mora junto da declaração do tipo

Cada entrada do `NOTIFICATION_TYPE_REGISTRY` passa a declarar três coisas que hoje estão espalhadas ou fixas:

- `payload` — schema Zod dos fatos que aquele tipo exige. É o contrato entre o handler e o renderizador.
- `label` — por locale (hoje é uma string pt-BR; ela sai na resposta de `GET /notification/preferences` e portanto também precisa ser traduzida).
- `content` — por locale, uma função `(payload, formatters) => NotificationContent`.

Ficam no mesmo arquivo porque são a mesma decisão: adicionar um tipo de notificação é declarar o que ele carrega e o que ele diz. Separar em arquivos de tradução partiria a definição de um tipo em dois lugares e tiraria a tipagem do payload.

### D4 — Renderizar na entrega

`notifications.title` e `notifications.body` saem; entra `notifications.payload` (`jsonb`). O texto é produzido em `DeliverPendingNotificationsUseCase`, imediatamente antes de chamar o canal, e entregue ao canal como argumento — o canal continua burro e não conhece idioma.

Consequência aceita: se o usuário trocar de idioma entre a criação e a entrega, **vale o idioma novo**. É o comportamento correto para uma fila cuja latência normal é de segundos, e é o que permite a caixa de entrada in-app futura renderizar no idioma do momento da leitura.

### D5 — O idioma chega pelo destinatário, sem query nova

`NotificationRecipient` ganha `locale` e `time_zone`. `claimDue` já faz `innerJoin` com `usersTable` para montar o destinatário — basta selecionar duas colunas a mais. Nenhuma porta cross-BC nova, nenhuma ida extra ao banco no caminho de entrega.

### D6 — Notificação irrenderizável falha sozinha; idioma sem tradução não existe

Tipo fora do registro, payload que não passa no schema: a notificação vira `failed` com `last_error`, e o lote continua. É a mesma decisão de fail-safe que `DeliverPendingNotificationsUseCase` já toma para canal inexistente — um tipo quebrado nunca pode travar a fila dos outros.

Idioma sem tradução, por outro lado, **não é um caso de runtime**: `label` e `content` são `Record<Locale, ...>` totais, então acrescentar um idioma a `SUPPORTED_LOCALES` sem traduzir um tipo existente não compila. Escolha deliberada sobre um fallback com `warn`: um idioma em que a plataforma não consegue escrever não é um idioma suportado, e o compilador é um lugar melhor para descobrir isso do que a caixa de entrada de um usuário. O payload também é validado **na criação** (`PersistingNotificationService`), não só na entrega, para que um handler quebrado apareça no log no momento do evento em vez de 30 segundos depois.

### I-N1 (invariante nova) — Nenhum texto voltado ao usuário nasce em um handler

Handler de notificação publica fatos, nunca strings de conteúdo. É o que impede o problema desta issue de voltar na próxima notificação criada. Travado por teste sobre os handlers.

### Risco: a migration — resolvido, mas com um achado

O risco previsto era dropar `title`/`body`. Ao gerar a migration descobriu-se que **a PR #51 não gerou migration nenhuma** para `notifications` e `notification_preferences` — as tabelas existem só em bancos que rodaram `db:push`. O deploy roda `bun run db:migrate` (`.github/workflows/deploy.yml`), então em produção essas tabelas ainda não existem e o BC `notification` está inerte lá.

Resultado: `drizzle/0012` **cria** as duas tabelas — já com `payload` no lugar de `title`/`body` — em vez de alterá-las, e nada é dropado. A migration fecha a lacuna da PR #51 e entrega esta issue no mesmo passo. A ressalva é para um banco em que alguém tenha rodado `db:push` manualmente: lá o `CREATE TABLE` falha e as colunas legadas precisam sair à mão.

### D7 — Todo texto endereçado a um usuário segue a preferência dele, não só notificação

Ampliação pedida depois da primeira rodada: os outros dois lugares com português fixo no código entram na mesma entrega.

- **Email de recuperação de senha** (`password_reset_email_composer.ts`) — o `User` já está em mãos no use case (é encontrado pelo email), então basta repassar `user.locale`. A marcação HTML **não** é duplicada por idioma: o texto sai para um `Record<Locale, PasswordResetCopy>` e o template continua único. Duplicar o HTML faria toda correção de layout precisar ser feita N vezes, e a esquecida só apareceria na caixa de entrada de quem fala aquele idioma. `escapeHtml` continua valendo para `name`/`email`; o texto de `COPY` é código, nunca entrada de usuário, e é o único HTML aqui que não passa por ele.
- **Descrição de lançamento do ledger** (`stay_ledger_description.ts`) — escrita para o **dono do imóvel**, mas os eventos de estadia carregam `property_id`, não o dono. `finance` resolve `property_id → user_id` com o `PropertyRepository` que o `FinanceDi` já tinha, e `user_id → preferências` pelo OHS novo. Histórico **não é migrado**: lançamentos antigos ficam como estão.

**`DisplayPreferencesService` (`auth/application/service/`) é o OHS.** Mesmo papel de `EntitlementService` em `billing`: publica idioma e fuso de um usuário sem expor `User` nem o repositório. Existe porque `finance` precisa da preferência e não tem — nem deveria ter — acesso à entidade de `auth`. `notification` não o usa: no caminho de entrega a preferência já vem de graça no join que `claimDue` faz para pegar nome e email, e uma segunda ida ao banco por notificação seria puro desperdício.

Ausência nunca lança, nos dois níveis (propriedade sumida, usuário sumido): cai no padrão. Um lançamento no idioma padrão é degradação; uma reserva que falha por causa do texto de uma descrição é quebra de produto.

## Fora de escopo (dívida registrada, não paga aqui)

- `src/booking/infra/service/tuya_device_management.ts` — `America/Sao_Paulo` é fuso do dispositivo físico, não do usuário. Não é o mesmo problema.

## Mapped Changes

### `core`

- **`src/core/domain/locale/locale.ts`** (novo) — `SUPPORTED_LOCALES` (`pt-BR`, `en-US`), tipo `Locale`, `DEFAULT_LOCALE`, `DEFAULT_TIME_ZONE`, schema Zod de locale e de time zone (fuso IANA validado contra `Intl`).
- **`src/core/infra/database/drizzle/schemas/auth_schemas.ts`** — colunas `locale` e `time_zone` em `usersTable`, `notNull` com default.
- **`src/core/infra/database/drizzle/schemas/notification_schemas.ts`** — remove `title`/`body`, adiciona `payload` (`jsonb`, `notNull`).
- **`src/core/infra/http/routes/routes.ts`** — registrar as rotas de preferência de perfil (`authenticated: true`, `allowWithoutPlatformAccess: true` — é conta própria, mesmo tratamento de `/auth/me`).
- **`src/core/infra/mcp/routes.ts`** — registrar as duas tools novas.
- **migration** — `bun run db:migration`.

### `auth`

- **`src/auth/domain/entity/user.ts`** — `locale` e `time_zone` no schema, com default; mutador dedicado de preferências (não mass assignment).
- **`src/auth/domain/repository/auth_repository.ts`** + **`.../auth_postgres_repository.ts`** — método de escrita restrito às preferências, na mesma linha do `updatePassword` (Interface Segregation, para não abrir vetor sobre `role`).
- **`src/auth/application/use_case/get_user_preferences.ts`** (novo) e **`update_user_preferences.ts`** (novo).
- **`src/auth/presentation/controller/auth/get_user.controller.ts`** — expor `locale` e `time_zone` no `GET /auth/me`.
- **`src/auth/presentation/controller/auth/get_user_preferences.controller.ts`** e **`update_user_preferences.controller.ts`** (novos).
- **`src/auth/presentation/mcp_tool/get_user_preferences.mcp_tool.ts`** e **`update_user_preferences.mcp_tool.ts`** (novos) — obrigatórias: dado do próprio usuário. Nota: `auth` ainda não tem diretório `mcp_tool/`; ele nasce aqui.
- **`src/auth/infra/di/auth_di.ts`** — factories dos use cases, controllers e tools.

### `notification`

- **`src/notification/domain/notification_type/notification_type_registry.ts`** — cada entrada ganha `payload` (schema Zod), `label` por locale e `content` por locale.
- **`src/notification/domain/service/notification_content_renderer.ts`** (novo) — resolve `NotificationContent` a partir de `(type, payload, locale, time_zone)`; formatação de data via `Intl` com o locale e o fuso recebidos.
- **`src/notification/domain/entity/notification.ts`** — `title`/`body` saem, entra `payload`.
- **`src/notification/domain/service/notification_channel.ts`** — `NotificationRecipient` ganha `locale` e `time_zone`; `deliver` passa a receber `NotificationContent`.
- **`src/notification/application/service/notification_service.ts`** — `NotifyInput` passa a ser `{ user_id, type, payload, scheduled_for? }`.
- **`src/notification/application/service/persisting_notification_service.ts`** — valida `payload` contra o schema do tipo e persiste.
- **`src/notification/application/use_case/deliver_pending_notifications.ts`** — renderiza antes de entregar; falha isolada quando irrenderizável.
- **`src/notification/application/use_case/get_notification_preferences.ts`** — `label` resolvido pelo locale do usuário.
- **`src/notification/application/handler/notify_on_subscription_payment_failed.ts`** e **`notify_on_subscription_trial_ending.ts`** — perdem as strings e o `Intl.DateTimeFormat`; passam a publicar fatos.
- **`src/notification/infra/channel/email_notification_channel.ts`** — usa o `NotificationContent` recebido; saudação e assinatura também por locale.
- **`src/notification/infra/database/postgres_repository/notification_postgres_repository.ts`** — `claimDue` seleciona `locale`/`time_zone` no join.
- **`src/notification/infra/di/notification_di.ts`** — injetar o renderizador.

### Documentação

- **`CLAUDE.md`** — preferência de idioma no perfil, renderização na entrega, I-N1.
- **`.claude/personas/arquiteto.md`** — registrar I-N1 junto das demais invariantes.

## Tasks

1. **Shared kernel de locale** — `core/domain/locale/`: locales suportados, defaults, schemas.
   - Dependencies: none
2. **Schema e migration** — `locale`/`time_zone` em `users`; `title`/`body` → `payload` em `notifications`.
   - Dependencies: task 1
3. **`User` + repositório de `auth`** — campos na entidade, mutador dedicado, método de escrita segregado no repositório.
   - Dependencies: tasks 1, 2
4. **Use cases de preferência de perfil** — get e update.
   - Dependencies: task 3
5. **Controllers + tools MCP de preferência de perfil** + `GET /auth/me` expondo os campos + wiring em `AuthDi`, `routes.ts` e `mcp/routes.ts`.
   - Dependencies: task 4
6. **Registro de tipos com payload e conteúdo por locale** — `payload`, `label` por locale, `content` por locale para os dois tipos existentes.
   - Dependencies: task 1
7. **`NotificationContentRenderer`** — renderização e formatação de data por locale/fuso; devolve `null`, nunca lança, quando o tipo ou o payload não permitem renderizar.
   - Dependencies: task 6
8. **`Notification` + `NotificationRecipient` + porta do canal** — `payload` no lugar de `title`/`body`; destinatário com locale/fuso; `deliver` recebendo conteúdo.
   - Dependencies: tasks 2, 6
9. **`NotificationService` e implementação** — `NotifyInput` com `payload`, validação contra o schema do tipo.
   - Dependencies: task 8
10. **Repositório de notificação** — `claimDue` trazendo locale/fuso; persistência de `payload`.
    - Dependencies: tasks 2, 8
11. **`DeliverPendingNotificationsUseCase`** — renderizar antes de entregar, isolar falha de renderização.
    - Dependencies: tasks 7, 10
12. **`EmailNotificationChannel`** — consumir o conteúdo renderizado; saudação/assinatura por locale.
    - Dependencies: tasks 7, 8
13. **Handlers sem texto** — os dois handlers passam a publicar fatos.
    - Dependencies: task 9
14. **`GetNotificationPreferencesUseCase`** — `label` no locale do usuário.
    - Dependencies: tasks 3, 6
15. **DI + wiring de `notification`** — renderizador injetado.
    - Dependencies: tasks 11, 12, 13, 14
16. **Testes** — entrega em `pt-BR` e em `en-US` com data no fuso escolhido; default de quem nunca configurou; troca de idioma entre criação e entrega valendo o novo; payload inválido não derruba o lote; I-N1 (handlers sem string de conteúdo); rota e tool de preferência; purge LGPD continuando verde.
    - Dependencies: tasks 5, 15
17. **Documentação** — `CLAUDE.md` e I-N1 no `arquiteto.md`.
    - Dependencies: task 16

> Tasks 1 e 6 abrem duas frentes paralelas: 3→4→5 (`auth`) e 7/8→9/10→11/12/13 (`notification`). 14 fecha as duas.
