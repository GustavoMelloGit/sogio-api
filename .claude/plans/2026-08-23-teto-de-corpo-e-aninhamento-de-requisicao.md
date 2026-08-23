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

### D1 — São **dois** números, e o que cada um significa é _reter_ versus _ler_

**Revisado após medição em runtime — ver D1-bis.** A versão anterior chamava o
`maxRequestBodySize` do `Bun.serve` de "piso do processo". Ele não é: o Bun só o
aplica quando há `Content-Length`. Sob `Transfer-Encoding: chunked` ele é
ignorado por completo (medido: 2 MB passaram inteiros por um teto de 256 KB).
Um teto que só vale para quem declara o próprio tamanho vale exatamente para o
chamador honesto — quem não quer ser limitado omite o header.

A correção não é achar outro lugar para o teto do processo. É parar de tratá-lo
como coisa do runtime e assumi-lo no leitor, que é o único ponto por onde todo
byte de todo corpo passa. Daí a divisão, que deixou de ser "quem aplica" e
passou a ser **o que o número limita**:

| Número                    | Limita                                                       | Valor    | Quem aplica                                                                                       |
| ------------------------- | ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `MAX_BUFFERED_BODY_BYTES` | Quanto é **retido** de um corpo não-stream                   | **1 MB** | O leitor com teto, contando                                                                       |
| `MAX_REQUEST_BODY_BYTES`  | Quanto é **lido** de um corpo qualquer, retido ou descartado | **8 MB** | O leitor com teto, contando; o `Bun.serve` só antecipa o corte para quem declara `Content-Length` |

**Por que 8 MB de orçamento de leitura.** É o dimensionamento do maior corpo que
uma rota legitimamente aceita (`MAX_IMPORT_BYTES = 5 MB`) mais folga, e precisa
ficar **estritamente acima** desse valor — se ficar igual ou abaixo, um CSV de
5 MB + 1 byte passa a ser cortado antes de receber o relatório `422` do
`readCsvRecordStream`, que é a resposta que a importação promete ao usuário.
8 MB também é o que dá ao maior lote plausível de importação por tool MCP
(~100 registros gordos) o direito de ser recusado **sem** perder a conexão
(D2-bis): abaixo disso, um cliente MCP que manda um lote grande demais vê a
chamada seguinte pendurar, que é o pior sintoma possível nessa superfície.

### D1-bis — `maxRequestBodySize` do Bun não é trava, é atalho

Medido, mesmo `Bun.serve`, `maxRequestBodySize: 262144`, corpo de 2 MB:

| Transporte                   | Resultado                                            |
| ---------------------------- | ---------------------------------------------------- |
| `Content-Length: 2 MB`       | `413` antes do handler rodar, 0 bytes vistos         |
| `Transfer-Encoding: chunked` | **sem corte** — handler rodou e leu os 2 MB inteiros |

É a mesma ironia de D2, uma camada abaixo: o cliente escolhe qual caminho o
servidor toma pela presença de um header opcional. Por isso o `maxRequestBodySize`
continua configurado — corta o caso honesto cedo, de graça, sem nem acordar o
handler — mas **não pode ser citado como garantia em lugar nenhum**. Quem
garante é a contagem no leitor. Registrado aqui porque alguém vai reencontrar
essa limitação do Bun e precisa achar a resposta antes de "consertar" o teto.

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

### D2 — O teto é contado enquanto se lê, e o corpo recusado é drenado até o fim

**Revisado após medição em runtime — ver D2-bis para o que caiu e por quê.**

`Content-Length` **não é consultado em lugar nenhum**. É header opcional (não
existe sob `Transfer-Encoding: chunked`) e escolhido pelo cliente: usá-lo para
decidir qualquer coisa deixaria o chamador escolher qual caminho o servidor
toma, e as duas pontas desse `if` precisam terminar no mesmo lugar de qualquer
forma (D2-bis). Um caminho só, mesmo comportamento para chamador honesto e
para chamador hostil.

A trava é contagem de bytes chunk a chunk sobre `request.body`, em duas fases:

