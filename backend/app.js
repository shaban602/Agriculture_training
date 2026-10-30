
const express = require("express");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const pool = require("./config/db");
const {
  createSessionToken,
  parseSessionToken,
  requireAuth,
  requireRole,
  sessionCookie,
  verifyPassword,
} = require("./lib/auth");

const app = express();
const configuredOrigins = (process.env.CORS_ORIGINS || process.env.APP_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const vercelOrigins = ["VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"]
  .map((name) => process.env[name])
  .filter(Boolean)
  .map((host) => `https://${host.replace(/^https?:\/\//, "").replace(/\/$/, "")}`);
const allowedOrigins = new Set([...configuredOrigins, ...vercelOrigins]);

if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Try again later." },
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed."));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (
    req.path.startsWith("/api/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    !allowedOrigins.has(req.get("origin"))
  ) {
    return res.status(403).json({ message: "Request origin is not allowed." });
  }

  next();
});

// --------------------------------------------------
// BASIC ROUTES
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    message: "Atlantis Life Agriculture Training System Backend is running!",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "success",
    message: "Backend API is working correctly",
  });
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!username || !password || username.length > 80 || password.length > 1024) {
    return res.status(400).json({ message: "Enter a valid username and password." });
  }

  try {
    const [users] = await pool.execute(
      "SELECT user_id, username, password_hash, role FROM `Users` WHERE username = ? AND is_active = 1 LIMIT 1",
      [username]
    );
    const user = users[0];

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    res.setHeader("Set-Cookie", sessionCookie(createSessionToken(user)));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      user: { id: user.user_id, username: user.username, role: user.role },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Unable to sign in right now." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  res.status(204).end();
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    user: { id: req.user.id, username: req.user.username, role: req.user.role },
  });
});

app.get("/api/test-db", requireAuth, requireRole("admin"), async (req, res) => {
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
      message: "Could not connect to MySQL.",
    });
  }
});

// --------------------------------------------------
// SHARED CRUD ROUTE CREATOR
// Used for tables with one auto-increment primary key.
// --------------------------------------------------

function registerCrudRoutes({
  path,
  table,
  primaryKey,
  columns,
  readRoles = ["admin", "trainer"],
  createRoles = ["admin"],
}) {
  // GET ALL RECORDS
  app.get(path, requireAuth, requireRole(...readRoles), async (req, res) => {
    try {
      const selectedColumns = columns
        .map((column) => `\`${column}\``)
        .join(", ");
      const [rows] = await pool.query(
        `SELECT ${selectedColumns} FROM \`${table}\` ORDER BY created_at DESC, \`${primaryKey}\` DESC`
      );
      res.json(rows);
    } catch (error) {
      console.error(`Fetch ${table} error:`, error.message);
      res.status(500).json({ message: `Failed to fetch ${table}` });
    }
  });

  // GET ONE RECORD
  app.get(`${path}/:${primaryKey}`, requireAuth, requireRole(...readRoles), async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM \`${table}\` WHERE \`${primaryKey}\` = ?`,
        [req.params[primaryKey]]
      );

      if (rows.length === 0) {
        return res.status(404).json({ message: "Record not found" });
      }

      res.json(rows[0]);
    } catch (error) {
      console.error(`Get ${table} record error:`, error.message);
      res.status(500).json({ message: "Failed to fetch record" });
    }
  });

  // ADD RECORD
  app.post(path, requireAuth, requireRole(...createRoles), async (req, res) => {
    try {
      const submittedColumns = Object.keys(req.body).filter(
        (column) => columns.includes(column) && column !== primaryKey
      );

      if (submittedColumns.length === 0) {
        return res.status(400).json({ message: "No valid fields supplied" });
      }

      const values = submittedColumns.map((column) => req.body[column]);
      const columnSql = submittedColumns
        .map((column) => `\`${column}\``)
        .join(", ");
      const placeholders = submittedColumns.map(() => "?").join(", ");

      const [result] = await pool.query(
        `INSERT INTO \`${table}\` (${columnSql}) VALUES (${placeholders})`,
        values
      );

      res.status(201).json({
        message: "Record added successfully",
        id: result.insertId,
      });
    } catch (error) {
      console.error(`Add ${table} error:`, error.message);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          message: "That primary key already exists.",
        });
      }

      if (
        error.code === "ER_NO_REFERENCED_ROW_2" ||
        error.code === "ER_ROW_IS_REFERENCED_2"
      ) {
        return res.status(409).json({
          message: "This record conflicts with a related database record.",
        });
      }

      res.status(500).json({
        message: "Failed to add record. Check the supplied fields.",
      });
    }
  });

  // EDIT RECORD
  app.put(`${path}/:${primaryKey}`, requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const submittedColumns = Object.keys(req.body).filter(
        (column) => columns.includes(column) && column !== primaryKey
      );

      if (submittedColumns.length === 0) {
        return res.status(400).json({
          message: "Provide at least one field to update.",
        });
      }

      const assignments = submittedColumns
        .map((column) => `\`${column}\` = ?`)
        .join(", ");

      const values = submittedColumns.map((column) => req.body[column]);
      values.push(req.params[primaryKey]);

      const [result] = await pool.query(
        `UPDATE \`${table}\` SET ${assignments} WHERE \`${primaryKey}\` = ?`,
        values
      );

      if (result.affectedRows === 0) {
        const [existing] = await pool.query(
          `SELECT 1 FROM \`${table}\` WHERE \`${primaryKey}\` = ?`,
          [req.params[primaryKey]]
        );

        if (existing.length === 0) {
          return res.status(404).json({ message: "Record not found" });
        }
      }

      res.json({ message: "Record updated successfully" });
    } catch (error) {
      console.error(`Update ${table} error:`, error.message);
      res.status(500).json({
        message: "Failed to update record. Check related records and field values.",
      });
    }
  });

  // DELETE RECORD
  app.delete(`${path}/:${primaryKey}`, requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const [result] = await pool.query(
        `DELETE FROM \`${table}\` WHERE \`${primaryKey}\` = ?`,
        [req.params[primaryKey]]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Record not found" });
      }

      res.json({ message: "Record deleted successfully" });
    } catch (error) {
      console.error(`Delete ${table} error:`, error.message);

      if (error.code === "ER_ROW_IS_REFERENCED_2") {
        return res.status(409).json({
          message:
            "This record is used by other records. Delete or reassign those related records first.",
        });
      }

      res.status(500).json({ message: "Failed to delete record" });
    }
  });
}

