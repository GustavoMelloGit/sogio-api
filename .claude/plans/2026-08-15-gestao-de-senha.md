# Gestão de Senha — Alteração Autenticada e Recuperação de Acesso por Email

> Plano produzido pela persona **Arquiteto**. Branch `add-password-management`,
> worktree `.claude/worktrees/add-password-management`.

## Objective

Dar ao Usuário do Sogio duas capacidades que hoje não existem: trocar a própria
senha estando autenticado (apresentando a senha atual), e recuperar o acesso
quando perdeu a senha, provando controle do email cadastrado. O segundo fluxo é
limitado a 3 emissões por conta em uma janela mensal. Envio de email passa a ser
uma capacidade da plataforma, implementada com Resend.

---

## 1. Análise de Negócio

Hoje um proprietário que perde a senha fica **permanentemente trancado fora** da
própria conta — não há caminho de recuperação, nem self-service nem operacional.
O único recurso seria intervenção manual no banco. Isso é um bloqueador direto
para colocar proprietários reais na plataforma.

O segundo problema é de higiene: não há como rotacionar uma credencial suspeita
de comprometimento. Quem desconfia que a senha vazou não tem o que fazer.

As duas capacidades resolvem, respectivamente:

- **Alteração de Senha** — o Usuário no controle da própria credencial, sem
  depender de suporte. Pré-requisito para qualquer resposta a incidente do lado
  do usuário.
- **Recuperação de Acesso** — o Usuário recupera a conta pelo único canal que
  ele comprovadamente controla (o email cadastrado), sem intervenção humana.

O limite de 3 recuperações por mês existe por dois motivos de negócio: custo de
envio de email e proteção da caixa de entrada do usuário contra ser inundada por
um terceiro que só conhece o endereço dele.

Do ponto de vista de LGPD, recuperação de acesso é instrumental ao direito de
acesso aos próprios dados (art. 18): sem ela, o titular não consegue exercer
nenhum dos outros direitos que a plataforma já implementa (`PurgeUserDataUseCase`).

---

## 2. Análise de Domínio

### 2.1 Bounded Context

**Auth**, sem ambiguidade — "identidade e autenticação de usuários". Nenhum outro
BC é tocado. A única fronteira interna afetada é o subdomínio de **acesso
delegado** (OAuth/MCP), que também vive em Auth: uma troca de senha é um evento
de ciclo de vida de credencial e obriga a perguntar se as concessões delegadas
sobrevivem a ela (ver R11).

### 2.2 Linguagem Ubíqua

| Termo (domínio)                    | Significado                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Senha**                          | O segredo de acesso do Usuário. Já existe como atributo de `User`.                                                                       |
| **Alteração de Senha**             | O Usuário autenticado substitui a própria senha, apresentando a senha atual. É um **comportamento do agregado `User`**, não um agregado. |
| **Pedido de Recuperação de Senha** | Comprovante de **uso único e vida curta** de que alguém solicitou a recuperação de acesso de uma conta. **Novo agregado.**               |
| **Cota Mensal de Recuperação**     | O limite de 3 emissões de Pedido por conta em uma janela mensal. É regra **sobre o histórico de Pedidos**, não estado do `User`.         |
| **Envio de Email**                 | Capacidade técnica transversal da plataforma. Não é conceito de Auth.                                                                    |

> Convenção da base: termos de domínio discutidos em português, identificadores
> de código em inglês (é exatamente o que o subdomínio de acesso delegado já faz).

### 2.3 Por que `PasswordResetRequest` é um agregado próprio, e não um Value Object dentro de `User`

Três razões, em ordem de peso:

1. **Cardinalidade.** A regra é "3 por mês" — ela exige **histórico**: N pedidos
   por usuário, cada um com seu timestamp. Como VO dentro de `User`, seria uma
   coleção; carregar `User` (o que acontece em **toda requisição autenticada**,
   via `AuthMiddleware`) passaria a arrastar histórico de recuperação que nada
   mais no sistema consome. Agregado grande por conveniência de modelagem.
