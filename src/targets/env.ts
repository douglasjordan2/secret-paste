import { existsSync, readFileSync, writeFileSync, renameSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const SAFE_BYTE = /^[A-Za-z0-9_@%+=:,.\/-]$/;

export function formatEnvValue(value: Buffer): Buffer {
  let safe = value.length > 0;
  for (const b of value) {
    if (!SAFE_BYTE.test(String.fromCharCode(b))) safe = false;
  }
  if (safe) return Buffer.from(value);
  const quote = value.includes(0x27) ? (value.includes(0x60) ? 0x22 : 0x60) : 0x27;
  if (quote === 0x22 && (value.includes(0x22) || value.includes(0x5c))) {
    throw new Error("value mixes quote characters and backslashes in a way .env cannot store losslessly; use target keychain or op");
  }
  return Buffer.concat([Buffer.from([quote]), value, Buffer.from([quote])]);
}

export function upsertEnvContent(existing: Buffer | null, name: string, value: Buffer): Buffer {
  const formatted = formatEnvValue(value);
  const text = existing ? existing.toString("latin1") : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length === 0 ? [] : text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const matcher = new RegExp(`^(\\s*)(export\\s+)?${name}\\s*=`);
  const parts: Buffer[] = [];
  let replaced = false;
  for (const line of lines) {
    const m = matcher.exec(line);
    if (m) {
      if (replaced) continue;
      replaced = true;
      parts.push(Buffer.from(`${m[1]}${m[2] ?? ""}${name}=`, "latin1"), formatted, Buffer.from(eol));
    } else {
      parts.push(Buffer.from(line, "latin1"), Buffer.from(eol));
    }
  }
  if (!replaced) parts.push(Buffer.from(`${name}=`), formatted, Buffer.from(eol));
  const out = Buffer.concat(parts);
  formatted.fill(0);
  return out;
}

export function ensureGitignore(dir: string): void {
  const gi = join(dir, ".gitignore");
  const hasGitignore = existsSync(gi);
  if (!hasGitignore && !existsSync(join(dir, ".git"))) return;
  const text = hasGitignore ? readFileSync(gi, "utf8") : "";
  const covered = text.split(/\r?\n/).some((l) => {
    const t = l.trim();
    return t === ".env" || t === "/.env" || t === ".env*" || t === "*.env";
  });
  if (covered) return;
  const needsNewline = text.length > 0 && !text.endsWith("\n");
  appendFileSync(gi, `${needsNewline ? "\n" : ""}.env\n`);
}

export function storeEnv(dir: string, name: string, value: Buffer): { path: string } {
  const path = join(dir, ".env");
  const exists = existsSync(path);
  const existing = exists ? readFileSync(path) : null;
  const mode = exists ? statSync(path).mode & 0o777 : 0o600;
  const content = upsertEnvContent(existing, name, value);
  const tmp = join(dir, `.env.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, content, { mode });
    renameSync(tmp, path);
  } finally {
    content.fill(0);
    existing?.fill(0);
  }
  ensureGitignore(dir);
  return { path };
}
