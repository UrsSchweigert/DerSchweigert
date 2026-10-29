import test from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { openEpub, parsePackage, EpubError } from "../tools/epub.mjs";

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

// --- parsePackage --------------------------------------------------------

/** Build a minimal stored-entry EPUB ZIP from a name→content map. */
function buildEpubZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(String(entry.content), "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0, 14); // crc32 is not validated by openEpub
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralStart = offset;
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);

  return Buffer.concat([...parts, ...central, eocd]);
}

function containerXml(fullPath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${fullPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
}

function opfXml(metadata, manifest, spine) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>${metadata}</metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`;
}

const minimalMetadata =
  "<dc:title>Minimal Book</dc:title>" +
  "<dc:language>en</dc:language>" +
  "<dc:creator>Some Author</dc:creator>" +
  "<dc:date>2026</dc:date>";

function parse(bytes) {
  return parsePackage(bytes, { inflate: inflateRawSync });
}

test("parsePackage reads EPUB 3 metadata and the spine in reading order", () => {
  const { metadata, documents } = parse(epub3Bytes);

  assert.deepStrictEqual(metadata, {
    title: "Die Heinzelmännchen",
    language: "de",
    creator: "August Kopisch",
    date: "1836",
  });

  assert.deepStrictEqual(
    documents.map((doc) => doc.path),
    [
      "OPS/title.xhtml",
      "OPS/c0_Die_Heinzelmannchen.xhtml",
      "OPS/about.xhtml",
    ],
  );
  assert.deepStrictEqual(
    documents.map((doc) => doc.title),
    ["Titelseite", "Die Heinzelmännchen", "Über"],
  );
  for (const doc of documents) {
    assert.strictEqual(typeof doc.xhtml, "string");
    assert.ok(doc.xhtml.length > 0, `${doc.path} must have xhtml content`);
  }
});

test("parsePackage reads EPUB 2 metadata and titles from the NCX", () => {
  const { metadata, documents } = parse(epub2Bytes);

  assert.deepStrictEqual(metadata, {
    title: "The Tale of Peter Rabbit",
    language: "en",
    creator: "Beatrix Potter",
    date: "2005-01-30",
  });

  assert.deepStrictEqual(
    documents.map((doc) => doc.path),
    [
      "OEBPS/wrap0000.html",
      "OEBPS/2097363003753100689_14838-h-0.htm.html",
    ],
  );
  // The cover wrapper has no NCX entry and no heading, so it falls back to position.
  assert.strictEqual(documents[0].title, "1");
  // The body chunk is named by the first NCX navPoint.
  assert.strictEqual(documents[1].title, "THE TALE OF PETER RABBIT");
});

test("all sixteen committed books yield ordered documents and a matching language", () => {
  const booksDir = new URL("../books-src/", import.meta.url);
  const files = readdirSync(booksDir).filter((name) => name.endsWith(".epub"));
  assert.strictEqual(files.length, 16, "the committed library must contain sixteen books");

  for (const file of files) {
    const prefix = file.startsWith("de-") ? "de" : file.startsWith("en-") ? "en" : null;
    assert.ok(prefix, `${file} must use a de- or en- id prefix`);

    const bytes = readFileSync(new URL(file, booksDir));
    const { metadata, documents } = parsePackage(bytes, { inflate: inflateRawSync });

    assert.strictEqual(metadata.language, prefix, `${file} language must match its id prefix`);
    assert.ok(documents.length > 0, `${file} must yield at least one document`);
    for (const doc of documents) {
      assert.strictEqual(typeof doc.path, "string");
      assert.strictEqual(typeof doc.title, "string");
      assert.strictEqual(typeof doc.xhtml, "string");
    }
  }
});

test("parsePackage yields titles from the EPUB 3 nav document", () => {
  // de-fuenfzig-fabeln is EPUB 3 with a nav document and no NCX.
  const bytes = readFileSync(new URL("../books-src/de-fuenfzig-fabeln.epub", import.meta.url));
  const { documents } = parsePackage(bytes, { inflate: inflateRawSync });

  const fable = documents.find((doc) => doc.path === "OEBPS/f001.xhtml");
  assert.ok(fable, "the first fable must be present");
  assert.strictEqual(fable.title, "Rabe");
  const other = documents.find((doc) => doc.path === "OEBPS/f004.xhtml");
  assert.ok(other, "the fourth fable must be present");
  assert.strictEqual(other.title, "Vögel vor der Scheuer");
});

test("parsePackage skips spine items marked linear=\"no\"", () => {
  const opf = opfXml(
    minimalMetadata,
    '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>',
    '<itemref idref="a" linear="yes"/><itemref idref="b" linear="no"/>',
  );
  const bytes = buildEpubZip([
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: containerXml("OPS/content.opf") },
    { name: "OPS/content.opf", content: opf },
    { name: "OPS/a.xhtml", content: "<html><body><h1>Alpha</h1></body></html>" },
    { name: "OPS/b.xhtml", content: "<html><body><h1>Beta</h1></body></html>" },
  ]);

  const { documents } = parse(bytes);
  assert.deepStrictEqual(documents.map((doc) => doc.path), ["OPS/a.xhtml"]);
});

test("parsePackage falls back to the first heading, then to position", () => {
  const opf = opfXml(
    minimalMetadata,
    '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>',
    '<itemref idref="a" linear="yes"/><itemref idref="b" linear="yes"/>',
  );
  const bytes = buildEpubZip([
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: containerXml("OPS/content.opf") },
    { name: "OPS/content.opf", content: opf },
    { name: "OPS/a.xhtml", content: "<html><body><h2>First Heading</h2></body></html>" },
    { name: "OPS/b.xhtml", content: "<html><body><p>no heading here</p></body></html>" },
  ]);

  const { documents } = parse(bytes);
  assert.strictEqual(documents[0].title, "First Heading");
  assert.strictEqual(documents[1].title, "2");
});

test("a missing package document is refused with a named error", () => {
  const bytes = buildEpubZip([
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: containerXml("OPS/missing.opf") },
    { name: "OPS/content.opf", content: opfXml(minimalMetadata, "", "") },
  ]);
  assert.throws(
    () => parse(bytes),
    (err) => {
      assert.ok(err instanceof EpubError);
      assert.strictEqual(err.code, "MISSING_PACKAGE_DOCUMENT");
      assert.ok(err.message.includes("OPS/missing.opf"), err.message);
      return true;
    },
  );
});

test("an empty manifest is refused with a named error", () => {
  const bytes = buildEpubZip([
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: containerXml("OPS/content.opf") },
    { name: "OPS/content.opf", content: opfXml(minimalMetadata, "", "") },
  ]);
  assert.throws(
    () => parse(bytes),
    (err) => {
      assert.ok(err instanceof EpubError);
      assert.strictEqual(err.code, "EMPTY_MANIFEST");
      return true;
    },
  );
});

test("a spine item outside the manifest is refused with a named error", () => {
  const bytes = buildEpubZip([
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: containerXml("OPS/content.opf") },
    {
      name: "OPS/content.opf",
      content: opfXml(
        minimalMetadata,
        '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>',
        '<itemref idref="a" linear="yes"/><itemref idref="missing" linear="yes"/>',
      ),
    },
    { name: "OPS/a.xhtml", content: "<html><body><h1>Alpha</h1></body></html>" },
  ]);
  assert.throws(
    () => parse(bytes),
    (err) => {
      assert.ok(err instanceof EpubError);
      assert.strictEqual(err.code, "SPINE_ITEM_NOT_IN_MANIFEST");
      assert.ok(err.message.includes("missing"), err.message);
      return true;
    },
  );
});

test("a package with zero linear documents is refused with a named error", () => {
  const bytes = buildEpubZip([
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: containerXml("OPS/content.opf") },
    {
      name: "OPS/content.opf",
      content: opfXml(
        minimalMetadata,
        '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>',
        '<itemref idref="a" linear="no"/>',
      ),
    },
    { name: "OPS/a.xhtml", content: "<html><body><h1>Alpha</h1></body></html>" },
  ]);
  assert.throws(
    () => parse(bytes),
    (err) => {
      assert.ok(err instanceof EpubError);
      assert.strictEqual(err.code, "NO_LINEAR_DOCUMENTS");
      return true;
    },
  );
});