2. **Ciclo de vida independente.** O Pedido nasce, expira sozinho, é consumido
   uma única vez e depois é lixo expurgável. `User` é permanente. Ciclos de vida
   distintos ⇒ agregados distintos.
3. **Precedente na própria base.** `AuthorizationRequest` e `AuthorizationCode`
   são exatamente este mesmo formato de conceito — comprovante efêmero, uso
   único, persistido por digest, com `expires_at`/`consumed_at` — e já são
   entidades próprias **no mesmo bounded context**. Modelar diferente aqui
   criaria dois idiomas para o mesmo tipo de coisa dentro de Auth.

**Atributos do agregado:** `user_id`, `token_digest`, `expires_at`,
`consumed_at`, mais o `BaseEntity` (`created_at` é o momento do pedido).

**Deliberadamente ausente: o email.** O email é do `User`. Copiá-lo para o Pedido
criaria uma segunda fonte de verdade (o que acontece se o usuário trocar o email
entre o pedido e o consumo?) e um dado pessoal a mais para reter — contra o
princípio de minimização.

### 2.4 Onde vive a regra "3 por mês"

A regra se decompõe em três responsabilidades distintas — é aqui que a maioria
dos designs erra, jogando as três dentro do use case:

1. **A contagem** — método do repositório: contar Pedidos de um usuário desde
   uma data. Isso é consulta, não regra.
2. **A regra** (o predicado e os números) — **policy de domínio** em
   `src/auth/domain/service/`, como **função pura**, no formato já estabelecido
   por `isConsentExpired` (e por `oauth_scope_policy`, `app_display_name_policy`:
   a pasta chama de "service", mas são policies puras). Ali moram o limite (3) e
   a definição da janela.
3. **A aplicação da regra** — o use case de solicitação: consulta a contagem,
   chama a policy, decide o que fazer. **Orquestra; não contém os números.**

**Por que não na entidade `User`:** `User` não conhece o próprio histórico de
pedidos e não deve conhecer (§2.3).
**Por que não só no use case:** os números e a semântica da janela são regra de
negócio. Regra de negócio embutida em use case é invisível na revisão de domínio
e não é testável isoladamente.

### 2.5 A Cota Mensal **não** é rate limiting

Ponto crítico para o Analista de Segurança. São **dois controles distintos**,
ambos necessários, com propósitos e modos de falha diferentes:

|                    | Cota Mensal de Recuperação                            | Rate limit da rota                          |
| ------------------ | ----------------------------------------------------- | ------------------------------------------- |
| Propósito          | regra de negócio; custo de email e anti-spam à vítima | proteção de infraestrutura; anti-flood      |
| Dimensão           | conta (`user_id`)                                     | `peer-ip`                                   |
| Janela             | ~30 dias                                              | segundos/minutos                            |
| Persistência       | banco — sobrevive a restart e a multi-instância       | memória do processo (`InMemoryRateLimiter`) |
| Efeito ao estourar | recusa **silenciosa e indistinguível** (R2)           | `429`                                       |

Confundi-las produz ou um limite de negócio que zera a cada deploy, ou um limite
de infraestrutura que exige ida ao banco por requisição. Ambos devem existir e
são independentes.

### 2.6 Agregados existentes tocados

- **`User`** — ganha um comportamento nomeado de troca de senha. Hoje a entidade
  é totalmente imutável (só getters). O precedente da base para mutação é `Stay`
  (mutação in-place de `#data` renovando `updated_at`) e `PropertySetting`/
  `AppSetting` (nova instância via patch). **Decisão: mutação in-place explícita
  e nomeada**, no molde de `Stay` — trocar senha é uma operação nomeada do
  domínio, não "atualizar um campo qualquer". A entidade recebe o **hash já
  calculado**: hashing é responsabilidade de `Hasher`, que vive em `application`,
  e `domain` não pode depender de `application`.
- **`AuthRepository`** — ganha um método de persistência **restrito à senha**
  (Interface Segregation; e evita que um `updateUser` genérico vire vetor de mass
  assignment sobre `role`).
