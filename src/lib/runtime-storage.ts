import path from "node:path";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";

const blobPathPrefix = "vercel-blob:";
const blobHostnameSuffix = ".blob.vercel-storage.com";

export type StorageErrorCode =
  | "STORAGE_NOT_CONFIGURED"
  | "STORAGE_AUTHENTICATION_FAILED"
  | "STORAGE_PROVIDER_FAILURE"
  | "STORED_OBJECT_MISSING"
  | "INVALID_STORAGE_PATH";

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StorageError";
  }
}

export type StoredEvidenceObject = {
  locator: string;
  provider: "vercel-blob" | "local-filesystem";
  size: number;
};

export type EvidenceObject = {
  stream: ReadableStream<Uint8Array>;
  contentType: string | null;
  size: number;
};

export type EvidenceStorage = {
  kind: "vercel-blob" | "local-filesystem";
  put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredEvidenceObject>;
  get(locator: string): Promise<EvidenceObject>;
  delete(locator: string): Promise<void>;
};

type BlobPutResult = { url: string };
type BlobGetResult =
  | {
      statusCode: 200;
      stream: ReadableStream<Uint8Array>;
      blob: { contentType: string; size: number };
    }
  | {
      statusCode: 304;
      stream: null;
      blob: { contentType: null; size: null };
    }
  | null;

type BlobClient = {
  put(
    pathname: string,
    body: Buffer,
    options: {
      access: "private";
      contentType: string;
      addRandomSuffix: false;
      allowOverwrite: false;
      cacheControlMaxAge: number;
      maximumSizeInBytes: number;
    },
  ): Promise<BlobPutResult>;
  get(url: string, options: { access: "private" }): Promise<BlobGetResult>;
  del(url: string): Promise<void>;
};

type StorageOptions = {
  env?: Partial<NodeJS.ProcessEnv>;
  localRoot?: string;
  blobClient?: BlobClient;
};

function runtimeRoot(env: Partial<NodeJS.ProcessEnv> = process.env) {
  return env.VERCEL ? path.join("/tmp", "sherlock") : process.cwd();
}

export function runtimeStorageDir(name: "uploads" | "backups") {
  return path.join(runtimeRoot(), name);
}

