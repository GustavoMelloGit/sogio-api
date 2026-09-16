# Escolha de plano logo após o cadastro

## Objective

O front mostra a tela de planos **uma vez, logo depois do cadastro**. Quem escolhe o Pro vai para o Checkout (trial de 14 dias). Quem escolhe "Grátis" só navega para o painel, sem chamar a API, porque a assinatura Free já existe desde o cadastro. A API não guarda "escolha pendente" nem oferece gatilho sob demanda para o Free.

O que esta PR entrega na API: `return_to` no Checkout e as URLs de retorno do Checkout e do Portal sob `/app`, onde o produto mora no front. Hoje quem volta do Stripe cai num 404.

## Personas

- **Orquestrador** (`model: opus`): conduz Arquiteto → Desenvolvedor → Analista de Segurança
- **Arquiteto** (`model: opus`): este plano
- **Desenvolvedor** (`model: sonnet`): implementação
- **Analista de Segurança** (`model: opus`): revisão final do escopo reduzido

## Escopo final: o que foi descartado e por quê

- **Versão 1** (`4b6f4ad`…`a3ca788`), bloqueio persistente: `needs_plan_choice`, `plan_chosen_at` com a migration `0018`, `ConfirmFreePlanChoiceUseCase` e a tool `confirm_free_plan_choice`. Saiu porque o usuário trocou o bloqueio por uma tela mostrada uma vez. Já foi revertido em `89eac70` e `32a6f60`, e `drizzle/` está idêntico a `origin/main` (D-6).
- **Versão 2** (`8c05aae`…`8879ab4`), rota `POST /billing/subscription/free-plan` como segundo gatilho de `EnsureFreeSubscriptionUseCase`, com `allowWithoutPlatformAccess: true` e exceção MCP. **Sai inteira, por decisão do usuário.** O cadastro já cria a assinatura Free antes de devolver a sessão (`RegisterUserUseCase` espera `StartFreeSubscriptionOnUserCreated`), então a rota só agiria numa conta sem assinatura, e o fluxo normal não produz essa conta. Com a rota saem também a exceção ao portão de platform access, a exceção MCP, o risco aceito da corrida de duplo clique e os achados I-2, I-3 e I-4 da revisão de segurança.
- **Continua como em `main`:** `EnsureFreeSubscriptionUseCase` e o handler do cadastro que o dispara.

## Contrato com o front

1. `GET /billing/subscription` e a tool `get_subscription_status`: iguais a `origin/main`, **sem** `needs_plan_choice`.
2. **Não existe rota para o Free.** O botão "Grátis" só navega para o painel.
3. `POST /billing/checkout-session` aceita `return_to: "billing" | "onboarding"` opcional (default `"billing"`), validado por enum:
   - `billing`: `/app/settings/billing?checkout=success` e `/app/settings/billing?checkout=canceled`
   - `onboarding`: `/app?checkout=success` e `/app?checkout=canceled`
4. `POST /billing/portal-session` volta para `/app/settings/billing?portal=return`.

**Observação para o front.** O cadastro só devolve a sessão depois que a assinatura Free existe. Se o handler falhar (por exemplo, catálogo sem `free`), o cadastro responde erro e não devolve sessão. A conta fica sem assinatura e bloqueada (`no_subscription`) até intervenção manual. É o comportamento de `main`, e esta PR não o muda.

## Decisões arquiteturais

### D-1: A API não tem o conceito de "escolha de plano" (mantida, ampliada)

O fato de negócio é o que o domínio já dizia: cada `User` tem exatamente uma `Subscription`, criada no Free pelo cadastro. Mostrar a tela uma vez é UX, e UX não vira estado nem rota no `billing`. Nada entra no agregado `Subscription`, no `Entitlement`, no banco ou na superfície HTTP/MCP.

### D-2, D-3 e D-4: descartadas

A rota do Free, a exceção ao portão de platform access e a exceção MCP deixaram de existir junto com a rota (ver "Escopo final"). A frase do `CLAUDE.md` "uma conta sem `Subscription` fica bloqueada até intervenção manual" volta a ser verdade e volta ao texto de `main`.

### D-5: `return_to` é enum fechado; a URL é montada no servidor (mantida)

`return_to` nunca é um caminho. É uma chave (`billing`, `onboarding`) que o caso de uso traduz para um par de caminhos fixos, sempre prefixados por `FRONT_BASE_URL`. Qualquer outro valor dá `422`. O default `"billing"` é aplicado no schema do controller. As chaves e os caminhos vivem em `create_checkout_session.ts`, e o controller importa a lista para o `z.enum`. Sem tool MCP pela exceção já documentada ("sessões de pagamento que devolvem URL para um humano abrir").

