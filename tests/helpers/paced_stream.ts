export type PacedByteStream = {
  readable: ReadableStream<Uint8Array>;
  chunksPulled: () => number;
};

export type PacedByteStreamOptions = {
  preamble?: Uint8Array;
  fillByte?: number;
};

export function makeConnectionSurvivalProbeStream(
  totalBytes: number,
  chunkBytes: number,
  delayMs: number,
  options: PacedByteStreamOptions = {}
): PacedByteStream {
  const fillByte = options.fillByte ?? 97;
  const preamble = options.preamble;
  let preambleSent = preamble === undefined;
  let pulled = 0;
  let remaining = totalBytes;

  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!preambleSent) {
        preambleSent = true;
        controller.enqueue(preamble as Uint8Array);
        return;
      }
      if (remaining <= 0) {
        controller.close();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
      const size = Math.min(chunkBytes, remaining);
      remaining -= size;
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(fillByte));
    },
  });

  return { readable, chunksPulled: () => pulled };
}
