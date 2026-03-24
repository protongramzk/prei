# 📦 PRei Storage (P0)

![version](https://img.shields.io/badge/version-0.1.0-black)
![status](https://img.shields.io/badge/status-experimental-white)
![platform](https://img.shields.io/badge/platform-browser-black)
![storage](https://img.shields.io/badge/storage-IndexedDB-white)
![api](https://img.shields.io/badge/API-S3--like-black)
![license](https://img.shields.io/badge/license-MIT-white)

**PRei Storage (P0)** is an S3-inspired object storage system built for the browser, powered by **IndexedDB**. It brings a familiar cloud storage mental model to local-first and offline-ready applications.

### 🎯 Built For
* **Local-First Applications**: Prioritize client-side data ownership.
* **Offline Resilience**: Seamless storage without an active internet connection.
* **Secure Objects**: Native client-side encryption for sensitive data.
* **Modern Experimentation**: Exploring efficient storage layers within browser constraints.

---

## 🛠️ Core Concept
P0 follows a modular pipeline to ensure high performance and low overhead:
> **User Call** → **API Layer** → **Middleware** → **Driver** → **Transform** → **Return**

* **API Layer**: Provides the S3-like interface.
* **Middleware**: Handles encryption and transformations.
* **Driver**: Manages the underlying IndexedDB connection.
* **Transform**: Performs data normalization and serialization.

---

## ✨ Features
* **Bucket & Object System**: Familiar S3-style hierarchy (Buckets and Keys).
* **Multi-Format Support**: Works with `Blob`, `ArrayBuffer`, `Uint8Array`, and `String`.
* **Built-in Security**: AES-GCM encryption via the Web Crypto API.
* **Advanced Listing**: Supports prefix-based object discovery.
* **Smart Utilities**: Metadata support and Object URL generation for UI elements.
* **Structured Errors**: Consistent error handling using the custom `P0Error` class.

---

## 🚀 Installation & Usage

### Setup
Copy `src/prei.js` into your project and import it directly as a module:

```javascript
import { createStorage } from "./prei.js";

Quick Start
Initialize the storage and perform basic CRUD operations:
const p0 = await createStorage();

// Create a bucket
await p0.createBucket("files");

// Upload an object
await p0.putObject({
  bucket: "files",
  key: "hello.txt",
  body: "Hello World"
});

// Retrieve an object
const file = await p0.getObject("files", "hello.txt");
console.log(await file.body.text());

📖 API Reference
Bucket API
 * createBucket(name): Initializes a new storage container.
 * listBuckets(): Returns a list of all available buckets.
 * deleteBucket(name): Permanently removes a bucket and its contents.
Object API
 * putObject({ bucket, key, body, metadata }): Stores data; all inputs are automatically normalized to Blobs.
 * getObject(bucket, key, options): Fetches an object. Pass { password: "..." } for protected items.
 * headObject(bucket, key): Retrieves metadata without the overhead of the body.
 * listObjects(bucket, { prefix, limit, offset }): Lists objects with pagination/prefix support.
 * copyObject({ from, to }): Duplicates objects within or across buckets.
 * getObjectURL(bucket, key): Generates a temporary URL for browser rendering (e.g., img src).
🔒 Security Specifications
P0 utilizes industry-standard security protocols:
 * Algorithm: AES-GCM 256-bit.
 * Key Derivation: PBKDF2 with 100,000 iterations.
 * Packed Format: [salt(16 bytes)] [iv(12 bytes)] [ciphertext].
⚠️ Limitations
 * Subject to browser-specific IndexedDB storage quotas.
 * Not optimized for very large files (>100MB) due to in-memory processing.
 * Native streaming support is currently not available.
📜 License
Licensed under the MIT License.