// --------------------------------------------------
// TABLES WITH A SINGLE PRIMARY KEY
// Column names match your existing MySQL database.
// --------------------------------------------------

registerCrudRoutes({
  path: "/api/farmers",
  table: "Farmers",
  primaryKey: "farmers_id",
  createRoles: ["admin", "trainer"],
  columns: [
    "farmers_id",
    "full_name",
    "farmers_email",
    "farmers_contact",
    "farmers_lacation",
    "joined_date",
  ],
});

registerCrudRoutes({
  path: "/api/trainers",
  table: "Trainers",
  primaryKey: "trainer_id",
  columns: [
    "trainer_id",
    "full_name",
    "trainer_email",
    "trainer_contact",
    "trainer_region",
    "hire_date",
  ],
});

registerCrudRoutes({
  path: "/api/events",
  table: "Events",
  primaryKey: "event_id",
  readRoles: ["admin", "trainer", "partner"],
  createRoles: ["admin", "trainer"],
  columns: [
    "event_id",
    "trainer_id",
    "event_name",
    "event_date",
    "event_location",
    "event_topic",
    "maxparticipants",
  ],
});

registerCrudRoutes({
  path: "/api/expenses",
  table: "Expenses",
  primaryKey: "expense_id",
  readRoles: ["admin"],
  createRoles: ["admin"],
  columns: [
    "expense_id",
    "event_id",
    "expense_name",
    "expense_description",
    "expense_date",
    "amount",
  ],
});

registerCrudRoutes({
  path: "/api/training-topics",
  table: "Training_Topics",
  primaryKey: "topic_id",
  columns: ["topic_id", "topic_name", "description"],
});

// --------------------------------------------------
// COMPOSITE-KEY CRUD ROUTES
// Used by Attendance and Product_adoption.
// Both use event_id + farmers_id as their primary key.
// --------------------------------------------------

