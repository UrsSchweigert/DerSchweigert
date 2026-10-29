import test from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import {
  openEpub,
  parsePackage,
  extractBlocks,
  splitSentences,
  normalizeText,
  EpubError,
} from "../tools/epub.mjs";

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

// --- extractBlocks / splitSentences / normalizeText -----------------------

const struwwelpeterBytes = readFileSync(new URL("../books-src/de-struwwelpeter.epub", import.meta.url));

const SAMPLE_STORY_HEADING = "Die Geschichte vom bösen Friederich";
const SAMPLE_STORY_LINES = [
  "Der Friederich, der Friederich",
  "das war ein arger Wüterich!",
  "Er fing die Fliegen in dem Haus",
  "und riß ihnen die Flügel aus.",
  "Er schlug die Stühl und Vögel tot,",
  "die Katzen litten große Not.",
  "Und höre nur, wie bös er war:",
  "Er peitschte seine Gretchen gar!",
  "Am Brunnen stand ein großer Hund,",
  "trank Wasser dort mit seinem Mund.",
  "Da mit der Peitsch herzu sich schlich",
  "der bitterböse Friederich;",
  "und schlug den Hund, der heulte sehr,",
  "und trat und schlug ihn immer mehr.",
  "Da biß der Hund ihn in das Bein,",
  "recht tief bis in das Blut hinein.",
  "Der bitterböse Friederich,",
  "der schrie und weinte bitterlich.",
  "Jedoch nach Hause lief der Hund",
  "und trug die Peitsche in dem Mund.",
  "Ins Bett muß Friedrich nun hinein,",
  "litt vielen Schmerz an seinem Bein;",
  "und der Herr Doktor sitzt dabei",
  "und gibt ihm bittre Arzenei.",
  "Der Hund an Friedrichs Tischchen saß,",
  "wo er den großen Kuchen aß;",
  "aß auch die gute Leberwurst",
  "und trank den Wein für seinen Durst.",
  "Die Peitsche hat er mitgebracht",
  "und nimmt sie sorglich sehr in acht.",
];

function assertWordsInOrder(actualText, expectedWords) {
  const actual = actualText.trim().split(/\s+/);
  let cursor = 0;
  for (const word of expectedWords) {
    while (cursor < actual.length && actual[cursor] !== word) cursor++;
    assert.ok(cursor < actual.length, `word "${word}" not found in order`);
    cursor++;
  }
}

test("normalizeText decodes entities and collapses whitespace without dropping a letter", () => {
  assert.strictEqual(normalizeText("Th&uuml;r und bey"), "Thür und bey");
  assert.strictEqual(normalizeText("&amp;&lt;&gt;&quot;&apos;"), '&<>"\'');
  assert.strictEqual(normalizeText("&#252; &#xE4;"), "ü ä");
  assert.strictEqual(normalizeText("a&nbsp;b"), "a b");
  assert.strictEqual(normalizeText("Wort&shy;bruch"), "Wortbruch");
  assert.strictEqual(normalizeText("a\u200bb"), "ab");
  assert.strictEqual(normalizeText("  a   \n\t b  "), "a b");
});

test("splitSentences ends after .!? plus a closing quote, with the documented exceptions", () => {
  assert.deepStrictEqual(splitSentences("Er kam. Dann ging er."), ["Er kam.", "Dann ging er."]);
  assert.deepStrictEqual(splitSentences("Herr und Frau sind da."), ["Herr und Frau sind da."]);
  assert.deepStrictEqual(splitSentences("Dr. Hoffmann kam."), ["Dr. Hoffmann kam."]);
  assert.deepStrictEqual(splitSentences("z. B. ein Haus."), ["z. B. ein Haus."]);
  assert.deepStrictEqual(splitSentences("u. a. auch"), ["u. a. auch"]);
  assert.deepStrictEqual(splitSentences("Mr. und Mrs. Brown kamen."), ["Mr. und Mrs. Brown kamen."]);
  assert.deepStrictEqual(splitSentences("St. Gallen liegt da."), ["St. Gallen liegt da."]);
  assert.deepStrictEqual(splitSentences("Das kostet 3.5 Euro."), ["Das kostet 3.5 Euro."]);
  assert.deepStrictEqual(splitSentences("Er rief »Hallo!« Dann ging er."), [
    "Er rief »Hallo!«",
    "Dann ging er.",
  ]);
  assert.deepStrictEqual(splitSentences("– Ja, ich weiß. Und du?"), ["– Ja, ich weiß. Und du?"]);
});

