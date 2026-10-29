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
  const username = await ask("Username to reset: ");
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) {
    throw new Error("Username must be 3-80 characters and use letters, numbers, dots, underscores, or hyphens.");
  }

  const password = await askHidden("New password (12+ characters): ");
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
  const confirmation = await askHidden("Confirm new password: ");
  if (password !== confirmation) throw new Error("Passwords did not match.");

  const passwordHash = await hashPassword(password);
  const [result] = await pool.execute(
    "UPDATE `Users` SET password_hash = ? WHERE username = ? AND is_active = 1",
    [passwordHash, username]
  );

  if (result.affectedRows !== 1) {
    throw new Error("No active account found with that username.");
  }

  console.log(`Password updated for active account: ${username}`);
}

main()
  .catch((error) => {
    console.error(`Password reset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
