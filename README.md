# Sogio API

This is the backend API for Sogio, a platform for managing property rentals. This project is currently under development.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

- [Bun](https://bun.sh/)
- [Apple container](https://github.com/apple/container) (macOS on Apple silicon), which runs the local PostgreSQL

### Installing

1. Clone the repository:
   ```bash
   git clone https://github.com/GustavoMelloGit/sogio-api
   ```
2. Navigate to the project directory:
   ```bash
   cd sogio-api
   ```
3. Install the dependencies:
   ```bash
   bun install
   ```

### Running the application

1. Start the local database (creates the `sogio_db` container and the `sogio_db_data` volume on first run):
   ```bash
   bun run db:start
   ```
2. Run the database migrations:
   ```bash
   bun run db:migrate
   ```
3. Start the development server:
   ```bash
   bun run dev
   ```

Stop the database with `bun run db:stop`; its data stays in the `sogio_db_data` volume.

## Project Structure

The project follows a clean architecture pattern, separating concerns into the following layers:

- **`src/domain`**: Contains the core business logic of the application, including entities and repository interfaces.
- **`src/application`**: Contains the application-specific logic, such as use cases and data transfer objects.
- **`src/infra`**: Contains the implementation details of the application, such as database repositories, web frameworks, and dependency injection.
- **`src/presentation`**: Contains the API controllers, which handle incoming HTTP requests and call the appropriate use cases.

## Technologies Used

- [Bun](https://bun.sh/) - JavaScript runtime and toolkit
- [TypeScript](https://www.typescriptlang.org/) - Typed superset of JavaScript
- [PostgreSQL](https://www.postgresql.org/) - The World's Most Advanced Open Source Relational Database
- [Drizzle](https://orm.drizzle.team/) - TypeScript ORM that feels like writing SQL
- [Zod](https://zod.dev/) - TypeScript-first schema validation
- [ESLint](https://eslint.org/) - Pluggable linting utility for JavaScript and JSX
- [Prettier](https://prettier.io/) - Opinionated code formatter
- [Husky](https://typicode.github.io/husky/) - Git hooks made easy

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
