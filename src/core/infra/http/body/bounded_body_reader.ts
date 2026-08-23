import { PayloadTooLargeError } from "../../../application/error/payload_too_large_error";

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBufferedBytes: number,
  maxReadBytes: number
): Promise<string | null> {
  if (body === null) {
    return null;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bufferedBytes = 0;
  let readBytes = 0;
  let text = "";
  let exceededBufferLimit = false;

  while (true) {
    const outcome = await reader.read().then(
      result => ({ read: true as const, result }),
      error => ({ read: false as const, error })
    );

    if (!outcome.read) {
      if (exceededBufferLimit) {
        throw new PayloadTooLargeError(maxBufferedBytes);
      }
      throw outcome.error;
    }

    const { done, value } = outcome.result;

    if (done) {
      break;
    }

    readBytes += value.byteLength;

    if (!exceededBufferLimit) {
      bufferedBytes += value.byteLength;
      if (bufferedBytes > maxBufferedBytes) {
        exceededBufferLimit = true;
      } else {
        text += decoder.decode(value, { stream: true });
      }
    }

    if (readBytes > maxReadBytes) {
      throw new PayloadTooLargeError(maxBufferedBytes);
    }
  }

  if (exceededBufferLimit) {
    throw new PayloadTooLargeError(maxBufferedBytes);
  }

  text += decoder.decode();

  return text;
}
