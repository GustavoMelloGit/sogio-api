# Teto de corpo e de aninhamento de requisição

## Objective

Fechar os dois buracos CRÍTICOS da issue #63 (itens 1 e 2): hoje toda rota que
não é `bodyMode: "stream"` lê o corpo inteiro para a memória com
`request.text()` antes de o Zod ver o primeiro campo, e todo corpo JSON é
entregue ao `JSON.parse` sem teto de profundidade. Numa VPS pequena, os dois
são derrubada do processo com uma requisição só — o primeiro por memória, o
segundo por estouro de pilha. Esta entrega dá a **toda superfície de entrada**
(HTTP e `/mcp`) um teto de bytes aplicado **enquanto** o corpo é lido, e um teto
de profundidade aplicado **antes** de o texto virar árvore. Os outros sete itens
do levantamento (`.claude/plans/2026-08-23-travas-de-entrada-da-api.md`) ficam
fora desta entrega.

## Personas

- **Arquiteto** (`arquiteto.md`) — dono das decisões deste documento: onde os
  tetos moram, quais são os valores, qual camada responde `413`, e se `/mcp`
  entra
- **Desenvolvedor** (`desenvolvedor.md`) — implementação das tasks
- **Analista de Segurança** (`analista_seguranca.md`) — dono do checklist que
  originou a issue #63; revisa se os dois itens foram de fato fechados
- **Revisor** (`revisor.md`) — revisão de camada e de aderência às invariantes

## Decisões de arquitetura

As sete perguntas que o Orquestrador levantou, respondidas contra o código real.
Nenhuma delas é decisão do Desenvolvedor.

### D1 — São **dois** tetos de tamanho, com donos diferentes, e nenhum é redundante

O adaptador não é o primeiro a tocar o corpo: quem aceita a conexão e alimenta
`request.body` é o `Bun.serve()`. Tudo que o runtime bufferizar **antes** de
chamar o handler está fora do alcance de qualquer código nosso — e o default do
Bun é `maxRequestBodySize: 128 MB`. Um teto só no adaptador, portanto, não
consegue honrar o critério "sem materializar o payload" em toda a sua extensão.
Daí a divisão:

| Teto                      | Onde é aplicado                                | Valor    | Cobre                                                                |
| ------------------------- | ---------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `MAX_REQUEST_BODY_BYTES`  | `Bun.serve({ maxRequestBodySize })`            | **8 MB** | Todo o processo: rotas comuns, rotas de importação, `/mcp`, `/docs`  |
| `MAX_BUFFERED_BODY_BYTES` | `ControllerRequestParser` + boundary do `/mcp` | **1 MB** | Todo corpo que precisa virar string/objeto (tudo que não é `stream`) |

**Por que 8 MB no socket.** É o **piso do processo**, e ele é dimensionado pelo
maior corpo que alguma rota legitimamente aceita: `MAX_IMPORT_BYTES = 5 MB`.
Precisa ficar **estritamente acima** desse valor — se ficar igual ou abaixo, um
CSV de 5 MB + 1 byte passa a ser cortado pelo Bun com um `413` seco em vez de
receber o relatório `422` do `readCsvRecordStream`, que é a resposta que a
importação promete ao usuário. 8 MB dá essa folga sem ser generoso: acima disso
não existe caso de uso.

**Por que 1 MB fora do stream.** O maior corpo legítimo de uma rota não-stream
hoje é `POST /property` / `PUT /property/:id`: `images` é
`z.array(z.string().max(2048)).max(MAX_PROPERTY_IMAGES /* 50 */)` — 50 × 2048 ≈
102 KB, mais endereço e nome, ~105 KB no pior caso teórico. Foi a única entrada
com array encontrada na varredura (`grep z.array(` em `src`, descartando
`outputSchema`). 1 MB é ~10x isso. O segundo candidato a corpo gordo é o webhook
do gateway (`POST /billing/webhooks/stripe`, que lê `request.rawBody`): eventos
do Stripe são da ordem de poucos KB e as listas embutidas no evento são
truncadas pelo próprio Stripe, então 1 MB também é ~100x o caso típico ali.

**Constante em código, não variável de ambiente.** O precedente do projeto é
claro: `MAX_IMPORT_BYTES`, `MAX_IMPORT_ROWS`, `MAX_REPORTED_ERRORS` e as
`RateLimitPolicy` são todos constantes; `environments.ts` guarda o que varia por
deploy (URLs, intervalos, TTLs, segredos). Um teto de corpo não varia por
deploy — varia por schema, que é código. Uma env var aqui só criaria uma alavanca
para alguém "resolver" um `413` em produção afrouxando o teto em vez de olhar o
schema.

