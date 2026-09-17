# Entrada com Google, conduzida pela API

## Objective

Permitir que uma pessoa entre no Sogio com a conta Google, sem digitar senha: o front só aponta o navegador para a API, a API conduz o authorization code flow com o Google (PKCE, `state`, `nonce`), valida a identidade atestada, cria a mesma sessão opaca que o login por senha cria (cookie `httpOnly`, ver "Sessão do App" no `CLAUDE.md`) e devolve o navegador ao front.

O ganho de negócio é tirar o atrito do cadastro e do login no celular, onde digitar email e senha é o ponto em que o anfitrião desiste. O ganho de segurança é colateral: quem entra só pelo Google não tem senha para vazar nem para reutilizar.

## Personas

- **Arquiteto** (`model: opus`): este plano, as invariantes e o vocabulário.
- **Desenvolvedor** (`model: sonnet`): tasks 1 a 11.
- **Analista de Segurança** (`model: opus`): task 20. Atenção especial a DA-10, DA-11, DA-12 e DA-15, que são o caminho de credencial.
- **Persona de testes: não existe** em `.claude/personas/`. O Desenvolvedor não escreve testes, então as tasks 12 a 19 ficam separadas e o Orquestrador decide quem as executa.

## Decisões do Usuário (2026-09-16, não reabrir)

- **D-U1.** Fluxo por redirect conduzido pela API. O front nunca carrega SDK do Google nem toca em credencial.
- **D-U2.** Conta existente com o mesmo email: a identidade Google é vinculada automaticamente **e a senha é mantida**. Risco aceito, registrado em R-1.
- **D-U3.** Email sem conta: cria conta nova **sem senha**, disparando `UserCreatedEvent` como o cadastro normal (assinatura Free). A senha pode ser definida depois pela recuperação de senha.

## Análise de Negócio

Três situações que passam a ter resposta:

- **"Não quero criar mais uma senha."** Cadastro em um toque, com nome e email que o Google já atesta.
- **"Já tenho conta com senha e quero entrar com o Google."** Vínculo automático no primeiro uso, sem tela de confirmação.
- **"Entrei pelo Google e agora quero uma senha."** Recuperação de senha por email, que já existe, define a primeira senha.

Um detalhe de produto que o desenho precisa respeitar: a entrada com Google pode acontecer no meio da conexão de uma IA (tela de consentimento do `/authorize` do MCP). A pessoa precisa voltar para aquela tela, não para o painel.

## Análise de Domínio

### Bounded Context

`auth`. Nenhum outro BC muda nesta entrega, com a exceção condicional de `notification` (P-1).

A entrada com Google **não** mora em `delegated_access`. Lá o Sogio é o **servidor** de autorização de apps de terceiros; aqui o Sogio é **cliente** de um provedor. Os dois falam OAuth por baixo, e é exatamente por isso que os nomes não podem se misturar.

### Linguagem Ubíqua

- **Provedor de identidade**: sistema externo que atesta quem a pessoa é. Hoje só `google`.
- **Identidade vinculada** (`LinkedIdentity`): o par (provedor, identificador no provedor) ligado a uma conta.
- **Identificador no provedor** (`subject`): o `sub` do Google. Estável e opaco. Nunca o email.
- **Entrada com Google**: o fluxo inteiro, do botão ao cookie de sessão.
- **Pedido de entrada externa** (`ExternalSignInRequest`): o estado transitório do fluxo. Curto, de uso único, amarrado ao navegador que o iniciou. Irmão de "Pedido de Recuperação de Senha" e de "Pending Authorization Request".
- **Vínculo automático**: ligar uma identidade a uma conta existente pelo email que o provedor atesta.
- **Conta sem senha**: conta cuja única forma de entrada é uma identidade vinculada, até definir senha pela recuperação.
- **Destino de retorno** (`return_to`): caminho relativo do front para onde a pessoa volta.
- **Resultado da entrada**: o que o front recebe no fim (`status` ou `error`).

Evitar em código novo: "OAuth", "social login", "token do Google". "OAuth" no repositório já significa o servidor de autorização do MCP, e "token" já significa credencial OAuth ou segredo de sessão.

### Agregados

- **`LinkedIdentity`**: `user_id`, `provider`, `subject`. Nada mais: nem email, nem nome, nem credencial do provedor.
- **`ExternalSignInRequest`**: `provider`, `state_digest`, `code_challenge`, `nonce_digest`, `return_to`, `expires_at`, `consumed_at`. Sem `user_id` e sem dado pessoal.
- **`User`** (existente): `password` passa a ser opcional.

### Invariantes novas

Entram em `.claude/personas/arquiteto.md` na task 11.

- **IA-1. Uma identidade vinculada é identificada por (provedor, `sub`), nunca por email.** A resolução começa pelo `sub` e, quando ele já está vinculado, a decisão é final: o email que o provedor mandar naquele momento é ignorado. O email do provedor só é lido na hora de vincular ou de criar a conta, e nunca sincroniza com `User.email`.
- **IA-2. Email atestado é pré-condição de vínculo e de criação.** `email_verified` diferente do booleano literal `true` (ausente, `false`, string `"true"`) é não verificado. Fail-closed.
- **IA-3. Conta sem senha nunca autentica por senha, e a recusa é indistinguível de senha errada.** Mesma mensagem, mesmo status.
- **IA-4. A primeira senha de uma conta sem senha só nasce pela recuperação por email.** Nunca pela troca autenticada: uma sessão roubada não pode plantar uma credencial que sobrevive à revogação de sessões.
- **IA-5. O pedido de entrada externa é de uso único e amarrado ao navegador.** É consumido na primeira apresentação do `state`, qualquer que seja o desfecho, e só avança junto com o verificador que só o navegador que o iniciou possui. Nada do que o banco guarda completa o fluxo sozinho.
- **IA-6. As rotas de entrada com Google só redirecionam para dois lugares**: o endpoint de autorização do provedor (fixo em código) e a rota de resultado do front (`FRONT_BASE_URL` + caminho fixo). O destino de retorno viaja como parâmetro, nunca vira destino de redirect da API.
- **IA-7. Um ID token só é aceito quando chega pelo canal direto com o endpoint de token.** Qualquer fluxo futuro que receba ID token pelo navegador (One Tap, app nativo) exige verificação de assinatura, com biblioteca, nunca escrita à mão.
- **IA-8. Nenhuma credencial do provedor é persistida nem logada** (access token, refresh token, ID token), e nenhum dado de perfil além de nome e email, e só na criação da conta.

### Impacto em outros contextos

- **`billing`**: nenhum. `UserCreatedEvent` é reaproveitado como está, e o entitlement não sabe como a conta entrou.
- **`notification`**: só se P-1 for aprovado.
- **`core`**: variáveis de ambiente, `routes.ts` e o timer horário de limpeza em `src/index.ts`.
- **`booking`, `finance`, `property_management`, `backoffice`, `marketing`**: nenhum. Nenhum deles lê `password` (verificado por busca no código).
- **`sogio-front`**: contrato descrito abaixo.
- **`sogio-wa-bot`**: nenhum, consome por MCP.

## Decisões Arquiteturais