### D-6: A migration `0018` foi apagada, sem migration de drop (executada)

Ela nunca chegou a um banco que importe: o deploy roda `db:migrate` a partir de `main`, e a suíte usa `drizzle-kit push`. A verificação continua valendo: `git diff origin/main -- drizzle/` vazio e `bun run db:migration` sem gerar arquivo. Um banco **local** que tenha rodado `db:migrate` nesta branch fica com `plan_chosen_at` órfã, o que é inofensivo. Para limpar: `ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "plan_chosen_at"`.

## Mapped Changes

**Apagados** (arquivos novos na PR; ficam ausentes, como em `main`):

- **`src/billing/presentation/controller/ensure_free_subscription.controller.ts`**: o controller da rota do Free
- **`tests/billing/ensure_free_subscription_route.test.ts`**: testa só a rota, incluindo a trava da corrida (`8879ab4`)

**Voltam exatamente ao conteúdo de `origin/main`:**

- **`src/billing/infra/di/billing_di.ts`**: saem o import de `EnsureFreeSubscriptionController` e `makeEnsureFreeSubscriptionController()`. `makeEnsureFreeSubscriptionUseCase()` **fica**, porque o handler do cadastro o usa.
- **`src/core/infra/http/routes/routes.ts`**: sai a entrada `authenticated` + `allowWithoutPlatformAccess` da rota do Free em `billingControllers`.
- **`tests/billing/get_subscription_status.test.ts`**: saem as duas asserções `not.toHaveProperty("needs_plan_choice")`. Elas travam a ausência de um campo que nunca existiu em `main`: testam o histórico da PR, não um comportamento.

**Alterados:**

- **`CLAUDE.md`**:
  - Em "Demais exceções" (superfície MCP), sai "a garantia da assinatura Free (…)", e a linha volta ao texto de `main`.
  - Em "Bounded Context `billing`", sai "garantia da assinatura Free" da lista de exceções do portão, e a frase volta a "uma conta sem `Subscription` fica bloqueada até intervenção manual", como em `main`.
  - A seção "#### Escolha de plano após o cadastro" é apagada inteira: a API não tem o conceito (D-1), e o que o front precisa da API está no parágrafo das URLs de retorno.
  - Fica só o parágrafo das URLs de retorno (`return_to` e `/app`), sem mudança.
- **`.claude/plans/2026-09-16-escolha-de-plano-apos-cadastro.md`**: este plano.

**Sem mudança (ficam como na PR):** `src/billing/application/use_case/create_checkout_session.ts`, `src/billing/presentation/controller/create_checkout_session.controller.ts`, `src/billing/application/use_case/create_billing_portal_session.ts`, `tests/billing/create_checkout_session.test.ts`, `tests/billing/create_billing_portal_session.test.ts`.

**Sem mudança (como em `main`):** `ensure_free_subscription.ts`, `start_free_subscription_on_user_created.ts`, `tests/helpers/fixtures/user.ts`, `tests/billing/subscription_history.test.ts`.

**Conferido com `git diff origin/main`:** fora dos arquivos acima, nada mais se liga à rota. `drizzle/`, `src/core/infra/mcp/` e `tests/core/` já são iguais a `main`. A menção a "free-plan" em `2026-09-10-bloquear-mcp-para-plano-free.md` é só o nome de uma branch antiga.

## Tasks

A PR #80 já está publicada: tudo vai em commits novos, sem reescrever o histórico.

1. **Remover a rota do Free** (escopo final)
   - Apagar o controller e `tests/billing/ensure_free_subscription_route.test.ts`.
   - Tirar do `billing_di.ts` a fábrica do controller e o import dela, mantendo `makeEnsureFreeSubscriptionUseCase()`.
   - Tirar a entrada da rota de `routes.ts`.
   - Conferir que `git diff origin/main -- src/billing/infra/di/billing_di.ts src/core/infra/http/routes/routes.ts` sai vazio.
   - Dependencies: none
2. **Reverter as asserções de `needs_plan_choice`** (D-1)
   - Voltar `tests/billing/get_subscription_status.test.ts` ao conteúdo de `origin/main`.
   - Dependencies: none
