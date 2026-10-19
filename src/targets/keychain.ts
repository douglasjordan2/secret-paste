import { platform, userInfo } from "node:os";
import { runWithStdin } from "./spawn.ts";

function shellSingleQuote(value: Buffer): Buffer {
  const out: number[] = [0x27];
  for (const b of value) {
    if (b === 0x27) out.push(0x27, 0x5c, 0x27, 0x27);
    else out.push(b);
  }
  out.push(0x27);
  return Buffer.from(out);
}

export async function storeKeychain(name: string, value: Buffer): Promise<{ readHint: string }> {
  if (platform() === "darwin") {
    const quoted = shellSingleQuote(value);
    const script = Buffer.concat([
      Buffer.from(`add-generic-password -U -a '${userInfo().username}' -s '${name}' -w `),
      quoted,
      Buffer.from("\n"),
    ]);
    try {
      await runWithStdin("security", ["-i"], script);
    } finally {
      script.fill(0);
      quoted.fill(0);
    }
    return { readHint: `security find-generic-password -s ${name} -w` };
  }
  await runWithStdin("secret-tool", ["store", `--label=${name}`, "service", name], value);
  return { readHint: `secret-tool lookup service ${name}` };
}
