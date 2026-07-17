import pino from "pino";

/**
 * Structured JSON logger for every Tess Portal service.
 * Secrets must never reach logs: known secret-shaped keys are redacted
 * wherever they appear in a log object, and nothing here ever logs
 * process.env.
 */
const REDACT_KEYS = [
  "password",
  "passwordHash",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "credentials",
  "masterKey",
  "connectionString",
  "DATABASE_URL",
  "REDIS_URL",
  "MEILI_MASTER_KEY",
  "VAULT_MASTER_KEY",
  "SESSION_SECRET",
];

const redactPaths = REDACT_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);

export function createLogger(service: string) {
  return pino({
    base: { service },
    level: process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    redact: {
      paths: redactPaths,
      censor: "[redacted]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
