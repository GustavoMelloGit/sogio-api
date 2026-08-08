import type { Logger } from "../../application/logger/logger";
import type { RateLimiter } from "../../application/rate_limit/rate_limiter";
import { ConsoleLogger } from "../logger/console_logger";
import { InMemoryRateLimiter } from "../rate_limit/in_memory_rate_limiter";

export class CoreDi {
  #logger: Logger;
  #rateLimiter: RateLimiter;

  constructor() {
    this.#logger = new ConsoleLogger();
    this.#rateLimiter = new InMemoryRateLimiter();
  }

  makeLogger(): Logger {
    return this.#logger;
  }

  /**
   * Shared across every route in the process — rate limiting only works if
   * callers hitting different routes still share the same counters per key.
   * Counting is therefore per-process, a documented limitation (see the MCP
   * OAuth authorization plan's Dívidas section) until it needs to survive
   * multiple instances.
   */
  makeRateLimiter(): RateLimiter {
    return this.#rateLimiter;
  }
}
