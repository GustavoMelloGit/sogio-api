import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "./database";

/** Either plain `db` or the executor `db.transaction`'s callback receives. */
export type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

const executorStorage = new AsyncLocalStorage<DbExecutor>();

/**
 * The executor a repository should write through for the current async
 * context: the ambient transaction started by `DrizzleTransactionRunner.run`
 * if one is in progress, or plain `db` otherwise (DA-13). Every repository
 * method that calls this keeps behaving exactly as it did before this
 * existed when it's invoked outside `TransactionRunner.run` — this is
 * purely additive.
 */
export function currentExecutor(): DbExecutor {
  return executorStorage.getStore() ?? db;
}

/** Runs `fn` with `executor` as the ambient executor for its async context. */
export function runWithExecutor<T>(
  executor: DbExecutor,
  fn: () => Promise<T>
): Promise<T> {
  return executorStorage.run(executor, fn);
}