### DA-1. Dois agregados novos em `auth`, fora de `User`

`LinkedIdentity` e `ExternalSignInRequest` são agregados próprios. A identidade não entra em `User` porque `User` é carregado pelo `AuthMiddleware` em toda requisição autenticada, e só a entrada com Google precisa das identidades. É o mesmo raciocínio que deixou `Session` como agregado separado.

### DA-2. O provedor é valor do domínio; o protocolo é infra

O pedido era deixar o nome do fornecedor só em infra, no espírito de `billing/infra/gateway/`. Isso vale integralmente para o **protocolo**, mas não pode valer para o **valor**, e a diferença é de modelo, não de gosto:

- Em `billing`, o gateway é um fornecedor invisível para a pessoa. "Stripe" nunca precisa ser persistido como dado, e trocar de gateway não muda nada do que o usuário vê.
- Aqui, a pessoa escolhe o provedor (o botão diz "Google"), e o `sub` só significa algo dentro do emissor que o gerou. Persistir `sub` sem o provedor torna o identificador ambíguo no dia em que houver um segundo provedor.

Portanto:

- `google` aparece como valor de um **vocabulário fechado** no domínio, do mesmo jeito que `AIRBNB` aparece nas fontes de reserva de `booking`, e no caminho das rotas.
- **Só em `src/auth/infra/identity_provider/`**: endpoints, client secret, troca de código, formato do ID token, valores aceitos de `iss`, leitura de claims.
- A **porta** fica em `src/auth/application/service/` (nome sugerido: `ExternalIdentityProvider`), com forma agnóstica de provedor e duas operações: montar a URL de autorização a partir de (`state`, `nonce`, `code_challenge`, `redirect_uri`) e trocar (`code`, `code_verifier`, `redirect_uri`) por uma **identidade atestada** (`subject`, `email`, `email_verified`, `name`, `nonce`) ou por uma falha tipada. Falha esperada nunca é exceção.

### DA-3. Resolução de conta: `sub` primeiro, e ele é final

| identidade (provedor, `sub`) | `email_verified` | contas com o email (sem distinção de caixa)    | desfecho                                           |
| ---------------------------- | ---------------- | ---------------------------------------------- | -------------------------------------------------- |
| vinculada à conta U          | qualquer         | qualquer                                       | entra como U (`signed_in`)                         |
| não vinculada                | não verdadeiro   | qualquer                                       | recusa `email_not_verified`                        |
| não vinculada                | verdadeiro       | nenhuma                                        | cria conta sem senha e vincula (`account_created`) |
| não vinculada                | verdadeiro       | exatamente uma, sem identidade Google          | vincula e entra (`linked`)                         |
| não vinculada                | verdadeiro       | exatamente uma, já com outra identidade Google | recusa `account_conflict`                          |
| não vinculada                | verdadeiro       | mais de uma                                    | recusa `account_conflict`                          |

Os dois casos que o pedido pediu explícitos:

- **A pessoa trocou o email da conta Google.** O `sub` continua o mesmo: entra na mesma conta Sogio, cujo email não muda.
- **O `sub` está vinculado à conta A e o email do Google agora bate com a conta B.** Entra como A. B não é tocada, não é vinculada, não recebe nada. Um sinal do provedor nunca troca a conta de uma identidade já vinculada (IA-1).

### DA-4. A decisão é uma policy de domínio pura

A tabela de DA-3 vive numa policy em `src/auth/domain/service/` que recebe **fatos** (dono da identidade, se houver; `email_verified`; contas encontradas pelo email, cada uma com a informação de já ter ou não identidade Google) e devolve uma decisão: entrar como U, vincular a U, criar, ou recusar com motivo. O caso de uso só busca os fatos e executa a decisão. Isso deixa a matriz inteira testável sem banco e sem provedor.

### DA-5. Uma identidade por provedor por conta

Unicidade em (provedor, `subject`) e em (`user_id`, provedor). Uma conta que já tem **outra** identidade Google recusa o vínculo com `account_conflict`: nunca substitui, nunca acumula uma segunda.

Motivo: substituir faria o vínculo mudar sem nenhum ato da pessoa dona da conta, e acumular abriria a pergunta de qual identidade vale. O caso legítimo (conta Google Workspace recriada com o mesmo endereço) é raro e tem saída: entrar com a senha ou recuperá-la por email.

### DA-6. `email_verified` é exigido para vincular e para criar, e só nesses dois casos

Entrar por um `sub` já vinculado não lê o email, então não exige a verificação. Leitura fail-closed conforme IA-2.

### DA-7. Comparação de email sem distinção de caixa, só na busca do vínculo

Hoje o cadastro por senha não normaliza email, e a busca por email é exata. Sem esta decisão, quem se cadastrou como `Maria@Gmail.com` e entra pelo Google (que atesta `maria@gmail.com`) ganharia uma **segunda conta, vazia**, e acharia que perdeu os dados.

- A busca que alimenta a policy compara sem distinção de caixa e devolve **todas** as contas encontradas; nunca escolhe uma.
- Mais de uma conta encontrada é `account_conflict` (DA-3).
- A conta criada pelo Google guarda o email como o Google atesta.
- Normalizar email em cadastro, login e recuperação é dívida pré-existente, fora de escopo (R-3).

### DA-8. Criação de conta pelo Google

- `User` sem senha. Nome vindo do claim `name`, sem espaços nas pontas e truncado em 100 caracteres; ausente ou vazio, cai na parte local do email. `locale` e `time_zone` ficam nos padrões.
- **Conta e identidade na mesma transação** (`TransactionRunner`): uma conta sem senha nunca existe sem a identidade que a justifica.
- **`UserCreatedEvent` é despachado depois do commit**, exatamente como `RegisterUserUseCase` faz. Consequências: `billing` cria a assinatura Free sem nenhuma alteração, e nenhuma invariante nova nasce sobre os handlers de `UserCreatedEvent` (eles continuam rodando fora de transação, o que preserva a liberdade de um futuro handler com efeito externo, como um email de boas vindas). Se a assinatura Free falhar, a consequência é a mesma do cadastro por senha: conta bloqueada até intervenção manual.
- Violação de unicidade (duas abas criando a mesma conta ao mesmo tempo) vira `unavailable`. A tentativa seguinte já encontra a identidade.

### DA-9. Senha opcional, consumidor por consumidor