1. **Retenção** — enquanto o total acumulado couber no teto, o chunk é
   retido/decodificado normalmente.
2. **Dreno** — cruzado o teto, o leitor para de reter e passa a **ler e
   descartar** cada chunk seguinte, até o fim do stream. Só então lança
   `PayloadTooLargeError`.

É deliberadamente a mesma forma do `ImportRunner` ("modo escrita → modo
coleta"): segue até o fim do stream para deixar o transporte limpo e falhar uma
vez só, no fim, em vez de abandonar a operação no meio. `request.text()` deixa
de ser chamado em qualquer caminho do adaptador.

Isso **não** transforma rota comum em memória constante, e o plano não deve
alegar que transforma. `IM-1` (pico constante) é uma propriedade de quem lê por
stream, e continua sendo exclusiva das três rotas de importação — um corpo JSON
precisa estar inteiro em memória para o `JSON.parse` existir. O que muda é que o
pico deixa de ser **ilimitado** e passa a ser **limitado** por
`MAX_BUFFERED_BODY_BYTES`: de "o cliente escolhe quanta RAM gastar" para "o
servidor escolhe". Nada acima do teto é retido, decodificado ou entregue ao
`JSON.parse` — o dreno descarta chunk a chunk, com pico de um chunk.

### D2-bis — Por que o corpo recusado precisa ser lido inteiro

Medido em `Bun.serve` cru, fora do projeto: **responder sem consumir o corpo
dessincroniza a conexão**. Com um corpo de 2 MB rejeitado com `413` e um segundo
request logo em seguida na mesma conexão keep-alive:

| Descarte do corpo          | 413 | 2º request          |
| -------------------------- | --- | ------------------- |
| não toca no corpo          | sim | **pendurou (>4 s)** |
| `await req.body.cancel()`  | sim | **pendurou (>4 s)** |
| read parcial + `cancel()`  | sim | **pendurou (>4 s)** |
| `Connection: close` no 413 | sim | **não resolve**     |
| dreno completo             | sim | 200 em 0 ms         |
| dreno-e-descarte           | sim | 200 em 0 ms         |

`cancel()` não devolve a conexão a um estado utilizável, e o Bun não honra o
`Connection: close` que a RFC 9112 §6.3 prescreve justamente para o servidor que
não vai ler o corpo todo. Sobra uma opção: ler.

O que estava em jogo não era o teste. Era que **um cliente keep-alive legítimo —
browser, app — que mandasse um corpo grande demais receberia o `413` e depois
veria a requisição _seguinte_ pendurar até o timeout.** Trocar "o servidor cai
com um POST de 500 MB" por "o cliente que erra o tamanho uma vez fica com a
conexão envenenada, e a API parece fora do ar" seria um péssimo negócio: a
segunda falha é mais frequente, atinge quem não está atacando ninguém, e não
tem sintoma que aponte para a causa.

**O dreno tem orçamento, e ele é o `MAX_REQUEST_BODY_BYTES`.** Sem orçamento, o
dreno seria trabalho ilimitado: sob `chunked` nada corta o stream (D1-bis), e um
cliente que fluxa sem parar prenderia um worker lendo para sempre — slowloris
com outro nome. Com orçamento, o dreno tem **dois finais**, e só um deles pode
ser seguido de um `413` numa conexão viva:

1. **Stream esgotado dentro do orçamento** → responde `413`, e a conexão
   continua utilizável. É o caso para o qual o dreno existe: quem errou o
   tamanho uma vez.
2. **Orçamento estourado** → para de ler, responde `413` em best-effort e
   **aceita que aquela conexão morra**. Quem fluxa 8 MB sem parar não ia reusar
   a conexão de qualquer forma; o custo dele é uma conexão inutilizada, o nosso
   é um socket ocioso até o timeout — o mesmo que qualquer cliente consegue
   segurar sem enviar byte nenhum. Não há como forçar o fechamento: o Bun não
   honra `Connection: close` (medido). No dia em que honrar, é aqui que entra.

**O custo, dito honestamente:** paga-se o tempo e a banda de ler até 8 MB que
serão jogados fora, por requisição recusada. Não é zero sob muitas conexões
simultâneas — mas a defesa contra _isso_ é limite de conexão e timeout de
ociosidade no servidor, outra alavanca, fora do escopo desta entrega, e que já
valia igual para as três rotas de importação, que leem 5 MB por stream desde
sempre.

**`AbortError` no meio do dreno.** O veredito é decidido pelo que já foi
**contado**, nunca pela forma como o stream terminou:

- abort **depois** de cruzar o teto → `PayloadTooLargeError` (`413`). O veredito
  já existia antes do abort, e o abort é frequentemente consequência do próprio
  corte. Deixar o `AbortError` subir viraria `500` no `errorCodeMap`, que é a
  resposta errada para um fato que já conhecíamos;
- abort **antes** de cruzar o teto → não é corpo grande demais, é cliente que
  desistiu. Não se fabrica um `413` para isso: mentiria no log e destruiria a
  única métrica que diria se o teto está apertado demais ("quantos 413 por
  dia"). O erro sobe como está. Vira um `500` não mapeado no log, o que é
  factualmente "não conseguimos ler a requisição", e a resposta não vai para
  ninguém porque o cliente já foi embora. Se isso virar ruído de log observado
  — e só então —, ganha erro tipado e caminho de log silencioso; hoje seria
  generalidade especulativa.

**O atalho de `Content-Length` morre, e some sem substituto.** Ele existia para
economizar a leitura; a plataforma acabou de provar que a leitura não é
opcional. Mantê-lo drenando seria o mesmo I/O, a mesma memória e o mesmo
resultado por um caminho a mais — dead weight que diverge na primeira
manutenção. Some junto com ele a assimetria entre chamador com e sem
`Content-Length`, que era o cliente escolhendo o ramo do servidor. Quem precisar de mais que isso declara `bodyMode: "stream"`,
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

### D6 — As rotas `bodyMode: "stream"` seguem intocadas **no teto de bytes**

Confirmado no código: `ControllerRequestParser.parse()` desvia para o ramo
`stream` na **primeira linha**, devolve `bodyStream` cru e nunca chega em
`#readRawBody()` nem em `#parseBody()`. Os tetos novos moram exatamente nesses
dois métodos, então nenhuma linha do caminho de importação muda de
comportamento. Não há duplicação nem contradição de tetos:

| Teto                      | Quem aplica                           | Escopo                              |
| ------------------------- | ------------------------------------- | ----------------------------------- |
| `MAX_IMPORT_BYTES` (5 MB) | `readCsvRecordStream`, contando bytes | Só as 3 rotas de importação         |
| `MAX_IMPORT_FIELD_BYTES`  | `readCsvRecordStream`                 | Campo do CSV                        |
| `MAX_IMPORT_ROWS`         | `ImportRunner`                        | Linhas do lote                      |
| `MAX_BUFFERED_BODY_BYTES` | O leitor com teto (HTTP e `/mcp`)     | Só o que **não** é stream, retido   |
| `MAX_REQUEST_BODY_BYTES`  | O leitor com teto e o de CSV          | Quanto qualquer corpo pode ser lido |

A única relação entre eles que precisa ser mantida é
`MAX_REQUEST_BODY_BYTES > MAX_IMPORT_BYTES` (D1) — e ela é travada por teste,
não por comentário.

### D6-bis — O caminho de importação já tem o bug de D2-bis, hoje, e ele entra nesta entrega

O que **não** muda para as rotas de importação é o teto de bytes. O que muda é
outra coisa, que a investigação de D2-bis expôs e que ninguém tinha visto:
`readCsvRecordStream` termina com

```
} finally {
  await reader.cancel();
}
```

Ou seja, **toda** rejeição de importação cancela o reader com bytes por ler — e,
pela sonda B, `cancel()` envenena a conexão. Não é um caso de canto: a rejeição
mais comum de todas é "coluna obrigatória ausente", que dispara depois de ler
**a primeira linha** de um arquivo que pode ter megabytes. Hoje, quem sobe um
CSV com o cabeçalho errado recebe o `422` correto e vê a requisição seguinte
pendurar.

É bug pré-existente, não regressão desta PR — mas entra aqui, por dois motivos:
é literalmente o mesmo defeito, com a mesma correção de duas fases; e sem ele a
IE-1 nasceria falsa em três rotas, o que é pior que não ter invariante. A
correção é a mesma: no caminho de rejeição, drenar e descartar até o fim do
stream (com o mesmo orçamento `MAX_REQUEST_BODY_BYTES`) antes de propagar o
`ImportRejectedError`; o `cancel()` do `finally` só continua fazendo sentido no
caminho de sucesso, em que o stream já foi lido até o fim.

Isto é leitura de código mais a sonda B, não medição no Sogio: a task começa
pelo teste que reproduz (importação rejeitada seguida de requisição na mesma
conexão), para provar o diagnóstico antes de corrigi-lo.

### D7 — Como se testa "sem materializar" sem alocar 500 MB

A prova não é "mandei 500 MB e sobrevivi"; é **"o servidor parou de puxar o
corpo"**. O `fetch` aceita um `ReadableStream` como body: o teste monta um
gerador que se declara enorme mas conta quantos chunks foram efetivamente
puxados, e afirma duas coisas — a resposta foi `413` **e** o número de chunks
puxados ficou na ordem do teto, não na ordem do corpo anunciado. A memória do
teste nunca passa de alguns MB. (Se o `duplex: "half"` do `fetch` do Bun não
cooperar, o plano B é escrever `Transfer-Encoding: chunked` num socket cru — que
tem o bônus de provar o caso "sem `Content-Length`" de D2.)

**A prova que faltava, e que a suíte completa encontrou por acidente: a conexão
sobrevive à recusa.** Depois de um `413`, a requisição seguinte do **mesmo
cliente keep-alive** precisa ser atendida normalmente, dentro de um timeout
curto. Sem essa afirmação, qualquer "otimização" futura que evite ler o corpo
reintroduz D2-bis em silêncio — e o sintoma aparece longe da causa, num teste
que não tem nada a ver. Vale para o adaptador HTTP e para `/mcp`.

No unitário do leitor, a afirmação equivalente é de **ordem**: o
`PayloadTooLargeError` é lançado **depois** de o stream ter sido esgotado, não
no chunk que cruza o teto. Um contador de chunks puxados na fonte prova as duas
coisas de uma vez (esgotou tudo; falhou no fim).

O resto se testa direto, e o molde já existe em
`tests/core/stream_body_adapter.test.ts` (controller descartável + `Bun.serve`
em porta 0):

- corpo acima do teto → `413`, e o `handle()` do controller **nunca rodou** (a
  única afirmação que separa "recusou" de "processou e reclamou");
- `Content-Length` mentindo para baixo ou ausente não muda nada — o header não
  é lido, então não há ramo a testar, e sim um ramo a **provar inexistente**:
  corpo idêntico com e sem `Content-Length` produz a mesma resposta;
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

- **IE-1 — Nenhum corpo de requisição é materializado sem teto, e nenhum corpo
  recusado é abandonado pela metade.** Toda superfície de entrada (adaptador
  HTTP, `/mcp` e o leitor de CSV) limita bytes **enquanto lê**, sem consultar
  `Content-Length` — header opcional e escolhido pelo cliente nunca decide qual
  caminho o servidor toma. São dois números: quanto pode ser **retido**
  (`MAX_BUFFERED_BODY_BYTES`) e quanto pode ser **lido**, retido ou descartado
  (`MAX_REQUEST_BODY_BYTES`). O `maxRequestBodySize` do `Bun.serve` **não é
  trava**: o Bun só o aplica quando há `Content-Length` e o ignora sob
  `chunked` (medido), então ele é atalho para o chamador honesto e nada mais —
  quem garante é a contagem no leitor. Cruzado o teto de retenção, o leitor para
  de reter e passa a **drenar e descartar** até o fim do stream, lançando só
  então: responder sem consumir o corpo dessincroniza a conexão keep-alive no
  Bun (`cancel()` não a recupera, `Connection: close` não é honrado, ambos
  medidos), e a requisição seguinte do mesmo cliente pendura até o timeout — um
  cliente legítimo que erra o tamanho uma vez fica com a conexão envenenada,
  falha mais frequente e mais desnorteante que a original. O dreno tem
  orçamento: estourado ele, para-se de ler e aquela conexão é dada como
  perdida — cortesia é para quem errou, não para quem fluxa sem parar. O pico de
  memória segue sendo um chunk. `bodyMode: "stream"` é a única saída para quem
  precisa aceitar mais, e ela troca "corpo maior" por "leitura incremental",
  nunca por "sem teto" nem por "sem dreno".
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
  `ReadableStream<Uint8Array>` contando bytes e decodificando
  incrementalmente; cruzado o teto, para de reter e drena/descarta até o fim do
  stream, e só então lança `PayloadTooLargeError` (D2, D2-bis). Não consulta
  `Content-Length`. Recebe o teto como argumento; não conhece rota nem
  controller
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
- **`src/core/infra/http/csv/streaming_csv_reader.ts`** — no caminho de
  rejeição, drena e descarta até o fim do stream (orçamento
  `MAX_REQUEST_BODY_BYTES`) antes de propagar o `ImportRejectedError`, em vez de
  cancelar o reader com bytes por ler (D6-bis)
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
2. **Leitor de corpo com teto** — `bounded_body_reader.ts`: contagem por chunk,
   decodificação incremental, e dreno-e-descarte depois do teto com
   `PayloadTooLargeError` lançado ao fim do stream. Sem leitura de
   `Content-Length` e sem `cancel()` (D2-bis)
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
8. **Unitários do leitor e do scanner** — teto atingido/não atingido, corpo
   ausente, **stream esgotado antes do lançamento** (contador de chunks
   puxados), colchete dentro de string, aspas escapadas, profundidade no limite
   e um acima. A asserção antiga de que o atalho "nunca chama `getReader()`"
   morre com o atalho e é substituída pela de ordem acima
   - Dependencies: tasks 2, 3
9. **Testes do adaptador HTTP** — `413` sem o controller rodar, **conexão
   keep-alive sobrevive à recusa** (413 seguido de request normal atendido
   dentro de timeout curto), mesma resposta com e sem `Content-Length`, `422`
   de profundidade, e a afirmação nova em `stream_body_adapter.test.ts` de que
   rota `stream` acima de 1 MB segue `200`
   - Dependencies: task 4
10. **Testes do teto de socket e da relação entre constantes** — wiring de
    `bunServeOptions.maxRequestBodySize`, servidor de brinquedo provando o `413`
    do Bun, e `MAX_REQUEST_BODY_BYTES > MAX_IMPORT_BYTES`
    - Dependencies: task 5
11. **Testes de `/mcp`** — corpo acima do teto → `413`; aninhamento acima de 32
    recusado antes do transporte; **chamada normal logo depois de um `413` na
    mesma conexão é atendida**; chamada normal segue funcionando
    - Dependencies: task 6
12. **Dreno no caminho de rejeição da importação** — teste que reproduz o
    envenenamento (importação rejeitada seguida de requisição na mesma conexão),
    depois a correção em `readCsvRecordStream` (D6-bis). Independente das
    demais: mexe em outro arquivo e em outro caminho
    - Dependencies: task 2 (reusa a decisão do orçamento, não o código)
13. **Documentação** — IE-1 e IE-2 em `arquiteto.md`; parágrafo dos tetos em
    `CLAUDE.md`, incluindo `chunked` escapando do `maxRequestBodySize`
    - Dependencies: tasks 4, 5, 6, 12

> Tasks 2 e 3 rodam em paralelo depois da 1. Depois delas, 4 e 6 rodam em
> paralelo, e 5 e 7 já podiam ter rodado em paralelo com 2 e 3. Os testes (8, 9,
> 10, 11) seguem cada um a sua task de implementação. A 12 fecha.
