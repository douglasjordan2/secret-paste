import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeEnv, upsertEnvContent, formatEnvValue } from "../src/targets/env.ts";
import { decodeFormField } from "../src/prompt-server.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "secret-paste-"));
const b = (s: string) => Buffer.from(s);

test("creates .env with mode 0600 when missing", () => {
  const dir = tmp();
  const { path } = storeEnv(dir, "API_KEY", b("abc123"));
  assert.equal(path, join(dir, ".env"));
  assert.equal(readFileSync(path, "utf8"), "API_KEY=abc123\n");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(existsSync(join(dir, ".gitignore")), false);
});

test("replaces existing key, preserves other lines, drops duplicates", () => {
  const out = upsertEnvContent(b("# comment\nFOO=1\nexport API_KEY=old\nBAR=2\nAPI_KEY=older\n"), "API_KEY", b("new"));
  assert.equal(out.toString(), "# comment\nFOO=1\nexport API_KEY=new\nBAR=2\n");
});

test("appends when missing and file lacks trailing newline", () => {
  assert.equal(upsertEnvContent(b("FOO=1"), "BAR", b("x")).toString(), "FOO=1\nBAR=x\n");
});

test("does not match keys that merely share a prefix", () => {
  assert.equal(upsertEnvContent(b("API_KEY_2=a\n"), "API_KEY", b("x")).toString(), "API_KEY_2=a\nAPI_KEY=x\n");
});

test("quotes values that need it", () => {
  assert.equal(formatEnvValue(b("plain-Value_1.2/x")).toString(), "plain-Value_1.2/x");
  assert.equal(formatEnvValue(b("has space #hash")).toString(), "'has space #hash'");
  assert.equal(formatEnvValue(b(`it's "q" \\`)).toString(), `"it's \\"q\\" \\\\"`);
});

test("existing file keeps its mode and gets .gitignore entry inside a git repo", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".git"));
  writeFileSync(join(dir, ".env"), "A=1\n", { mode: 0o644 });
  writeFileSync(join(dir, ".gitignore"), "node_modules");
  storeEnv(dir, "B", b("2"));
  assert.equal(readFileSync(join(dir, ".env"), "utf8"), "A=1\nB=2\n");
  assert.equal(statSync(join(dir, ".env")).mode & 0o777, 0o644);
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "node_modules\n.env\n");
  storeEnv(dir, "C", b("3"));
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "node_modules\n.env\n");
});

test("creates .gitignore in a git repo that has none", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".git"));
  storeEnv(dir, "A", b("1"));
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), ".env\n");
});

test("form field decoding handles percent and plus without touching other fields", () => {
  assert.equal(decodeFormField(b("other=1&value=a%26b+c%3D%2B&x=2"), "value")?.toString(), "a&b c=+");
  assert.equal(decodeFormField(b("other=1"), "value"), null);
  assert.equal(decodeFormField(b("value=%E2%9C%93"), "value")?.toString("utf8"), "✓");
});
