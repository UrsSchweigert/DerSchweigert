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
 *
 * `parsePackage` additionally reads the OPF package document (metadata,
 * manifest and spine) and returns the content documents in reading order.
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

/** Directory part of a `/`-separated ZIP path, or "" at the root. */
function dirname(path) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

/** Join a base directory and a relative path with a single `/`. */
function joinPath(base, rel) {
  return base ? `${base}/${rel}` : rel;
}

/** Collapse `.` and `..` segments in a `/`-separated path. */
function normalizePath(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/** Strip a URL fragment and percent-decode a manifest or navigation href. */
function decodeHref(href) {
  let value = String(href);
  const hash = value.indexOf("#");
  if (hash >= 0) value = value.slice(0, hash);
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the literal value when it is not valid percent-encoding.
  }
  return value;
}

const NAMED_ENTITIES = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };

/** Decode the common XML character references in a single pass. */
function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name) => {
    if (name[0] === "#") {
      const hex = name[1] === "x" || name[1] === "X";
      const code = parseInt(hex ? name.slice(2) : name.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole;
  });
}

/** Strip markup and collapse whitespace in an element's text content. */
function cleanText(text) {
  return decodeEntities(String(text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

/** Read one attribute value from a single XML element string. */
function getAttr(element, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = re.exec(element);
  return match ? match[1] : null;
}

/** Text of the first `<prefix:name>…</prefix:name>` element. */
function findElementText(xml, name) {
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>`,
    "i",
  );
  const match = re.exec(xml);
  return match ? cleanText(match[1]) : "";
}

/** First h1–h3 heading text in a document, or "" when it has none. */
function firstHeading(xhtml) {
  const match = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/i.exec(xhtml);
  return match ? cleanText(match[1]) : "";
}

/** The `<nav epub:type="toc">` block, or the whole document as a fallback. */
function tocNavBlock(navXhtml) {
  const match = /<nav\b[^>]*\bepub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav\s*>/i.exec(navXhtml);
  return match ? match[1] : navXhtml;
}

function parseManifest(xml) {
  const manifest = new Map();
  const re = /<item\b[^>]*>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const element = match[0];
    const id = getAttr(element, "id");
    const href = getAttr(element, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      mediaType: getAttr(element, "media-type") || "",
      properties: getAttr(element, "properties") || "",
    });
  }
  return manifest;
}

function parseSpine(xml) {
  const spine = [];
  const re = /<itemref\b[^>]*>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const element = match[0];
    const idref = getAttr(element, "idref");
    if (!idref) continue;
    spine.push({ idref, linear: (getAttr(element, "linear") || "yes").toLowerCase() });
  }
  return spine;
}

function buildNcxTitles(byName, packageDir, manifest) {
  const titles = new Map();
  let ncxHref = null;
  for (const item of manifest.values()) {
    if (item.mediaType.toLowerCase() === "application/x-dtbncx+xml") {
      ncxHref = item.href;
      break;
    }
  }
  if (!ncxHref) return titles;

  const ncxPath = normalizePath(joinPath(packageDir, decodeHref(ncxHref)));
  const ncxEntry = byName.get(ncxPath);
  if (!ncxEntry) return titles;

  const xml = ncxEntry.bytes.toString("utf8");
  const ncxDir = dirname(ncxPath);
  const re = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint\s*>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const body = match[1];
    const contentTag = /<content\b[^>]*>/i.exec(body);
    if (!contentTag) continue;
    const src = getAttr(contentTag[0], "src");
    if (!src) continue;
    const label = /<navLabel\b[^>]*>[\s\S]*?<text\b[^>]*>([\s\S]*?)<\/text\s*>/i.exec(body);
    const title = label ? cleanText(label[1]) : "";
    if (!title) continue;
    const path = normalizePath(joinPath(ncxDir, decodeHref(src)));
    if (!titles.has(path)) titles.set(path, title);
  }
  return titles;
}

function buildNavTitles(byName, packageDir, manifest) {
  const titles = new Map();
  let navHref = null;
  for (const item of manifest.values()) {
    if (item.properties.toLowerCase().split(/\s+/).includes("nav")) {
      navHref = item.href;
      break;
    }
  }
  if (!navHref) return titles;

  const navPath = normalizePath(joinPath(packageDir, decodeHref(navHref)));
  const navEntry = byName.get(navPath);
  if (!navEntry) return titles;

  const html = navEntry.bytes.toString("utf8");
  const navDir = dirname(navPath);
  const block = tocNavBlock(html);
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = re.exec(block))) {
    const title = cleanText(match[2]);
    if (!title) continue;
    const path = normalizePath(joinPath(navDir, decodeHref(match[1])));
    if (!titles.has(path)) titles.set(path, title);
  }
  return titles;
}

/**
 * Parse an EPUB package document into metadata and reading-order documents.
 *
 * @param {Buffer|Uint8Array} bytes  raw EPUB (ZIP) bytes.
 * @param {{ inflate?: (compressed: Uint8Array) => Uint8Array }} [options]
 * @returns {{ metadata: {title: string, language: string, creator: string, date: string}, documents: Array<{path: string, title: string, xhtml: string}> }}
 */
export function parsePackage(bytes, { inflate } = {}) {
  const { entries, packagePath } = openEpub(bytes, { inflate });
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  const packageEntry = byName.get(packagePath);
  if (!packageEntry) {
    fail("MISSING_PACKAGE_DOCUMENT", `package document "${packagePath}" named by the container is missing from the archive`);
  }

  const packageDir = dirname(packagePath);
  const xml = packageEntry.bytes.toString("utf8");

  const metadata = {
    title: findElementText(xml, "title"),
    language: findElementText(xml, "language"),
    creator: findElementText(xml, "creator"),
    date: findElementText(xml, "date"),
  };

  const manifest = parseManifest(xml);
  if (manifest.size === 0) {
    fail("EMPTY_MANIFEST", `package document "${packagePath}" has an empty manifest`);
  }

  const navTitles = buildNavTitles(byName, packageDir, manifest);
  const ncxTitles = buildNcxTitles(byName, packageDir, manifest);

  const documents = [];
  for (const ref of parseSpine(xml)) {
    const item = manifest.get(ref.idref);
    if (!item) {
      fail("SPINE_ITEM_NOT_IN_MANIFEST", `spine item "${ref.idref}" is not listed in the manifest`);
    }
    if (ref.linear === "no") continue;

    const path = normalizePath(joinPath(packageDir, decodeHref(item.href)));
    const entry = byName.get(path);
    const xhtml = entry ? entry.bytes.toString("utf8") : "";

    let title = navTitles.get(path) ?? ncxTitles.get(path);
    if (!title) title = firstHeading(xhtml);
    if (!title) title = String(documents.length + 1);

    documents.push({ path, title, xhtml });
  }

  if (documents.length === 0) {
    fail("NO_LINEAR_DOCUMENTS", `package document "${packagePath}" has no linear reading-order documents`);
  }

  return { metadata, documents };
}
