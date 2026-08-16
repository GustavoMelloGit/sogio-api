/**
 * Runs `fn` inside a single database transaction, so every repository write
 * made while it runs either all commit together or all roll back together
 * (DA-13). Declared here so a use case can depend on the *ability* to run
 * transactionally across bounded contexts without knowing Drizzle — or even
 * Postgres — sits underneath.
 */
export interface TransactionRunner {
  run<T>(fn: () => Promise<T>): Promise<T>;
}
