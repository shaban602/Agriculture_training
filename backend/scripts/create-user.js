require("dotenv").config();

const readline = require("readline");
const pool = require("../config/db");
const { hashPassword } = require("../lib/auth");

function ask(question) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    terminal.question(question, (answer) => {
      terminal.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal to enter passwords safely.");
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = "";
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();

    function finish(error) {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }

    function onData(input) {
      const character = input.toString("utf8");
      if (character === "\u0003") return finish(new Error("Cancelled."));
      if (character === "\r" || character === "\n") return finish();
      if (character === "\u007f" || character === "\b") {
        value = value.slice(0, -1);
        return;
      }
      if (character >= " ") value += character;
    }

    stdin.on("data", onData);
  });
}

async function main() {
  const username = await ask("Username: ");
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) {
    throw new Error("Username must be 3-80 characters and use letters, numbers, dots, underscores, or hyphens.");
  }

  const role = (await ask("Role (admin, trainer, partner): ")).toLowerCase();
  if (!["admin", "trainer", "partner"].includes(role)) {
    throw new Error("Role must be admin, trainer, or partner.");
  }

  const password = await askHidden("Password (12+ characters): ");
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
  const confirmation = await askHidden("Confirm password: ");
  if (password !== confirmation) throw new Error("Passwords did not match.");

  const passwordHash = await hashPassword(password);
  await pool.execute(
    "INSERT INTO `Users` (username, password_hash, role) VALUES (?, ?, ?)",
    [username, passwordHash, role]
  );
  console.log(`Created ${role} account: ${username}`);
}

main()
  .catch((error) => {
    console.error(error.code === "ER_DUP_ENTRY" ? "That username already exists." : error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());