3. **`CLAUDE.md`**
   - Voltar a linha "Demais exceções" e o parágrafo do portão de platform access ao texto de `origin/main`.
   - Apagar a seção "Escolha de plano após o cadastro".
   - Manter o parágrafo das URLs de retorno.
   - Dependencies: task 1 (a documentação só deixa de citar a rota depois que ela sai do código)
4. **Verificação final**
   - `bun run typecheck`, `bun run lint:check`, `bun run format:check` e `bun run test` verdes.
   - `grep -rn "free-plan\|EnsureFreeSubscriptionController\|garantia da assinatura Free\|needs_plan_choice\|plan_chosen_at\|recordPlanChoice\|confirm_free_plan_choice\|ConfirmFreePlanChoice" src tests drizzle CLAUDE.md` vazio.
   - `git diff origin/main --stat` restrito a: `create_checkout_session.ts`, `create_checkout_session.controller.ts`, `create_billing_portal_session.ts`, os dois testes deles, `CLAUDE.md` (só o parágrafo das URLs de retorno) e este plano.
   - Dependencies: tasks 1, 2, 3
5. **Revisão de segurança** (Analista)
   - Confirmar:
     - nenhuma rota nova e nenhum `allowWithoutPlatformAccess` novo no diff
     - nenhuma exceção MCP nova no `CLAUDE.md`
     - `return_to` sem caminho vindo do chamador (D-5), com o teste de `422` intacto
     - Portal com caminho constante
   - Registrar o resultado neste plano, abaixo da revisão anterior.
   - Dependencies: task 4

## Revisão de Segurança

> **Superada em parte (2026-09-16).** Esta revisão analisou a versão 2, com a rota `POST /billing/subscription/free-plan`. A rota saiu (ver "Escopo final"). Os itens marcados **[Superado]** tratam só dela e não valem mais. Os marcados **[Vale]** seguem aplicáveis. A task 5 registra a revisão do escopo final.

**Analista de Segurança, 2026-09-16.** Escopo: `git diff origin/main` da branch `feat/plan-choice-after-signup`, com foco em `8c05aae`…`5e07a1e`. Além da leitura do código, uma sonda descartável (não commitada) rodou contra o servidor de teste: 20 chamadas paralelas numa conta sem assinatura, escrita por cookie com e sem `Origin` da allowlist, e uma conta `trial_expired` enviando corpo forjado.

**Resultado: nenhum achado crítico nem moderado.** Os quatro achados abaixo são informativos e nenhum bloqueia o merge.

### Verificações que passaram

