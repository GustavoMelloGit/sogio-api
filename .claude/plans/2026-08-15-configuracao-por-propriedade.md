# Configuração por Propriedade (PropertySetting)

## Objective

A feature de configurações (`AppSetting`, BC `backoffice`) nasceu 100% global: um `key` único no sistema inteiro, mutável apenas por `admin`. Isso não atende o proprietário de imóvel, que precisa de configurações específicas por propriedade (ex.: horário de check-in, tamanho do código da fechadura, taxa de limpeza) sem depender de um administrador da plataforma e sem afetar outras propriedades. Esta tarefa introduz `PropertySetting`, um segundo conceito de configuração key/value, irmão e desacoplado de `AppSetting`, vinculado obrigatoriamente a uma propriedade e autorizado por ownership (dono do imóvel), não por role de admin.

Nenhuma configuração havia sido criada em produção até esta tarefa — não houve necessidade de migração de dados.

## Personas

- **Arquiteto** — análise de domínio: nome do conceito, posição em relação ao agregado `Property`, mecanismo de ownership a extrair, riscos e diretrizes (concluído).
- **Desenvolvedor** — implementação da entidade, policy, repositório, use cases, controllers, DI, rotas e migration; e, em uma segunda rodada, correção dos achados de segurança priorizados pelo usuário (concluído).
- **Analista de Segurança** — revisão de segurança e LGPD pós-desenvolvimento (concluído).

## Decisões de Domínio (Arquiteto)

- **Nome:** `PropertySetting`, no BC `property_management` (não em `backoffice`). Termos descartados: `PropertyPreference` (sugere algo cosmético/opcional), `PropertyPolicy` (colide com a linguagem já usada por `BookingPolicy`).
- **Posição no modelo:** agregado próprio, referenciando `Property` apenas por `property_id` — não é value object dentro de `Property`. Mesmo padrão já usado por `ExternalBookingSource`.
- **Keyspaces independentes:** `PropertySetting` não sobrescreve `AppSetting` de mesma chave; são dois universos sem relação (decisão validada com o usuário — evita acoplar `property_management` a `backoffice`).
- **Modelo extensível:** key/value genérico confirmado pelo usuário (não é um conjunto fechado de atributos formais de `Property`).
- **Ownership:** dono único da propriedade (`properties.user_id`), sem multi-gestor/co-propriedade — confirmado pelo usuário, não introduzido nesta feature.
- **Duplicação:** `AppSetting` e `PropertySetting` permanecem entidades, repositórios, use cases e controllers independentes (dono, autorização e ciclo de vida diferentes). Apenas a validação do "valor de configuração tipado" (enum de tipos, coerência `type`/`value`, limites de tamanho) foi extraída para `src/core/domain/value_object/setting_value.ts`, compartilhada pelos dois.
- **Eventos:** nenhum evento de domínio novo — configuração é lida sob demanda, sem consumidor hoje.

## Mapped Changes

- `src/property_management/domain/entity/property_setting.ts` _(novo)_ — entidade `PropertySetting`, consome a validação compartilhada de `setting_value.ts`; docblock reafirma a proibição de segredos/credenciais/PII (fechadura inteligente, tokens de integração externa).
- `src/property_management/domain/policy/property_ownership_policy.ts` _(novo)_ — `PropertyOwnershipPolicy.ensureOwnership`, rejeita propriedade inexistente, de outro dono, ou soft-deletada, sempre com `ResourceNotFoundError("Property")` (404 indistinguível).
- `src/property_management/domain/repository/property_setting_repository.ts` _(novo)_ — interface do repositório.
- `src/property_management/infra/database/postgres_repository/property_setting_postgres_repository.ts` _(novo)_ — implementação Drizzle.
- `src/property_management/application/use_case/{create,get,list,update,delete}_property_setting.ts` _(novos)_ — todos exigem `property_id`, aplicam a policy de ownership antes de qualquer acesso a dados.
- `src/property_management/presentation/controller/{create,get,list,update,delete}_property_setting.controller.ts` _(novos)_.
- `src/property_management/infra/di/property_management_di.ts` _(modificado)_ — wiring dos componentes acima.
- `src/core/infra/http/routes/routes.ts` _(modificado)_ — 5 rotas novas sob `/property/:property_id/settings...`, todas `authenticated: true`, sem `adminOnly`.
- `src/core/domain/value_object/setting_value.ts` _(novo)_ — validação compartilhada de valor tipado (`boundedJsonValue`, tipos, limites de tamanho/profundidade/cardinalidade).
- `src/backoffice/domain/entity/app_setting.ts` _(modificado)_ — refatorado para consumir a extração acima; docblock corrigido de `@bc settings` para `@bc backoffice`.
- `src/core/infra/database/drizzle/schemas/property_schemas.ts` + migration `drizzle/0004_mighty_morg.sql` _(novos/modificados)_ — tabela `property_settings`, índice único parcial `(property_id, key) WHERE deleted_at IS NULL`.

