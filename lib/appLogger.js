"use strict";

const REDACT_KEY_RE = /(secret|token|password|authorization|cookie|api[_-]?key|jwt)/i;
const MAX_STRING_LOG_LENGTH = 280;
const MAX_ARRAY_LOG_ITEMS = 8;

function sanitizeLogString(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_STRING_LOG_LENGTH);
}

function redactContext(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[depth-limited]";

  if (Buffer.isBuffer(value)) {
    return `[buffer:${value.length}]`;
  }

  if (value instanceof Uint8Array) {
    return `[uint8array:${value.length}]`;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  if (typeof value === "string") {
    return sanitizeLogString(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LOG_ITEMS).map((item) => redactContext(item, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (REDACT_KEY_RE.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactContext(nested, depth + 1);
      }
    }
    return out;
  }

  return value;
}

function writeLog(level, domain, message, context = null) {
  const prefix = `[${domain}] ${message}`;
  const method = level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : console.log;

  if (context && typeof context === "object" && Object.keys(context).length) {
    method(prefix, redactContext(context));
    return;
  }

  method(prefix);
}

function createLogger(domain) {
  return {
    info(message, context = null) {
      writeLog("info", domain, message, context);
    },
    warn(message, context = null) {
      writeLog("warn", domain, message, context);
    },
    error(message, context = null) {
      writeLog("error", domain, message, context);
    },
  };
}

module.exports = {
  createLogger,
  redactContext,
};
