/**
 * Public-domain gate for the bundled book library.
 *
 * Every source in `books-src/sources.json` must clear both rules below before
 * it may be converted into app content:
 *
 *   - EU: the author (and any recorded contributor) died before 1956,
 *     i.e. 70 years p.m.a. counted from 2026.
 *   - US: first publication was in 1930 or earlier.
 *
 * The two cutoffs are constants. There are no per-book exceptions: a record's
 * own claims (`licenseBasis`, `publicDomain`, ...) never influence the result.
 * `validatedForYear` is only reported so the generated manifest can record the
 * year the rules were applied; it does not move either cutoff.
 */

/** EU rule: the death year must be strictly below this value. */
export const EU_DEATH_YEAR_BELOW = 1956;

/** US rule: the first publication year must be at most this value. */
export const US_PUBLICATION_YEAR_AT_MOST = 1930;

/** The year these cutoffs were applied, recorded in the generated manifest. */
export const VALIDATED_FOR_YEAR = 2026;

/** The rule set as recorded in `sources.json` and the generated manifest. */
export const RULES = Object.freeze({
  euDeathYearBelow: EU_DEATH_YEAR_BELOW,
  usPublicationYearAtMost: US_PUBLICATION_YEAR_AT_MOST,
  validatedForYear: VALIDATED_FOR_YEAR,
});

const REQUIRED_DEATH_YEAR_FIELDS = ["authorDeathYear"];
const OPTIONAL_DEATH_YEAR_FIELDS = ["translatorDeathYear", "illustratorDeathYear"];
const PUBLICATION_YEAR_FIELDS = ["firstPublicationYear"];

/** Refusal raised by {@link assertRights} and {@link assertAllRights}. */
export class RightsError extends Error {
  constructor(bookIds, result) {
    super(result.reasons.join("; "));
    this.name = "RightsError";
    this.code = "RIGHTS_REFUSED";
    this.bookIds = bookIds;
    this.reasons = result.reasons;
    this.validatedForYear = result.validatedForYear;
  }
}

function bookIdOf(record) {
  if (record && typeof record === "object") {
    if (typeof record.id === "string" && record.id.length > 0) return record.id;
    if (typeof record.file === "string" && record.file.length > 0) return record.file;
  }
  return "(unknown book)";
}

function describeValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return String(value);
  } catch {
    return "<unprintable>";
  }
}

function isValidYear(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function checkDeathYear(record, field, required, bookId, validatedForYear, reasons) {
  const value = record[field];
  const euRule = `EU rule: ${field} must be below ${EU_DEATH_YEAR_BELOW}`;
  const context = `${euRule}; validated for ${validatedForYear}`;

  if (value === undefined || value === null) {
    if (required) {
      reasons.push(`${bookId}: ${field} is missing (${context})`);
    }
    return;
  }
  if (!isValidYear(value)) {
    reasons.push(`${bookId}: ${field} ${describeValue(value)} is not a numeric year (${context})`);
    return;
  }
  if (value >= EU_DEATH_YEAR_BELOW) {
    reasons.push(`${bookId}: ${field} ${value} is not below ${EU_DEATH_YEAR_BELOW} (${context})`);
  }
}

function checkPublicationYear(record, field, bookId, validatedForYear, reasons) {
  const value = record[field];
  const usRule = `US rule: ${field} must be at most ${US_PUBLICATION_YEAR_AT_MOST}`;
  const context = `${usRule}; validated for ${validatedForYear}`;

  if (value === undefined || value === null) {
    reasons.push(`${bookId}: ${field} is missing (${context})`);
    return;
  }
  if (!isValidYear(value)) {
    reasons.push(`${bookId}: ${field} ${describeValue(value)} is not a numeric year (${context})`);
    return;
  }
  if (value > US_PUBLICATION_YEAR_AT_MOST) {
    reasons.push(`${bookId}: ${field} ${value} is after ${US_PUBLICATION_YEAR_AT_MOST} (${context})`);
  }
}

/**
 * Decide whether one `sources.json` record clears both public-domain rules.
 *
 * @param {object} record A book record from `books-src/sources.json`.
 * @param {{validatedForYear?: number}} [options]
 * @returns {{ok: boolean, reasons: string[], validatedForYear: number}}
 *   `reasons` is empty when `ok` is true; each refusal names the book id, the
 *   offending field and its year (or the expected cutoff year when missing).
 */
export function evaluateRights(record, { validatedForYear = VALIDATED_FOR_YEAR } = {}) {
  if (!isValidYear(validatedForYear)) {
    throw new TypeError(`validatedForYear must be a positive integer, received ${describeValue(validatedForYear)}`);
  }

  const bookId = bookIdOf(record);
  const reasons = [];

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    reasons.push(`${bookId}: record is not an object; cannot validate rights for ${validatedForYear}`);
    return { ok: false, reasons, validatedForYear };
  }

  for (const field of REQUIRED_DEATH_YEAR_FIELDS) {
    checkDeathYear(record, field, true, bookId, validatedForYear, reasons);
  }
  for (const field of OPTIONAL_DEATH_YEAR_FIELDS) {
    checkDeathYear(record, field, false, bookId, validatedForYear, reasons);
  }
  for (const field of PUBLICATION_YEAR_FIELDS) {
    checkPublicationYear(record, field, bookId, validatedForYear, reasons);
  }

  return { ok: reasons.length === 0, reasons, validatedForYear };
}

/**
 * Throw unless one record clears the gate. Call this before converting a book
 * so a refused record can never produce an output file.
 */
export function assertRights(record, options = {}) {
  const result = evaluateRights(record, options);
  if (!result.ok) throw new RightsError([bookIdOf(record)], result);
  return result;
}

/**
 * Run the gate over every record before any conversion starts.
 *
 * Every record is evaluated, then all refusals are reported together. A caller
 * that invokes this before writing output therefore leaves the output directory
 * untouched when any book is refused.
 */
export function assertAllRights(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError("records must be an array of book records");
  }

  const failed = [];
  let validatedForYear = options.validatedForYear ?? VALIDATED_FOR_YEAR;
  for (const record of records) {
    const result = evaluateRights(record, options);
    validatedForYear = result.validatedForYear;
    if (!result.ok) failed.push({ record, result });
  }

  if (failed.length > 0) {
    const result = {
      ok: false,
      reasons: failed.flatMap((entry) => entry.result.reasons),
      validatedForYear,
    };
    throw new RightsError(failed.map((entry) => bookIdOf(entry.record)), result);
  }

  return { ok: true, reasons: [], validatedForYear, count: records.length };
}

/**
 * Run the gate over every record, then convert only if all of them pass.
 *
 * `convert(record, {validatedForYear})` is never called for a refused book, so
 * a refused book cannot produce an output file. Any error from `convert`
 * propagates unchanged.
 */
export async function convertAllWithRightsGate(records, convert, options = {}) {
  const gate = assertAllRights(records, options);
  const outputs = [];
  for (const record of records) {
    outputs.push(await convert(record, { validatedForYear: gate.validatedForYear }));
  }
  return { ...gate, outputs };
}
