/**
 * Dependency-free EPUB (ZIP) container parser.
 *
 * An EPUB is a ZIP archive with a fixed layout:
 *   - `mimetype`                 stored, contents "application/epub+zip"
 *   - `META-INF/container.xml`   names the OPF package document
 *
 * This module reads the ZIP central directory and decodes every entry so the
 * caller only ever has to hand it a Buffer. Deflate decoding is injected by the
 * caller, so this module imports no third-party package and needs no network
 * access.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

/** Error thrown by {@link openEpub}; `code` names the refusal, `message` names the file and the missing part. */
export class EpubError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "EpubError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new EpubError(code, message, options);
}

function u16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function u32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) return -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (u32(buffer, i) !== EOCD_SIGNATURE) continue;
    const commentLength = u16(buffer, i + 20);
    if (i + 22 + commentLength <= buffer.length) return i;
  }
  return -1;
}

function readLocalData(buffer, localHeaderOffset, compressedSize, name) {
  if (localHeaderOffset + 30 > buffer.length) {
    fail(
      "TRUNCATED_ARCHIVE",
      `truncated EPUB: local header for "${name}" extends past the end of the archive`,
    );
  }
  if (u32(buffer, localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    fail(
      "TRUNCATED_ARCHIVE",
      `truncated or corrupt EPUB: missing local file header for "${name}"`,
    );
  }
  const nameLength = u16(buffer, localHeaderOffset + 26);
  const extraLength = u16(buffer, localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > buffer.length) {
    fail(
      "TRUNCATED_ARCHIVE",
      `truncated EPUB: data for "${name}" extends past the end of the archive`,
    );
  }
  return buffer.subarray(dataStart, dataEnd);
}

function parsePackagePath(containerXml) {
  const match = /<rootfile[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i.exec(containerXml);
  return match ? match[1] : null;
}

/**
 * Open an EPUB container from a Buffer.
 *
 * @param {Buffer|Uint8Array} bytes  raw EPUB (ZIP) bytes.
 * @param {{ inflate?: (compressed: Uint8Array) => Uint8Array }} [options]
 *   `inflate` decodes raw deflate streams and is required for deflated entries.
 * @returns {{ entries: Array<{ name: string, bytes: Buffer, compression: "stored"|"deflated" }>, packagePath: string }}
 */
export function openEpub(bytes, { inflate } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) {
    fail(
      "TRUNCATED_ARCHIVE",
      "truncated or invalid EPUB: end-of-central-directory record not found",
    );
  }

  const entryCount = u16(buffer, eocd + 10);
  const centralSize = u32(buffer, eocd + 12);
  const centralOffset = u32(buffer, eocd + 16);

  if (centralOffset + centralSize > buffer.length) {
    fail("TRUNCATED_ARCHIVE", "truncated EPUB: central directory extends past the end of the archive");
  }

  const entries = [];
  let cursor = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > buffer.length) {
      fail("TRUNCATED_ARCHIVE", "truncated EPUB: central directory entry is incomplete");
    }
    if (u32(buffer, cursor) !== CENTRAL_DIR_SIGNATURE) {
      fail("TRUNCATED_ARCHIVE", "truncated or corrupt EPUB: bad central directory signature");
    }

    const flags = u16(buffer, cursor + 8);
    const method = u16(buffer, cursor + 10);
    const compressedSize = u32(buffer, cursor + 20);
    const nameLength = u16(buffer, cursor + 28);
    const extraLength = u16(buffer, cursor + 30);
    const commentLength = u16(buffer, cursor + 32);
    const localHeaderOffset = u32(buffer, cursor + 42);

    const entryHeaderSize = 46 + nameLength + extraLength + commentLength;
    if (cursor + entryHeaderSize > buffer.length) {
      fail("TRUNCATED_ARCHIVE", "truncated EPUB: central directory entry header is incomplete");
    }

    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if ((flags & 0x1) !== 0) {
      fail("ENCRYPTED_ENTRY", `encrypted entry "${name}" is not supported`);
    }

    const raw = readLocalData(buffer, localHeaderOffset, compressedSize, name);

    let bytes;
    let compression;
    if (method === 0) {
      compression = "stored";
      bytes = raw;
    } else if (method === 8) {
      compression = "deflated";
      if (typeof inflate !== "function") {
        fail("INFLATE_FAILED", `cannot inflate entry "${name}": no inflate function was provided`);
      }
      let inflated;
      try {
        inflated = inflate(raw);
      } catch (err) {
        fail(
          "INFLATE_FAILED",
          `failed to inflate entry "${name}": ${err && err.message ? err.message : String(err)}`,
          { cause: err },
        );
      }
      bytes = Buffer.from(inflated);
    } else {
      fail("UNSUPPORTED_COMPRESSION", `entry "${name}" uses unsupported ZIP compression method ${method}`);
    }

    entries.push({ name, bytes, compression });
    cursor += entryHeaderSize;
  }

  const container = entries.find((entry) => entry.name === "META-INF/container.xml");
  if (!container) {
    fail("MISSING_CONTAINER", "EPUB is missing META-INF/container.xml");
  }

  const packagePath = parsePackagePath(container.bytes.toString("utf8"));
  if (!packagePath) {
    fail("MISSING_PACKAGE_DOCUMENT", "META-INF/container.xml does not name a package document rootfile");
  }

  return { entries, packagePath };
}