- **`User`**: o hash de senha passa a ser anulável, e o domínio ganha o fato "tem senha". `users.password` passa a aceitar nulo (migration só de ida, R-5).
- **`SignInUseCase`**: conta sem senha responde o mesmo `UnauthorizedError("Incorrect e-mail or password")` da conta inexistente, sem chamar o `Hasher` (IA-3). O tempo de resposta fica igual ao da conta inexistente. O oráculo "existe ou não existe" (por tempo, e pelo `409` do cadastro) já existe hoje e não é ampliado.
- **`ChangePasswordUseCase`**: conta sem senha responde `409` (`ConflictError`) com mensagem fixa apontando para a recuperação de senha, antes de qualquer comparação de hash. Nunca "definir a primeira senha só com a sessão" (IA-4). O `openApiSpec` da rota ganha o `409`.
- **`RequestPasswordResetUseCase`**: nenhuma alteração. Funciona para conta sem senha e mantém a resposta genérica.
- **`ResetPasswordUseCase`**: nenhuma alteração. É o caminho que define a primeira senha, e continua encerrando todas as sessões, inclusive a sessão Google que pediu.
- **`RegisterUserUseCase`**: nenhuma alteração. O email de uma conta sem senha continua dando `409`.
- **`GET /auth/me`**: ganha `has_password: boolean`, para o front decidir entre "Trocar senha" e "Definir senha".
- **Tool `get_me`**: **não** ganha `has_password`. É metadado de credencial, e as ações de credencial estão fora do MCP pela exceção "material de credencial"; um app conectado não tem uso para saber se a conta tem senha. `tests/auth/get_me_tool.test.ts` continua valendo como está.
- **Backoffice, `PurgeUserDataUseCase`**: nenhum consumo de `password`.

### DA-10. Estado transitório: tabela mais cookie de vínculo, nada secreto no banco

**No banco, `ExternalSignInRequest`:**

- `state_digest` (SHA-256 hex, único): chave de busca, no mesmo idioma de `authorization_requests.identifier_digest`.
- `code_challenge`: o S256 do verificador. Já é um digest.
- `nonce_digest`.
- `return_to` (anulável), `expires_at` (10 minutos, o mesmo prazo do pedido de autorização pendente), `consumed_at`.

**No navegador, o cookie de vínculo:**

- Guarda o `code_verifier` do PKCE: 32 bytes de CSPRNG em base64url, gerado por `DelegatedSecretService.generate()`. Nunca é persistido.
- `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` igual ao prazo do pedido, sem `Domain`.
- Fora de `development`/`test`: prefixo `__Host-` e `Secure` (mesma regra de ambiente local de `session_cookie.ts`).
- `Lax` é obrigatório, não conveniência: o callback chega por navegação de topo vinda de outro site (o Google), e `Strict` não enviaria o cookie.
- `__Host-` e não `__Secure-`: este cookie nunca precisa ser compartilhado entre subdomínios, e o prefixo impede que um subdomínio irmão injete um verificador próprio (o caminho de login CSRF por injeção de cookie).

**Vínculo com o navegador.** O callback só avança se o verificador do cookie bater com o `code_challenge` do pedido, pela mesma `verifyPkceS256` de `pkce_policy.ts` (comparação em tempo constante). O mesmo segredo é o verificador PKCE enviado ao Google e a prova de que **este** navegador iniciou **este** pedido: um `state` levado para outro navegador não passa, e uma leitura do banco não completa o fluxo.

**Uso único.** Reivindicação atômica por `state_digest` (só consome o que não foi consumido e não expirou), no idioma de E4. O pedido é consumido na primeira apresentação do `state`, inclusive quando a checagem de vínculo falha logo depois.

**O cookie não é limpo no sucesso.** A resposta de sucesso já gasta o seu único `Set-Cookie` com o cookie de sessão (limite RE1 do plano `2026-09-15-sessao-em-cookie.md`, que esta entrega mantém). O pedido já está consumido, então o cookie restante é inerte e expira sozinho. Nas respostas de erro, o cookie de vínculo é limpo.

**Alternativas recusadas:**

- **Memória**: um reinício do processo perde todo fluxo em andamento, e não há teto de crescimento sob enxurrada sem código de despejo.
- **Só cookie**: não há uso único do lado do servidor. Depois de um callback bem sucedido, o cookie continuaria valendo até o `Max-Age`, porque não dá para limpá-lo na mesma resposta. E o destino de retorno ficaria guardado no cliente.

**Expurgo (E9).** Pedidos vencidos saem no timer horário que já expurga sessões em `src/index.ts`.

### DA-11. Ordem de validação do callback (normativa)

Toda saída é `302` para a rota de resultado do front. O controller nunca deixa exceção chegar ao caminho JSON do adaptador, no mesmo molde de `AuthorizeController`: declara `parameterSource: "query"` sem `inputSchema` (o adaptador passa a tratá-lo como rota de protocolo: `no-store` nos erros e mensagem de erro não mapeado fora do log) e lê a query por `parseUniqueQueryParams` (E1).

0. Rate limit (adaptador).
1. Provedor não configurado: `unavailable`.
2. Parâmetro duplicado na query: `expired`, sem tocar no banco.
3. `state` ausente: `expired`.
4. Reivindicação por digest do `state` sem resultado: `expired`. **Daqui em diante o pedido está consumido e o `return_to` é conhecido.**
5. Cookie ausente ou verificador que não bate com o `code_challenge`: `expired`. No log, `binding_mismatch`, distinto, porque é sinal de segurança; para a pessoa, o mesmo código.
6. Provedor devolveu `error`: `access_denied` vira `canceled`; qualquer outro vira `unavailable`.
7. `code` ausente: `unavailable`.
8. Troca de código e validação de claims (DA-15) falharam: `unavailable`.
9. Digest do `nonce` do token diferente de `nonce_digest`: `unavailable` (log `nonce_mismatch`). O provedor atesta o token; o pedido atesta o nonce.
10. Policy de DA-3 recusou: `email_not_verified` ou `account_conflict`.
11. Executa (vincular, criar ou nada), cria a sessão e responde `302` com o `Set-Cookie` da sessão.

Exceção inesperada a partir do passo 4: `unavailable`, com o `return_to` já conhecido.

`GET /auth/google/start`, na ordem: rate limit; provedor não configurado vira redirect para o front com `error=unavailable`, sem falar com o Google; `return_to` validado (DA-12); geração de `state`, verificador e `nonce`; gravação do pedido; `302` para o Google com o cookie de vínculo.

### DA-12. Destino de retorno sem redirect aberto

