import { runWithStdin } from "./spawn.ts";

function jsonStringBytes(value: Buffer): Buffer {
  const out: number[] = [0x22];
  for (const b of value) {
    if (b === 0x22 || b === 0x5c) { out.push(0x5c, b); continue; }
    if (b < 0x20) {
      out.push(...Buffer.from(`\\u${b.toString(16).padStart(4, "0")}`));
      continue;
    }
    out.push(b);
  }
  out.push(0x22);
  return Buffer.from(out);
}

export async function storeOp(name: string, value: Buffer): Promise<{ readHint: string }> {
  const encoded = jsonStringBytes(value);
  const template = Buffer.concat([
    Buffer.from(`{"title":${JSON.stringify(name)},"category":"PASSWORD","fields":[{"id":"password","type":"CONCEALED","purpose":"PASSWORD","label":"password","value":`),
    encoded,
    Buffer.from("}]}"),
  ]);
  try {
    await runWithStdin("op", ["item", "create"], template);
  } finally {
    template.fill(0);
    encoded.fill(0);
  }
  return { readHint: `op item get ${name} --fields label=password --reveal` };
}
