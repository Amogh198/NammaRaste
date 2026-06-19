const mysql = require('mysql2');
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'DBMS1234',
  database: 'pothole_db'
});

db.query("ALTER TABLE contractors ADD COLUMN password VARCHAR(255) DEFAULT 'password123'", (err, results) => {
  if (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log("Column already exists.");
    } else {
      console.error("Error adding column:", err);
    }
  } else {
    console.log("Successfully added 'password' column.");
  }
  db.end();
});
