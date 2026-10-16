-- Run once on the MySQL server at 192.168.20.102 as root (phpMyAdmin > SQL tab works).
-- Replace CHANGE_ME with a strong password, then put the same password in config.php.
-- Written for MySQL 5.1 (no IF NOT EXISTS on users; GRANT ... IDENTIFIED BY creates the login).
CREATE DATABASE IF NOT EXISTS wau_attendance CHARACTER SET utf8 COLLATE utf8_unicode_ci;

-- A login used only by the attendance app, limited to this one database.
-- '%' lets it connect from other machines on the LAN; use 'localhost' if the app runs on the server itself.
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON wau_attendance.* TO 'attendance'@'%' IDENTIFIED BY 'CHANGE_ME';
FLUSH PRIVILEGES;
