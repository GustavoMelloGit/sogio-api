import { describe, expect, it } from "bun:test";
import { readBoundedBody } from "../../src/core/infra/http/body/bounded_body_reader";
import { exceedsMaxJsonDepth } from "../../src/core/infra/http/body/json_depth_guard";
import { PayloadTooLargeError } from "../../src/core/application/error/payload_too_large_error";

function trackedStream(chunks: Uint8Array[]): {
  stream: ReadableStream<Uint8Array>;
  pulled: () => number;
  exhausted: () => boolean;
} {
  let pulled = 0;
  let index = 0;
  let exhausted = false;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      if (index >= chunks.length) {
        exhausted = true;
        controller.close();
        return;
      }
      controller.enqueue(chunks[index] as Uint8Array);
      index++;
    },
  });

  return {
    stream,
    pulled: () => pulled,
    exhausted: () => exhausted,
  };
}

function singleChunkStream(text: string): ReadableStream<Uint8Array> {
  return trackedStream([new TextEncoder().encode(text)]).stream;
}

function nestedArray(depth: number): string {
  return "[".repeat(depth) + "]".repeat(depth);
}

describe("readBoundedBody", () => {
  it("returns the full text when the body stays under the byte ceiling", async () => {
    const text = await readBoundedBody(
      singleChunkStream("hello world"),
      1000,
      1_000_000
    );

    expect(text).toBe("hello world");
  });

  it("returns null when the body is absent", async () => {
    const text = await readBoundedBody(null, 1000, 1_000_000);

    expect(text).toBeNull();
  });

  it("drains every available chunk from the source before throwing PayloadTooLargeError", async () => {
    const chunks = Array.from({ length: 5 }, () =>
      new TextEncoder().encode("a".repeat(300))
    );
    const { stream, exhausted } = trackedStream(chunks);

    await expect(
      readBoundedBody(stream, 1000, 1_000_000)
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(exhausted()).toBe(true);
  });

  it("stops reading and throws once the drained total crosses the read budget, without exhausting the stream", async () => {
    const chunks = Array.from({ length: 1000 }, () =>
      new TextEncoder().encode("b".repeat(500))
    );
    const { stream, pulled, exhausted } = trackedStream(chunks);

    await expect(readBoundedBody(stream, 1000, 2000)).rejects.toBeInstanceOf(
      PayloadTooLargeError
    );
    expect(exhausted()).toBe(false);
    expect(pulled()).toBeLessThan(chunks.length);
  });

  it("converts an aborted read into PayloadTooLargeError once the buffer ceiling was already crossed", async () => {
    let calls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        calls++;
        if (calls === 1) {
          controller.enqueue(new TextEncoder().encode("c".repeat(2000)));
          return;
        }
        controller.error(new Error("connection reset"));
      },
    });

    await expect(
      readBoundedBody(stream, 1000, 1_000_000)
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("surfaces the original error when the read aborts before the buffer ceiling is crossed", async () => {
    const original = new Error("client disconnected");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(original);
      },
    });

    const rejection = await readBoundedBody(stream, 1000, 1_000_000).catch(
      (error: unknown) => error
    );

    expect(rejection).toBe(original);
    expect(rejection).not.toBeInstanceOf(PayloadTooLargeError);
  });

  it("decodes a multi-byte UTF-8 character split across two chunks without corrupting it", async () => {
    const text = "hello 😀 world";
    const bytes = new TextEncoder().encode(text);
    const emojiStart = bytes.indexOf(0xf0);
    const splitPoint = emojiStart + 2;
    const { stream } = trackedStream([
      bytes.slice(0, splitPoint),
      bytes.slice(splitPoint),
    ]);

    const decoded = await readBoundedBody(stream, 1000, 1_000_000);

    expect(decoded).toBe(text);
  });
});

describe("exceedsMaxJsonDepth", () => {
  it("passes when nesting sits exactly at the limit", () => {
    expect(exceedsMaxJsonDepth(nestedArray(32), 32)).toBe(false);
  });

  it("rejects when nesting is one level above the limit", () => {
    expect(exceedsMaxJsonDepth(nestedArray(33), 32)).toBe(true);
  });

  it("does not count a bracket inside a string literal as nesting", () => {
    const text = `{"a":${JSON.stringify("[[[[[[[")}}`;

    expect(exceedsMaxJsonDepth(text, 1)).toBe(false);
    expect(exceedsMaxJsonDepth(text, 0)).toBe(true);
  });

  it("does not let an escaped quote close a string early", () => {
    const text = `{"a":${JSON.stringify('"[[[[')}}`;

    expect(exceedsMaxJsonDepth(text, 1)).toBe(false);
  });
});