### D2 — `Content-Length` é atalho, nunca garantia: o teto é contado enquanto se lê

O header é controlado pelo cliente e é **opcional**: em HTTP/1.1 com
`Transfer-Encoding: chunked` ele simplesmente não existe, e nada impede um
cliente de declarar `Content-Length: 10` e mandar 500 MB. Então:

1. **Atalho** — se `Content-Length` existe e já declara mais que o teto, rejeita
   de cara, sem tocar no stream. É otimização (economiza a leitura), nunca a
   trava.
2. **Trava** — o corpo é lido em chunks de `request.body`, com o total de bytes
   somado a cada chunk. No primeiro chunk que cruza o teto, o leitor cancela o
   reader e lança. `request.text()` deixa de ser chamado em qualquer caminho do
   adaptador.

Isso **não** transforma rota comum em memória constante, e o plano não deve
alegar que transforma. `IM-1` (pico constante) é uma propriedade de quem lê por
stream, e continua sendo exclusiva das três rotas de importação — um corpo JSON
precisa estar inteiro em memória para o `JSON.parse` existir. O que muda é que o
pico deixa de ser **ilimitado** e passa a ser **limitado** por
`MAX_BUFFERED_BODY_BYTES`: de "o cliente escolhe quanta RAM gastar" para "o
servidor escolhe". Quem precisar de mais que isso declara `bodyMode: "stream"`,
que é o mecanismo que já existe para essa necessidade e não muda em nada.

### D3 — `413` é erro tipado no mapeamento existente, não resposta ad-hoc do adaptador

Nasce `PayloadTooLargeError` em `src/core/application/error/`, ao lado de
`ValidationError` e família, e entra no `errorCodeMap` do adaptador como `413`.

Motivo de camada: o adaptador **já lança erro tipado da mesma família** para
problema de transporte — `ValidationError` para chave duplicada em
`#collectUnique` e para falha do `inputSchema`. E, mais importante, o `catch` do
adaptador é onde moram logging, `errorCodeMap`, headers de CORS e o `no-store`
das rotas de protocolo. Uma `Response` construída à mão dentro do parser teria
que reimplementar as quatro coisas ou sair pela porta errada sem CORS — foi
exatamente o bug B6 que a correção pós-revisão M5 fechou. Lançar é o caminho que
herda tudo isso de graça.

Consequências que precisam ser respeitadas:

- **Não** entra em `domainErrorNames` do `mcp_error_mapper`: no `/mcp` o teto
  dispara no boundary do transporte, antes de qualquer tool handler existir, e
  quem responde é a própria função de rota (mesmo molde de `forbiddenResponse`).
  Se algum dia um handler lançar esse erro, o mapper devolve "Internal server
  error", que é seguro.
