export type BoundedJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid_json" | "too_large" };

type BodyBytesResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "invalid_json" | "too_large" };

export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonBodyResult> {
  const declaredLength = Number.parseInt(
    request.headers.get("Content-Length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  if (!request.body) {
    return { ok: false, reason: "invalid_json" };
  }

  const body = await readBytes(request.body, maxBytes);
  if (!body.ok) return body;

  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(body.bytes)) as unknown,
    };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

async function readBytes(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<BodyBytesResult> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  return { ok: true, bytes: joinBytes(chunks, byteLength) };
}

function joinBytes(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
