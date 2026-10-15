require("dotenv").config();

const app = require("./app");
const pool = require("./config/db");

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  try {
    const [rows] = await pool.query("SELECT 1");
    console.log(`Backend running at http://localhost:${PORT}`);
    console.log("Database connected successfully");
    console.log("DB test query result:", rows[0]);
  } catch (error) {
    console.log(`Backend running at http://localhost:${PORT}`);
    console.log("Database connection failed:", error.message);
  }
});