"use strict";

const NULL_BYTE_RE = /\u0000/g;
const CONTROL_CHAR_RE = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitizeTextForPostgres(value, options = {}) {
  if (value === null || value === undefined) return null;

  const {
    trim = false,
    normalizeWhitespace = false,
    maxLength = 0,
    withStats = false,
    bufferEncoding = "utf8",
  } = options || {};

  let text;
  if (Buffer.isBuffer(value)) {
    text = value.toString(bufferEncoding);
  } else if (value instanceof Uint8Array) {
    text = Buffer.from(value).toString(bufferEncoding);
  } else {
    text = String(value);
  }

  const stats = {
    original_length: text.length,
    final_length: text.length,
    removed_null_bytes: 0,
    removed_control_chars: 0,
    changed: false,
  };

  let safe = text
    .replace(NULL_BYTE_RE, (match) => {
      stats.removed_null_bytes += match.length;
      return "";
    })
    .replace(CONTROL_CHAR_RE, (match) => {
      stats.removed_control_chars += match.length;
      return "";
    });

  if (normalizeWhitespace) {
    safe = safe
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n");
  }

  if (trim) {
    safe = safe.trim();
  }

  if (Number(maxLength || 0) > 0 && safe.length > Number(maxLength)) {
    safe = safe.slice(0, Number(maxLength));
  }

  stats.final_length = safe.length;
  stats.changed = safe !== text;

  if (!withStats) return safe;
  return {
    value: safe,
    ...stats,
  };
}

function deepSanitizeForPostgres(value, options = {}, seen = new WeakMap()) {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return sanitizeTextForPostgres(value, options);
  }

  if (Buffer.isBuffer(value)) {
    if (options.convertBuffersToText) {
      return sanitizeTextForPostgres(value, options);
    }
    return Buffer.from(value);
  }

  if (value instanceof Uint8Array) {
    if (options.convertBuffersToText) {
      return sanitizeTextForPostgres(Buffer.from(value), options);
    }
    return Buffer.from(value);
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepSanitizeForPostgres(item, options, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.set(value, true);
    const out = {};
    for (const [rawKey, rawValue] of Object.entries(value)) {
      const safeKey = sanitizeTextForPostgres(rawKey, { trim: false, normalizeWhitespace: false }) || rawKey;
      out[safeKey] = deepSanitizeForPostgres(rawValue, options, seen);
    }
    seen.delete(value);
    return out;
  }

  return value;
}

function safeJsonStringifyForPostgres(value, fallback = "{}", options = {}) {
  try {
    return JSON.stringify(
      deepSanitizeForPostgres(value, {
        convertBuffersToText: true,
        ...options,
      })
    );
  } catch {
    return fallback;
  }
}

function sanitizeDbValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeTextForPostgres(value);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeDbValue(item));
  if (typeof value === "object") return safeJsonStringifyForPostgres(value, "{}");
  return value;
}

function sanitizeDbParams(params = []) {
  if (!Array.isArray(params)) return [];
  return params.map((value) => sanitizeDbValue(value));
}

function buildSanitizationSummary(value, options = {}) {
  const summary = sanitizeTextForPostgres(value, { ...options, withStats: true });
  if (!summary.changed) return null;
  return {
    original_length: summary.original_length,
    final_length: summary.final_length,
    removed_null_bytes: summary.removed_null_bytes,
    removed_control_chars: summary.removed_control_chars,
  };
}

module.exports = {
  buildSanitizationSummary,
  deepSanitizeForPostgres,
  safeJsonStringifyForPostgres,
  sanitizeDbParams,
  sanitizeDbValue,
  sanitizeTextForPostgres,
};