- Entrada: `GET /auth/google/start?return_to=<caminho>`.
- Aceito só caminho relativo do front: começa com `/`, o segundo caractere não é `/` nem `\`, sem `\` em lugar nenhum, sem caractere de controle, até 512 caracteres. É a regra de `returnPath()` do front, mais estrita. Policy pura em `src/auth/domain/service/`, ao lado de `redirect_uri_policy.ts`.
- Inválido ou duplicado é **descartado em silêncio**: o fluxo segue sem destino, e o front cai no padrão (`/app`). Nunca é erro, igual ao comportamento do front.
- Gravado no pedido, do lado do servidor. Depois do início do fluxo, o cliente não o controla mais.
- Devolvido como parâmetro `return_to` da rota de resultado do front, nunca usado como destino de redirect pela API (IA-6). O front reaplica `returnPath()`: defesa em profundidade.
- Nunca vai para o log: pode carregar o `request_id` de um consentimento OAuth pendente.
- Retomar o consentimento do MCP: o front passa `/connect/authorize?request_id=...` como `return_to`. O pedido de autorização pendente dura 10 minutos, o que cobre a ida e volta ao Google (R-8).

### DA-13. Resultado entregue ao front

Uma única rota pública do front recebe todos os desfechos. O caminho é constante da camada de apresentação da API, como `FRONT_CONSENT_PATH` (sugestão: `/login/google`, a confirmar com o front).

- Sucesso: `?status=signed_in|linked|account_created`, mais `&return_to=...` quando houver.
- Falha: `?error=canceled|expired|email_not_verified|account_conflict|unavailable`, mais `&return_to=...` quando conhecido.

Por que uma rota fixa em vez de redirecionar direto para o `return_to`: decidir para onde navegar (escolha de plano depois de criar conta, retomar consentimento, mostrar erro) é do front. A API redireciona para um único destino configurado, e com isso não sobra superfície de redirect aberto do lado dela. O custo é um salto a mais no cliente.

Os códigos colapsam de propósito: `expired` cobre inexistente, vencido, já usado e vínculo com o navegador falho (mesmo idioma do `not_found` de `decide`); `unavailable` cobre tudo o que é do lado do provedor. `account_conflict` revela que existe conta com aquele email só para quem acabou de provar ao Google que é dono dele, então não é enumeração.

As duas rotas respondem sempre com `Cache-Control: no-store` e `Referrer-Policy: no-referrer`.

### DA-14. Adaptador do Google

- Endpoints fixos em infra: autorização `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`. Sem buscar documento de descoberta em runtime: uma chamada de rede e uma decisão de confiança a menos.
- Pedido de autorização: `response_type=code`, `scope=openid email profile`, `state`, `nonce`, `code_challenge` com `code_challenge_method=S256`, `redirect_uri`, `prompt=select_account`. Sem `access_type=offline`, sem `include_granted_scopes`, sem escopo adicional.
- `prompt=select_account`: o seletor de contas aparece sempre. A pessoa escolhe conscientemente qual conta Google entra (computador compartilhado, várias contas), e um vínculo automático nunca acontece com uma conta Google ativa que ela não escolheu.
- `profile` existe só por causa do `name` (DA-8). Foto, idioma e nomes separados são descartados na leitura.
- Troca de código: autenticada por `client_secret`, com timeout curto (ordem de 10 segundos). Só o `id_token` da resposta é lido; o access token do Google é descartado sem ser gravado nem logado (IA-8).
- Falha de rede, timeout, resposta não 2xx e token inválido viram falha tipada.

### DA-15. ID token sem verificação de assinatura, com todas as outras validações

O pedido citava assinatura via JWKS. A decisão é **não** verificar a assinatura, e **não** adicionar dependência:

- OpenID Connect Core 1.0, §3.1.3.7, item 6: quando o ID token é recebido por comunicação direta com o endpoint de token, a validação TLS do servidor pode substituir a verificação de assinatura.
- A documentação do Google para o fluxo de servidor diz o mesmo, textualmente: "since you are communicating directly with Google over an intermediary-free HTTPS channel and using your client secret to authenticate yourself to Google, you can be confident that the token you receive really comes from Google and is valid".
- Aqui o token **só** chega por esse canal: requisição a endpoint HTTPS fixo em código, autenticada por client secret.
- Verificar assinatura exigiria `jose` (dependência nova) ou validação JWS e cache de JWKS escritos à mão (confusão de algoritmo, rotação de chave). O que isso protegeria é um atacante que já quebrou o TLS com o Google, e esse atacante também controlaria a própria troca de código.

Validações que ficam, num validador puro de claims em infra (sem rede, nunca lança, no molde de `stripe_catalog_entry_parser.ts`):

- `iss` igual a `https://accounts.google.com` ou `accounts.google.com`.
- `aud` igual a `GOOGLE_CLIENT_ID`; se vier lista, precisa conter o client id, e `azp` precisa ser igual a ele.
- `exp` no futuro; `iat` não pode estar no futuro além de uma folga de relógio pequena e fixa.
- `sub` não vazio, até 255 caracteres; `email` válido, até 255.
- `email_verified` lido como booleano literal (IA-2): qualquer outra coisa vira `false`, não falha, para a policy responder `email_not_verified`. Mesmo `true`, só conta quando Google é autoridade sobre o domínio: email termina em `@gmail.com` (sem distinção de caixa) ou o claim `hd` chega como string não vazia (Google Workspace); fora disso vira `false`. `hd` presente com tipo errado conta como ausente, não invalida o token.
- `name` opcional.
- Tamanho do token limitado antes de decodificar; token malformado é falha.

O `nonce` é conferido pelo caso de uso contra o pedido (DA-11, passo 9). IA-7 trava a premissa.

### DA-16. Variáveis de ambiente

- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. O nome segue `TUYA_CLIENT_ID` e evita "OAUTH", pelo motivo da Linguagem Ubíqua.
- **Obrigatórias fora de `development`**, no mesmo `refine` das demais. Em `test`, valores fake: o adaptador nunca é exercido (os testes do callback trocam a porta, e o teste do início do fluxo não fala com o Google).
- **A redirect URI não é variável**: é derivada, `${apiBaseUrl}/auth/google/callback`. Mesmo princípio do `issuer` do OAuth: a configuração é a fonte de verdade, nunca o header `Host`.
- Em `development`, ausentes: as duas rotas redirecionam para o front com `error=unavailable`, sem contatar o Google.
- Deploy: `.github/workflows/deploy.yml` ganha os dois secrets.

### DA-17. Rotas

|                              | `GET /auth/google/start` | `GET /auth/google/callback` |
| ---------------------------- | ------------------------ | --------------------------- |
| `authenticated`              | `false`                  | `false`                     |
| `corsPolicy`                 | padrão                   | padrão                      |
| `allowWithoutPlatformAccess` | não se aplica            | não se aplica               |
| `rateLimitPolicy`            | `peer-ip`, 20 por minuto | `peer-ip`, 20 por minuto    |
| `userRateLimitPolicy`        | não                      | não                         |
| `parameterSource`            | `query`                  | `query`                     |
| `inputSchema`                | não                      | não                         |
| resposta                     | `302`                    | `302`                       |

- São rotas de navegação de topo, nunca chamadas por `fetch`. CORS não participa, e a política padrão fica: não há motivo para abrir `*`. Nenhuma das duas lê o cookie de sessão; elas não autenticam, criam sessão.
- O portão de platform access não se aplica, como em `/auth/sign-in`: uma conta bloqueada entra, e o bloqueio aparece na próxima requisição autenticada, onde o front já mostra o paywall.
- 20 por minuto por IP porque cada início grava uma linha e cada callback faz uma chamada de saída. Mesmo número de `/authorize` e de `/auth/sign-in`.
- `openApiSpec` nas duas: respostas `302`, parâmetros, vocabulário fechado de `status` e `error`, e a observação explícita de que são rotas de navegação e de que o callback é chamado pelo provedor. Tag `Auth`.

### DA-18. MCP: exceção "material de credencial"

Nenhuma das duas rotas tem tool MCP. Elas não operam sobre dados do usuário logado: criam a credencial da sessão do app, e uma IA não tem navegador para seguir um redirect do Google. É a mesma categoria de cadastro, login e recuperação de senha. `has_password` fica fora de `get_me` pela mesma exceção (DA-9). Registrado aqui como o `CLAUDE.md` exige.

### DA-19. Eventos

