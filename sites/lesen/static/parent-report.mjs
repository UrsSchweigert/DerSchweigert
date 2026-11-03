/**
 * Dedicated entry point for the on-device parent report.
 *
 * The report and CSV helpers live in ./platform.mjs so the UI and the export
 * adapter share one module graph. Re-exporting them here keeps the report
 * contract in one named place for tests and future screens without adding a
 * second runtime dependency to the offline bundle.
 */
export {
  buildReport,
  toCsv,
  REPORT_FILENAME,
  MAX_CARD_PRACTICE_MS,
  PRACTICE_TIME_KEY,
  readPracticeMs,
  addPracticeMs,
} from './platform.mjs';