- **`Consent` / `IssuedCredential`** — tocados **apenas** se a decisão pendente
  DP2 (R11) for "sim". Nada a mudar neles: `revokeConsentCascade` já existe.

### 2.7 Eventos de Domínio

A base tem `EventDispatcher` e o padrão `StayBookedEvent`/`StayCanceledEvent`,
sempre justificado por um **efeito concreto em outro contexto**.

- **`PasswordResetRequestedEvent` — não criar.** O único consumidor seria o envio
  do email: síncrono, no mesmo bounded context, e cuja falha o fluxo precisa
  observar para registrar. Evento aqui é indireção sem ganho (YAGNI). O use case
  chama a porta de email diretamente.
- **`PasswordChangedEvent` — não criar agora.** Registrado como o ponto de
  extensão natural quando (a) a notificação "sua senha foi alterada" virar
  requisito, ou (b) a revogação de sessões/consentimentos ganhar mais de um
  consumidor. Hoje teria zero ou um handler.

Registro as duas negativas **explicitamente** porque "essa alteração dispara
algum evento?" é pergunta obrigatória da revisão de domínio, e a resposta "não"
precisa ser deliberada, não omissão.

### 2.8 A porta de envio de email: `core`, não `auth`

**Decisão: porta em `core/application/`, adapter Resend em `core/infra/`,
factory em `CoreDi`.**

- "Enviar um email" **não** pertence à linguagem ubíqua de Auth. Auth precisa de
  email porque é o canal de recuperação; Booking vai precisar (confirmação de
  reserva, código de entrada), Finance vai precisar (fechamento mensal). Colocar
  a porta em `auth/application/service/` faria Booking **importar de Auth** para
  mandar email — acoplamento invertido entre bounded contexts, exatamente o que a
  separação em BCs existe para impedir.
- O precedente da base é inequívoco: `Logger` e `RateLimiter` são capacidades
  técnicas transversais e vivem em `core/application/{logger,rate_limit}/` com
  implementação em `core/infra/`, expostas por `CoreDi.makeLogger()` /
  `makeRateLimiter()`. `Hasher` e `SessionManager` ficaram em `auth` porque **são**
  conceitos de Auth (hash de senha, sessão). Email não é.
- **A porta deve ser burra**: destinatário, assunto, corpo. **O conteúdo do email
  de recuperação é de Auth** — é linguagem de negócio de Auth. Quem compõe a
  mensagem é um colaborador em `auth/application/`, não `core`. Sem essa divisão,
  `core` acumula conhecimento de todos os BCs.

**O link do email aponta para o front, não para a API.** `FRONT_BASE_URL` já
existe e já é o precedente estabelecido (o `/authorize` redireciona para lá). O
front coleta a nova senha e chama a rota da API que consome o token.

---

## 3. Riscos e Questionamentos

Numerados para o Analista de Segurança referenciar no laudo.

**R1 — Enumeração de contas.** Se a solicitação de recuperação responder 404 para
email inexistente e 200 para existente, vira oráculo de "quem tem conta no Sogio".
A resposta deve ser **idêntica e sempre bem-sucedida**, independentemente de o
email existir. Consequência de domínio: o use case **não lança
`ResourceNotFoundError`** quando não acha o usuário — retorna o mesmo DTO e
encerra. Isso contraria o reflexo "não achou ⇒ 404" do resto da base, então
precisa estar justificado no código, senão alguém "conserta" depois.

**R2 — A Cota Mensal também é um oráculo.** Se estourar a cota devolver 409/429 e
não estourar devolver 200, o atacante distingue contas existentes pela diferença
de resposta. A recusa por cota tem que ser **externamente indistinguível** do
caminho feliz: não envia email, não cria pedido, responde igual. O sinal vai para
o **log**, nunca para o cliente. **Este é o ponto mais fácil de errar do plano
inteiro** — é o instinto natural do desenvolvedor devolver 429 aqui.

