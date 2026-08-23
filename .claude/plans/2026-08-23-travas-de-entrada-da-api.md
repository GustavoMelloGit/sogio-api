# Travas de entrada da API

## Objective

Fechar as entradas da API contra abuso de tamanho, tipo e domínio, e travar cada
decisão numa regra de lint sempre que a forma do schema permitir prová-la. A
entrega imediata é `sogio/zod-array-max` (todo `z.array()` de entrada declara
teto de itens); o resto deste documento é o levantamento dos demais buracos
encontrados na varredura, com severidade e o motivo de cada um ser ou não
lintável.

## Personas

- **Analista de Segurança** (`analista_seguranca.md`) — dono do checklist de
  validação de entrada que originou este levantamento
- **Arquiteto** (`arquiteto.md`) — dono das decisões de domínio fechado (item 4)
  e do teto de corpo de requisição (item 1)
- **Desenvolvedor** (`desenvolvedor.md`) — implementação das regras e correções

## Mapped Changes

Entregue nesta PR:

- **`eslint-rules/zod_array_max.js`** — regra nova, mesmo molde de
  `zod_string_max.js`: `z.array()` sem `.max()`/`.length()`/`.nonempty()` é
  erro. Reusa `schema_scope.js` (`isZodChain`, `chainedMethodsAfter`,
  `isIgnoredSchema`), então herda a mesma isenção de `outputSchema`/
  `*OutputSchema`/`*ResponseSchema`/`envSchema` das outras
- **`eslint-rules/index.js`**, **`eslint.config.js`** — registro da regra
- **`src/property_management/domain/entity/property.ts`** — `MAX_PROPERTY_IMAGES
= 50` ao lado de `MAX_PROPERTY_CAPACITY`; `propertySchema.images` ganha o teto
- **`create_property.controller.ts`**, **`update_property.controller.ts`**,
  **`import_batch_properties.ts`**, **`import_properties.mcp_tool.ts`** — as
  cinco violações reais que a regra encontrou, todas o mesmo campo `images`
- **`tests/core/eslint_rules.test.ts`** — casos válidos e inválidos da regra

## Backlog levantado (não entregue)

Numerados por severidade decrescente. Cada item diz se é lintável.

### 1. CRÍTICO — Corpo de requisição sem teto de tamanho

`HttpControllerAdapter` chama `this.request.text()` sem olhar `Content-Length`
em toda rota que não seja `bodyMode: "stream"`. As rotas de importação têm
`MAX_IMPORT_BYTES`; nenhuma outra tem nada. Um POST de 500 MB numa rota comum é
lido inteiro para a memória antes de o Zod ver o primeiro campo — os `.max()` de
campo não protegem contra isso, porque rodam depois. Numa VPS pequena é o vetor
de DoS mais barato da lista. **Não lintável** — é decisão do adaptador, não do
schema. Vale a mesma premissa de pico de memória constante que a importação já
adota.

### 2. CRÍTICO — Profundidade de aninhamento sem teto

`JSON.parse` de um corpo com dezenas de milhares de níveis estoura a pilha antes
de qualquer validação. Mitigado de fato pelo item 1 (um payload assim costuma
ser grande), mas não eliminado: aninhamento profundo cabe em poucos KB.
**Não lintável**.

### 3. MODERADO — URL validada como string livre

`images` é `z.string().max(2048)`, não `z.url()`. Aceita `javascript:alert(1)`,
`data:text/html,...` e caminho relativo. O backend não renderiza nada, mas
grava e devolve, e o frontend põe em `<img src>` — é XSS armazenado com o Sogio
como veículo. A correção é `z.url()` mais allowlist de protocolo (`https:`), não
só o formato. **Lintável por heurística de nome** (campo `*url*`/`*image*` deve
usar `z.url()`), o que é frágil; melhor tratar como convenção mais correção
pontual.

### 4. MODERADO — Domínio fechado modelado como string livre

