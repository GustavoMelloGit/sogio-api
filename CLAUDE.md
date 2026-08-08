# CLAUDE.md

Este arquivo fornece orientações ao Claude Code (claude.ai/code) ao trabalhar com este repositório.

## Personas e Orquestração

Este projeto utiliza um sistema de personas especialistas. **O Orquestrador é o ponto de entrada obrigatório para toda e qualquer tarefa.** Leia o arquivo abaixo antes de qualquer planejamento, desenvolvimento ou revisão:

```
.claude/personas/orquestrador.md
```

O Orquestrador decide quais personas invocar, em que ordem e quando. Nunca invoque outra persona diretamente — tudo passa pelo Orquestrador primeiro.

Todas as personas disponíveis estão em `.claude/personas/*.md`.

## Comandos

```bash
# Desenvolvimento
bun run dev          # Inicia o servidor de desenvolvimento com hot reload
bun run start        # Inicia o servidor de produção

# Build
bun run build        # Compila TypeScript + Bun build para executável (./out)

# Qualidade de Código
bun run lint         # ESLint com auto-fix
bun run lint:check   # ESLint sem fix (CI)
bun run format       # Formatação com Prettier
bun run format:check # Verificação do Prettier (CI)

# Banco de Dados (Drizzle ORM)
bun run db:push       # Envia o schema para o banco
bun run db:migration  # Gera arquivos de migration
bun run db:migrate    # Executa migrations pendentes
```

```bash
# Testes
bun run db:push:test  # Cria o schema `test` no banco e aplica o schema Drizzle (obrigatório antes do primeiro run)
bun run test          # Executa todos os testes
```

Os testes ficam em `tests/<bounded context>/<test name>.test.ts`.

> **Pré-requisito**: o arquivo `.env.test` na raiz do projeto deve conter a variável `DATABASE_URL` com as credenciais reais do banco local, e a variável `API_BASE_URL` (ex: `http://localhost:4000`) — obrigatória fora de `development` desde a introdução dos documentos de descoberta OAuth.

## Arquitetura

**StayHub API** é um backend de gestão de aluguel de imóveis construído com Bun + TypeScript + PostgreSQL (Drizzle ORM). Segue **Clean Architecture** com separação estrita de camadas.

### Estrutura de Camadas

Cada módulo de negócio (`auth`, `booking`, `property_management`, `finance`) possui quatro camadas:

```
src/[modulo]/
├── domain/         # Entidades, interfaces de repositório, value objects, eventos, policies
├── application/    # Use cases, serviços, DTOs, event handlers
├── infra/          # Repositórios Drizzle, container DI, integrações externas
└── presentation/   # Controllers HTTP
```

O módulo `src/core/` provê infraestrutura compartilhada: tipo base de entidade, erros customizados, interface `UseCase`, roteamento HTTP, configuração do DI e setup do banco.

### Padrões Principais

**Entidades** usam um campo privado `#data` com schema Zod. Dois factories estáticos: `create()` para objetos novos, `reconstitute()` para carregar do banco. Getters expõem dados como read-only. Toda entidade estende `BaseEntity` com `id`, `created_at`, `updated_at`, `deleted_at`.

**Use Cases** implementam `UseCase<Input, Output>`. Dependências injetadas via construtor. `execute(input, user)` retorna um DTO (nunca uma entidade bruta). Lançam erros tipados (`ConflictError`, `ResourceNotFoundError`, etc.).

**Controllers** implementam `Controller` (`path`, `method`, `handle()`). Validam input com Zod (lançam `ValidationError` em caso de falha). Retornam um DTO — o adaptador HTTP serializa para JSON.

**Containers DI** — cada módulo tem uma classe `[Module]Di` (`AuthDi`, `StayDi`, `PropertyDi`, `FinanceDi`). Factory methods nomeados `make[Componente]` montam as dependências. Instâncias criadas uma única vez em `routes.ts`.

**Tratamento de Erros** — use cases lançam erros tipados; o adaptador HTTP mapeia os nomes de erro para status codes: `ValidationError` → 422, `ConflictError` → 409, `ResourceNotFoundError` → 404, `UnauthorizedError` → 401, `IllegalStateError` → 500.

**Autenticação** — JWT Bearer tokens. `SessionManager` cria/valida tokens. O middleware de auth extrai o usuário e o repassa ao controller. Rotas declaram `authenticated: boolean` em `routes.ts`.

### Banco de Dados

Os schemas do Drizzle ORM ficam em `src/core/infra/database/drizzle/schemas/`. Repositórios usam `db.query` e DML do Drizzle. Registros são mapeados para entidades via `reconstitute()`.

### Variáveis de Ambiente

Definidas em `src/core/infra/config/environments.ts`:

- `PORT` — porta do servidor
- `DATABASE_URL` — string de conexão PostgreSQL
- `NODE_ENV` — `development | test | sandbox | production`
- `JWT_SECRET` — chave de assinatura dos tokens

### Estilo de Código

Configuração do Prettier: indentação de 2 espaços, largura de linha de 80 caracteres, aspas duplas, trailing commas (ES5), ponto e vírgula obrigatório. ESLint aplica regras TypeScript strict. Husky executa lint + format no pre-commit via lint-staged.

Nomenclatura de arquivos: `snake_case.ts`. Classes: `PascalCase`. Campos privados: `#fieldName` (private class fields do TypeScript).

## Convenções de Commit

Seguir o formato **Conventional Commits**:

```
<tipo>: <descrição curta em inglês>
```

Tipos usados neste projeto:

- `feat` — nova funcionalidade ou comportamento
- `fix` — correção de bug
- `refactor` — reestruturação de código sem mudança de comportamento
- `chore` — tooling, deps, CI/CD, config, mudanças não funcionais

Regras:

- Tipo e descrição em letras minúsculas
- Sem ponto final
- Descrição resume o _o quê_, corpo (se necessário) explica o _por quê_
- Commits em inglês
- **Após cada modificação de código, criar um commit antes de continuar**
