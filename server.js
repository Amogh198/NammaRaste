const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DB CONNECTION ────────────────────────────────────────────
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'DBMS1234', // 🔴 CHANGE THIS to your MySQL root password
  database: 'pothole_db'
});

db.connect((err) => {
  if (err) {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to pothole_db');
});

// ── GET all road stretches (for dropdown) ───────────────────
app.get('/api/stretches', (req, res) => {
  db.query(`
    SELECT rs.stretch_id, rs.stretch_name, w.ward_name,
           rs.start_lat, rs.start_lng
    FROM road_stretches rs
    JOIN wards w ON rs.ward_id = w.ward_id
  `, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// ── GET all complaints ───────────────────────────────────────
app.get('/api/complaints', (req, res) => {
  db.query(`
    SELECT 
      c.complaint_id,
      ci.full_name AS citizen_name,
      rs.stretch_name,
      w.ward_name,
      c.severity,
      c.status,
      c.is_repeat,
      c.description,
      c.complaint_lat,
      c.complaint_lng,
      c.filed_at,
      con.contractor_name,
      ra.sla_deadline,
      ra.resolved_at
    FROM complaints c
    JOIN citizens ci ON c.citizen_id = ci.citizen_id
    JOIN road_stretches rs ON c.stretch_id = rs.stretch_id
    JOIN wards w ON rs.ward_id = w.ward_id
    LEFT JOIN repair_assignments ra ON c.complaint_id = ra.complaint_id
    LEFT JOIN contractors con ON ra.contractor_id = con.contractor_id
    ORDER BY c.filed_at DESC
  `, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// ── POST file a new complaint ────────────────────────────────
app.post('/api/complaints', (req, res) => {
  const { citizen_name, phone, stretch_id, lat, lng, severity, description } = req.body;

  // Step 1: Upsert citizen
  db.query(
    `INSERT INTO citizens (full_name, phone) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
    [citizen_name, phone],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });

      db.query(`SELECT citizen_id FROM citizens WHERE phone = ?`, [phone], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const citizen_id = rows[0].citizen_id;

        // Step 2: Insert complaint (trigger will set is_repeat)
        db.query(
          `INSERT INTO complaints (citizen_id, stretch_id, complaint_lat, complaint_lng, severity, description, status)
           VALUES (?, ?, ?, ?, ?, ?, 'open')`,
          [citizen_id, stretch_id, lat, lng, severity, description],
          (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            const complaint_id = result.insertId;

            // Step 3: Get ward's contractor and auto-assign
            db.query(
              `SELECT con.contractor_id 
               FROM contractors con
               JOIN road_stretches rs ON con.ward_id = rs.ward_id
               WHERE rs.stretch_id = ?
               LIMIT 1`,
              [stretch_id],
              (err, contractors) => {
                if (err) return res.status(500).json({ error: err.message });
                if (contractors.length === 0) {
                  return res.json({ success: true, complaint_id, assigned: false });
                }

                const contractor_id = contractors[0].contractor_id;
                // SLA: severity 4-5 → 3 days, others → 7 days
                const days = severity >= 4 ? 3 : 7;

                db.query(
                  `INSERT INTO repair_assignments (complaint_id, contractor_id, sla_deadline)
                   VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
                  [complaint_id, contractor_id, days],
                  (err) => {
                    if (err) return res.status(500).json({ error: err.message });

                    // Update complaint status to assigned
                    db.query(
                      `UPDATE complaints SET status = 'assigned' WHERE complaint_id = ?`,
                      [complaint_id]
                    );

                    res.json({ success: true, complaint_id, assigned: true, contractor_id });
                  }
                );
              }
            );
          }
        );
      });
    }
  );
});

// ── PUT update complaint status ──────────────────────────────
app.put('/api/complaints/:id/status', (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  db.query(
    `UPDATE complaints SET status = ? WHERE complaint_id = ?`,
    [status, id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });

      if (status === 'resolved') {
        db.query(
          `UPDATE repair_assignments SET resolved_at = NOW() WHERE complaint_id = ?`,
          [id]
        );
      }
      res.json({ success: true });
    }
  );
});

