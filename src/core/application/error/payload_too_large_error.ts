export class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds the maximum size of ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}