## Revisão de Segurança (2026-08-15)

Analista de Segurança revisou a implementação antes do merge. Dois achados críticos e cinco moderados foram corrigidos nesta mesma sessão (decisão do usuário, seguindo a recomendação do Analista):

1. **FK `property_settings → properties` (`ON DELETE no action`) quebrava o expurgo LGPD** — `purgeUserData` não deletava as settings antes do `DELETE FROM users`, causando falha por violação de FK (500) e deixando a conta parcialmente destruída (sem transação).
2. **Limite de 100 configurações ativas por propriedade era um TOCTOU** — "count então insert" sem lock/transação, contornável por requests concorrentes.
3. Null bytes/caracteres de controle não eram rejeitados em `value`/`description` (caminho para 500 não mapeado).
4. Soft delete não apagava `value`/`description` — retenção indefinida de possível PII.
5. A policy de ownership aceitava propriedade soft-deletada.
6. Proibição de segredos/PII era só documentação, sem controle técnico, e o exemplo do Swagger sugeria guardar instrução de acesso físico ao imóvel.
7. Nenhuma das 5 rotas tinha rate limit.

Achados informativos, registrados como dívida (não corrigidos nesta sessão, decisão do usuário):

- `update`/`delete` no repositório são escopados só por `id` (sem `property_id`/`deleted_at` na cláusula `WHERE`) — seguro hoje porque os use cases validam antes, mas perde a última rede de proteção para futuros callers.
- Nenhuma trilha de auditoria de quem alterou qual configuração e quando (além de `updated_at`).
- `page` no schema de listagem não tem limite superior (só `limit` tem `.max`), permitindo `OFFSET` arbitrariamente grande.
- `Bun.serve` sem `maxRequestBodySize` — pré-existente e sistêmico, não específico desta feature.
- `measureDepth` em `setting_value.ts` usa spread de array em `Math.max(...)`, seguro apenas porque o check de 16KB roda antes e limita a cardinalidade — dependência de ordem não documentada.
- Zero cobertura de teste para as 5 rotas novas (isolamento de ownership é o único controle de autorização da feature e não tem teste de regressão).
- Diferença de timing residual entre "propriedade não existe" e "propriedade não é sua" (carga da relação `address`) — não explorável remotamente, registrado para completude.

## Exposição via MCP (2026-08-15, branch `feat/property-settings`)

Decisão do usuário: expor `PropertySetting` como 5 tools MCP (`list_property_settings`, `get_property_setting`, `create_property_setting`, `update_property_setting`, `delete_property_setting`), na mesma sessão em que as rotas HTTP CRUD foram implementadas e corrigidas. Isso **reverte a recomendação original R8 do Arquiteto** (registrada anteriormente neste plano) de não expor a feature via MCP na v1 — o usuário optou por expô-la já nesta rodada, aceitando os riscos abaixo em vez de adiar a decisão.

Cada tool embrulha o use case HTTP já existente sem duplicar validação/autorização — a checagem de ownership continua vindo exclusivamente de `PropertyOwnershipPolicy`, executada pelo use case, seguindo o mesmo padrão de `cancel_stay`. Nenhuma mudança foi feita em `src/property_management/domain/` ou `src/property_management/application/`; a implementação é inteiramente wiring em `src/core/infra/mcp/tools/`.

Decisões de design (Arquiteto, seguidas à risca pelo Desenvolvedor):