// ── GET contractor performance dashboard ────────────────────
app.get('/api/dashboard', (req, res) => {
  db.query(`SELECT * FROM contractor_performance`, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// ── GET SLA breach log ───────────────────────────────────────
app.get('/api/breaches', (req, res) => {
  db.query(`
    SELECT 
      sb.breach_id,
      sb.breach_detected_at,
      sb.sla_deadline,
      con.contractor_name,
      w.ward_name,
      c.complaint_id,
      rs.stretch_name,
      c.severity
    FROM sla_breach_log sb
    JOIN repair_assignments ra ON sb.assignment_id = ra.assignment_id
    JOIN contractors con ON sb.contractor_id = con.contractor_id
    JOIN complaints c ON ra.complaint_id = c.complaint_id
    JOIN road_stretches rs ON c.stretch_id = rs.stretch_id
    JOIN wards w ON sb.ward_id = w.ward_id
    ORDER BY sb.breach_detected_at DESC
  `, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// ── GET ward open complaints ─────────────────────────────────
app.get('/api/ward-stats', (req, res) => {
  db.query(`SELECT * FROM ward_open_complaints`, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// ── GET repeat complaints ────────────────────────────────────
app.get('/api/repeats', (req, res) => {
  db.query(`SELECT * FROM repeat_complaints_report`, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// ── CONTRACTOR LOGIN ─────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { name, password } = req.body;
  db.query(
    `SELECT contractor_id, contractor_name FROM contractors WHERE contractor_name = ? AND password = ?`,
    [name, password],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(401).json({ error: 'Invalid name or password' });
      res.json({ success: true, user: results[0] });
    }
  );
});

// ── GET contractor specific complaints ───────────────────────
app.get('/api/contractor/complaints/:id', (req, res) => {
  const { id } = req.params;
  db.query(`
    SELECT 
      c.complaint_id,
      ci.full_name AS citizen_name,
      rs.stretch_name,
      w.ward_name,
      c.severity,
      c.status,
      c.is_repeat,
      c.complaint_lat,
      c.complaint_lng,
      c.filed_at,
      ra.sla_deadline
    FROM complaints c
    JOIN citizens ci ON c.citizen_id = ci.citizen_id
    JOIN road_stretches rs ON c.stretch_id = rs.stretch_id
    JOIN wards w ON rs.ward_id = w.ward_id
    JOIN repair_assignments ra ON c.complaint_id = ra.complaint_id
    WHERE ra.contractor_id = ?
    ORDER BY c.filed_at DESC
  `, [id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// ── GET alerts for contractor (Repeats and Breaches) ──────────
app.get('/api/contractor/alerts/:id', (req, res) => {
  const { id } = req.params;
  const queries = {
    repeats: `
      SELECT c.complaint_id, rs.stretch_name, c.is_repeat
      FROM complaints c
      JOIN road_stretches rs ON c.stretch_id = rs.stretch_id
      JOIN repair_assignments ra ON c.complaint_id = ra.complaint_id
      WHERE ra.contractor_id = ? AND c.is_repeat = 1 AND c.status != 'resolved'
    `,
    breaches: `
      SELECT c.complaint_id, rs.stretch_name, ra.sla_deadline
      FROM complaints c
      JOIN repair_assignments ra ON c.complaint_id = ra.complaint_id
      JOIN road_stretches rs ON c.stretch_id = rs.stretch_id
      WHERE ra.contractor_id = ? AND ra.sla_deadline < NOW() AND c.status != 'resolved'
    `
  };

  db.query(queries.repeats, [id], (err, repeats) => {
    if (err) return res.status(500).json({ error: err.message });
    db.query(queries.breaches, [id], (err, breaches) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ repeats, breaches });
    });
  });
});

// ── START SERVER ─────────────────────────────────────────────
app.listen(3000, () => {
  console.log('🚀 Server running at http://localhost:3000');
});
