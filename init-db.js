const mysql = require("mysql2/promise");
require("dotenv").config();

async function initDB() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false } // ✅ السماح بالاتصال مع self-signed certificate
    });

    console.log("✅ Connected to MySQL");

   await connection.execute(`
  ALTER TABLE children
  MODIFY COLUMN age VARCHAR(255) NOT NULL;
`);

    console.log("✅ Tables created successfully!");
    await connection.end();
  } catch (error) {
    console.error("❌ Error initializing database:", error.message);
  }
}

initDB();