- **`UserCreatedEvent` é reaproveitado sem mudança.** `billing` não é tocado, e `tests/core/event_handler_registration.test.ts` continua com `user_created: 1`.
- **O vínculo a uma conta existente é fato relevante do domínio** (muda como uma conta pode ser acessada), mas evento só nasce com consumidor. O consumidor recomendado é a notificação de segurança de P-1.
  - Se P-1 for aprovado: evento de identidade vinculada (payload: `user_id` e provedor; nunca email nem `sub`), despachado depois do vínculo persistido, consumido por um handler em `notification`.
  - Se P-1 for recusado: nenhum evento novo nesta entrega.
- Criar conta pelo Google **não** dispara o evento de vínculo: `UserCreatedEvent` já cobre, e não há senha prévia sobre a qual avisar.

### DA-20. Log por allowlist (E7 aplicado)

- **Permitido**: nome do endpoint (`google_sign_in_start`, `google_sign_in_callback`), desfecho (`status` ou código de erro), motivo interno quando for diferente (`binding_mismatch`, `nonce_mismatch`, `token_exchange_failed`, `claims_invalid`, `provider_error`), provedor, chave de rate limit, `user_id` só no sucesso.
- **Proibido**: `code`, `state`, verificador, `nonce`, `id_token`, access token do provedor, `sub`, email, nome, `return_to`, URL completa, corpo de resposta de erro do provedor.

### DA-21. Sessão

O callback cria a sessão pelo mesmo `ISessionManager.createSession` e serializa o cookie pelo mesmo `buildSessionCookie`: mesma sessão, mesmo prazo, mesma revogação, mesmo `SESSION_COOKIE_DOMAIN`. O segredo não vai no corpo nem na URL. Uma sessão já existente no navegador não é revogada quando substituída, como em `/auth/sign-in` hoje (R-10).

## Riscos

- **R-1. Pre-account hijacking (risco aceito pelo usuário).** O cadastro por email e senha não verifica posse do email. Alguém pode cadastrar o email de outra pessoa antes dela; quando a dona verdadeira entrar pelo Google, o vínculo automático liga a identidade àquela conta **e mantém a senha**, e quem a criou continua entrando com ela e vendo tudo, inclusive dados pessoais de hóspedes. O usuário foi avisado exatamente disso e aceitou o risco em troca do vínculo sem atrito (D-U2). A correção estrutural seria verificar posse do email no cadastro por senha, ou descartar a senha no vínculo; a segunda foi recusada, a primeira está fora de escopo. A única mitigação compatível com a decisão é avisar a dona da conta no momento do vínculo (P-1).
- **R-2. Endereço reciclado no provedor.** Em Google Workspace, um endereço pode passar para outra pessoa, com `sub` novo. Se a conta antiga não tiver identidade Google, a nova dona do endereço vincula e entra. Não amplia nada: a recuperação de senha por email já dá esse mesmo poder hoje. Se a conta antiga já tiver identidade, é `account_conflict`.
- **R-3. Email sem normalização (pré-existente).** DA-7 resolve só a busca do vínculo. Cadastro, login e recuperação continuam comparando exato: ainda é possível cadastrar `Maria@...` depois que o Google criou `maria@...`. Recomendação: PR própria. Antes do deploy, rodar a consulta do passo de operação 5.
- **R-4. Fluxo abandonado.** Enquanto um pedido não é consumido (até 10 minutos), quem tiver `state`, `code_challenge` e `nonce` da vítima (visíveis só na URL do navegador dela e no Google) pode se autenticar com a própria conta Google contra o desafio dela e levar o navegador dela ao callback: login CSRF. A janela fecha assim que qualquer callback daquele `state` roda. Aceito: exige ler a URL do navegador da vítima.
- **R-5. Deploy só de ida.** Depois que existir uma conta sem senha, o binário anterior não consegue reconstituí-la (o schema dele exige senha): `/auth/me` responde `500` para essas contas e o login por senha delas quebra. Voltar versão exige um código que tolere senha nula.
- **R-6. `.env.test`.** Variáveis obrigatórias em `test` derrubam o boot da suíte em toda worktree até o `.env.test` da raiz ganhar as duas chaves (passo de operação 3). Worktrees já criadas precisam da mesma edição.
- **R-7. `429` em JSON numa rota de navegação.** Quem estoura o rate limit vê JSON cru no navegador. Aceito, com o precedente de `/authorize`.
- **R-8. Consentimento do MCP vencendo no meio do caminho.** Se a ida ao Google passar de 10 minutos, o pedido de autorização pendente vence. O front já tem a tela de pedido expirado.
- **R-9. Texto do email de recuperação.** Diz "redefinir" para quem nunca teve senha. Aceito.
- **R-10. Sessão substituída sem revogar a anterior.** Mesmo comportamento do login por senha hoje. A sessão órfã expira por inatividade.
- **R-11. Dois fluxos no mesmo navegador.** O segundo início sobrescreve o cookie de vínculo, e o primeiro callback responde `expired`. Aceito.
- **R-12. Dependência do Google para contas sem senha.** Se o Google estiver fora, a saída é a recuperação de senha por email.
- **R-13. Tela de consentimento do Google em modo de teste.** Nesse modo, só usuários de teste cadastrados conseguem entrar. Precisa ser publicada (passo de operação 1).

## Decisão do usuário sobre o ponto pendente

### P-1. Aviso de segurança quando uma identidade Google é vinculada a uma conta existente

**Aprovado pelo usuário em 2026-09-16.** Tasks 10 e 19 fazem parte da entrega.

É a única mitigação de R-1 que não reabre D-U2. No cenário de pre-account hijacking, a dona verdadeira não tem como saber que existe uma senha que ela nunca criou. Um aviso no momento do vínculo ("Sua conta Google foi vinculada à sua conta Sogio. Se você nunca criou uma senha no Sogio, redefina a senha agora") dá a ela o gesto que resolve: a redefinição troca a senha e encerra todas as sessões, inclusive a de quem a criou.

Hoje, na prática, toda conta que recebe vínculo automático tem senha (o único outro caminho de criação é o próprio Google, que já cria com identidade). Por isso o texto pode sempre mencionar a senha.

Custo: o evento de DA-19; um tipo novo em `NOTIFICATION_TYPE_REGISTRY` com `optional: false` (canal email, conteúdo em `pt-BR` e `en-US`, payload sem email nem `sub`, conforme I-N1); um handler em `notification/application/handler/`; o registro no Di; e o contador de `event_handler_registration.test.ts`. Tasks 10 e 19.

O que ele não faz: não impede nada, não bloqueia a senha e não pede confirmação. Só informa.

## Dados pessoais e LGPD

- **Recebido do Google**: `sub`, email, `email_verified`, nome (e, por causa do escopo `profile`, foto e nomes separados, descartados na leitura).
- **Guardado**: `sub` e provedor, em `LinkedIdentity`. Nome e email só viram dados do `User` quando a conta é **criada** pelo Google; num vínculo, nada do perfil Google é gravado.
- **Nunca guardado**: access token, refresh token e ID token do Google, foto, idioma, `email_verified`.
- **Base legal**: execução de contrato (art. 7º, V). É o meio de entrada que a própria pessoa escolheu.
- **Exclusão**: `linked_identities.user_id` referencia `users` com `ON DELETE cascade`, então `PurgeUserDataUseCase` leva a identidade junto sem alteração. Travado por teste (task 16).
- **Pedido de entrada externa**: não tem `user_id` nem dado pessoal. O `return_to` pode carregar um `request_id` de consentimento, que não é dado pessoal. Expurgado pelo timer horário.
- **Log**: allowlist de DA-20.
- **Política de privacidade** (texto no front): passa a citar o Google como provedor de entrada e os dados recebidos.

