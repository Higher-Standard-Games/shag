/** Application deadlines for asset headers and streaming bodies. */
export const ASSET_HEADER_TIMEOUT_MS = 15_000;
export const ASSET_IDLE_TIMEOUT_MS = 60_000;
export const ASSET_TOTAL_TIMEOUT_MS = 15 * 60_000;

async function deadline<T>(work: Promise<T>, ms: number, cancel: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Asset request timed out; please retry"));
          cancel();
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAsset(
  url: RequestInfo | URL,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  let expired = false;
  try {
    // Native composition retains caller cancellation through body consumption too.
    const signal =
      init.signal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([controller.signal, init.signal])
        : controller.signal;
    const request = fetchImpl(url, { ...init, signal }).then((response) => {
      if (expired) void response.body?.cancel().catch(() => {});
      return response;
    });
    return await deadline(request, ASSET_HEADER_TIMEOUT_MS, () => {
      expired = true;
      controller.abort();
    });
  } finally {
    init.signal?.removeEventListener("abort", abort);
  }
}

/** Renew the idle deadline on progress, while retaining a generous total limit. */
export async function readAssetBuffer(
  response: Response,
  idleMs = ASSET_IDLE_TIMEOUT_MS,
  totalMs = ASSET_TOTAL_TIMEOUT_MS,
  onProgress?: (loadedBytes: number) => void,
): Promise<ArrayBuffer> {
  // Supports non-streaming fetch implementations too.
  if (!response.body) {
    const bytes = await deadline(response.arrayBuffer(), idleMs, () => {});
    onProgress?.(bytes.byteLength);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const end = performance.now() + totalMs;
  try {
    for (;;) {
      const remaining = end - performance.now();
      if (remaining <= 0) throw new Error("Asset download exceeded its time limit; please retry");
      const { done, value } = await deadline(reader.read(), Math.min(idleMs, remaining), () => {
        void reader.cancel().catch(() => {});
      });
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      onProgress?.(size);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readAssetText(response: Response): Promise<string> {
  return new TextDecoder().decode(await readAssetBuffer(response, ASSET_HEADER_TIMEOUT_MS, 60_000));
}

export async function readAssetJson(response: Response): Promise<unknown> {
  return JSON.parse(await readAssetText(response));
}