function registerCompositeCrudRoutes({
  path,
  table,
  primaryKeys,
  columns,
  readRoles = ["admin", "trainer"],
  createRoles = ["admin"],
}) {
  const whereSql = primaryKeys
    .map((key) => `\`${key}\` = ?`)
    .join(" AND ");

  // GET ALL
  app.get(path, requireAuth, requireRole(...readRoles), async (req, res) => {
    try {
      const selectedColumns = columns
        .map((column) => `\`${column}\``)
        .join(", ");
      const [rows] = await pool.query(
        `SELECT ${selectedColumns} FROM \`${table}\` ORDER BY created_at DESC, event_id DESC, farmers_id DESC`
      );
      res.json(rows);
    } catch (error) {
      console.error(`Fetch ${table} error:`, error.message);
      res.status(500).json({ message: `Failed to fetch ${table}` });
    }
  });

  // GET ONE, USING BOTH PRIMARY-KEY VALUES
  app.get(`${path}/:event_id/:farmers_id`, requireAuth, requireRole(...readRoles), async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM \`${table}\` WHERE ${whereSql}`,
        primaryKeys.map((key) => req.params[key])
      );

      if (rows.length === 0) {
        return res.status(404).json({ message: "Record not found" });
      }

      res.json(rows[0]);
    } catch (error) {
      console.error(`Get ${table} record error:`, error.message);
      res.status(500).json({ message: "Failed to fetch record" });
    }
  });

  // ADD
  app.post(path, requireAuth, requireRole(...createRoles), async (req, res) => {
    try {
      const submittedColumns = Object.keys(req.body).filter((column) =>
        columns.includes(column)
      );

      const missingKeys = primaryKeys.filter(
        (key) =>
          req.body[key] === undefined ||
          req.body[key] === null ||
          req.body[key] === ""
      );

      if (missingKeys.length > 0) {
        return res.status(400).json({
          message: `Required primary-key fields: ${missingKeys.join(", ")}`,
        });
      }

      const columnSql = submittedColumns
        .map((column) => `\`${column}\``)
        .join(", ");
      const placeholders = submittedColumns.map(() => "?").join(", ");
      const values = submittedColumns.map((column) => req.body[column]);

      await pool.query(
        `INSERT INTO \`${table}\` (${columnSql}) VALUES (${placeholders})`,
        values
      );

      res.status(201).json({ message: "Record added successfully" });
    } catch (error) {
      console.error(`Add ${table} error:`, error.message);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          message: "A record with these event and farmer IDs already exists.",
        });
      }

      if (error.code === "ER_NO_REFERENCED_ROW_2") {
        return res.status(409).json({
          message: "The selected event or farmer does not exist.",
        });
      }

      res.status(500).json({ message: "Failed to add record" });
    }
  });

  // EDIT NON-KEY FIELDS
  app.put(`${path}/:event_id/:farmers_id`, requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const submittedColumns = Object.keys(req.body).filter(
        (column) => columns.includes(column) && !primaryKeys.includes(column)
      );

      if (submittedColumns.length === 0) {
        return res.status(400).json({
          message: "Provide at least one non-key field to update.",
        });
      }

      const assignments = submittedColumns
        .map((column) => `\`${column}\` = ?`)
        .join(", ");

      const values = submittedColumns.map((column) => req.body[column]);
      values.push(...primaryKeys.map((key) => req.params[key]));

      const [result] = await pool.query(
        `UPDATE \`${table}\` SET ${assignments} WHERE ${whereSql}`,
        values
      );

      if (result.affectedRows === 0) {
        const [existing] = await pool.query(
          `SELECT 1 FROM \`${table}\` WHERE ${whereSql}`,
          primaryKeys.map((key) => req.params[key])
        );

        if (existing.length === 0) {
          return res.status(404).json({ message: "Record not found" });
        }
      }

      res.json({ message: "Record updated successfully" });
    } catch (error) {
      console.error(`Update ${table} error:`, error.message);
      res.status(500).json({ message: "Failed to update record" });
    }
  });

  // DELETE USING BOTH KEY VALUES
  app.delete(`${path}/:event_id/:farmers_id`, requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const [result] = await pool.query(
        `DELETE FROM \`${table}\` WHERE ${whereSql}`,
        primaryKeys.map((key) => req.params[key])
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Record not found" });
      }

      res.json({ message: "Record deleted successfully" });
    } catch (error) {
      console.error(`Delete ${table} error:`, error.message);
      res.status(500).json({ message: "Failed to delete record" });
    }
  });
}

registerCompositeCrudRoutes({
  path: "/api/attendance",
  table: "Attendance",
  primaryKeys: ["event_id", "farmers_id"],
  createRoles: ["admin", "trainer"],
  columns: [
    "event_id",
    "farmers_id",
    "attendance_date",
    "feedback_score",
    "votes",
  ],
});

registerCompositeCrudRoutes({
  path: "/api/product-adoption",
  table: "Product_adoption",
  primaryKeys: ["event_id", "farmers_id"],
  readRoles: ["admin", "trainer", "partner"],
  createRoles: ["admin", "trainer"],
  columns: [
    "farmers_id",
    "event_id",
    "product_name",
    "adoption_date",
    "adoption_status",
  ],
});

module.exports = app;