## Contrato com o front

- **Botão "Entrar com Google"** (login e cadastro): navegação comum para `${API_BASE_URL}/auth/google/start`, com `?return_to=<caminho>` quando a tela tiver o `from`. Nunca `fetch`.
- **Rota nova `/login/google`** (pública, fora do `matcher` do `proxy.ts` e fora de `GUEST_ONLY_PATHS`, porque chega com o cookie de sessão recém gravado):
  - `status=account_created`: o mesmo destino de depois do cadastro (escolha de plano), a menos que o `return_to` seja a tela de consentimento; o front decide.
  - `status=signed_in` ou `status=linked`: `router.replace(returnPath(return_to))`. `linked` pode mostrar "Conta Google vinculada".
  - `error=canceled`: volta ao login sem alarde, preservando o `from`.
  - `error=expired`: "A tentativa expirou. Tente de novo."
  - `error=email_not_verified`: "Não conseguimos confirmar este email pelo Google. Entre com email e senha."
  - `error=account_conflict`: "Já existe uma conta com este email ligada a outra conta Google. Entre com a senha ou recupere a senha."
  - `error=unavailable`: "Não foi possível entrar com o Google agora."
  - Todo `return_to` passa por `returnPath()`.
- **Configurações**: com `has_password: false` em `/auth/me`, "Trocar senha" vira "Definir senha", que leva à recuperação de senha com o email da conta.
- **Login por senha e cadastro**: nenhum contrato novo. Login de conta sem senha dá o erro genérico de sempre (o front pode sugerir o botão do Google), e cadastro com email de conta existente continua `409`.

## Mapped Changes

**Configuração e deploy**

- **`src/core/infra/config/environments.ts`**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e o `refine` de obrigatoriedade fora de `development` (DA-16).
- **`.github/workflows/deploy.yml`**: os dois secrets em `env`, `envs` e no `printf` do `.env`.

**Banco**

- **`src/core/infra/database/drizzle/schemas/auth_schemas.ts`**: `users.password` anulável.
- **`src/core/infra/database/drizzle/schemas/external_identity_schemas.ts`** (novo, no molde de `password_reset_schemas.ts`): `linked_identities` (unicidade em provedor + `subject` e em `user_id` + provedor, `user_id` com `ON DELETE cascade`) e `external_sign_in_requests` (`state_digest` único, índice em `expires_at`). Relations.
- **`src/core/infra/database/drizzle/schema.ts`**: exportar o schema novo.
- **`drizzle/0018_*.sql`** e `drizzle/meta/`: gerados por `bun run db:migration`.

**`auth`, domínio**

- **`src/auth/domain/entity/user.ts`**: senha anulável, fato "tem senha" (DA-9).
- **`src/auth/domain/entity/linked_identity.ts`** (novo), com o vocabulário fechado de provedores.
- **`src/auth/domain/entity/external_sign_in_request.ts`** (novo).
- **`src/auth/domain/repository/linked_identity_repository.ts`** (novo): buscar por provedor + `subject`, saber se uma conta já tem identidade de um provedor, criar.
- **`src/auth/domain/repository/external_sign_in_request_repository.ts`** (novo): criar, reivindicar atomicamente, apagar vencidos.
- **`src/auth/domain/repository/auth_repository.ts`**: busca de contas por email sem distinção de caixa, devolvendo todas (DA-7).
- **`src/auth/domain/service/external_account_resolution_policy.ts`** (novo, puro): DA-3 a DA-6.
- **`src/auth/domain/service/return_destination_policy.ts`** (novo, puro): DA-12.

**`auth`, aplicação**

- **`src/auth/application/service/external_identity_provider.ts`** (novo): a porta (DA-2).
- **`src/auth/application/use_case/start_external_sign_in.ts`** (novo).
- **`src/auth/application/use_case/complete_external_sign_in.ts`** (novo): DA-8, DA-10, DA-11.
- **`src/auth/application/use_case/sign_in.ts`**, **`change_password.ts`**: DA-9.

**`auth`, infra**

- **`src/auth/infra/identity_provider/google_identity_provider.ts`** (novo): DA-14.
- **`src/auth/infra/identity_provider/google_id_token_claims.ts`** (novo, puro): DA-15.
- **`src/auth/infra/database/postgres_repository/auth_postgres_repository.ts`**: mapeamento de senha nula, busca sem caixa.
- **`src/auth/infra/database/postgres_repository/linked_identity_postgres_repository.ts`** (novo), sobre `currentExecutor()` para participar da transação de DA-8.
- **`src/auth/infra/database/postgres_repository/external_sign_in_request_postgres_repository.ts`** (novo).
- **`src/auth/infra/di/auth_di.ts`**: fábricas do provedor, dos repositórios, dos dois casos de uso e dos dois controllers; `TransactionRunner` para o callback.

**`auth`, apresentação**

- **`src/auth/presentation/http/external_sign_in_cookie.ts`** (novo): montar, limpar e ler o cookie de vínculo (DA-10).
- **`src/auth/presentation/controller/auth/start_google_sign_in.controller.ts`** (novo).
- **`src/auth/presentation/controller/auth/complete_google_sign_in.controller.ts`** (novo), com a constante do caminho de resultado do front (DA-13).
- **`src/auth/presentation/controller/auth/get_user.controller.ts`**: `has_password` na resposta e no `openApiSpec`.
- **`src/auth/presentation/controller/auth/change_password.controller.ts`**: `409` no `openApiSpec`.

**`core`**

- **`src/core/infra/http/routes/routes.ts`**: as duas rotas em `authControllers`.
- **`src/index.ts`**: expurgo de pedidos vencidos no timer horário de limpeza.

**`notification` (só com P-1)**

- **`src/auth/domain/event/identity_linked_event.ts`** (novo).
- **`src/notification/domain/notification_type/notification_type_registry.ts`**: tipo novo, `optional: false`.
- **`src/notification/application/handler/notify_on_identity_linked.ts`** (novo).
- **`src/notification/infra/di/notification_di.ts`**: registro do handler.

**Documentação**

- **`CLAUDE.md`** e **`.claude/personas/arquiteto.md`**: ver "Documentação".

**Testes**: ver "Testes esperados".

## Tasks

Tasks 1 a 11 são do Desenvolvedor. Tasks 12 a 19 são de testes e **não** são do Desenvolvedor. Um commit por task, em Conventional Commits, em inglês. Ao fim de cada task, `bun run typecheck` precisa passar, inclusive sobre `tests/` (o `tsconfig` não restringe `include`); ajuste mecânico de tipo num helper de teste entra na própria task.