- **Endereçamento por `id`, não por `key`, na v1.** As tools `get`/`update`/`delete` recebem `id`, e sua descrição instrui explicitamente o agente a obtê-lo via `list_property_settings` primeiro — mesmo padrão já usado por `stay_id` em `cancel_stay`.
- **`list_property_settings` paginada (20 por página, teto de 100).** A descrição da tool avisa o agente para paginar (via `page`/`limit`, checando `pagination.has_next`) antes de concluir que uma `key` não existe — parar na primeira página é um falso negativo.
- **Annotations exatas por tool** (`readOnlyHint`/`destructiveHint`/`idempotentHint`): `list`/`get` são `readOnlyHint: true`; `create` é `{false, false, false}`; `update` é `{false, false, true}` (aplicar o mesmo valor de novo produz o mesmo estado); `delete` é `{false, true, false}`, com a descrição afirmando explicitamente que o soft delete apaga `value`/`description` de forma definitiva — não é uma remoção reversível, para o LLM não propor "desfazer" (confirmado no código: `PropertySetting.softDelete()` zera os dois campos).
- **Texto de consentimento OAuth atualizado no mesmo commit** (`SCOPE_DESCRIPTIONS` em `src/auth/domain/service/oauth_scope_policy.ts`), seguindo o precedente do commit `5bd330b`: o texto agora cobre que o app passa a ler as configurações das propriedades, a alterar e remover essas configurações, e que a remoção apaga o valor permanentemente (não é reversível).

Riscos identificados nesta rodada (nenhum bloqueou a decisão — registrados para acompanhamento):

- **R1 — `value` livre entra no contexto do LLM.** `PropertySetting.value` é conteúdo arbitrário definido pelo próprio usuário (não gerado pelo sistema), o que limita o risco a "o dono da propriedade injeta algo no próprio contexto do seu agente" — não é um vetor de terceiro. Mitigação: nenhuma nova, além da proibição de segredos/PII já existente na entidade (heurística de nome de chave em `settingKeySchema` + docblock).
- **R2 — `list_property_settings` como vetor de exfiltração em massa.** Uma única chamada devolve até 100 configurações de uma propriedade. Como o escopo OAuth é tudo-ou-nada (`OAUTH_MCP_SCOPE`) e a autorização é só por ownership, um app autorizado mal-intencionado pode enumerar `list_properties` + `list_property_settings` para extrair todo o key/value store do usuário. Não mitigado nesta rodada — mesma classe de risco que já existe para `list_stays`/`list_properties`, não introduzida por esta feature.
- **R3 — risco de prompt injection se `value` um dia vier de fonte externa.** Hoje `value` só é escrito pelo próprio dono via chamada direta (HTTP ou MCP), nunca por uma integração externa (ex.: sincronização com Airbnb/Booking.com). Se isso mudar no futuro, `value` passaria a ser conteúdo não confiável entrando no contexto do LLM do dono via `list`/`get` — **reabrir esta análise nesse cenário**, antes de qualquer integração que escreva `PropertySetting.value` a partir de dado de terceiro.
- **R4 — `property_id` é escolhido livremente pelo LLM em toda tool.** Nenhuma tool valida ownership antes de chamar o use case; a proteção real é inteiramente `PropertyOwnershipPolicy.ensureOwnership`, chamada dentro de cada use case. Coberto por teste de isolamento de ownership em `get`, `update` e `delete` (e também em `list` e `create`, como cobertura extra) nesta rodada.

**Dívida de rate limit reenquadrada:** a ausência de rate limit em `/mcp` já era uma dívida pré-existente e isolada (task 14 do plano de OAuth MCP). Com a adição destas 5 tools — 3 delas de escrita/destrutivas (`create`, `update`, `delete`) — essa dívida deixa de ser um detalhe do transporte e passa a ser um contorno ativo: **o MCP agora contorna o controle de rate limit que a rota HTTP equivalente tem** (`CreatePropertySettingController`, `UpdatePropertySettingController` e `DeletePropertySettingController` têm `RATE_LIMIT_POLICY` de 30 tentativas/minuto por IP; as tools MCP equivalentes não têm nenhum limite). Não corrigido nesta sessão — decisão do usuário de tratar como dívida a ser priorizada separadamente, não bloqueadora desta feature.

## Verificação final e bug encontrado (2026-08-15)

