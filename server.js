const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
require("dotenv").config();

const app = express();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";
const PORT = Number(process.env.PORT || 3000);

if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET in environment variables.");
  process.exit(1);
}

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(results);
    });
  });
}

function getConnection() {
  return new Promise((resolve, reject) => {
    db.getConnection((err, connection) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(connection);
    });
  });
}

function connectionQuery(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(results);
    });
  });
}

function beginTransaction(connection) {
  return new Promise((resolve, reject) => {
    connection.beginTransaction(err => (err ? reject(err) : resolve()));
  });
}

function commit(connection) {
  return new Promise((resolve, reject) => {
    connection.commit(err => (err ? reject(err) : resolve()));
  });
}

function rollback(connection) {
  return new Promise(resolve => {
    connection.rollback(() => resolve());
  });
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing token" });
  }

  const token = authHeader.slice(7);

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.user = decoded;
    next();
  });
}

app.post("/api/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!username || !email || !password) {
      return res.status(400).json({ message: "Missing data" });
    }

    const existingUsers = await query("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [email]);

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await query("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", [
      username,
      email,
      hashedPassword
    ]);

    return res.json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Register error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const users = await query("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email]);

    if (users.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/profile", verifyToken, (req, res) => {
  return res.json({
    id: req.user.id,
    email: req.user.email,
    username: req.user.username
  });
});

app.get("/users/:id", verifyToken, async (req, res) => {
  try {
    const accountId = Number(req.params.id);

    if (!Number.isInteger(accountId)) {
      return res.status(400).json({ success: false, message: "Invalid account id" });
    }

    if (req.user.id !== accountId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const rows = await query("SELECT id, child_name, age FROM children WHERE account_id = ?", [accountId]);

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get children error:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/childData/:id", verifyToken, async (req, res) => {
  try {
    const childId = Number(req.params.id);

    if (!Number.isInteger(childId)) {
      return res.status(400).json({ success: false, message: "Invalid child id" });
    }

    const rows = await query(
      `SELECT lc.id, lc.category
       FROM learning_categories lc
       INNER JOIN children c ON c.id = lc.child_id
       WHERE lc.child_id = ? AND c.account_id = ?`,
      [childId, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "No categories found" });
    }

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Get child categories error:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/addChild", verifyToken, async (req, res) => {
  const accountId = req.user.id; // 🔥 من التوكن فقط
  const childName = String(req.body.child_name || "").trim();
  const age = String(req.body.age || "").trim();
  const categories = req.body.categories || [];

  if (!childName || !age) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  let parsedCategories = Array.isArray(categories)
    ? categories.map(c => String(c).trim()).filter(Boolean)
    : [];

  let connection;

  try {
    connection = await getConnection();
    await beginTransaction(connection);

    const insertChildResult = await connectionQuery(
      connection,
      "INSERT INTO children (account_id, child_name, age) VALUES (?, ?, ?)",
      [accountId, childName, age]
    );

    const childId = insertChildResult.insertId;

    if (parsedCategories.length > 0) {
      const values = parsedCategories.map(category => [childId, category]);

      await connectionQuery(
        connection,
        "INSERT INTO learning_categories (child_id, category) VALUES ?",
        [values]
      );
    }

    await commit(connection);

    return res.json({
      success: true,
      child_id: childId,
      categories: parsedCategories
    });
  } catch (error) {
    if (connection) await rollback(connection);

    console.error("Add child error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    if (connection) connection.release();
  }
}); 

if (categories) {
      const parsed = typeof categories === "string" ? JSON.parse(categories) : categories;

      if (Array.isArray(parsed)) {
        parsedCategories = parsed;
      } else if (parsed && Array.isArray(parsed.Items)) {
        parsedCategories = parsed.Items;
      }
    }

    parsedCategories = parsedCategories
      .map(category => String(category || "").trim())
      .filter(Boolean);


app.put("/children/:id", verifyToken, upload.none(), async (req, res) => {
  const childId = Number(req.params.id);
  const accountId = Number(req.body.account_id);
  const childName = String(req.body.child_name || "").trim();
  const age = String(req.body.age || "").trim();
  const categories = req.body.categories;

  if (!Number.isInteger(childId) || !Number.isInteger(accountId) || !childName || !age) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  if (req.user.id !== accountId) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  let parsedCategories = [];

  try {
    if (categories) {
      const parsed = typeof categories === "string" ? JSON.parse(categories) : categories;

      if (Array.isArray(parsed)) {
        parsedCategories = parsed;
      } else if (parsed && Array.isArray(parsed.Items)) {
        parsedCategories = parsed.Items;
      }
    }

    parsedCategories = parsedCategories
      .map(category => String(category || "").trim())
      .filter(Boolean);
  } catch {
    return res.status(400).json({ success: false, message: "Invalid categories JSON" });
  }

  let connection;

  try {
    connection = await getConnection();
    await beginTransaction(connection);

    const ownedRows = await connectionQuery(
      connection,
      "SELECT id FROM children WHERE id = ? AND account_id = ? LIMIT 1",
      [childId, accountId]
    );

    if (ownedRows.length === 0) {
      await rollback(connection);
      return res.status(404).json({ success: false, message: "Child not found" });
    }

    await connectionQuery(
      connection,
      "UPDATE children SET child_name = ?, age = ? WHERE id = ? AND account_id = ?",
      [childName, age, childId, accountId]
    );

    await connectionQuery(connection, "DELETE FROM learning_categories WHERE child_id = ?", [childId]);

    if (parsedCategories.length > 0) {
      const values = parsedCategories.map(category => [childId, category]);

      await connectionQuery(
        connection,
        "INSERT INTO learning_categories (child_id, category) VALUES ?",
        [values]
      );
    }

    await commit(connection);

    return res.json({
      success: true,
      child_id: childId,
      categories: parsedCategories
    });
  } catch (error) {
    if (connection) {
      await rollback(connection);
    }

    console.error("Update child error:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("API is running 🚀");
});