1. **Configuração do provedor**: variáveis e `refine` (DA-16), `deploy.yml`, e as duas chaves fake no `.env.test` da worktree (gitignored, não commitar).
   - Dependencies: none
2. **Schema e migration**: `users.password` anulável, `linked_identities`, `external_sign_in_requests`, export, `bun run db:migration`.
   - Dependencies: none
3. **Senha opcional**: `User`, mapeamento e busca sem caixa em `AuthPostgresRepository`, `SignInUseCase`, `ChangePasswordUseCase` e `409` no spec, `has_password` em `GET /auth/me` (DA-7, DA-9).
   - Dependencies: task 2
4. **Identidade vinculada**: vocabulário fechado de provedores, entidade, contrato do repositório, repositório Postgres sobre `currentExecutor()` (DA-1, DA-5).
   - Dependencies: task 2
5. **Pedido de entrada externa**: entidade, contrato do repositório (criar, reivindicar, apagar vencidos), repositório Postgres, expurgo no timer horário de `src/index.ts` (DA-10).
   - Dependencies: tasks 2, 4
6. **Policies de domínio**: resolução de conta (DA-3 a DA-6) e destino de retorno (DA-12), puras.
   - Dependencies: task 4
7. **Porta e adaptador do provedor**: porta em `application/service/`, adaptador do Google e validador puro de claims em `infra/identity_provider/` (DA-2, DA-14, DA-15).
   - Dependencies: tasks 1, 4
8. **Início do fluxo**: `StartExternalSignInUseCase`, helper do cookie de vínculo, montagem do redirect para a rota de resultado do front (compartilhada com o callback), controller, Di, rota e `openApiSpec` (DA-11, DA-12, DA-13, DA-17, DA-20).
   - Dependencies: tasks 5, 6, 7
9. **Callback**: `CompleteExternalSignInUseCase` com a ordem de DA-11, transação de DA-8, `UserCreatedEvent` depois do commit, sessão (DA-21), controller, Di, rota e `openApiSpec`.
   - Dependencies: tasks 3, 8
10. **[Só com P-1] Aviso de vínculo**: evento, despacho no caso de uso do callback depois do vínculo persistido, tipo de notificação, handler e registro (DA-19).
    - Dependencies: task 9
11. **Documentação**: `CLAUDE.md` e `.claude/personas/arquiteto.md`.
    - Dependencies: task 9 (e task 10, se P-1 for aprovado)
12. **[Testes] Fixtures**: conta sem senha, identidade vinculada, dublê em memória da porta do provedor.
    - Dependencies: tasks 3, 4, 7
13. **[Testes] Conta sem senha**.
    - Dependencies: tasks 3, 12
14. **[Testes] Policies de domínio**.
    - Dependencies: task 6
15. **[Testes] Validador de claims do Google**.
    - Dependencies: task 7
16. **[Testes] Repositórios, expurgo e LGPD**.
    - Dependencies: tasks 4, 5, 12
17. **[Testes] Caso de uso do callback**.
    - Dependencies: tasks 9, 12
18. **[Testes] Rotas**.
    - Dependencies: tasks 9, 12
19. **[Testes, só com P-1] Aviso de vínculo**.
    - Dependencies: tasks 10, 17
20. **Revisão do Analista de Segurança**: DA-10 a DA-15, cookie de vínculo, log, LGPD.
    - Dependencies: tasks 1 a 19

> Paralelizáveis: **1 e 2** na largada. Depois de 2, **3 e 4**. Depois de 4, **5 e 6**, e também **7** assim que 1 fechar. **14** assim que 6 fechar e **15** assim que 7 fechar, em paralelo com o desenvolvimento. **12** depois de 3, 4 e 7; em seguida **13 e 16**. Depois de 9: **10, 11, 17 e 18** em paralelo.

## Testes esperados

A suíte roda com `bun run test` e nunca fixa variável de ambiente para passar. Os testes de rota leem `GOOGLE_CLIENT_ID` e `apiBaseUrl` da configuração, nunca de literal.

**`tests/auth/passwordless_account.test.ts`** (task 13)

- Login de conta sem senha: `401`, com corpo idêntico ao de email inexistente e ao de senha errada.
- Troca de senha de conta sem senha: `409` com a mensagem fixa; a senha continua nula; nenhuma sessão encerrada.
- Recuperação seguida de redefinição define a primeira senha; login por senha passa a funcionar; `has_password` vira `true`.
- `GET /auth/me`: `has_password: false` para conta sem senha, `true` para a fixture comum.
- Cadastro com o email de uma conta sem senha: `409`.

**`tests/auth/external_account_resolution_policy.test.ts`** (task 14)

- Cada linha da tabela de DA-3.
- `sub` vinculado a A com email apontando para B: entra como A.
- `sub` vinculado com `email_verified` falso: entra mesmo assim.

**`tests/auth/return_destination_policy.test.ts`** (task 14)

- Aceita `/app` e `/connect/authorize?request_id=abc`.
- Recusa `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:alert(1)`, vazio, sem barra inicial, `\` em qualquer posição, `\n` e `\t`, e mais de 512 caracteres.

**`tests/auth/google_id_token_claims.test.ts`** (task 15)

- Token válido gera a identidade atestada.
- Cada recusa: `iss` errado ou ausente, `aud` diferente, lista em `aud` sem o client id, `azp` divergente, `exp` vencido, `iat` no futuro além da folga, `sub` ausente, vazio ou longo demais, email inválido.
- `email_verified` como string `"true"`: identidade com `email_verified: false`, não falha.
- Token malformado (partes a menos, base64url inválido, JSON inválido, tamanho acima do teto): falha, nunca exceção.

**`tests/auth/external_sign_in_request_repository.test.ts`** e **`tests/auth/linked_identity_repository.test.ts`** (task 16)

- Reivindicação devolve o pedido uma vez; a segunda devolve nada; pedido vencido não é reivindicável.
- A linha gravada não contém o `state` em claro.
- Expurgo apaga só os vencidos.
- Unicidade em provedor + `subject` e em conta + provedor.
- Purge de usuário remove as identidades vinculadas (LGPD).

**`tests/auth/complete_external_sign_in.test.ts`** (task 17), dublê da porta e Postgres real

- `sub` vinculado: `signed_in`, sessão criada para o dono, email ignorado.
- `sub` vinculado a A com email de B: entra como A; B intocada e sem identidade.
- Email verificado de conta com senha: `linked`; identidade criada; hash de senha inalterado; login por senha continua funcionando.
- Email sem conta: `account_created`; conta sem senha; nome do token (e a parte local do email quando o nome falta; truncado em 100); identidade criada; **assinatura Free existe** (`UserCreatedEvent`).
- `email_verified` falso: `email_not_verified`; nada criado.
- Conta com outra identidade Google: `account_conflict`.
- Duas contas que diferem só na caixa do email: `account_conflict`. Uma única com caixa diferente: `linked`.
- `state` desconhecido, vencido ou já usado: `expired`.
- Verificador errado: `expired`, e o pedido fica consumido (uma segunda tentativa com o verificador certo também falha).
- Provedor com `access_denied`: `canceled`; outro erro: `unavailable`; falha na troca: `unavailable`; `nonce` divergente: `unavailable`.
- Atomicidade: se a gravação da identidade falhar na criação, nenhuma conta sobra.
- Todo desfecho depois da reivindicação devolve o `return_to` do pedido.

**`tests/auth/google_sign_in_routes.test.ts`** (task 18)

- **Início, pelas rotas reais**: `302` para o endpoint de autorização do Google com `client_id`, `redirect_uri` igual a `apiBaseUrl` + caminho do callback, `response_type=code`, `scope=openid email profile`, `code_challenge_method=S256`, `prompt=select_account`, `state` e `nonce`; `code_challenge` igual ao S256 do valor do cookie; cookie de vínculo com `HttpOnly`, `SameSite=Lax`, `Path=/` e `Max-Age`; linha gravada com o digest do `state`; `Cache-Control: no-store` e `Referrer-Policy: no-referrer`.
- `return_to` válido é gravado; `//evil.com` é descartado e o fluxo segue para o Google.
- **Callback, pelas rotas reais, sem Google**: sem `state`; `state` desconhecido; cookie errado; `state` duplicado; `error=access_denied` com cookie certo (vira `canceled`, devolve `return_to` e limpa o cookie de vínculo). Em todos: `Location` começa com `FRONT_BASE_URL` + caminho de resultado, nunca JSON, nunca cookie de sessão.
- **Callback de sucesso**: controller montado com o dublê da porta e passado por `BunHttpControllerAdapter`. `302` com `status` certo e cookie de sessão que autentica `GET /auth/me`.
- Nenhum `Location` aponta diretamente para o `return_to`.

