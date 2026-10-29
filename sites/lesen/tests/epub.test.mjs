import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { openEpub, EpubError } from "../tools/epub.mjs";

// The committed sources are the fixtures. de-heinzelmaennchen is EPUB 3 and
// en-peter-rabbit is EPUB 2; every malformed variant below is derived from
// those same bytes inside this test, so no extra binary fixtures are needed.
const epub3Bytes = readFileSync(new URL("../books-src/de-heinzelmaennchen.epub", import.meta.url));
const epub2Bytes = readFileSync(new URL("../books-src/en-peter-rabbit.epub", import.meta.url));

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;

function findEocdOffset(buffer) {
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(i + 20);
    if (i + 22 + commentLength <= buffer.length) return i;
  }
  return -1;
}

/** Set the encryption bit (general purpose bit 0) on one central-directory entry. */
function setEncryptionFlag(buffer, targetName) {
  const out = Buffer.from(buffer);
  const eocd = findEocdOffset(out);
  assert.ok(eocd >= 0, "fixture must contain an end-of-central-directory record");
  const count = out.readUInt16LE(eocd + 10);
  const centralOffset = out.readUInt32LE(eocd + 16);
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    assert.strictEqual(out.readUInt32LE(cursor), CENTRAL_DIR_SIGNATURE, "bad central directory signature in fixture");
    const nameLength = out.readUInt16LE(cursor + 28);
    const extraLength = out.readUInt16LE(cursor + 30);
    const commentLength = out.readUInt16LE(cursor + 32);
    const name = out.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === targetName) {
      out.writeUInt16LE(out.readUInt16LE(cursor + 8) | 0x1, cursor + 8);
      return out;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`fixture entry not found: ${targetName}`);
}

/** Replace every equal-length occurrence of `from` with `to` in the buffer. */
function renameBytes(buffer, from, to) {
  const fromBuf = Buffer.from(from, "utf8");
  const toBuf = Buffer.from(to, "utf8");
  assert.strictEqual(fromBuf.length, toBuf.length, "rename must keep the byte length");
  const out = Buffer.from(buffer);
  let hits = 0;
  let idx = 0;
  while ((idx = out.indexOf(fromBuf, idx)) !== -1) {
    toBuf.copy(out, idx);
    idx += fromBuf.length;
    hits += 1;
  }
  assert.ok(hits > 0, `"${from}" not found in fixture`);
  return out;
}

function open(bookBytes, inflate = inflateRawSync) {
  return openEpub(bookBytes, { inflate });
}

test("EPUB 3: de-heinzelmaennchen opens through the central directory", () => {
  const { entries, packagePath } = open(epub3Bytes);

  assert.strictEqual(packagePath, "OPS/content.opf");
  assert.ok(entries.length > 0);

  const mimetype = entries.find((entry) => entry.name === "mimetype");
  assert.ok(mimetype);
  assert.strictEqual(mimetype.compression, "stored");
  assert.deepStrictEqual(mimetype.bytes, Buffer.from("application/epub+zip"));

  const content = entries.find((entry) => entry.name === "OPS/content.opf");
  assert.ok(content);
  assert.strictEqual(content.compression, "deflated");
  assert.ok(content.bytes.toString("utf8").includes('version="3.0"'));

  for (const entry of entries) {
    assert.strictEqual(typeof entry.name, "string");
    assert.ok(Buffer.isBuffer(entry.bytes));
    assert.ok(entry.compression === "stored" || entry.compression === "deflated");
  }
});

test("EPUB 2: en-peter-rabbit opens through the central directory", () => {
  const { entries, packagePath } = open(epub2Bytes);

  assert.strictEqual(packagePath, "OEBPS/content.opf");

  // The Project Gutenberg cover is a stored (uncompressed) entry.
  const cover = entries.find((entry) => entry.name === "OEBPS/2102215158318067684_cover.jpg");
  assert.ok(cover);
  assert.strictEqual(cover.compression, "stored");
  assert.strictEqual(cover.bytes.length, 57651);

  const content = entries.find((entry) => entry.name === "OEBPS/content.opf");
  assert.ok(content);
  assert.strictEqual(content.compression, "deflated");
  assert.ok(content.bytes.toString("utf8").includes('version="2.0"'));
});

test("deflated entries decode through the injected inflate for both layouts", () => {
  for (const bytes of [epub2Bytes, epub3Bytes]) {
    const { entries } = open(bytes);

    const container = entries.find((entry) => entry.name === "META-INF/container.xml");
    assert.ok(container, "container.xml must be present");
    assert.strictEqual(container.compression, "deflated");
    assert.ok(container.bytes.toString("utf8").includes("rootfile"));
    assert.ok(container.bytes.toString("utf8").includes("full-path"));
  }
});

test("an inflate that throws surfaces as a named EpubError naming the entry", () => {
  assert.throws(
    () => openEpub(epub2Bytes, { inflate: () => { throw new Error("boom"); } }),
    (err) => {
      assert.ok(err instanceof EpubError);
      assert.strictEqual(err.code, "INFLATE_FAILED");
      assert.ok(err.message.includes("META-INF/container.xml"), err.message);
      assert.ok(err.message.includes("boom"), err.message);
      return true;
    },
  );
});

test("encrypted entries are refused with a named error", () => {
  const encrypted = setEncryptionFlag(epub2Bytes, "mimetype");
  assert.throws(
    () => open(encrypted),
    (err) => {
      assert.ok(err instanceof EpubError);
      assert.strictEqual(err.code, "ENCRYPTED_ENTRY");
      assert.ok(err.message.includes("mimetype"), err.message);
      return true;
    },
  );
});

test("truncated archives are refused with a named error", () => {
  const truncated = Buffer.from(epub2Bytes.subarray(0, epub2Bytes.length - 128));
  assert.throws(
    () => open(truncated),
    (err) => {
      assert.ok(err instanceof EpubError);
      assert.strictEqual(err.code, "TRUNCATED_ARCHIVE");
      assert.ok(err.message.includes("end-of-central-directory"), err.message);
      return true;
    },
  );
});

test("a missing container.xml is refused with a named error", () => {
  const renamed = renameBytes(epub3Bytes, "META-INF/container.xml", "META-INF/containrr.xml");
  assert.throws(
    () => open(renamed),
    (err) => {
      assert.ok(err instanceof EpubError);
      assert.strictEqual(err.code, "MISSING_CONTAINER");
      assert.ok(err.message.includes("META-INF/container.xml"), err.message);
      return true;
    },
  );
});
