const EnglishInfo = require('../models/EnglishInfo');
const ArabicInfo = require('../models/ArabicInfo');
const HebrewInfo = require('../models/HebrewInfo');
const cacheManager = require('./cacheManager');

/**
 * Registry of supported languages for store info.
 * Each entry maps a language code to its model class, R2 storage key and cache key.
 * Adding a new language = one subclass + one entry here + one cacheManager key.
 */
const LANGUAGES = {
  en: { InfoClass: EnglishInfo, r2Key: 'info/info.json', cacheKey: cacheManager.KEYS.STORE_INFO },
  ar: { InfoClass: ArabicInfo, r2Key: 'info/info-ar.json', cacheKey: cacheManager.KEYS.STORE_INFO_AR },
  he: { InfoClass: HebrewInfo, r2Key: 'info/info-he.json', cacheKey: cacheManager.KEYS.STORE_INFO_HE }
};

const SUPPORTED_LANGS = Object.keys(LANGUAGES);

/**
 * Normalizes a language code: trims and lowercases; missing or empty defaults to English.
 * @param {*} raw - Raw lang value (from query or body)
 * @returns {string} Normalized language code (possibly unsupported)
 */
function normalizeLang(raw) {
  if (raw === undefined || raw === null) return 'en';
  const value = String(raw).trim().toLowerCase();
  return value === '' ? 'en' : value;
}

/**
 * Checks whether a normalized language code is supported.
 * @param {string} code
 * @returns {boolean}
 */
function isSupportedLang(code) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}

module.exports = { LANGUAGES, SUPPORTED_LANGS, normalizeLang, isSupportedLang };
