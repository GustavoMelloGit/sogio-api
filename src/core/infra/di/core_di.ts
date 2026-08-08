import type { Logger } from "../../application/logger/logger";
import type { RateLimiter } from "../../application/rate_limit/rate_limiter";
import { ConsoleLogger } from "../logger/console_logger";
import { InMemoryRateLimiter } from "../rate_limit/in_memory_rate_limiter";

/**
 * Module-level singletons, not per-`CoreDi`-instance fields (correção
 * pós-revisão, M6's correlato). `CoreDi` is constructed independently in
 * several places (`http_controller_adapter.ts`, `AuthDi`, `src/index.ts`,
 * `core/infra/mcp/routes.ts`) — before this fix, each `new CoreDi()` built
 * its *own* `InMemoryRateLimiter`, so `makeRateLimiter()`'s docstring
 * ("shared across every route in the process") was false: the adapter's
 * automatic `peer-ip` check and `AuthDi`'s controllers (`/token`'s and
 * `/revoke`'s `client_id` dimension) were counting against two entirely
 * separate maps. A module-level instance makes every `CoreDi()` — present or
 * future — return the exact same counter, so the docstring's guarantee is
 * now actually true rather than aspirational.
 */
const sharedLogger: Logger = new ConsoleLogger();
const sharedRateLimiter: RateLimiter = new InMemoryRateLimiter();

export class CoreDi {
  makeLogger(): Logger {
    return sharedLogger;
  }

  /**
   * Shared across every route in the process — rate limiting only works if
   * callers hitting different routes still share the same counters per key.
   * Counting is therefore per-process, a documented limitation (see the MCP
   * OAuth authorization plan's Dívidas section) until it needs to survive
   * multiple instances.
   */
  makeRateLimiter(): RateLimiter {
    return sharedRateLimiter;
  }
}
