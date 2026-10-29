require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2");
const pool = require("../config/db");

function writeWithBackpressure(stream, text) {
  if (stream.write(text)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function main() {
  const backupDirectory = path.resolve(
    process.env.BACKUP_DIR || path.join(__dirname, "..", "backups")
  );
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("BACKUP_RETENTION_DAYS must be a positive whole number.");
  }

  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `agriculture_training_backup_${timestamp}.sql`;
  const temporaryPath = path.join(backupDirectory, `${backupName}.tmp`);
  const backupPath = path.join(backupDirectory, backupName);
  let output;
  let connection;

  try {
    connection = await pool.getConnection();
    output = fs.createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    await writeWithBackpressure(
      output,
      "-- Atlantis Life database backup\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n"
    );

    const [tables] = await connection.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );

    for (const { TABLE_NAME: tableName } of tables) {
      const quotedTable = mysql.escapeId(tableName);
      const [definitions] = await connection.query(`SHOW CREATE TABLE ${quotedTable}`);
      const createStatement = Object.values(definitions[0])[1];

      await writeWithBackpressure(
        output,
        `DROP TABLE IF EXISTS ${quotedTable};\n${createStatement};\n`
      );

      const rowStream = connection.connection
        .query(`SELECT * FROM ${quotedTable}`)
        .stream({ highWaterMark: 25 });

      for await (const row of rowStream) {
        const columns = Object.keys(row);
        const columnSql = columns.map((column) => mysql.escapeId(column)).join(", ");
        const valueSql = columns
          .map((column) => mysql.escape(row[column]))
          .join(", ");
        await writeWithBackpressure(
          output,
          `INSERT INTO ${quotedTable} (${columnSql}) VALUES (${valueSql});\n`
        );
      }

      await writeWithBackpressure(output, "\n");
    }

    await writeWithBackpressure(output, "SET FOREIGN_KEY_CHECKS=1;\n");
    const outputFinished = new Promise((resolve, reject) => {
      output.once("finish", resolve);
      output.once("error", reject);
    });
    output.end();
    await outputFinished;
    await connection.commit();
    fs.renameSync(temporaryPath, backupPath);

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(backupDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(?:agriculture|livestock)_training_backup_.*\.sql$/.test(entry.name)) {
        continue;
      }

      const entryPath = path.join(backupDirectory, entry.name);
      if (entryPath !== backupPath && fs.statSync(entryPath).mtimeMs < cutoff) {
        fs.unlinkSync(entryPath);
      }
    }

    console.log(`Database backup created: ${backupPath}`);
  } finally {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        // The transaction may already have committed.
      }
      connection.release();
    }
    if (output && !output.destroyed) output.destroy();
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Backup failed: ${error.message}`);
  process.exitCode = 1;
});