**R3 — "Por mês": calendário ou janela móvel?** (a) 3 por mês-calendário zera no
dia 1º e permite 6 emissões em 48h na virada do mês. (b) Janela móvel de 30 dias
limita de fato. **Recomendo (b)** — é a que cumpre o propósito e é trivial de
implementar como contagem desde `agora - 30d`. Única ambiguidade real do
requisito ⇒ **DP1** abaixo.

**R4 — O que consome cota: emissão ou consumo?** **Recomendo emissão.** O custo
que se quer limitar (envio de email, spam na caixa da vítima) acontece na
emissão. Se contasse só o consumo, um atacante dispararia emails ilimitados para
a vítima sem nunca consumir nenhum.

**R5 — Expiração do Pedido.** Vida curta e explícita. O precedente da base para
comprovante de uso único é `AuthorizationCode` ("vida curtíssima"). Para
recuperação de senha o padrão de mercado é 15–60 min; **recomendo 1 hora**,
configurável por env var com default, no formato `*_TTL_SECONDS` já estabelecido.
Sem `expires_at`, um email vazado meses depois ainda abre a conta.

**R6 — Invalidar Pedidos pendentes ao emitir um novo.** Se o usuário pede 3
vezes, os 3 links funcionam? **Recomendo que não**: emitir um novo Pedido
invalida os pendentes anteriores daquele usuário. Reduz a janela de exposição e é
o comportamento que o usuário espera ("pedi de novo, vale o último"). Sem isso,
um link antigo interceptado continua válido depois de o usuário já ter pedido
outro.

**R7 — Uso único de verdade (race condition).** Dois requests simultâneos com o
mesmo token não podem ambos trocar a senha. A base **já resolveu exatamente
isso** em `AuthorizationCodeRepository.claim` — `UPDATE ... WHERE consumed_at IS
NULL RETURNING`, atômico no banco, com zero linhas tratado como reuso. **Reutilizar
esse formato**; um `find` seguido de `update` no use case é a implementação
errada.

**R8 — O token em claro nunca é persistido.** Apenas o digest.
`DelegatedSecretService` já faz exatamente isso (32 bytes aleatórios base64url +
SHA-256 hex) e já vive em `auth/domain/service/`. **Reutilizar a implementação,
não duplicar.** Ressalva: o nome atual está amarrado ao subdomínio de acesso
delegado, e o uso pelo fluxo de recuperação — legítimo, é o mesmo conceito — vai
fazer o nome mentir. Se o Revisor julgar impreciso, **a correção é renomear, não
duplicar o gerador**.

**R9 — Token em URL e em logs.** O link chega ao front com o token. Do lado da
API, a rota que consome o token deve recebê-lo **no corpo da requisição, nunca na
query string ou no path** — URLs vazam para logs de acesso, referrers e proxies.
E nada no fluxo pode logar o token nem o digest.

**R10 — Senha atual obrigatória na alteração autenticada.** Um JWT roubado não
pode trocar a senha sozinho — a verificação da senha atual é o que impede a tomada
permanente da conta a partir de um token de sessão vazado. Falha ⇒
`UnauthorizedError` com mensagem genérica.

**R11 — Sessões e consentimentos após a troca. (Dívida arquitetural real.)** O
JWT hoje é stateless: sem `jti`, sem versão, sem lista de revogação
(`SessionManager` só assina e verifica). **É arquitetonicamente impossível
invalidar sessões existentes ao trocar a senha.** Consequência concreta: quem
roubou a sessão continua dentro por até 24h **depois** de a vítima trocar a
senha — o que esvazia parcialmente o valor do próprio fluxo de recuperação. Não
proponho resolver nesta feature (exigiria versionar o token e checar no
middleware — mudança transversal, feature própria), mas **exijo que fique
registrada e classificada pelo Analista de Segurança**.
Já os **consentimentos OAuth/MCP são revogáveis** — `revokeConsentCascade` existe
e é síncrono. ⇒ **DP2** abaixo.

**R12 — Nova senha igual à atual.** **Recomendo rejeitar** na alteração
autenticada (`ValidationError`): é barato e evita a troca de fachada. **Não
recomendo histórico de N senhas anteriores**: complexidade acidental e obrigaria
a reter hashes antigos — dado a mais, contra minimização (LGPD).