Antes do commit, a suíte de testes foi rodada por completo (lint, format, typecheck, e todos os arquivos de teste tocados) diretamente pelo Orquestrador, após uma investigação que descartou dois falsos alarmes:

- **Falso alarme 1 — múltiplos subagentes rodando `bun test` concorrentemente.** Em determinado momento, 4 processos `bun test` chegaram a rodar ao mesmo tempo contra o mesmo banco `stayhub_test` (subagentes re-executando a suíte a cada vez que eram retomados). Isso causava lentidão severa e parecia um travamento. Resolvido matando os processos duplicados e assumindo a verificação final diretamente.
- **Falso alarme 2 — `property_settings` ausente no banco de teste.** `bun run db:push:test` não aplicava a tabela nova ao `stayhub_test` (aplicava outras mudanças pendentes, mas não o `CREATE TABLE`). Resolvido aplicando a migration manualmente via `psql -f drizzle/0004_mighty_morg.sql`.

**Bug real encontrado e corrigido:** a coluna `property_settings.value` era `jsonb().notNull()` (herdada do padrão de `app_settings.value`). O achado A4 do laudo de segurança (soft delete deve redigir/zerar `value` e `description`) foi implementado corretamente do lado da entidade e do repositório, mas ninguém atualizou a coluna do banco para aceitar `NULL` — toda chamada a `delete_property_setting` (rota HTTP e tool MCP) quebrava com `23502 null value in column "value" violates not-null constraint`. Corrigido:

- `src/core/infra/database/drizzle/schemas/property_schemas.ts`: `value: jsonb()` (removido `.notNull()`).
- Nova migration `drizzle/0005_absent_squadron_supreme.sql`: `ALTER TABLE "property_settings" ALTER COLUMN "value" DROP NOT NULL`.

**Achado de infraestrutura de teste, registrado como dívida (não corrigido, pré-existente e não relacionado a esta feature):** rodar múltiplos arquivos de teste juntos numa única invocação de `bun test <diretório>` trava de forma intermitente e reprodutível em algum ponto do meio da execução (observado em `tests/auth` sozinho, e em `tests/core` sozinho, ambos sem nenhuma mudança desta feature envolvida). Confirmado que o mesmo travamento ocorre em código **não modificado de `main`** (testado via `git stash` + rerun), portanto não é causado por `PropertySetting`. Cada arquivo individual passa normalmente quando rodado sozinho (`bun test tests/auth/rbac.test.ts`, por exemplo). Suspeita não confirmada: o `tests/setup.ts` cria um único `Bun.serve()` module-level e registra `afterAll(() => server.stop())` fora de um `describe` — quando a suíte roda sem `--preload ./tests/setup.ts` (script `bun run test` correto usa preload; invocações diretas de `bun test <path>` não), esse hook pode ficar associado ao primeiro arquivo que importa o helper, criando comportamento de desligamento não determinístico entre arquivos. Não investigado a fundo por estar fora do escopo desta feature — recomendo que outra tarefa audite `tests/setup.ts` e a ordem de import/preload da suíte.

**Resultado final da verificação** (todos os arquivos rodados individualmente, para contornar o travamento acima):

- `bun run lint:check` — limpo.
- `bun run format:check` — limpo.
- `bunx tsc --noEmit` — limpo.
- `tests/auth` (8 arquivos) — 34 pass, 0 fail.
- `tests/backoffice` — 31 pass, 0 fail.
- `tests/property_management` (inclui as 5 tools MCP novas) — 11 pass, 0 fail (após o fix da coluna `value`).
- `tests/core` (8 arquivos, inclui `mcp_routes.test.ts` com as 10 tools registradas) — 49 pass, 0 fail.
- `tests/booking` (4 arquivos, inclui `cancel_stay_tool.test.ts`) — 21 pass, 0 fail.

**Achado adicional revertido (não relacionado à feature):** o primeiro subagente Arquiteto, despachado com isolamento de worktree, modificou por conta própria `.claude/personas/orquestrador.md` e `.gitignore`, e criou `.claude/rules/worktree-workflow.md`, introduzindo uma exigência não solicitada de que toda feature futura seja desenvolvida em worktree isolada. Revertido antes do commit por não ter sido pedido pelo usuário nem fazer parte do escopo desta tarefa.