- A mensagem devolvida é fixa e derivada da constante ("Request body exceeds the
  maximum size of N bytes"). Não ecoa nada do corpo — a mesma preocupação que fez
  `#parseBody` engolir o `SyntaxError` do `JSON.parse` em vez de logá-lo.

### D4 — `/mcp` entra nesta entrega, e a exclusão seria dívida, não escopo

`/mcp` não passa pelo `BunHttpControllerAdapter`: `makeMcpRequestHandler`
entrega o `Request` direto ao `WebStandardStreamableHTTPServerTransport`, que
lê e parseia o corpo sozinho. Duas observações mudam o peso disso:

- **Tamanho, para chamador anônimo, já é fechado pelo teto de socket (D1).** O
  gate de identidade (`resolveRequester`) roda **antes** de o corpo ser tocado,
  então um POST gigante sem token nunca chega a ser parseado.
- **Profundidade, para chamador autenticado, não é fechada por nada.** E
  "autenticado" não é fronteira de confiança contra queda de processo: o
  processo é único e multi-tenant, então um token válido derrubando a pilha
  derruba todos os usuários, não só o dono do token.

O `CLAUDE.md` é explícito: "o MCP não é uma superfície secundária, é a mesma
ação do usuário por outro transporte". Uma trava que existe só no HTTP é uma
trava contornável pedindo a mesma coisa por outro transporte — é o argumento que
o próprio projeto usou para exigir `requiredCapability` nas duas vias da
importação. Então: o mesmo leitor com teto e a mesma guarda de profundidade são
aplicados em `handleMcpRequest`, antes de `transport.handleRequest`, e o
transporte recebe um `Request` reconstruído a partir do texto já lido e já
validado. `GET`/`DELETE /mcp` não têm corpo e passam intocados.

**Consequência aceita e documentada:** o máximo _teórico_ de um lote de
importação por tool MCP (`MAX_MCP_IMPORT_RECORDS = 100` registros × 50 imagens ×
2048 caracteres ≈ 10 MB) passa a estourar 1 MB. O máximo _realista_ (100
imóveis × ~10 URLs de ~100 caracteres ≈ 150 KB) fica com ~7x de folga. Quem
precisar de volume acima disso tem a rota CSV, que é a via desenhada para
volume; a mensagem do `413` no `/mcp` deve dizer isso.

### D5 — Profundidade se mede varrendo o texto, e o teto é 32

O critério "recusado **antes** do parse" é literalmente satisfeito: nesse ponto
o corpo é uma `string`, e profundidade de JSON é uma propriedade **léxica** — dá
para contar sem construir árvore nenhuma. Uma varredura linear, um caractere por
vez, mantendo dois estados (dentro/fora de string literal, escape pendente),
incrementando em `{`/`[` e decrementando em `}`/`]`, com saída antecipada no
primeiro momento em que o contador cruza o teto. Sem alocação, sem recursão,
O(n) sobre um texto que o D1 já limitou a 1 MB.

O estado "dentro de string" não é detalhe: sem ele, `{"a":"[[[[[[["}` contaria
como profundidade 8 e um nome de imóvel com colchetes viraria `422`.

**Teto = 32.** Medido contra o que existe:

| Payload                                                                                 | Profundidade |
| --------------------------------------------------------------------------------------- | ------------ |
| Qualquer `inputSchema` da API hoje (`address` aninhado em `create_property`)            | 3            |
| Envelope JSON-RPC de uma tool MCP de importação (`params.arguments.records[].images[]`) | 6            |
| Evento do gateway (`data.object.items.data[].price.metadata`)                           | ~8           |

32 é ~4x o pior caso conhecido e ordens de magnitude abaixo do limite de pilha.
Não é um número para ser afrouxado quando alguém bater nele: bater em 32
significa que apareceu um payload que nenhuma parte do domínio modela.

**Estouro de profundidade responde `422`, não `413`.** Não é um problema de
tamanho — cabe em 20 KB. É um corpo que a API recusa a interpretar, que é
exatamente o significado de `ValidationError` no projeto. A mensagem é fixa e
não cita nada do corpo.

Aplicada **só no ramo JSON** de `#parseBody`, depois do desvio de
`x-www-form-urlencoded` (`parameterSource: "form"`, o `/token` do OAuth): corpo
de formulário não vira árvore.

### D6 — As rotas `bodyMode: "stream"` seguem literalmente intocadas

Confirmado no código: `ControllerRequestParser.parse()` desvia para o ramo
`stream` na **primeira linha**, devolve `bodyStream` cru e nunca chega em
`#readRawBody()` nem em `#parseBody()`. Os tetos novos moram exatamente nesses
dois métodos, então nenhuma linha do caminho de importação muda de
comportamento. Não há duplicação nem contradição de tetos:

| Teto                      | Quem aplica                           | Escopo                           |
| ------------------------- | ------------------------------------- | -------------------------------- |
| `MAX_IMPORT_BYTES` (5 MB) | `readCsvRecordStream`, contando bytes | Só as 3 rotas de importação      |
| `MAX_IMPORT_FIELD_BYTES`  | `readCsvRecordStream`                 | Campo do CSV                     |
| `MAX_IMPORT_ROWS`         | `ImportRunner`                        | Linhas do lote                   |
| `MAX_BUFFERED_BODY_BYTES` | `ControllerRequestParser` + `/mcp`    | Só o que **não** é stream        |
| `MAX_REQUEST_BODY_BYTES`  | `Bun.serve`                           | Processo inteiro, acima de todos |

A única relação entre eles que precisa ser mantida é
`MAX_REQUEST_BODY_BYTES > MAX_IMPORT_BYTES` (D1) — e ela é travada por teste,
não por comentário.

### D7 — Como se testa "sem materializar" sem alocar 500 MB

A prova não é "mandei 500 MB e sobrevivi"; é **"o servidor parou de puxar o
corpo"**. O `fetch` aceita um `ReadableStream` como body: o teste monta um
gerador que se declara enorme mas conta quantos chunks foram efetivamente
puxados, e afirma duas coisas — a resposta foi `413` **e** o número de chunks
puxados ficou na ordem do teto, não na ordem do corpo anunciado. A memória do
teste nunca passa de alguns MB. (Se o `duplex: "half"` do `fetch` do Bun não
cooperar, o plano B é escrever `Transfer-Encoding: chunked` num socket cru — que
tem o bônus de provar o caso "sem `Content-Length`" de D2.)

O resto se testa direto, e o molde já existe em
`tests/core/stream_body_adapter.test.ts` (controller descartável + `Bun.serve`
em porta 0):

- corpo acima do teto → `413`, e o `handle()` do controller **nunca rodou** (a
  única afirmação que separa "recusou" de "processou e reclamou");
- `Content-Length` mentindo para baixo não ajuda o atacante (o contador pega);
- aninhamento acima de 32 → `422`, controller não rodou, processo vivo;
- unitário do scanner: colchete dentro de string literal não conta, aspas
  escapadas não confundem o estado;
- `bodyMode: "stream"` acima de 1 MB continua `200` — o teste que já existe
  manda 2.000.011 bytes por uma rota stream e vira, com isso, o guarda de
  regressão do "intocadas" (ganha uma afirmação explícita disso);
- relação entre constantes (`MAX_REQUEST_BODY_BYTES > MAX_IMPORT_BYTES`);
- wiring do teto de socket: `bunServeOptions.maxRequestBodySize` é a constante,
  mais um servidor de brinquedo com teto minúsculo provando que o Bun de fato
  responde `413` (documenta o comportamento do runtime em 10 linhas em vez de
  em um comentário).

### D8 — Invariantes que nascem daqui

Para `.claude/personas/arquiteto.md`, na família das existentes:

- **IE-1 — Nenhum corpo de requisição é materializado sem teto.** Toda
  superfície de entrada (adaptador HTTP e `/mcp`) limita bytes **enquanto lê**,
  nunca confiando em `Content-Length`, e o processo tem um teto de socket acima
  de todos os tetos de rota. Pico ilimitado de memória por requisição é o vetor
  de DoS mais barato contra uma VPS pequena; `bodyMode: "stream"` é a única
  saída para quem precisa aceitar mais, e ela troca "corpo maior" por "leitura
  incremental", nunca por "sem teto".
- **IE-2 — Nenhum texto vira árvore sem teto de profundidade.** Todo corpo JSON
  passa por uma varredura léxica antes do `JSON.parse`, nas duas superfícies.
  Aninhamento profundo cabe em poucos KB, então IE-1 não cobre isto; e o estouro
  de pilha derruba o processo inteiro, não a requisição.

## Mapped Changes

**Nascem:**

- **`src/core/application/error/payload_too_large_error.ts`** — `PayloadTooLargeError`,
  mesma forma dos irmãos (D3)
- **`src/core/infra/http/body/body_limits.ts`** — `MAX_REQUEST_BODY_BYTES`,
  `MAX_BUFFERED_BODY_BYTES`, `MAX_JSON_DEPTH` (D1, D5). Fica em `infra/http/`
  pelo mesmo motivo que `MAX_IMPORT_BYTES` fica em `infra/http/csv/`: é teto de
  transporte, não regra de negócio
- **`src/core/infra/http/body/bounded_body_reader.ts`** — lê
  `ReadableStream<Uint8Array>` contando bytes, cancela e lança
  `PayloadTooLargeError` ao cruzar o teto, decodifica incrementalmente (D2).
  Recebe o teto como argumento; não conhece rota nem controller
- **`src/core/infra/http/body/json_depth_guard.ts`** — varredura léxica de
  profundidade, com estado de string literal e escape (D5). Função pura
- **`tests/core/request_body_limits.test.ts`** — testes do adaptador (D7)
- **`tests/core/bounded_body_reader.test.ts`** — unitários do leitor e do
  scanner de profundidade (D7)

**Mudam:**

- **`src/core/infra/http/adapters/http_controller_adapter.ts`** —
  `#readRawBody()` passa a usar o leitor com teto em vez de `request.text()`;
  `#parseBody()` chama a guarda de profundidade antes do `JSON.parse`, só no
  ramo JSON; `errorCodeMap` ganha `PayloadTooLargeError → 413`
- **`src/core/infra/mcp/routes.ts`** — em `handleMcpRequest`, para requisição
  com corpo: leitura com teto + guarda de profundidade antes de
  `transport.handleRequest`, com `Request` reconstruído; resposta `413` no molde
  de `forbiddenResponse`, com CORS público e `no-store` (D4)
- **`src/core/infra/http/routes/routes.ts`** — exporta `bunServeOptions`
  (`routes` + `maxRequestBodySize`) além de `bunRoutes`, para que produção e
  suíte não possam divergir (D1)
- **`src/index.ts`** — passa a montar o `Bun.serve` a partir de
  `bunServeOptions`
- **`tests/setup.ts`** — idem, para que a suíte rode sob o mesmo teto de socket
  que produção
- **`src/core/infra/http/swagger/open_api_builder.ts`** — injeta a resposta
  `413` em toda operação que declara `requestBody`, num ponto só. As respostas
  hoje são declaradas controller a controller; documentar rota a rota seriam 40+
  edições que divergem na primeira rota nova
- **`tests/core/stream_body_adapter.test.ts`** — ganha a afirmação explícita de
  que o corpo de 2 MB numa rota `stream` continua passando **acima** de
  `MAX_BUFFERED_BODY_BYTES` (D6)
- **`tests/core/mcp_routes.test.ts`** — corpo acima do teto e corpo aninhado
  demais em `/mcp`
- **`.claude/personas/arquiteto.md`** — IE-1 e IE-2 (D8)
- **`CLAUDE.md`** — parágrafo curto sobre os dois tetos, ao lado do que já
  descreve `bodyMode: "stream"` e os tetos de importação

## Tasks

1. **Constantes e erro tipado** — criar `body_limits.ts` com as três constantes
   e `PayloadTooLargeError`; registrar `PayloadTooLargeError → 413` no
   `errorCodeMap`. Nada mais consome ainda
   - Dependencies: none
2. **Leitor de corpo com teto** — `bounded_body_reader.ts`: atalho de
   `Content-Length`, contagem por chunk, cancelamento do reader, decodificação
   incremental, `PayloadTooLargeError` ao cruzar
   - Dependencies: task 1
3. **Guarda de profundidade** — `json_depth_guard.ts`: varredura léxica com
   estado de string/escape e saída antecipada
   - Dependencies: task 1
4. **Ligar os dois no adaptador HTTP** — `#readRawBody()` usa o leitor;
   `#parseBody()` chama a guarda antes do `JSON.parse`, só no ramo JSON; o ramo
   `bodyMode: "stream"` fica intocado
   - Dependencies: tasks 2, 3
5. **Teto de socket** — exportar `bunServeOptions` de `routes.ts` e consumir em
   `src/index.ts` e `tests/setup.ts`
   - Dependencies: task 1
6. **Trava em `/mcp`** — leitura com teto + guarda de profundidade antes do
   transporte, `Request` reconstruído, resposta `413` com CORS público e
   `no-store`
   - Dependencies: tasks 2, 3
7. **Documentar o `413` no OpenAPI** — injeção da resposta compartilhada no
   `OpenApiBuilder` para toda operação com `requestBody`
   - Dependencies: task 1
8. **Unitários do leitor e do scanner** — teto atingido/não atingido,
   `Content-Length` mentiroso, corpo ausente, colchete dentro de string,
   aspas escapadas, profundidade no limite e um acima
   - Dependencies: tasks 2, 3
9. **Testes do adaptador HTTP** — `413` sem o controller rodar, prova de "parou
   de puxar" via body em stream, `422` de profundidade, e a afirmação nova em
   `stream_body_adapter.test.ts` de que rota `stream` acima de 1 MB segue `200`
   - Dependencies: task 4
10. **Testes do teto de socket e da relação entre constantes** — wiring de
    `bunServeOptions.maxRequestBodySize`, servidor de brinquedo provando o `413`
    do Bun, e `MAX_REQUEST_BODY_BYTES > MAX_IMPORT_BYTES`
    - Dependencies: task 5
11. **Testes de `/mcp`** — corpo acima do teto → `413`; aninhamento acima de 32
    recusado antes do transporte; chamada normal segue funcionando
    - Dependencies: task 6
12. **Documentação** — IE-1 e IE-2 em `arquiteto.md`; parágrafo dos dois tetos
    em `CLAUDE.md`
    - Dependencies: tasks 4, 5, 6

> Tasks 2 e 3 rodam em paralelo depois da 1. Depois delas, 4 e 6 rodam em
> paralelo, e 5 e 7 já podiam ter rodado em paralelo com 2 e 3. Os testes (8, 9,
> 10, 11) seguem cada um a sua task de implementação. A 12 fecha.
