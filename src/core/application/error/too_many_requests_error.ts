export class TooManyRequestsError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Too many requests. Retry after ${retryAfterSeconds} seconds.`);
    this.name = "TooManyRequestsError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
