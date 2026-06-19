const mysql = require('mysql2');
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'DBMS1234',
  database: 'pothole_db'
});

const sql = `
  ALTER TABLE contractors ADD COLUMN IF NOT EXISTS password VARCHAR(255) DEFAULT 'password123';
`;

db.query(sql, (err, results) => {
  if (err) {
    console.error(err);
  } else {
    console.log("Successfully added password column and set default.");
  }
  db.end();
});