`Stay.source` é `z.string().max(100)` embora o domínio real seja fechado
(`DIRECT` mais as plataformas de `ExternalBookingSource`, que já é
`z.enum(["AIRBNB", "BOOKING"])`). Blocklist implícita: hoje qualquer string
entra e vira dado sujo em relatório e em filtro. **Não lintável** — o lint não
sabe quais domínios são fechados. É decisão do Arquiteto.

### 5. MODERADO — String obrigatória sem `.min(1)` e sem `.trim()`

`zod-string-max` exige teto e não piso, então `z.string().max(100)` aceita `""`.
E `.min(1)` sozinho aceita uma string só de espaços. Campos afetados incluem
`source` e `entrance_code`. **Lintável**: estender `zod-string-max` para exigir
`.min()` em string não `.optional()`/`.default()`/`.nullable()`. Precisa de uma
passada de correção antes de ligar, senão a regra nasce vermelha.

### 6. MODERADO — `z.number()` sem `.int()` escapa de toda trava numérica

`zod-int-bounds` só dispara em `.int()`. Um `z.number()` puro passa sem piso nem
teto, aceitando `1e308`, `-0`, `NaN` via coerção e float onde o domínio é
inteiro. Hoje só existe em `outputSchema` (já isento), mas nada impede o próximo
campo. **Lintável**: nova `zod-number-bounds`, ou estender a existente para
disparar em `z.number()`/`z.coerce.number()` sem `.int()`.

### 7. INFORMATIVO — Data sem faixa

`z.coerce.date()` aceita o ano 275760 — `check_in`/`check_out` em `book_stay`,
`update_stay`, os filtros `from`/`to` de listagem e `BookedPeriod`. Não corrompe
nada hoje (`BookingPolicy` compara datas entre si), mas produz estadias
absurdas e índices inúteis. **Lintável com escopo**: a regra só faria sentido em
`presentation/controller/` e `presentation/mcp_tool/` — em entidade,
`created_at: z.date()` não tem faixa a declarar. Escopar por `files:` no
`eslint.config.js`, como já é feito para `handler-only-event-handlers`.

### 8. INFORMATIVO — `z.record()` sem teto de chaves

`Notification.payload` (`z.record(z.string().max(100), z.unknown())`) e
`Plan.capabilities` limitam o tamanho da chave, não o número delas. Risco baixo:
nenhum dos dois vem de entrada de usuário — `payload` é montado por handler
interno, `capabilities` vem do gateway. Registrado para não passar despercebido
se algum dia um `record` for exposto numa rota. **Lintável** no mesmo molde da
regra de array.

### 9. INFORMATIVO — Caracteres de controle e null bytes não rejeitados

Nenhum schema de string normaliza ou rejeita caracteres de controle. Um null
byte em campo de texto é erro do driver Postgres, ou seja, 500 em vez de 422.
**Lintável** só de forma grosseira; melhor como um `saneString()` compartilhado
que os schemas passem a usar.

## Tasks

1. **Regra `zod-array-max`** — criar a regra, registrar no plugin e no config,
   testar, corrigir as violações existentes com `MAX_PROPERTY_IMAGES`
   - Dependencies: none
   - Status: entregue nesta PR
2. **Teto de corpo de requisição** — rejeitar com 413 acima de um limite, antes
   de `request.text()`, nas rotas que não são `bodyMode: "stream"`
   - Dependencies: none
3. **`images` como URL** — trocar `z.string().max(2048)` por `z.url()` com
   allowlist de protocolo, nas quatro superfícies de imóvel
   - Dependencies: none
4. **`Stay.source` como enum** — decisão de domínio mais migration do dado já
   gravado
   - Dependencies: none
5. **Piso em string obrigatória** — passada de correção e depois estender
   `zod-string-max`
   - Dependencies: none
6. **`zod-number-bounds`** — travar `z.number()` sem `.int()`
   - Dependencies: none
7. **Faixa de data em schema de entrada** — regra escopada a `presentation/`
   - Dependencies: task 6 (mesmo molde, mesma decisão de escopo)
8. **`zod-record-max`** — teto de chaves
   - Dependencies: task 1 (mesma forma da regra de array)

> As tasks 2 a 6 não têm dependência entre si e podem rodar em paralelo.
