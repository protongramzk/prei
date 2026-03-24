/**
 * prei.js — P0 (@prei/storage)
 * S3-compatible object storage for the browser, powered by IndexedDB.
 *
 * Architecture:
 *   User Call → API Layer → Middleware → Driver → Transform → Return
 */

// ─────────────────────────────────────────────
// CONSTANTS & ERROR CODES
// ─────────────────────────────────────────────

const ErrorCode = {
  NOT_FOUND: "NOT_FOUND",
  PASSWORD_REQUIRED: "PASSWORD_REQUIRED",
  INVALID_PASSWORD: "INVALID_PASSWORD",
  BUCKET_NOT_FOUND: "BUCKET_NOT_FOUND",
  BUCKET_ALREADY_EXISTS: "BUCKET_ALREADY_EXISTS",
  INVALID_INPUT: "INVALID_INPUT",
  DB_ERROR: "DB_ERROR",
};

const STORE_BUCKETS = "p0_buckets";
const STORE_OBJECTS = "p0_objects";

// ─────────────────────────────────────────────
// P0 ERROR
// ─────────────────────────────────────────────

class P0Error extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "P0Error";
    this.code = code;
  }
}

function err(code, msg) {
  throw new P0Error(code, msg);
}

// ─────────────────────────────────────────────
// DRIVER — IndexedDB abstraction
// ─────────────────────────────────────────────

function openDB(dbName, version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORE_BUCKETS)) {
        db.createObjectStore(STORE_BUCKETS, { keyPath: "name" });
      }

      if (!db.objectStoreNames.contains(STORE_OBJECTS)) {
        const store = db.createObjectStore(STORE_OBJECTS, { keyPath: "_id" });
        store.createIndex("by_bucket", "bucket", { unique: false });
        store.createIndex("by_bucket_key", ["bucket", "key"], { unique: true });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new P0Error(ErrorCode.DB_ERROR, req.error?.message));
  });
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);

    let result;

    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(new P0Error(ErrorCode.DB_ERROR, t.error?.message));
    t.onabort = () => reject(new P0Error(ErrorCode.DB_ERROR, "Transaction aborted"));

    try {
      result = fn(t);
    } catch (e) {
      reject(e);
    }
  });
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new P0Error(ErrorCode.DB_ERROR, req.error?.message));
  });
}

// ─────────────────────────────────────────────
// ENCRYPTION MIDDLEWARE
// Uses AES-GCM via Web Crypto API
// ─────────────────────────────────────────────

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptBody(body, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  // Normalize body to ArrayBuffer
  let buf;
  if (body instanceof Blob) {
    buf = await body.arrayBuffer();
  } else if (body instanceof ArrayBuffer) {
    buf = body;
  } else if (typeof body === "string") {
    buf = new TextEncoder().encode(body).buffer;
  } else {
    buf = body;
  }

  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf);

  // Pack: [salt(16)] [iv(12)] [ciphertext]
  const result = new Uint8Array(16 + 12 + encrypted.byteLength);
  result.set(salt, 0);
  result.set(iv, 16);
  result.set(new Uint8Array(encrypted), 28);
  return result.buffer;
}

async function decryptBody(encryptedBuffer, password) {
  const data = new Uint8Array(encryptedBuffer);
  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const ciphertext = data.slice(28);

  const key = await deriveKey(password, salt);
  try {
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    err(ErrorCode.INVALID_PASSWORD, "Decryption failed — wrong password.");
  }
}

// ─────────────────────────────────────────────
// NORMALIZE HELPERS
// ─────────────────────────────────────────────

function normalizeBody(body) {
  if (body instanceof Blob) return body;
  if (body instanceof ArrayBuffer) return new Blob([body]);
  if (typeof body === "string") return new Blob([body], { type: "text/plain" });
  if (body instanceof Uint8Array) return new Blob([body]);
  err(ErrorCode.INVALID_INPUT, "body must be Blob, ArrayBuffer, Uint8Array, or string.");
}

function validateBucketName(name) {
  if (!name || typeof name !== "string" || name.trim() === "") {
    err(ErrorCode.INVALID_INPUT, "Bucket name must be a non-empty string.");
  }
}

