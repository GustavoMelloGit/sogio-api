import type { TransactionRunner } from "../../../application/transaction/transaction_runner";
import { db } from "./database";
import { runWithExecutor } from "./transaction_context";

/**
 * Implements `TransactionRunner` over `db.transaction`, publishing the
 * transaction's executor through `AsyncLocalStorage` (`transaction_context`)
 * instead of threading it as a parameter. An explicit executor would have to
 * cross a `domain` port (`PropertyOccupancy`) and the event dispatcher into
 * a handler of another bounded context, dragging a Drizzle type across three
 * layer boundaries and forcing every `EventHandler` to accept it (DA-13).
 * The ambient-context approach keeps every signature untouched; the only
 * repositories that need to know about it are the ones that actually write
 * during a `DeletePropertyUseCase` transaction — see `currentExecutor`.
 */
export class DrizzleTransactionRunner implements TransactionRunner {
  async run<T>(fn: () => Promise<T>): Promise<T> {
    return db.transaction(tx => runWithExecutor(tx, fn));
  }
}
