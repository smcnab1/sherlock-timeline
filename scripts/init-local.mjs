// Create credentials for the disposable, loopback-only development stack.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";

import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

if (!process.stdin.isTTY) throw new Error("Run setup in an interactive terminal.");
const hiddenOutput = new Writable({ write(_chunk, _encoding, done) { done(); } });
const prompt = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true });
let password;
try {
  process.stderr.write("Choose a demo sign-in password (at least 16 characters): ");
  password = await prompt.question("");
} finally {
  prompt.close();
  process.stderr.write("\n");
}
if (password.length < 16) throw new Error("Use a password of at least 16 characters.");
const databasePassword = randomBytes(24).toString("hex");
const hash = await bcrypt.hash(password, 12);
// Next and Prisma expand dollar-prefixed values when reading .env.
const config = [
  "POSTGRES_PASSWORD=" + databasePassword,
  "DATABASE_URL=postgresql://sherlock:" + databasePassword + "@127.0.0.1:5432/sherlock_demo",
  "ADMIN_PASSWORD_HASH='" + hash.replaceAll("$", "\\$") + "'",
  "SESSION_SECRET=" + randomBytes(32).toString("hex"),
];
writeFileSync(".env", config.join("\n") + "\n", { flag: "wx", mode: 0o600 });
console.log("Local demo credentials saved in .env.");