**R13 — Política de força de senha, fonte única.** Hoje `userSchema` exige apenas
`min(8).max(128)`. Os dois fluxos novos **criam senhas**; se cada um validar do
seu jeito, o sistema passa a ter três definições de "senha válida" (registro,
alteração, redefinição). **Diretriz: uma única fonte de verdade, aplicada nos três
pontos.** Endurecer a regra é decisão separada — não misturar com esta feature.

**R14 — Retenção e o direito ao esquecimento.** O Pedido guarda `user_id` +
timestamps: dado pessoal por associação. Exige (a) **expurgo** dos consumidos e
expirados — o projeto não tem cron, e o padrão estabelecido é o _piggyback na
própria rota_ (`RegisterAppUseCase.#purgeUnusedRegistrations`); e (b) **`ON DELETE
cascade`** a partir de `users`. Sem (b), `PurgeUserDataUseCase` — que deleta
`users` diretamente e depende dos cascades estarem corretos — **passa a falhar**.
Este é um bug que a feature introduz se ninguém olhar; há precedente literal
disso no comentário do próprio `purgeUserData`.

**R15 — Falha do provedor de email não pode virar oráculo nem 500.** Se o Resend
cair, o usuário não pode receber uma resposta distinguível. **Recomendo:** persistir
o Pedido, tentar enviar, e em falha **logar e responder o mesmo DTO genérico** —
o usuário tenta de novo. Falhar a requisição vaza estado interno e ainda assim já
consumiu cota.

**R16 — Corolário de R4+R15:** Pedido criado ⇒ cota consumida, mesmo se o email
falhar. Aceito (é o comportamento seguro), mas o log precisa deixar isso
recuperável para o suporte.

### Decisões pendentes de confirmação do usuário

Nenhuma bloqueia o início da implementação — cada uma tem um default recomendado.

- **DP1 (R3)** — Janela da cota: **móvel de 30 dias** (recomendado) vs.
  mês-calendário.
- **DP2 (R11)** — Recuperar/alterar a senha deve **desconectar os aplicativos
  conectados** (consentimentos OAuth/MCP)? **Recomendação: sim na recuperação**
  (a premissa do fluxo é que a conta pode estar comprometida), **não na alteração
  autenticada** (o usuário provou que é ele; derrubar as integrações a cada
  rotação de senha é hostil). Se confirmado, a task 9 ganha a chamada ao cascade.

---

## 4. Decisões Arquiteturais

| #   | Decisão                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Bounded context: **Auth**. Nenhum outro BC tocado.                                                                                                                                                                                  |
| D2  | **`PasswordResetRequest`**: nova entidade/agregado em `auth/domain/entity/`, no molde de `AuthorizationCode`. Campos: `user_id`, `token_digest`, `expires_at`, `consumed_at`.                                                       |
| D3  | **`PasswordResetRequestRepository`**: interface em `auth/domain/repository/`. Operações: criar; **reivindicar atomicamente** (formato `claim`, R7); contar na janela; invalidar pendentes do usuário (R6); expurgar por data (R14). |
| D4  | **Cota Mensal**: policy pura em `auth/domain/service/`, no molde de `isConsentExpired`. Limite e janela moram lá; o use case apenas aplica.                                                                                         |
| D5  | **TTL do Pedido**: env var `*_TTL_SECONDS` com default, exportada em ms por `environments.ts`, **injetada pelo `AuthDi`** — é assim que os TTLs de consent/token já funcionam. Não hardcodar no domínio.                            |
| D6  | **Porta de email em `core/application/`**, adapter Resend em `core/infra/`, factory em `CoreDi`. **Composição da mensagem de recuperação em `auth/application/`.**                                                                  |
| D7  | **`User`** ganha comportamento nomeado de troca de senha, recebendo **hash pronto**. `AuthRepository` ganha método de persistência **restrito à senha**.                                                                            |
| D8  | **Sem eventos de domínio** nesta feature (§2.7). `PasswordChangedEvent` registrado como extensão futura.                                                                                                                            |
| D9  | Geração do segredo **reutiliza `DelegatedSecretService`** (R8). Não duplicar.                                                                                                                                                       |
| D10 | **`rateLimitPolicy` `peer-ip` nas três rotas novas**, independente e adicional à Cota Mensal (§2.5).                                                                                                                                |
| D11 | **Respostas indistinguíveis** no fluxo de recuperação (R1, R2, R15): o use case de solicitação retorna sempre o mesmo DTO, aconteça o que acontecer.                                                                                |

