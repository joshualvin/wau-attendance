-- Created automatically by api.php on first run; kept here to run by hand if preferred.
-- Written for MySQL 5.1 and later.
CREATE TABLE IF NOT EXISTS company_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  work_start TIME NOT NULL DEFAULT '09:00:00',
  work_end TIME NOT NULL DEFAULT '17:00:00',
  grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  work_days VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5',
  annual_leave_quota TINYINT UNSIGNED NOT NULL DEFAULT 12
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS employees (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(20) NULL,
  name VARCHAR(120) NOT NULL,
  branch VARCHAR(80) NULL,
  department VARCHAR(80) NULL,
  position VARCHAR(80) NULL,
  job_level VARCHAR(40) NULL,
  employment_status ENUM('Permanent','Contract','Probation') NOT NULL DEFAULT 'Permanent',
  join_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY employee_code (employee_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS attendance (
  emp_id INT UNSIGNED NOT NULL,
  work_date DATE NOT NULL,
  clock_in TIME NULL,
  clock_out TIME NULL,
  status ENUM('present','late','absent','sick','leave') NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (emp_id, work_date),
  KEY work_date (work_date),
  CONSTRAINT attendance_emp FOREIGN KEY (emp_id) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- Every clock in/out and every admin edit, for Attendance activity and the history log.
CREATE TABLE IF NOT EXISTS attendance_log (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  emp_id INT UNSIGNED NOT NULL,
  work_date DATE NOT NULL,
  event_time TIME NOT NULL,
  kind ENUM('clock_in','clock_out','edit','delete') NOT NULL,
  source ENUM('live','admin') NOT NULL DEFAULT 'live',
  detail VARCHAR(300) NULL,
  latitude DECIMAL(9,6) NULL,
  longitude DECIMAL(9,6) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY work_date (work_date),
  KEY emp_date (emp_id, work_date),
  CONSTRAINT attendance_log_emp FOREIGN KEY (emp_id) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS time_off (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  emp_id INT UNSIGNED NOT NULL,
  type ENUM('annual','sick','permission') NOT NULL DEFAULT 'annual',
  request_type ENUM('full_day','half_day_morning','half_day_afternoon') NOT NULL DEFAULT 'full_day',
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  reason VARCHAR(300) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  KEY emp_dates (emp_id, date_from, date_to),
  CONSTRAINT time_off_emp FOREIGN KEY (emp_id) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT IGNORE INTO company_settings (id, name) VALUES (1, 'Wahyu Agung Utama');
