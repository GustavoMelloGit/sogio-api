---
description: Rules for the architecture of the project.
globs:
alwaysApply: true
---

## Project Structure

- The project follows Domain Driven Design principles and has multiples bounded contexts.
- All the BCs (Bounded Contexts) are located in the `src` folder. For example, the `booking` BC is located in the `src/booking` folder.
- The `core` is not necessarily a BC, but it is a folder that contains files that are shared across all the BCs.

## Clean Architecture Pattern

- The project follows a clean architecture pattern and Domain Driven Design, separating concerns into the following layers:
  - **`src/<bc>/domain`**: Contains the core business logic of the application, including entities and repository interfaces.
  - **`src/<bc>/application`**: Contains the application-specific logic, such as use cases and data transfer objects.
  - **`src/<bc>/infra`**: Contains the implementation details of the application, such as database repositories, web frameworks, and dependency injection.
  - **`src/<bc>/presentation`**: Contains the API controllers, which handle incoming HTTP requests, and the MCP tools, which handle incoming MCP tool calls — both call the appropriate use cases.
- **Each directory under a layer has one meaning, and lint enforces it.**
  - **`application/service/`** holds **application services**: objects that coordinate collaborators to carry out one application task, plus the outbound ports the application declares for infrastructure to implement (`Hasher`, `CredentialVerifier`). No business rules of their own. Enforced by `sogio/service-only-service-objects` — only classes and interfaces may be exported.
  - **`application/content/`** holds the **text a bounded context addresses to a user**, resolved by locale: email bodies, ledger entry descriptions. Pure functions, no collaborators. (`notification` is the documented exception — its copy lives inside `NOTIFICATION_TYPE_REGISTRY`, because there "which types exist" and "what each one says" are one declaration.)
  - **`application/handler/`** holds event handlers and nothing else — see below.
  - **`domain/`** holds business rules: entities, value objects, policies, domain services, repository interfaces.
  - **`presentation/schema/`** holds the **input contract of a use case, as published to callers** — one `z.ZodRawShape` per use case, shared by its HTTP controller and its MCP tool. It sits in `presentation` because it describes what a caller sends, not a business rule; its bounds always reference constants from `domain`. Enforced by `sogio/no-inline-input-schema`, which forbids declaring an input schema literal inside `presentation/controller/` or `presentation/mcp_tool/`.
  - The lint rules cannot prove a class _is_ an application service or that a function _is_ content. What they prove is that the file publishes the right **shape**, which forces the question at the moment of writing.
- **A use case reachable over both transports has one input contract, not two.** HTTP and MCP are two transports onto the same use case, so the fields a caller may send, their types and their bounds are one declaration in `src/<bc>/presentation/schema/<use_case>.schema.ts`. The shared unit is a `z.ZodRawShape` — a plain object of Zod fields — because `McpToolDefinition.inputSchema` takes the raw shape and the controller wraps it with `z.object(shape)`. `.describe()` belongs on the shared shape: it is the tool's prompt for an LLM and, through `bodyFromZod`/`z.toJSONSchema`, the field description in `/docs`. A legitimate difference between the channels is one visible `.extend()`/`.omit()` at the consumer — never a second copy of the field. Two examples that must stay different: `book_stay` takes `z.coerce.date()` over HTTP but demands ISO-8601 with an explicit offset over MCP, because an LLM will invent an offset-less datetime; and `entrance_code` is HTTP-only, because it is a real door-lock password that must never enter an LLM's context. Output schemas are out of scope — `outputSchema` exists only for `/docs`, and the MCP tool publishes none.

- **`application/handler/` holds event handlers and nothing else.** A file there exports exactly one class implementing `EventHandler`; anything a handler needs but is not a handler — a text composer, a lookup helper, a pure derivation — belongs in `application/service/` or `domain/`. The directory is the list of things a bounded context reacts to; a helper drifting into it makes that list stop meaning anything. Enforced by `sogio/handler-only-event-handlers` (`eslint-rules/handler_only_event_handlers.js`), which allows non-exported helpers inside a handler file and type-only exports.
- The project uses Bun as the JavaScript runtime and toolkit.
- The project uses TypeScript as the programming language.
- The project uses PostgreSQL as the database.
- The project uses Drizzle as the ORM.
- The project uses Zod as the validation library.

## Creating a new route

- First, check if there is a BC that can be used to create this new route. If there isn't, create it.
- Then, check if there is a repository method that can be used to create this new route. If there isn't, create it.
- Then create the use case that will be used to create this new route.
- Then create the controller that will be used to handle the incoming HTTP requests and call the appropriate use case.
- Then add the factory methods to the DI container.
- Then add the route to the routes file.
- Then add the corresponding MCP tool in `src/<bc>/presentation/mcp_tool/`, registered in two places: a `make<X>Tool()` factory on the BC's Di container and the `tools` array in `makeMcpRequestHandler` (`core/infra/mcp/routes.ts`) — reusing the same DI instances the HTTP route uses. Every new **user-scoped** use case or endpoint ships with its MCP tool in the same delivery.
- **Admin/backoffice use cases get no MCP tool.** If the use case operates on the whole application — global configuration, every user's data — rather than the logged-in user's own data, it stays off the MCP surface by design, not as debt. This covers the entire `backoffice` BC and any `adminOnly` route.
- Other documented exceptions live in `CLAUDE.md` (credential material, the OAuth protocol itself, third-party webhooks, unauthenticated public links, LGPD account deletion, hosted payment sessions, or operational routes like `/health`/`/docs`).