---

## 5. Diretrizes para as demais personas

### 5.1 Desenvolvedor

Três rotas novas. Termos abaixo em português (domínio); traduzir para
identificadores em inglês seguindo a convenção da base.

**1. Alterar Senha** — autenticada.
Recebe senha atual + nova senha. Verifica a atual via `Hasher.compare`; falha ⇒
`UnauthorizedError` genérico (R10). Nova senha idêntica à atual ⇒
`ValidationError` (R12). Gera o novo hash e persiste.

**2. Solicitar Recuperação de Senha** — pública.
Recebe email. **Sempre responde o mesmo DTO** (D11). Internamente, em ordem:
localiza o usuário (não achou ⇒ encerra silenciosamente, R1); aplica a policy de
cota (estourou ⇒ encerra silenciosamente + log, R2); invalida Pedidos pendentes
anteriores (R6); gera o segredo via `DelegatedSecretService` (R8); persiste o
Pedido com digest e `expires_at` (R5); monta o link a partir de `FRONT_BASE_URL`;
envia pela porta de email. Falha de envio ⇒ log, resposta inalterada (R15).
Expurgo best-effort de Pedidos vencidos faz piggyback aqui (R14), no molde de
`RegisterAppUseCase.#purgeUnusedRegistrations`.

**3. Redefinir Senha** — pública.
Recebe token + nova senha, **ambos no corpo** (R9). Reivindica o Pedido
atomicamente (R7); zero linhas ⇒ `UnauthorizedError` genérico — **não distinguir**
"inexistente" de "já usado" de "expirado". Valida `expires_at`. Gera o hash e
persiste. Se **DP2** for confirmado como "sim", cascateia a revogação de
consentimentos aqui.

Transversal às três:

- `rateLimitPolicy` na dimensão `peer-ip` (D10).
- `inputSchema` Zod com `min`/`max` em **todo** campo de texto — o Analista de
  Segurança cobra isso explicitamente.
- `openApiSpec` completo, no formato dos controllers existentes.
- Nova senha validada pela **mesma** regra do registro (R13).
- **Nunca logar**: senha em claro, token em claro, digest do token.

Schema Drizzle: nova tabela para os Pedidos; `user_id` referenciando `users` com
**`ON DELETE cascade`** (R14); `token_digest` único; índice em
`(user_id, created_at)` para a contagem da cota.

Env vars novas: chave da API do Resend, remetente, e TTL do Pedido. Seguir a
disciplina de `refine` por ambiente que `API_BASE_URL`/`FRONT_BASE_URL` já usam
(**obrigatórias fora de `development`**). **Atenção:** `env` é parseado no import;
tornar a chave do Resend obrigatória sem ressalva **quebra a suíte de testes
inteira**. Em `test`, o adapter Resend nunca deve ser exercido.

### 5.2 Analista de Segurança

Revisar com atenção especial: **R1 e R2** (oráculos de enumeração — o achado mais
provável), **R5**, **R6**, **R7** (uso único atômico), **R9** (token em URL/logs),
**R11** (dívida de invalidação de sessão — **classificar formalmente**), **R14**
(retenção + cascade do purge LGPD), **R15**. Verificar também que a rota
autenticada nova não abre mass assignment sobre `role`.

### 5.3 Revisor

Checar que: os números da cota e do TTL não vazaram para dentro do use case (D4,
D5); a policy é função pura testável isoladamente; o adapter Resend não vazou para
`application`; e não houve duplicação do gerador de segredos (R8, D9).

---

## Tasks para o Desenvolvedor

