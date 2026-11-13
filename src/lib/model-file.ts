import localforage from 'localforage';

/**
 * Downloads a model file once, checks it against its pinned SHA-256 and keeps
 * it in the browser (IndexedDB, through localForage) for the next visit. Only
 * the model file is fetched; no image data is sent anywhere.
 */
export interface PinnedModelFile {
  /** The file's parts, fetched in order and joined (each stays under GitHub's 50 MB warning). */
  parts: string[];
  /** Total size of the joined file, in bytes. */
  bytes: number;
  /** SHA-256 of the joined file, lower-case hex. */
  sha256: string;
}

export interface DownloadProgress {
  stage: 'downloading' | 'verifying';
  loadedBytes: number;
  totalBytes: number;
}

/** The cache entry of `file`: named by its hash, so a different file never reads an old one. */
function cacheKey(file: PinnedModelFile): string {
  return `image_suite_model_${file.sha256}`;
}

/** Lower-case hex SHA-256 of `bytes`. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The bytes of `file`, from the browser's cache or downloaded. Throws with a
 * message for the user when it cannot be downloaded or does not match its
 * hash. A cached copy is checked again, so a damaged cache is downloaded anew.
 */
export async function loadPinnedModel(
  file: PinnedModelFile,
  onProgress: (p: DownloadProgress) => void,
  fetchImpl: typeof fetch = fetch
): Promise<ArrayBuffer> {
  let cached: ArrayBuffer | null = null;
  try {
    cached = await localforage.getItem<ArrayBuffer>(cacheKey(file));
  } catch {
    // No IndexedDB here (a private window, some workers): download instead.
  }
  if (cached && cached.byteLength === file.bytes) {
    onProgress({ stage: 'verifying', loadedBytes: file.bytes, totalBytes: file.bytes });
    if ((await sha256Hex(cached)) === file.sha256) return cached;
  }

  const joined = new Uint8Array(file.bytes);
  let loaded = 0;
  onProgress({ stage: 'downloading', loadedBytes: 0, totalBytes: file.bytes });
  for (const url of file.parts) {
    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch (err) {
      throw new Error(`Could not download the background removal model (${err instanceof Error ? err.message : String(err)}). Check the connection and try again.`);
    }
    if (!response.ok) {
      throw new Error(`Could not download the background removal model: the server answered ${response.status} for ${url}.`);
    }
    const reader = response.body?.getReader();
    const append = (chunk: Uint8Array) => {
      if (loaded + chunk.length > file.bytes) throw new Error('The background removal model downloaded is larger than expected.');
      joined.set(chunk, loaded);
      loaded += chunk.length;
      onProgress({ stage: 'downloading', loadedBytes: loaded, totalBytes: file.bytes });
    };
    if (!reader) {
      append(new Uint8Array(await response.arrayBuffer()));
      continue;
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      append(value);
    }
  }
  if (loaded !== file.bytes) {
    throw new Error(`The background removal model download was incomplete (${loaded} of ${file.bytes} bytes).`);
  }
  onProgress({ stage: 'verifying', loadedBytes: loaded, totalBytes: file.bytes });
  const hash = await sha256Hex(joined.buffer);
  if (hash !== file.sha256) {
    throw new Error('The background removal model downloaded does not match its pinned checksum, so it was not used.');
  }
  try {
    await localforage.setItem(cacheKey(file), joined.buffer);
  } catch {
    // Out of storage: it works now and downloads again next time.
  }
  return joined.buffer;
}
