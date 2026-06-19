const mysql = require('mysql2');
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'DBMS1234',
  database: 'pothole_db'
});

db.query('DESCRIBE contractors', (err, results) => {
  if (err) {
    console.error(err);
  } else {
    console.log(JSON.stringify(results, null, 2));
  }
  db.end();
});