- **[Superado] Exceção ao portão de platform access (D-3).** `EnsureFreeSubscriptionUseCase` retorna antes de ler o catálogo quando existe qualquer linha em `subscriptions` para o `user_id`, sem olhar o status (`ensure_free_subscription.ts:25-28`). Nenhuma conta bloqueada com assinatura muda de estado. Isso está coberto por teste para `payment_failed` e para Pro ativo, em trial, vencido e cancelado, e a sonda confirmou `trial_expired`: a conta segue `trialing`, com `blocked_reason: "trial_expired"`. Nenhum caminho apaga só a assinatura: a única remoção é o cascade do purge LGPD (`auth_postgres_repository.ts:138`). Por isso não dá para fabricar o estado "sem assinatura" e ganhar um segundo trial pelo Checkout, que só oferece trial com `trial_ends_at === null`.
- **[Superado] Concorrência (D-2).** Na sonda, 20 POSTs paralelos deram 1×`204` e 19×`500`, todos com o corpo genérico `{"message":"Internal server error"}`. Ficou 1 linha em `subscriptions` e 1 entrada `started` no Histórico. A restrição `subscriptions_user_id_unique` (`drizzle/0007_robust_cobalt_man.sql:31`) barra o segundo `INSERT`, e o `dispatch` só roda depois do `save` (`ensure_free_subscription.ts:43-45`). Por isso a chamada perdedora não emite `SubscriptionStartedEvent`, cujo único handler é o do Histórico. A janela acontece uma vez na vida da conta: depois que a linha existe, toda chamada é `204` sem escrita, e o `500` não se repete.
- **[Superado] IDOR e mass assignment.** O controller não declara `inputSchema` e ignora a requisição. O alvo vem só de `user.id` da sessão (`ensure_free_subscription.controller.ts:32-35`). Na sonda, um corpo com o `user_id` de outra conta, `plan_code: "pro"` e `status: "active"` recebeu `204`: a outra conta continuou sem linha e a assinatura do chamador ficou intacta.
- **[Superado] CSRF.** `assertSameSiteRequest` roda em toda rota autenticada antes de `authenticate`, com ou sem `allowWithoutPlatformAccess` (`http_controller_adapter.ts:497`). Na sonda, cookie com `Origin: https://evil.example` deu `403`, cookie sem `Origin` deu `403` e nenhuma assinatura foi criada. Com a origem da allowlist, `204`. O cookie ainda é `SameSite=Lax`. E o pior caso de um CSRF aqui seria criar o Free de uma vítima sem assinatura, que é o próprio comportamento desejado.
- **[Vale] Open redirect (D-5).** `return_to` é `z.enum(CHECKOUT_RETURN_TARGETS)` (`create_checkout_session.controller.ts:22`) e vira caminhos fixos sob `FRONT_BASE_URL` (`create_checkout_session.ts:24-36`). O Portal usa uma constante (`create_billing_portal_session.ts:14`). Um teste HTTP ainda trava a regra: `https://evil.example/phish`, `/app/settings/billing`, `//evil.example`, `BILLING` e `""` dão `422` (`tests/billing/create_checkout_session.test.ts:396-419`).
- **[Superado] Exceção MCP (D-4).** Procede. `/mcp` exige `has_platform_access` de todo não-admin (`src/core/infra/mcp/routes.ts:254-258`), e `SubscriptionEntitlementService` nunca concede acesso sem assinatura. A tool seria um no-op para todo não-admin que chegasse até ela.
- **[Superado] LGPD.** Nenhum dado pessoal novo. A rota grava a mesma linha e a mesma entrada de Histórico que o cadastro já grava (execução de contrato), e as duas têm `ON DELETE cascade` a partir de `users`. A saída de `plan_chosen_at` reduz o que fica armazenado.
- **[Vale em parte] Resíduos.** `git diff origin/main -- drizzle/ src/core/infra/database/` está vazio: schema, snapshots e journal são idênticos a `main`. Não há `plan_chosen_at`, `needs_plan_choice`, `recordPlanChoice` nem `confirm_free_plan_choice` em `src`, `drizzle` ou `CLAUDE.md`. As asserções de ausência em `get_subscription_status.test.ts:54,82` saem na task 2. A exceção fica na documentação OpenAPI do Checkout (I-1).

### Achados

**INFORMATIVO I-1: resíduo de "escolha de plano" na OpenAPI do Checkout** (resolvido em `1c58f4d`)

- Onde: `src/billing/presentation/controller/create_checkout_session.controller.ts:46`
- Problema: a descrição termina com "Creating a session never records the initial plan choice — only the subscription actually starting does.". A API não registra mais escolha nenhuma (D-1), então o `/docs` descreve um estado que não existe. O trecho "where the initial plan choice happens" também amarra o contrato da API a uma tela do front.
- Impacto: documentação enganosa para integradores e para a IA que lê o spec. Sem impacto de segurança.
- Correção: apagar a última frase e encurtar o trecho do `onboarding` para "`onboarding` returns to the app home.".

**[Superado] INFORMATIVO I-2: o `500` da corrida loga SQL, parâmetros e stack**

- Onde: `src/core/infra/http/adapters/http_controller_adapter.ts:333` (erro não mapeado numa rota que não é de protocolo), disparado por `subscription_postgres_repository.ts:144`
- Problema: na sonda, cada chamada perdedora logou em `ERROR` a mensagem do Drizzle (`Failed query: insert into "subscriptions" ... params: <id>, <created_at>, <updated_at>, <user_id>, <plan_id>, active, ...`) com o stack. Hoje os parâmetros são só identificadores e datas, sem nome nem email. O volume é limitado a uma janela por conta. O risco foi aceito em D-2, e esta revisão concorda.
- Impacto: ruído em alerta de erro, porque um duplo clique vira um `ERROR` com stack. Pela LGPD, o log leva o `user_id` pseudonimizado, como outros logs já levam.
- Recomendação (opcional): se o ruído incomodar em produção, o caminho barato é um método de repositório com `insert ... on conflict (user_id) do nothing returning id`, usado só por `EnsureFreeSubscriptionUseCase`, que despacha o evento apenas quando uma linha volta. **Nunca** `on conflict (user_id) do update`: isso transformaria uma corrida com o webhook na sobrescrita de uma assinatura Pro pelo Free.

**[Superado] INFORMATIVO I-3: rota sem rate limit**

