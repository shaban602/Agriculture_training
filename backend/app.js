
const express = require("express");
const cors = require("cors");
const pool = require("./config/db");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Livestock Training System Backend is running!",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "success",
    message: "Backend API is working correctly",
  });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT DATABASE() AS database_name, VERSION() AS mysql_version"
    );

    res.json({
      status: "success",
      message: "MySQL connected successfully!",
      database: rows[0].database_name,
      mysqlVersion: rows[0].mysql_version,
    });
  } catch (error) {
    console.error("MySQL connection error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Could not connect to MySQL. Check your database settings.",
    });
  }
});

module.exports = app;