test("extractBlocks groups paragraphs and verse lines and drops boilerplate", () => {
  const xhtml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>',
    '<div class="pg-boilerplate pgheader header" id="pg-header"><p>Header</p><div id="pg-start-separator"><span>*** START OF THE PROJECT GUTENBERG EBOOK X ***</span></div></div>',
    "<h2>Ein Test</h2>",
    "<p>Erster Absatz. Zweiter Satz.</p>",
    '<div class="poem"><div class="stanza"><span class="i1">Zeile eins<br/>Zeile zwei<br/></span></div></div>',
    "<p>Letzter Absatz.</p>",
    '<p class="printer">Druck von der Druckerei.</p>',
    '<div id="pg-footer"><p>License.</p></div>',
    "</body></html>",
  ].join("\n");

  const { blocks, paragraphs, sentences } = extractBlocks(xhtml);

  assert.deepStrictEqual(
    blocks.map((block) => block.kind),
    ["prose", "prose", "verse", "prose"],
  );
  assert.deepStrictEqual(blocks[0].paragraphs, ["Ein Test"]);
  assert.deepStrictEqual(blocks[1].sentences, ["Erster Absatz.", "Zweiter Satz."]);
  assert.deepStrictEqual(blocks[2].lines, ["Zeile eins", "Zeile zwei"]);
  assert.deepStrictEqual(blocks[3].paragraphs, ["Letzter Absatz."]);
  assert.strictEqual(paragraphs, 5);
  assert.strictEqual(sentences, 6);
});

test("extractBlocks ends paragraphs at block elements and drops empty blocks", () => {
  const { blocks, paragraphs, sentences } = extractBlocks(
    "<ul><li>A</li><li>B</li></ul><blockquote>C</blockquote><p> </p><p><br/></p><p>Text</p>",
  );
  assert.deepStrictEqual(
    blocks.map((block) => block.text),
    ["A", "B", "C", "Text"],
  );
  assert.strictEqual(paragraphs, 4);
  assert.strictEqual(sentences, 4);
});

test("Struwwelpeter: sample story words appear in order, no empty sentences, counts match the manifest", () => {
  const { documents } = parsePackage(struwwelpeterBytes, { inflate: inflateRawSync });
  const texts = [];
  let paragraphs = 0;
  let sentences = 0;
  for (const doc of documents) {
    const result = extractBlocks(doc.xhtml);
    paragraphs += result.paragraphs;
    sentences += result.sentences;
    for (const block of result.blocks) {
      texts.push(block.text);
      for (const sentence of block.sentences) {
        assert.ok(sentence.trim().length > 0, "no sentence may be empty");
      }
    }
  }

  // Whole-book manifest values.
  assert.strictEqual(paragraphs, 374);
  assert.strictEqual(sentences, 451);

  const expectedWords = [SAMPLE_STORY_HEADING, ...SAMPLE_STORY_LINES].join(" ").trim().split(/\s+/);
  assertWordsInOrder(texts.join(" "), expectedWords);
});

test("Struwwelpeter: the sample story yields 31 paragraphs and 31 sentences", () => {
  const { documents } = parsePackage(struwwelpeterBytes, { inflate: inflateRawSync });
  const doc = documents.find((document) => document.xhtml.includes("Wüterich"));
  assert.ok(doc, "the story body document must be present");

  const { blocks } = extractBlocks(doc.xhtml);
  const start = blocks.findIndex((block) => block.text.includes(SAMPLE_STORY_HEADING));
  const end = blocks.findIndex((block) => block.text.includes("Die gar traurige Geschichte"));
  assert.ok(start >= 0, "sample story heading must be found");
  assert.ok(end > start, "the following story must bound the sample story");

  const storyBlocks = blocks.slice(start, end);
  let paragraphs = 0;
  let sentences = 0;
  for (const block of storyBlocks) {
    paragraphs += block.kind === "prose" ? block.paragraphs.length : block.lines.length;
    sentences += block.sentences.length;
  }
  assert.strictEqual(paragraphs, 31);
  assert.strictEqual(sentences, 31);
});

test("all sixteen books extract without error and never yield an empty sentence", () => {
  const booksDir = new URL("../books-src/", import.meta.url);
  const files = readdirSync(booksDir).filter((name) => name.endsWith(".epub"));
  assert.strictEqual(files.length, 16, "the committed library must contain sixteen books");

  for (const file of files) {
    const bytes = readFileSync(new URL(file, booksDir));
    const { documents } = parsePackage(bytes, { inflate: inflateRawSync });
    let blocks = 0;
    for (const doc of documents) {
      const result = extractBlocks(doc.xhtml);
      blocks += result.blocks.length;
      assert.ok(result.paragraphs >= 0, `${file}: paragraph count must be non-negative`);
      assert.ok(result.sentences >= 0, `${file}: sentence count must be non-negative`);
      for (const block of result.blocks) {
        assert.ok(block.kind === "prose" || block.kind === "verse", `${file}: unknown block kind`);
        for (const sentence of block.sentences) {
          assert.ok(sentence.trim().length > 0, `${file}: empty sentence in ${doc.path}`);
        }
      }
    }
    assert.ok(blocks > 0, `${file} must yield at least one block`);
  }
});
