// Create credentials for the disposable, loopback-only development stack.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";

const password = randomBytes(18).toString("base64url");
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
console.log("Local demo sign-in password (save privately): " + password);
