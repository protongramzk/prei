PRei Storage (P0)

"version" (https://img.shields.io/badge/version-0.1.0-black)
"status" (https://img.shields.io/badge/status-experimental-white)
"platform" (https://img.shields.io/badge/platform-browser-black)
"storage" (https://img.shields.io/badge/storage-IndexedDB-white)
"api" (https://img.shields.io/badge/API-S3--like-black)
"license" (https://img.shields.io/badge/license-MIT-white)

PRei Storage (P0) is an S3-like object storage system for the browser, powered by IndexedDB.

Built for:

- local-first applications
- offline-ready storage
- client-side encrypted objects
- experimenting with modern storage layers in the browser

---

Core Concept

User Call → API Layer → Middleware → Driver → Transform → Return

- API Layer → S3-like interface
- Middleware → encryption, transformation
- Driver → IndexedDB
- Transform → normalization / serialization

---

Features

- Bucket & Object system (S3-inspired)
- Supports Blob, ArrayBuffer, Uint8Array, and String
- Built-in encryption (AES-GCM via Web Crypto)
- Prefix-based listing
- Metadata support
- Object URL generation
- Structured error system

---

Installation

Copy src/prei.js then use directly as a module:

import { createStorage } from "./prei.js";

---

Quick Start

const p0 = await createStorage();

await p0.createBucket("files");

await p0.putObject({
  bucket: "files",
  key: "hello.txt",
  body: "Hello World"
});

const file = await p0.getObject("files", "hello.txt");
console.log(await file.body.text());

---

Bucket API

createBucket

await p0.createBucket("my-bucket");

listBuckets

const buckets = await p0.listBuckets();

deleteBucket

await p0.deleteBucket("my-bucket");

---

Object API

putObject

await p0.putObject({
  bucket: "files",
  key: "image.png",
  body: fileBlob,
  metadata: {
    contentType: "image/png"
  }
});

---

getObject

const obj = await p0.getObject("files", "image.png");

const blob = obj.body;

Access protected object:

await p0.getObject("files", "secret.txt", {
  password: "123"
});

---

headObject

Retrieve metadata without body:

const meta = await p0.headObject("files", "image.png");

---

deleteObject

await p0.deleteObject("files", "image.png");

---

listObjects

const list = await p0.listObjects("files", {
  prefix: "img/",
  limit: 50,
  offset: 0
});

---

copyObject

await p0.copyObject({
  from: { bucket: "files", key: "a.txt" },
  to: { bucket: "files", key: "b.txt" }
});

---

Encryption

protectObject

await p0.protectObject({
  bucket: "files",
  key: "secret.txt",
  password: "mypassword"
});

isProtected

const status = await p0.isProtected("files", "secret.txt");

---

Object URL

const url = await p0.getObjectURL("files", "image.png");

img.src = url;

---

Error Handling

All errors use the "P0Error" class:

try {
  await p0.getObject("files", "unknown.txt");
} catch (e) {
  if (e instanceof p0.P0Error) {
    console.log(e.code);
  }
}

Error Codes

- "NOT_FOUND"
- "PASSWORD_REQUIRED"
- "INVALID_PASSWORD"
- "BUCKET_NOT_FOUND"
- "BUCKET_ALREADY_EXISTS"
- "INVALID_INPUT"
- "DB_ERROR"

---

Supported Body Types

- Blob
- ArrayBuffer
- Uint8Array
- String

All inputs are automatically normalized into Blob internally.

---

Storage Schema

Buckets

p0_buckets
- name (PK)
- createdAt

Objects

p0_objects
- _id (bucket::key)
- bucket
- key
- body
- encryptedBody
- protected
- size
- metadata
- createdAt
- updatedAt

---

Encryption Details

- AES-GCM 256-bit
- PBKDF2 (100,000 iterations)
- Packed format:

[salt(16)] [iv(12)] [ciphertext]

---

Use Cases

- Local file manager (like the demo UI)
- Offline asset cache
- Secure local vault
- Progressive Web App storage
- Local CDN simulation

---

Limitations

- Limited by browser IndexedDB quota
- Not suitable for very large files (100MB+)
- No streaming support (in-memory processing)

---

Roadmap Ideas

- Middleware system
- Adapter layer (Memory / S3 / R2)
- Streaming support
- Multipart uploads
- Signed URL simulation

---

Philosophy

P0 does not aim to replace S3.

It brings the S3 mental model into:

- offline environments
- local-first architectures
- client-side applications

---

License

MIT