export function publicUploadPath(...parts: string[]) {
  return `/uploads/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

export function isBlobStoragePath(filePath: string) {
  return filePath.startsWith(blobPathPrefix);
}

export function createBlobStorageLocator(url: string) {
  return `${blobPathPrefix}${validateBlobUrl(url)}`;
}

export function blobPathnameFromLocator(locator: string) {
  const url = new URL(blobUrlFromStoragePath(locator));
  return url.pathname.replace(/^\//, "");
}

export function isPathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function blobConfiguration(
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  const hasReadWriteToken = Boolean(env.BLOB_READ_WRITE_TOKEN?.trim());
  const hasStoreId = Boolean(env.BLOB_STORE_ID?.trim());
  const hasExplicitOidcToken = Boolean(env.VERCEL_OIDC_TOKEN?.trim());
  const runsOnVercel = Boolean(env.VERCEL);
  const hasOidcConfiguration =
    hasStoreId && (hasExplicitOidcToken || runsOnVercel);

  return {
    configured: hasReadWriteToken || hasOidcConfiguration,
    method: hasReadWriteToken
      ? "read-write-token"
      : hasOidcConfiguration
        ? "oidc"
        : null,
    partial: !hasReadWriteToken && (hasStoreId || hasExplicitOidcToken),
  } as const;
}

export function createRuntimeEvidenceStorage(
  options: StorageOptions = {},
): EvidenceStorage {
  const env = options.env ?? process.env;
  const hosted = Boolean(env.VERCEL) || env.NODE_ENV === "production";
  const configuration = blobConfiguration(env);

  if (hosted) {
    if (!configuration.configured) {
      throw new StorageError(
        "STORAGE_NOT_CONFIGURED",
        configuration.partial
          ? "Vercel Blob credentials are incomplete. Configure BLOB_READ_WRITE_TOKEN, or connect an OIDC-enabled store that supplies BLOB_STORE_ID."
          : "Private Vercel Blob storage is not configured for this environment.",
      );
    }

    return createBlobStorage(options.blobClient);
  }

  if (configuration.configured) {
    return createBlobStorage(options.blobClient);
  }

  return createLocalStorage(
    options.localRoot ?? path.join(process.cwd(), "uploads"),
  );
}

export function createRuntimeEvidenceStorageForLocator(
  locator: string,
  options: StorageOptions = {},
) {
  if (isBlobStoragePath(locator)) return createRuntimeEvidenceStorage(options);

  const env = options.env ?? process.env;
  if (env.VERCEL || env.NODE_ENV === "production") {
    throw new StorageError(
      "STORED_OBJECT_MISSING",
      "This evidence record points to deployment-local storage that is unavailable in production.",
    );
  }

  return createLocalStorage(
    options.localRoot ?? path.join(process.cwd(), "uploads"),
  );
}

/**
 * Compatibility adapter for the investigation-import pipeline. New evidence
 * uploads use the EvidenceStorage interface directly so database rollback can
 * perform compensating cleanup.
 */
export async function storeUploadFile(
  parts: string[],
  body: Buffer,
  contentType = "application/octet-stream",
) {
  const storage = createRuntimeEvidenceStorage();
  const key = ["sherlock", "uploads", ...parts].join("/");
  const stored = await storage.put({ key, body, contentType });
  return {
    publicPath: publicUploadPath(...parts),
    filePath: stored.locator,
    fileSize: stored.size,
  };
}

export async function deleteStoredUploadFile(locator: string) {
  const storage = createRuntimeEvidenceStorageForLocator(locator);
  await storage.delete(locator);
}

function createBlobStorage(injectedClient?: BlobClient): EvidenceStorage {
  async function client(): Promise<BlobClient> {
    if (injectedClient) return injectedClient;
    const blob = await import("@vercel/blob");
    return { put: blob.put, get: blob.get, del: blob.del } as BlobClient;
  }

  return {
    kind: "vercel-blob",
    async put({ key, body, contentType }) {
      assertStorageKey(key);
      try {
        const result = await (
          await client()
        ).put(key, body, {
          access: "private",
          contentType,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          maximumSizeInBytes: body.byteLength,
        });
        return {
          locator: createBlobStorageLocator(result.url),
          provider: "vercel-blob",
          size: body.byteLength,
        };
      } catch (error) {
        throw mapBlobError(error);
      }
    },
    async get(locator) {
      const url = blobUrlFromStoragePath(locator);
      try {
        const result = await (await client()).get(url, { access: "private" });
        if (!result || result.statusCode !== 200) {
          throw new StorageError(
            "STORED_OBJECT_MISSING",
            "The stored evidence object does not exist.",
          );
        }
        return {
          stream: result.stream,
          contentType: result.blob.contentType,
          size: result.blob.size,
        };
      } catch (error) {
        if (error instanceof StorageError) throw error;
        throw mapBlobError(error);
      }
    },
    async delete(locator) {
      const url = blobUrlFromStoragePath(locator);
      try {
        await (await client()).del(url);
      } catch (error) {
        throw mapBlobError(error);
      }
    },
  };
}

function createLocalStorage(root: string): EvidenceStorage {
  const localRoot = path.resolve(root);

  return {
    kind: "local-filesystem",
    async put({ key, body }) {
      assertStorageKey(key);
      const filePath = path.resolve(localRoot, key);
      assertLocalPath(localRoot, filePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, body, { flag: "wx" });
      return {
        locator: filePath,
        provider: "local-filesystem",
        size: body.byteLength,
      };
    },
    async get(locator) {
      const filePath = localPathFromLocator(localRoot, locator);
      try {
        const metadata = await stat(filePath);
        if (!metadata.isFile()) {
          throw new StorageError(
            "STORED_OBJECT_MISSING",
            "The stored evidence object is not a file.",
          );
        }
        return {
          stream: Readable.toWeb(
            createReadStream(filePath),
          ) as ReadableStream<Uint8Array>,
          contentType: null,
          size: metadata.size,
        };
      } catch (error) {
        if (error instanceof StorageError) throw error;
        if (isNodeError(error) && error.code === "ENOENT") {
          throw new StorageError(
            "STORED_OBJECT_MISSING",
            "The stored evidence object does not exist.",
          );
        }
        throw new StorageError(
          "STORAGE_PROVIDER_FAILURE",
          "Local evidence storage could not be read.",
          { cause: error },
        );
      }
    },
    async delete(locator) {
      const filePath = localPathFromLocator(localRoot, locator);
      try {
        await unlink(filePath);
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return;
        throw new StorageError(
          "STORAGE_PROVIDER_FAILURE",
          "Local evidence storage could not be cleaned up.",
          { cause: error },
        );
      }
    },
  };
}

function assertStorageKey(key: string) {
  const normalised = path.posix.normalize(key);
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    normalised !== key ||
    normalised === ".." ||
    normalised.startsWith("../")
  ) {
    throw new StorageError(
      "INVALID_STORAGE_PATH",
      "The evidence storage key is invalid.",
    );
  }
}

function localPathFromLocator(root: string, locator: string) {
  const candidate = locator.startsWith("/uploads/")
    ? path.resolve(root, locator.slice("/uploads/".length))
    : path.resolve(locator);
  assertLocalPath(root, candidate);
  return candidate;
}

function assertLocalPath(root: string, candidate: string) {
  if (!isPathInside(root, candidate)) {
    throw new StorageError(
      "INVALID_STORAGE_PATH",
      "The evidence path is outside local upload storage.",
    );
  }
}

function blobUrlFromStoragePath(locator: string) {
  if (!isBlobStoragePath(locator)) {
    throw new StorageError(
      "INVALID_STORAGE_PATH",
      "The evidence record does not contain a Blob locator.",
    );
  }
  return validateBlobUrl(locator.slice(blobPathPrefix.length));
}

function validateBlobUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(blobHostnameSuffix))
      throw new Error("invalid host");
    return url.toString();
  } catch (error) {
    throw new StorageError(
      "INVALID_STORAGE_PATH",
      "The evidence record contains an invalid Blob URL.",
      { cause: error },
    );
  }
}

function mapBlobError(error: unknown) {
  const name =
    error instanceof Error
      ? error.name === "Error"
        ? error.constructor.name
        : error.name
      : "";
  const message = error instanceof Error ? error.message : "";

  if (name === "BlobNotFoundError") {
    return new StorageError(
      "STORED_OBJECT_MISSING",
      "The stored evidence object does not exist.",
      { cause: error },
    );
  }
  if (
    name === "BlobAccessError" ||
    /unauthori[sz]ed|forbidden|invalid.*token|access denied/i.test(message)
  ) {
    return new StorageError(
      "STORAGE_AUTHENTICATION_FAILED",
      "Vercel Blob rejected the configured storage credentials.",
      { cause: error },
    );
  }
  if (
    name === "BlobStoreNotFoundError" ||
    /no blob credentials|no read-write token|no storeId|store.*not found/i.test(
      message,
    )
  ) {
    return new StorageError(
      "STORAGE_NOT_CONFIGURED",
      "The configured Vercel Blob store is unavailable or incomplete.",
      { cause: error },
    );
  }
  return new StorageError(
    "STORAGE_PROVIDER_FAILURE",
    "Vercel Blob could not complete the storage operation.",
    { cause: error },
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
