# Namma Raste (BBMP Pothole Monitoring System)

An automated, role-separated municipal complaint management and repair tracking system developed as a Database Management Systems (DBMS) project. The platform enables Bengaluru citizens to report potholes and allows city contractors to manage work orders, resolve complaints, and track SLA (Service Level Agreement) compliance.

---

## 🚀 Key Features

*   **Role Separation:** 
    *   **Citizens:** Public access to submit complaints and view active/recent pothole logs without needing a login.
    *   **Contractors:** Password-secured portal to view assignments in their assigned ward, receive high-priority alerts, and update repair progress.
*   **Database-Driven Logic:**
    *   **Duplicate Detection (Trigger):** Automatically flags incoming reports within a 100-meter radius on the same road stretch using geodesic distance calculation (Spherical Law of Cosines).
    *   **SLA Tracking (Trigger):** Automatically audits contractor performance and logs Service Level Agreement breaches in an audit table if a task isn't completed before the deadline.
    *   **Real-time Analytics (Views):** Aggregates cityward and contractor metrics (total assignments, average resolution time, SLA breaches) using dedicated MySQL views.

---

## 🛠️ Technology Stack

*   **Frontend:** HTML5, CSS3 (Vanilla), JavaScript (ES6, Fetch API)
*   **Backend:** Node.js, Express.js
*   **Database:** MySQL

---

## 📋 Prerequisites