- Onde: `src/core/infra/http/routes/routes.ts:335-339`
- Análise: cada chamada custa a leitura da sessão, a do usuário e uma leitura indexada de `subscriptions` (o `touch` da sessão tem throttle), sem chamada ao gateway. A escrita acontece no máximo uma vez na vida da conta. O perfil é o mesmo de `GET /billing/subscription` e `GET /billing/subscription/history`, também alcançáveis sem platform access e sem limite. A rota não abre superfície nova de abuso. No caso operacional de catálogo sem `free`, cada chamada gera um `404` logado em `ERROR`: um flood de log autenticado igual ao de qualquer rota que responde `404`.
- Recomendação (opcional): para ficar uniforme com Checkout e Portal, um `userRateLimitPolicy` de cerca de 30 chamadas por minuto por usuário.

**[Superado] INFORMATIVO I-4: as garantias da corrida não têm teste de regressão**

- Onde: `tests/billing/ensure_free_subscription_route.test.ts`
- Problema: a integridade do risco aceito em D-2 depende de três fatos que nenhum teste trava: a unicidade de `subscriptions.user_id`, `save()` fazer `INSERT` em vez de upsert por `user_id`, e o `dispatch` vir depois do `save`. Um refactor que mude qualquer um deles passaria na suíte e poderia duplicar o Histórico ou sobrescrever uma assinatura.
- Recomendação: um teste que dispare cerca de 5 chamadas paralelas numa conta sem assinatura e afirme **só o estado final**: exatamente 1 linha, exatamente 1 entrada `started`, e nenhuma resposta fora de `204`/`500`, sem fixar quantos `500` saem. Com menos valor, também faltam o `404` com catálogo sem `free` e um teste de CSRF específico da rota. O teste genérico de CSRF já existe em `tests/auth/session_cookie.test.ts:173,232`.

### Revisão do escopo final (task 5)

**Analista de Segurança, 2026-09-16.** Escopo: `git diff origin/main` em `7b11085`, com 7 arquivos: `return_to`, as URLs de retorno sob `/app`, seus testes, o parágrafo do `CLAUDE.md` e este plano.

**Resultado: nenhum achado crítico, moderado ou informativo novo.** Nada bloqueia o merge.

- **Rota e portão.** `git diff origin/main` está vazio em `src/core/`, `src/billing/infra/`, `src/auth/`, `tests/core/` e `drizzle/`. Não há rota nova, controller novo nem `allowWithoutPlatformAccess` novo. Os dois casos de uso só são usados pelos controllers que já existem em `main`.
- **MCP.** Nenhuma tool nova. O diff do `CLAUDE.md` é só o parágrafo das URLs de retorno, sem exceção nova. Checkout e Portal seguem na exceção de sessões de pagamento que já existia.
- **Resíduos.** O `grep` da task 4, somado a `planChosenAt` e `plan_choice`, volta vazio em `src`, `tests`, `drizzle` e `CLAUDE.md`. A OpenAPI é gerada em runtime a partir do controller, e a descrição dele não fala mais em escolha de plano (I-1 resolvido).
- **Open redirect (D-5).** `return_to` é `z.enum(CHECKOUT_RETURN_TARGETS).default("billing")` (`create_checkout_session.controller.ts:22`). O caso de uso só indexa `RETURN_PATHS`, que tem caminhos literais (`create_checkout_session.ts:24-36`). A origem vem de `FRONT_BASE_URL`, que precisa ser uma origem exata (`environments.ts:207`). Campos extras são descartados, e o controller repassa só `plan_code` e `return_to`. O `422` não ecoa o valor enviado.
- **Trava por teste.** `https://evil.example/phish`, `/app/settings/billing`, `//evil.example`, `BILLING` e `""` dão `422` pela rota HTTP (`tests/billing/create_checkout_session.test.ts:396-419`). O teste não passa por acaso: o `beforeEach` limpa o preço do Pro, então um schema afrouxado cairia no `IllegalStateError` e daria `500`. Nesta revisão, os 19 testes dos dois arquivos passaram.
- **Portal.** `RETURN_PATH` é constante e o `Input` é `Record<string, never>` (`create_billing_portal_session.ts:8,14`). Nada do chamador entra na URL, e o teste afirma a URL exata.
- **LGPD.** Nenhum dado pessoal novo é coletado, armazenado ou logado.
- **Nota para o front (não é achado).** `?checkout=success` é só aviso de UX, porque qualquer um digita essa URL. O acesso continua vindo do webhook, como em `main`.
