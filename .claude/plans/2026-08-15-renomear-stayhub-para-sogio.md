# Renomear produto StayHub -> Sogio

## Objective

Substituir o nome de marca "StayHub"/"stayhub" por "Sogio"/"sogio" em todo o
repositório (código, docs, config), no repositório GitHub, no banco de dados
local e nas pastas locais do projeto — sem alterar nenhum termo de domínio
(bounded contexts, agregados, rotas) e sem impactar produção.

## Personas

- **Arquiteto** — validou que é rename de branding, não de domínio; ver
  parecer completo no histórico da task. Nenhum bloqueio arquitetural.
- **Desenvolvedor** — executa o rename dentro da worktree.
- **Analista de Segurança** — revisa o diff (foco: `cors.middleware.ts`,
  `docker-compose.yml`, mudanças que tocam auth/OAuth).

## Decisões do usuário

1. Repositório GitHub: `GustavoMelloGit/stayhub-api` -> `GustavoMelloGit/sogio-api`
2. Banco local (`docker-compose.yml`, `.env`, `.env.test`): `stayhub`/`stayhub_test` -> `sogio`/`sogio_test`. Produção **não** é tocada nesta task.
3. Referências ao frontend (`stayhub-front` -> `sogio-front`) nos comentários do backend — o repo do frontend em si está fora de escopo.
4. Pastas locais do projeto (`~/Documents/Personal/stayhub/stayhub-api` -> `~/Documents/Personal/sogio/sogio-api`) — renomeadas por último, depois do merge.

## Regra de ouro (Arquiteto)

Buscar e trocar apenas o token de marca `stayhub`/`StayHub` (case-insensitive).
**Nunca** tocar em ocorrências de `stay` isoladas — `Stay`, `book_stay`,
`list_stays`, rota `/stays`, tabela `stays`, etc. são termos de domínio e
permanecem exatamente como estão.

## Mapped Changes

### Código-fonte (dentro da worktree, via PR)

- `src/core/infra/mcp/routes.ts:30` — `MCP_SERVER_NAME` ("stayhub" -> "sogio"), visível no `initialize` do protocolo MCP
- `src/core/infra/mcp/mcp_server.ts:14` — comentário
- `src/core/infra/http/swagger/open_api_builder.ts:49` — título/descrição OpenAPI
- `src/core/infra/http/swagger/scalar_ui.ts:33,49` — labels da doc
- `src/core/infra/http/swagger/swagger_ui.ts:28` — labels da doc
- `src/core/infra/config/environments.ts:33` — comentário (`stayhub-front` -> `sogio-front`)
- `src/core/presentation/middleware/cors.middleware.ts:15,115,150,151` — **apenas comentários**; lógica real usa `frontBaseUrl` (env), não muda. Trocar o par de exemplo anti-spoofing de forma coerente (`front.sogio.com` vs `front.sogio.com.evil.com`)
- `src/auth/application/use_case/decide_authorization_request.ts:42` — comentário
- `src/auth/application/use_case/list_connected_apps.ts:24` — comentário
- `src/auth/domain/service/oauth_scope_policy.ts:45` — texto de fallback de `describeScope()` (display-only, não persistido; não invalida consentimentos existentes — confirmado pelo Arquiteto)
- `src/auth/presentation/controller/delegated_access/authorize.controller.ts:26` — comentário
- `src/auth/presentation/controller/delegated_access/list_connected_apps.controller.ts:28` — comentário
- `src/auth/presentation/controller/auth/sign_in.controller.ts:47` — exemplo OpenAPI (e-mail de exemplo)
- `src/auth/presentation/controller/auth/register_user.controller.ts:51` — exemplo OpenAPI
- `src/property_management/presentation/controller/create_property.controller.ts:103` — URL de exemplo de imagem
- `tests/**/*.test.ts`, `tests/helpers/fixtures/delegated_access.ts` — strings arbitrárias (emails, issuers de teste); trocar fixture + assertions juntos, por arquivo

### Docs / config (dentro da worktree, via PR)

- `README.md`
- `CLAUDE.md`
- `package.json` (`"name": "stayhub-api"` -> `"sogio-api"`)
- `docker-compose.yml` — `container_name`, `POSTGRES_DB`, **e adicionar `name: sogio-api` explícito no topo** para não depender do nome do diretório (evita quebrar o volume de novo no futuro)
- `.claude/personas/arquiteto.md` — seção "Contexto do Domínio: StayHub" -> "Sogio" (só o nome do produto, terminologia de domínio intacta)
- `bun.lock` — **não editar à mão**; regenerar via `bun install` após mudar `package.json`

### Fora do escopo desta PR (não tocar)

- `.github/workflows/deploy.yml` (`cd stayhub_api`, `pm2 restart stayhub_api`) — identificadores reais da VPS de produção; renomear exige coordenação manual com o servidor, fora desta task
- Linha comentada de `DATABASE_URL` de produção em `.env` (credencial real) — não alterar nem reproduzir
- `.claude/plans/*.md` já existentes — histórico imutável
- Alias do conector MCP do usuário (`stayhub-prod`, fora do repositório, aponta pra produção) — pendência para quando produção for renomeada

### Local, fora do git (feito depois do merge, direto na raiz)

- `.env` — `DATABASE_URL` -> `.../sogio` (linha de produção comentada permanece intocada)
- `.env.test` — `DATABASE_URL` -> `.../sogio_test`
- Recriar ambiente Docker local (o volume é derivado do nome do projeto/diretório — vai mudar de qualquer forma): `docker compose down`, `docker compose up -d`, `bun run db:push`, `bun run db:push:test`
- Renomear repositório GitHub: `gh repo rename sogio-api`, depois `git remote set-url origin` (local e, se aplicável, na worktree antes de removê-la)
- Renomear pastas locais: `~/Documents/Personal/stayhub` -> `~/Documents/Personal/sogio`, `stayhub-api` -> `sogio-api`

## Tasks

1. **Arquiteto valida escopo** — concluído.
   - Dependencies: none
2. **Criar branch + worktree** (`rename-stayhub-to-sogio`)
   - Dependencies: task 1
3. **Desenvolvedor executa o rename** (código-fonte + docs/config listados acima, dentro da worktree)
   - Dependencies: task 2
4. **Rodar `bun install`, `lint:check`, `format:check`, `typecheck`** na worktree
   - Dependencies: task 3
5. **Commit + push + `gh pr create`**
   - Dependencies: task 4
6. **Analista de Segurança revisa o diff da PR**
   - Dependencies: task 5
7. **Merge da PR** (após revisão de segurança, confirmação do usuário)
   - Dependencies: task 6
8. **Remover worktree**
   - Dependencies: task 7
9. **Cutover local**: `.env`/`.env.test`, recriar Docker, `db:push`/`db:push:test`
   - Dependencies: task 8 (precisa do `docker-compose.yml` atualizado já em `main`)
10. **Renomear repositório no GitHub + `git remote set-url`**
    - Dependencies: task 8
11. **Renomear pastas locais** (`mv`)
    - Dependencies: tasks 9, 10 (evita mover o diretório com worktree/remote ainda em uso)

> Tasks 9 e 10 podem rodar em paralelo entre si (ambas dependem só da 8).