Before running the application, make sure you have installed:
*   [Node.js](https://nodejs.org/) (v16 or higher)
*   [MySQL Server](https://dev.mysql.com/downloads/installer/) (v8.0 or higher)

---

## ⚙️ Setup Instructions

### 1. Database Setup
Log into your MySQL terminal (or Workbench) and execute the following DDL script to create the database schema, tables, views, and triggers:

```sql
-- Create Database
CREATE DATABASE IF NOT EXISTS pothole_db;
USE pothole_db;

-- 1. Create Wards Table
CREATE TABLE IF NOT EXISTS wards (
  ward_id INT NOT NULL AUTO_INCREMENT,
  ward_name VARCHAR(100) NOT NULL,
  zone VARCHAR(50) NOT NULL,
  PRIMARY KEY (ward_id)
) ENGINE=InnoDB;

-- 2. Create Road Stretches Table
CREATE TABLE IF NOT EXISTS road_stretches (
  stretch_id INT NOT NULL AUTO_INCREMENT,
  stretch_name VARCHAR(150) NOT NULL,
  ward_id INT NOT NULL,
  start_lat DECIMAL(9,6) DEFAULT NULL,
  start_lng DECIMAL(9,6) DEFAULT NULL,
  end_lat DECIMAL(9,6) DEFAULT NULL,
  end_lng DECIMAL(9,6) DEFAULT NULL,
  PRIMARY KEY (stretch_id),
  FOREIGN KEY (ward_id) REFERENCES wards(ward_id)
) ENGINE=InnoDB;

-- 3. Create Citizens Table
CREATE TABLE IF NOT EXISTS citizens (
  citizen_id INT NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (citizen_id)
) ENGINE=InnoDB;

-- 4. Create Contractors Table
CREATE TABLE IF NOT EXISTS contractors (
  contractor_id INT NOT NULL AUTO_INCREMENT,
  contractor_name VARCHAR(100) NOT NULL,
  contact_phone VARCHAR(15) DEFAULT NULL,
  ward_id INT NOT NULL,
  password VARCHAR(255) DEFAULT 'password123',
  PRIMARY KEY (contractor_id),
  FOREIGN KEY (ward_id) REFERENCES wards(ward_id)
) ENGINE=InnoDB;

-- 5. Create Complaints Table
CREATE TABLE IF NOT EXISTS complaints (
  complaint_id INT NOT NULL AUTO_INCREMENT,
  citizen_id INT NOT NULL,
  stretch_id INT NOT NULL,
  complaint_lat DECIMAL(9,6) NOT NULL,
  complaint_lng DECIMAL(9,6) NOT NULL,
  severity TINYINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  description TEXT,
  status ENUM('open', 'assigned', 'in_progress', 'resolved') DEFAULT 'open',
  is_repeat TINYINT(1) DEFAULT 0,
  filed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (complaint_id),
  FOREIGN KEY (citizen_id) REFERENCES citizens(citizen_id),
  FOREIGN KEY (stretch_id) REFERENCES road_stretches(stretch_id)
) ENGINE=InnoDB;

-- 6. Create Repair Assignments Table
CREATE TABLE IF NOT EXISTS repair_assignments (
  assignment_id INT NOT NULL AUTO_INCREMENT,
  complaint_id INT NOT NULL,
  contractor_id INT NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sla_deadline DATETIME NOT NULL,
  resolved_at DATETIME DEFAULT NULL,
  PRIMARY KEY (assignment_id),
  FOREIGN KEY (complaint_id) REFERENCES complaints(complaint_id),
  FOREIGN KEY (contractor_id) REFERENCES contractors(contractor_id)
) ENGINE=InnoDB;

-- 7. Create Repair Log Table
CREATE TABLE IF NOT EXISTS repair_log (
  log_id INT NOT NULL AUTO_INCREMENT,
  assignment_id INT NOT NULL,
  status_update ENUM('assigned', 'in_progress', 'resolved') NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT,
  PRIMARY KEY (log_id),
  FOREIGN KEY (assignment_id) REFERENCES repair_assignments(assignment_id)
) ENGINE=InnoDB;

-- 8. Create SLA Breach Log Table
CREATE TABLE IF NOT EXISTS sla_breach_log (
  breach_id INT NOT NULL AUTO_INCREMENT,
  assignment_id INT NOT NULL,
  complaint_id INT NOT NULL,
  contractor_id INT NOT NULL,
  sla_deadline DATETIME NOT NULL,
  breach_detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (breach_id),
  FOREIGN KEY (assignment_id) REFERENCES repair_assignments(assignment_id)
) ENGINE=InnoDB;

-- Triggers for Automation --

-- Trigger A: flag_repeat_complaint (BEFORE INSERT)
DELIMITER //
CREATE TRIGGER flag_repeat_complaint 
BEFORE INSERT ON complaints
FOR EACH ROW
BEGIN
    DECLARE nearby_count INT;
    SELECT COUNT(*) INTO nearby_count
    FROM complaints
    WHERE stretch_id = NEW.stretch_id
      AND status != 'resolved'
      AND (
          6371000 * ACOS(
              COS(RADIANS(NEW.complaint_lat)) * COS(RADIANS(complaint_lat)) *
              COS(RADIANS(complaint_lng) - RADIANS(NEW.complaint_lng)) +
              SIN(RADIANS(NEW.complaint_lat)) * SIN(RADIANS(complaint_lat))
          )
      ) <= 100;
    IF nearby_count > 0 THEN
        SET NEW.is_repeat = 1;
    END IF;
END //
DELIMITER ;

-- Trigger B: check_sla_breach (AFTER UPDATE)
DELIMITER //
CREATE TRIGGER check_sla_breach 
AFTER UPDATE ON repair_assignments
FOR EACH ROW
BEGIN
    IF NEW.resolved_at IS NULL AND NOW() > NEW.sla_deadline THEN
        INSERT INTO sla_breach_log (assignment_id, complaint_id, contractor_id, sla_deadline)
        SELECT NEW.assignment_id, NEW.complaint_id, NEW.contractor_id, NEW.sla_deadline
        WHERE NOT EXISTS (
            SELECT 1 FROM sla_breach_log WHERE assignment_id = NEW.assignment_id
        );
    END IF;
END //
DELIMITER ;

-- Analytical Views --

-- View A: Contractor Performance view
CREATE OR REPLACE VIEW contractor_performance AS 
SELECT 
    con.contractor_name,
    COUNT(ra.assignment_id) AS total_assigned,
    AVG(TIMESTAMPDIFF(HOUR, ra.assigned_at, ra.resolved_at)) AS avg_resolution_hours,
    SUM(CASE WHEN (ra.resolved_at IS NULL AND NOW() > ra.sla_deadline) THEN 1 ELSE 0 END) AS sla_breaches
FROM repair_assignments ra 
JOIN contractors con ON ra.contractor_id = con.contractor_id
GROUP BY con.contractor_name;

-- View B: Ward Open Complaints workload indicator
CREATE OR REPLACE VIEW ward_open_complaints AS 
SELECT 
    w.ward_name,
    COUNT(c.complaint_id) AS open_count
FROM complaints c 
JOIN road_stretches rs ON c.stretch_id = rs.stretch_id
JOIN wards w ON rs.ward_id = w.ward_id
WHERE c.status != 'resolved'
GROUP BY w.ward_name;

-- View C: Repeat Complaints Report view
CREATE OR REPLACE VIEW repeat_complaints_report AS 
SELECT 
    c.complaint_id,
    ci.full_name AS citizen_name,
    rs.stretch_name,
    w.ward_name,
    c.severity,
    c.status,
    c.filed_at
FROM complaints c
JOIN citizens ci ON c.citizen_id = ci.citizen_id
JOIN road_stretches rs ON c.stretch_id = rs.stretch_id
JOIN wards w ON rs.ward_id = w.ward_id
WHERE c.is_repeat = 1;

-- Insert Seed Data (Optional helper)
INSERT INTO wards (ward_name, zone) VALUES 
('Ward 141 - Lakkasandra', 'South Division'),
('Ward 150 - Bellandur', 'Mahadevapura'),
('Ward 111 - Shantala Nagar', 'East Division');

INSERT INTO road_stretches (stretch_name, ward_id) VALUES 
('Bannerghatta Road (Dairy Circle Stretch)', 1),
('Outer Ring Road (Sarjapur Junction)', 2),
('MG Road (Brigade Road Junction)', 3);

INSERT INTO contractors (contractor_name, contact_phone, ward_id, password) VALUES 
('South Division Builders', '9999888877', 1, 'password123'),
('Bellandur Infrastructure Ltd', '9999888866', 2, 'password123'),
('East Corridor Roadworks', '9999888855', 3, 'password123');
```

### 2. Configure Backend Credentials
Open `server.js` and locate lines 11–17. Update the MySQL root password to match your local installation:
```javascript
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'YOUR_MYSQL_PASSWORD', // Update with your MySQL password
  database: 'pothole_db'
});
```

### 3. Application Execution
1.  Navigate to the repository folder:
    ```bash
    cd pothole-app
    ```
2.  Install required Node modules:
    ```bash
    npm install
    ```
3.  Start the Express server:
    ```bash
    npm start
    ```
4.  Open your browser and navigate to:
    ```
    http://localhost:3000
    ```

---

## 📁 Project Directory Structure

```
pothole-app/
├── public/                 # Client-side web pages
│   ├── index.html          # Citizen portal (landing page)
│   ├── complaints.html     # Directory list of all complaints
│   ├── dashboard.html      # Public real-time performance analytics
│   ├── login.html          # Contractor authentication page
│   └── contractor.html     # Contractor work orders & alert center
├── server.js               # Express API and MySQL query router
├── package.json            # Node project configuration & dependencies
└── README.md               # Setup and documentation guide
```
