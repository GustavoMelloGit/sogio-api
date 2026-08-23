import { PayloadTooLargeError } from "../../../application/error/payload_too_large_error";

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  contentLengthHeader: string | null
): Promise<string | null> {
  if (body === null) {
    return null;
  }

  const declaredContentLength = contentLengthHeader
    ? Number(contentLengthHeader)
    : null;

  if (
    declaredContentLength !== null &&
    Number.isFinite(declaredContentLength) &&
    declaredContentLength > maxBytes
  ) {
    throw new PayloadTooLargeError(maxBytes);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError(maxBytes);
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();

  return text;
}