> Tasks sem dependência comum podem rodar em paralelo. As tasks 1, 3, 4 e 5 são
> todas independentes entre si e formam a primeira onda.

1. **Configuração e env vars** — adicionar em `environments.ts`: chave da API do
   Resend, remetente do email, e TTL do Pedido de Recuperação (formato
   `*_TTL_SECONDS`, com default), exportando o TTL em ms como os demais.
   Obrigatórias fora de `development` via `refine`, no molde de `API_BASE_URL`.
   Atualizar a seção "Variáveis de Ambiente" do `CLAUDE.md` e o pré-requisito de
   `.env.test`.
   - Dependências: nenhuma

2. **Porta e adapter de envio de email** — `bun add resend`; porta em
   `core/application/` (destinatário, assunto, corpo — burra, sem conhecimento de
   Auth); adapter Resend em `core/infra/`; factory em `CoreDi` no molde de
   `makeLogger`/`makeRateLimiter`.
   - Dependências: task 1

3. **Agregado, schema e repositório de Pedido de Recuperação** — entidade
   `PasswordResetRequest` no molde de `AuthorizationCode`; tabela Drizzle com
   `ON DELETE cascade` em `user_id`, `token_digest` único e índice
   `(user_id, created_at)`; interface de repositório com criar / **claim atômico** /
   contar na janela / invalidar pendentes / expurgar por data; implementação
   Postgres.
   - Dependências: nenhuma

4. **Comportamento de troca de senha no `User` e no `AuthRepository`** — método
   nomeado na entidade que recebe o **hash pronto** e renova `updated_at` (molde
   `Stay`); método no repositório restrito a persistir a senha.
   - Dependências: nenhuma

5. **Policy da Cota Mensal de Recuperação** — função pura em
   `auth/domain/service/` no molde de `isConsentExpired`, com o limite (3) e a
   janela (30 dias corridos — DP1) como constantes locais.
   - Dependências: nenhuma

6. **Use case + controller de Alterar Senha** — rota autenticada; verifica senha
   atual, rejeita senha idêntica à atual, persiste o novo hash. `rateLimitPolicy`
   `peer-ip`, `inputSchema` com limites, `openApiSpec`.
   - Dependências: task 4

7. **Composição da mensagem de recuperação** — colaborador em
   `auth/application/` que monta assunto e corpo do email a partir do link
   derivado de `FRONT_BASE_URL`.
   - Dependências: tasks 1, 2

8. **Use case + controller de Solicitar Recuperação** — rota pública, resposta
   sempre idêntica (D11); ordem interna conforme §5.1; expurgo best-effort
   piggyback. `rateLimitPolicy` `peer-ip`.
   - Dependências: tasks 2, 3, 5, 7

9. **Use case + controller de Redefinir Senha** — rota pública; token e senha no
   **corpo**; claim atômico; erro genérico indistinguível; valida expiração;
   persiste o novo hash. Se **DP2** = sim, cascateia revogação de consentimentos.
   `rateLimitPolicy` `peer-ip`.
   - Dependências: tasks 3, 4

10. **Migration Drizzle** — gerar a migration da nova tabela (`bun run
db:migration`) e conferir o cascade. - Dependências: task 3

11. **Wiring de DI e rotas** — factories no `AuthDi` (repositório, policy, TTL
    injetado, porta de email vinda do `CoreDi`, os três use cases e os três
    controllers) e registro das rotas em `routes.ts` com o `authenticated`
    correto de cada uma.
    - Dependências: tasks 6, 8, 9

12. **Verificação final** — `bun run typecheck`, `bun run lint:check`,
    `bun run format:check` e `bun run test` limpos na worktree.
    - Dependências: tasks 10, 11

> **Nota para o Orquestrador:** a persona Desenvolvedor não escreve testes, e não
> existe persona de QA. Os fluxos de recuperação têm exatamente o tipo de
> comportamento que só teste pega (R1/R2 — respostas indistinguíveis; R7 — uso
> único sob concorrência). Recomendo decidir explicitamente quem cobre isso antes
> de abrir o PR.
