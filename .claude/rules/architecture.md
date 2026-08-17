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
  - **`src/<bc>/presentation`**: Contains the API controllers, which handle incoming HTTP requests and call the appropriate use cases.
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
- Then add the corresponding MCP tool in `src/core/infra/mcp/tools/`, registered in the barrel (`tools/index.ts`), the import block of `mcp/routes.ts`, and the `tools` array in `makeMcpRequestHandler` — reusing the same DI instances the HTTP route uses. Every new use case or endpoint ships with its MCP tool in the same delivery, unless it falls into one of the documented exceptions in `CLAUDE.md` (credential material, the OAuth protocol itself, third-party webhooks, unauthenticated public links, LGPD account deletion, hosted payment sessions, or operational routes like `/health`/`/docs`).