**`tests/notification/identity_linked_notification.test.ts`** (task 19, só com P-1)

- Vínculo gera notificação pendente do tipo novo, com payload sem email nem `sub`.
- Criação de conta pelo Google não gera.
- `PUT /notifications/preferences` recusa desligar o tipo (`422`).
- `tests/core/event_handler_registration.test.ts` ganha o evento novo com contagem 1.

## Documentação

**`CLAUDE.md`**

1. Seção nova **"Entrada com Google"**, logo depois de "Sessão do App": o fluxo; vínculo por `sub` e o que acontece quando o email diverge; vínculo automático mantendo a senha como risco aceito, com a justificativa de R-1; conta sem senha e primeira senha pela recuperação; estado transitório em tabela mais cookie de vínculo; destino de retorno e rota de resultado; vocabulário de `status` e `error`; ID token sem verificação de assinatura e a premissa de IA-7; `linked_identities` com `ON DELETE cascade` no purge.
2. **"Sessão do App"**: a sessão nasce de três caminhos (login, cadastro, callback do Google) e é a mesma nos três; o cookie de vínculo não é sessão e nunca autentica nada.
3. **"Variáveis de Ambiente"**: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`, obrigatórias fora de `development`, e a redirect URI derivada de `API_BASE_URL`.
4. **Pré-requisito do `.env.test`**: as duas variáveis, com valores fake em `test`, porque o adaptador do Google nunca é exercido nos testes.
5. **"Superfície MCP obrigatória"**, lista de exceções: "material de credencial (cadastro, login, entrada com Google, troca e recuperação de senha)".
6. Se P-1 for aprovado, em **"Bounded Context `notification`"**: o evento de vínculo passa a ser um dos eventos ligados.

**`.claude/personas/arquiteto.md`**

1. Na tabela de contextos, `Auth` passa a citar identidades vinculadas.
2. Agregados `LinkedIdentity` e `ExternalSignInRequest`.
3. Invariantes IA-1 a IA-8.
4. Bloco "Vocabulário de Entrada Externa" com a Linguagem Ubíqua deste plano.
5. Se P-1 for aprovado, linha nova na tabela de eventos.

## Passos de operação

1. **Google Cloud, tela de consentimento**: tipo externo, nome Sogio, email de suporte, domínio autorizado `sogio.app`, link da política de privacidade, escopos `openid`, `email` e `profile` (não sensíveis). **Publicar** (sair do modo de teste), ou só usuários de teste entram (R-13).
2. **Google Cloud, credencial** do tipo "Aplicativo da Web", com as redirect URIs autorizadas `${API_BASE_URL}/auth/google/callback` de produção, de sandbox e `http://localhost:<PORT>/auth/google/callback`. Nenhuma origem JavaScript: o front nunca fala com o Google.
3. **`.env.test` da raiz**, antes de qualquer worktree rodar a suíte (R-6), e o mesmo nas worktrees já existentes:

   ```
   GOOGLE_CLIENT_ID=fake-google-client-id
   GOOGLE_CLIENT_SECRET=fake-google-client-secret
   ```

4. **GitHub**: secrets `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no ambiente `production`.
5. **Antes do deploy**, conferir contas cujo email difere só na caixa. Se houver, essas contas recebem `account_conflict` na entrada com Google até alguém decidir manualmente:

   ```
   SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
   ```

6. **Migration antes do binário novo**. O deploy é só de ida a partir da primeira conta sem senha (R-5).
7. A API pode ir para produção antes do front: sem o botão, as rotas ficam sem uso.

## Fora de escopo

- Vincular manualmente, pela tela de configurações, uma conta Google de email diferente.
- Desvincular a conta Google.
- Outros provedores (Apple, Microsoft).
- One Tap ou qualquer ID token recebido pelo navegador (IA-7).
- Normalização geral de email (R-3) e verificação de posse de email no cadastro por senha (a correção estrutural de R-1).
- Tela de métodos de entrada ou aparelhos conectados.

## Revisão de Segurança (2026-09-16)

1. **Crítico, corrigido.** `email_verified` só vale quando o Google é autoridade sobre o email (`@gmail.com` ou `hd` presente). Fora disso, um endereço que mudou de dono permitiria vincular o Google de quem teve a caixa no passado à conta do dono atual, e redefinir a senha não removeria o vínculo. Aprovado pelo usuário, com a consequência aceita de que conta Google com email de outro provedor entra por email e senha.
2. **Moderado, corrigido.** `GET /auth/google/start` passou a declarar `parameterSource: "query"`, descartar `return_to` duplicado e transformar exceção inesperada em `302` com `error=unavailable`, sem logar mensagem de erro.
3. **Informativo, corrigido.** Exceções depois da reivindicação no callback carregam `reason: "unexpected_error"`, e o log registra só o nome do erro e o código do Postgres.
4. **Informativo, aceito.** O aviso de vínculo não roda na mesma transação do vínculo: segue o idioma dos demais handlers de `notification`, que capturam e logam a falha. Uma falha ao enfileirar o aviso não desfaz o vínculo.
5. **Informativo, corrigido.** A troca de código usa `redirect: "error"`, e a premissa de TLS verificado (sem `NODE_TLS_REJECT_UNAUTHORIZED`) foi registrada em IA-7.
6. **Informativo, corrigido.** A serialização do cookie de vínculo recebe o ambiente como parâmetro, e os dois ramos (`__Host-` com `Secure`, e local) são testados.
7. **Informativo, aceito.** Rate limit por IP completo, sem agregação por prefixo IPv6, no mesmo padrão já aceito em `/authorize`.