function validateKey(key) {
  if (!key || typeof key !== "string" || key.trim() === "") {
    err(ErrorCode.INVALID_INPUT, "Key must be a non-empty string.");
  }
}

function makeId(bucket, key) {
  return `${bucket}::${key}`;
}

// ─────────────────────────────────────────────
// createStorage — main factory
// ─────────────────────────────────────────────

export async function createStorage({ dbName = "p0_storage", version = 1 } = {}) {
  const db = await openDB(dbName, version);

  // ── internal driver helpers ─────────────────

  async function _bucketExists(name) {
    return tx(db, [STORE_BUCKETS], "readonly", (t) => {
      const store = t.objectStore(STORE_BUCKETS);
      return idbReq(store.get(name)).then((r) => !!r);
    });
  }

  async function _requireBucket(name) {
    if (!(await _bucketExists(name))) {
      err(ErrorCode.BUCKET_NOT_FOUND, `Bucket "${name}" does not exist.`);
    }
  }

  async function _getRecord(bucket, key) {
    return tx(db, [STORE_OBJECTS], "readonly", (t) => {
      const store = t.objectStore(STORE_OBJECTS);
      return idbReq(store.get(makeId(bucket, key)));
    });
  }

  async function _putRecord(record) {
    return tx(db, [STORE_OBJECTS], "readwrite", (t) => {
      const store = t.objectStore(STORE_OBJECTS);
      return idbReq(store.put(record));
    });
  }

  // ── Bucket Operations ───────────────────────

  async function createBucket(name) {
    validateBucketName(name);
    if (await _bucketExists(name)) {
      err(ErrorCode.BUCKET_ALREADY_EXISTS, `Bucket "${name}" already exists.`);
    }
    await tx(db, [STORE_BUCKETS], "readwrite", (t) => {
      const store = t.objectStore(STORE_BUCKETS);
      return idbReq(store.put({ name, createdAt: Date.now() }));
    });
    return { ok: true, bucket: name };
  }

  async function listBuckets() {
    return tx(db, [STORE_BUCKETS], "readonly", (t) => {
      const store = t.objectStore(STORE_BUCKETS);
      return idbReq(store.getAll());
    });
  }

  async function deleteBucket(name) {
    validateBucketName(name);
    await _requireBucket(name);

    // Delete all objects in bucket first
    await tx(db, [STORE_OBJECTS], "readwrite", (t) => {
      return new Promise((resolve, reject) => {
        const store = t.objectStore(STORE_OBJECTS);
        const index = store.index("by_bucket");
        const req = index.openCursor(IDBKeyRange.only(name));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(new P0Error(ErrorCode.DB_ERROR, req.error?.message));
      });
    });

    await tx(db, [STORE_BUCKETS], "readwrite", (t) => {
      const store = t.objectStore(STORE_BUCKETS);
      return idbReq(store.delete(name));
    });

    return { ok: true };
  }

  // ── Object Operations ───────────────────────

  async function putObject({ bucket, key, body, metadata = {} }) {
    validateBucketName(bucket);
    validateKey(key);
    await _requireBucket(bucket);

    const blob = normalizeBody(body);

    const record = {
      _id: makeId(bucket, key),
      bucket,
      key,
      body: blob,
      size: blob.size,
      protected: false,
      encryptedBody: null,
      metadata: {
        contentType: blob.type || "application/octet-stream",
        ...metadata,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await _putRecord(record);
    return { ok: true, bucket, key, size: record.size };
  }

  async function getObject(bucket, key, opts = {}) {
    validateBucketName(bucket);
    validateKey(key);

    const record = await _getRecord(bucket, key);

    if (!record) {
      if (opts.safe) return null;
      err(ErrorCode.NOT_FOUND, `Object "${key}" not found in bucket "${bucket}".`);
    }

    if (record.protected) {
      if (!opts.password) {
        err(ErrorCode.PASSWORD_REQUIRED, `Object "${key}" is protected. Provide a password.`);
      }
      const decrypted = await decryptBody(record.encryptedBody, opts.password);
      const blob = new Blob([decrypted], { type: record.metadata.contentType });
      return {
        bucket,
        key,
        body: blob,
        size: blob.size,
        metadata: record.metadata,
        protected: true,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    }

    return {
      bucket,
      key,
      body: record.body,
      size: record.size,
      metadata: record.metadata,
      protected: false,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async function headObject(bucket, key) {
    validateBucketName(bucket);
    validateKey(key);

    const record = await _getRecord(bucket, key);
    if (!record) err(ErrorCode.NOT_FOUND, `Object "${key}" not found in bucket "${bucket}".`);

    // Return metadata only — no body
    const { body: _body, encryptedBody: _enc, ...meta } = record;
    return meta;
  }

  async function deleteObject(bucket, key) {
    validateBucketName(bucket);
    validateKey(key);
    await _requireBucket(bucket);

    await tx(db, [STORE_OBJECTS], "readwrite", (t) => {
      const store = t.objectStore(STORE_OBJECTS);
      return idbReq(store.delete(makeId(bucket, key)));
    });

    return { ok: true };
  }

  async function listObjects(bucket, { prefix = "", limit = 100, offset = 0 } = {}) {
    validateBucketName(bucket);
    await _requireBucket(bucket);

    return tx(db, [STORE_OBJECTS], "readonly", (t) => {
      return new Promise((resolve, reject) => {
        const store = t.objectStore(STORE_OBJECTS);
        const index = store.index("by_bucket");
        const results = [];
        let skipped = 0;

        const req = index.openCursor(IDBKeyRange.only(bucket));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor || results.length >= limit) {
            resolve(results);
            return;
          }
          const record = cursor.value;
          if (!prefix || record.key.startsWith(prefix)) {
            if (skipped < offset) {
              skipped++;
            } else {
              results.push({
                key: record.key,
                size: record.size,
                protected: record.protected,
                metadata: record.metadata,
                updatedAt: record.updatedAt,
              });
            }
          }
          cursor.continue();
        };
        req.onerror = () => reject(new P0Error(ErrorCode.DB_ERROR, req.error?.message));
      });
    });
  }

  async function copyObject({ from, to }) {
    if (!from?.bucket || !from?.key) err(ErrorCode.INVALID_INPUT, "`from` must have bucket and key.");
    if (!to?.bucket || !to?.key) err(ErrorCode.INVALID_INPUT, "`to` must have bucket and key.");

    await _requireBucket(from.bucket);
    await _requireBucket(to.bucket);

    const source = await _getRecord(from.bucket, from.key);
    if (!source) err(ErrorCode.NOT_FOUND, `Source object "${from.key}" not found.`);

    const copy = {
      ...source,
      _id: makeId(to.bucket, to.key),
      bucket: to.bucket,
      key: to.key,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await _putRecord(copy);
    return { ok: true, from, to };
  }

  // ── Encryption ──────────────────────────────

  async function protectObject({ bucket, key, password }) {
    validateBucketName(bucket);
    validateKey(key);
    if (!password) err(ErrorCode.INVALID_INPUT, "Password is required for protectObject.");

    const record = await _getRecord(bucket, key);
    if (!record) err(ErrorCode.NOT_FOUND, `Object "${key}" not found in bucket "${bucket}".`);

    if (record.protected) {
      err(ErrorCode.INVALID_INPUT, "Object is already protected. Unprotect first to re-encrypt.");
    }

    const encrypted = await encryptBody(record.body, password);

    const updated = {
      ...record,
      body: null,
      encryptedBody: encrypted,
      protected: true,
      updatedAt: Date.now(),
    };

    await _putRecord(updated);
    return { ok: true };
  }

  async function isProtected(bucket, key) {
    validateBucketName(bucket);
    validateKey(key);

    const record = await _getRecord(bucket, key);
    if (!record) err(ErrorCode.NOT_FOUND, `Object "${key}" not found in bucket "${bucket}".`);
    return record.protected === true;
  }

  // ── URL Helper ──────────────────────────────

  async function getObjectURL(bucket, key, opts = {}) {
    const obj = await getObject(bucket, key, opts);
    return URL.createObjectURL(obj.body);
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  return {
    // Bucket
    createBucket,
    listBuckets,
    deleteBucket,

    // Object CRUD
    putObject,
    getObject,
    headObject,
    deleteObject,
    listObjects,
    copyObject,

    // Encryption
    protectObject,
    isProtected,

    // URL
    getObjectURL,

    // Errors (exported for instanceof checks)
    P0Error,
    ErrorCode,
  };
}
