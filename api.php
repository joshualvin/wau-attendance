<?php
/**
 * Attendance API — stores everything in MySQL.
 * GET  api.php?action=state                        working set as JSON
 * GET  api.php?action=activity&date=YYYY-MM-DD     clock events and edits for one day
 * GET  api.php?action=history&empId=N&date=...     history log of one attendance record
 * GET  api.php?action=export&month=YYYY-MM         CSV download
 * POST api.php  {"action": "...", ...}             writes (see the second switch)
 */
declare(strict_types=1);

const STATUSES = ['present', 'late', 'absent', 'sick', 'leave'];
const LEAVE_TYPES = ['annual', 'sick', 'permission'];
const REQUEST_TYPES = ['full_day', 'half_day_morning', 'half_day_afternoon'];
const EMP_STATUSES = ['Permanent', 'Contract', 'Probation'];

function fail(int $code, string $msg) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $msg]);
    exit;
}
function ok(array $data = []) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true] + $data);
    exit;
}
function str(array $in, string $key, int $max, bool $required = false): ?string {
    $v = isset($in[$key]) ? trim((string)$in[$key]) : '';
    if ($v === '') {
        if ($required) fail(400, "Missing $key.");
        return null;
    }
    // MySQL 5.1 stores 3-byte utf8 only, so drop emoji and other 4-byte characters.
    return mb_substr(preg_replace('/[\x{10000}-\x{10FFFF}]/u', '', $v), 0, $max);
}
function date_arg(array $in, string $key, bool $required = true): ?string {
    $v = (string)($in[$key] ?? '');
    if ($v === '' && !$required) return null;
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !checkdate((int)substr($v, 5, 2), (int)substr($v, 8, 2), (int)substr($v, 0, 4))) fail(400, "Invalid $key date.");
    return $v;
}
function time_arg($v): ?string {
    if ($v === null || $v === '') return null;
    if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string)$v)) fail(400, 'Times must look like 08:30.');
    return (string)$v;
}
function int_arg(array $in, string $key): int {
    if (!isset($in[$key]) || !is_numeric($in[$key])) fail(400, "Missing $key.");
    return (int)$in[$key];
}
function coord($v, float $limit): ?float {
    return is_numeric($v) && abs((float)$v) <= $limit ? round((float)$v, 6) : null;
}

ini_set('display_errors', '0'); // warnings would corrupt the JSON replies
header('Cache-Control: no-store');
$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) fail(500, 'config.php is missing. Copy config.example.php to config.php and enter the database details.');
$cfg = require $cfgFile;
date_default_timezone_set($cfg['timezone'] ?? 'Asia/Jakarta');

// Over a slow link the MySQL handshake sometimes takes several seconds, so allow time and retry once.
for ($attempt = 1; ; $attempt++) {
    try {
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8', $cfg['db_host'], (int)($cfg['db_port'] ?? 3306), $cfg['db_name']),
            $cfg['db_user'], $cfg['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_TIMEOUT => 10]
        );
        $pdo->exec("SET time_zone = '" . date('P') . "'");
        break;
    } catch (PDOException $e) {
        if ($attempt < 2 && $e->getCode() == 2002) continue;
        fail(500, 'Cannot connect to MySQL at ' . $cfg['db_host'] . ' (database ' . $cfg['db_name'] . '). Check config.php. MySQL said: ' . $e->getMessage());
    }
}

/* Tables are created on first use and upgraded in place, so the only setup is an empty database. */
function migrate(PDO $pdo): void {
    $sql = preg_replace('/^--.*$/m', '', file_get_contents(__DIR__ . '/schema.sql'));
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) $pdo->exec($stmt);
    $cols = function (string $t) use ($pdo) { return array_column($pdo->query("SHOW COLUMNS FROM $t")->fetchAll(), 'Field'); };
    // Upgrades for databases created by the first version of this app.
    if (!in_array('employee_code', $cols('employees'), true)) {
        $pdo->exec('ALTER TABLE employees ADD employee_code VARCHAR(20) NULL AFTER id, ADD branch VARCHAR(80) NULL AFTER name,
            ADD job_level VARCHAR(40) NULL AFTER position, ADD join_date DATE NULL AFTER employment_status, ADD UNIQUE KEY employee_code (employee_code)');
    }
    if (!in_array('work_days', $cols('company_settings'), true)) {
        $pdo->exec("ALTER TABLE company_settings ADD work_days VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5', ADD annual_leave_quota TINYINT UNSIGNED NOT NULL DEFAULT 12");
    }
    if (!in_array('request_type', $cols('time_off'), true)) {
        $pdo->exec("ALTER TABLE time_off ADD request_type ENUM('full_day','half_day_morning','half_day_afternoon') NOT NULL DEFAULT 'full_day' AFTER type");
    }
}
if (!$pdo->query("SHOW TABLES LIKE 'attendance_log'")->fetch() || !in_array('request_type', array_column($pdo->query('SHOW COLUMNS FROM time_off')->fetchAll(), 'Field'), true)) {
    migrate($pdo);
}

$today = date('Y-m-d');
$method = $_SERVER['REQUEST_METHOD'];
$in = $method === 'POST' ? (json_decode(file_get_contents('php://input'), true) ?: []) : $_GET;
$action = (string)($in['action'] ?? '');

function company(PDO $pdo): array {
    $co = $pdo->query("SELECT name, TIME_FORMAT(work_start, '%H:%i') AS workStart, TIME_FORMAT(work_end, '%H:%i') AS workEnd,
        grace_minutes AS grace, work_days AS workDays, annual_leave_quota AS leaveQuota FROM company_settings WHERE id = 1")->fetch()
        ?: ['name' => 'Wahyu Agung Utama', 'workStart' => '09:00', 'workEnd' => '17:00', 'grace' => 15, 'workDays' => '1,2,3,4,5', 'leaveQuota' => 12];
    $co['grace'] = (int)$co['grace'];
    $co['leaveQuota'] = (int)$co['leaveQuota'];
    $co['workDays'] = array_map('intval', array_filter(explode(',', (string)$co['workDays']), 'strlen'));
    return $co;
}
function is_late(array $co, string $hm): bool {
    [$h, $m] = array_map('intval', explode(':', $hm));
    [$sh, $sm] = array_map('intval', explode(':', $co['workStart']));
    return $h * 60 + $m > $sh * 60 + $sm + $co['grace'];
}
function active_employee(PDO $pdo, int $id): array {
    $st = $pdo->prepare('SELECT id, name FROM employees WHERE id = ? AND deleted_at IS NULL');
    $st->execute([$id]);
    return $st->fetch() ?: fail(404, 'That employee no longer exists.');
}
function log_event(PDO $pdo, int $empId, string $date, string $kind, string $source, ?string $detail = null, ?float $lat = null, ?float $lng = null): void {
    $pdo->prepare('INSERT INTO attendance_log (emp_id, work_date, event_time, kind, source, detail, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$empId, $date, date('H:i:s'), $kind, $source, $detail, $lat, $lng]);
}
function next_code(PDO $pdo, string $companyName): string {
    $prefix = strtoupper(implode('', array_map(function ($w) { return $w[0]; }, preg_split('/\s+/', trim($companyName) ?: 'EMP')))) ?: 'EMP';
    $prefix = substr(preg_replace('/[^A-Z0-9]/', '', $prefix), 0, 4) ?: 'EMP';
    $st = $pdo->prepare('SELECT employee_code FROM employees WHERE employee_code LIKE ?');
    $st->execute([$prefix . '%']);
    $max = 0;
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $c) if (preg_match('/(\d+)$/', $c, $m)) $max = max($max, (int)$m[1]);
    return $prefix . str_pad((string)($max + 1), 3, '0', STR_PAD_LEFT);
}
const LOG_SELECT = "SELECT l.id, l.emp_id AS empId, e.name AS empName, e.employee_code AS code, e.position, DATE_FORMAT(l.work_date, '%Y-%m-%d') AS date,
    TIME_FORMAT(l.event_time, '%H:%i') AS time, l.kind, l.source, l.detail, l.latitude AS lat, l.longitude AS lng
    FROM attendance_log l JOIN employees e ON e.id = l.emp_id";

switch ($action) {
case 'state':
    $emps = $pdo->query("SELECT id, employee_code AS code, name, branch, department AS org, position, job_level AS level, employment_status AS status,
        DATE_FORMAT(join_date, '%Y-%m-%d') AS joinDate FROM employees WHERE deleted_at IS NULL ORDER BY name")->fetchAll();
    $st = $pdo->prepare("SELECT emp_id, DATE_FORMAT(work_date, '%Y-%m-%d') AS d, TIME_FORMAT(clock_in, '%H:%i') AS `in`, TIME_FORMAT(clock_out, '%H:%i') AS `out`, status FROM attendance WHERE work_date >= ?");
    $st->execute([date('Y-m-d', strtotime('-400 days'))]);
    $days = [];
    foreach ($st as $r) $days[$r['d']][$r['emp_id']] = ['in' => $r['in'], 'out' => $r['out'], 'status' => $r['status']];
    $leave = $pdo->query("SELECT t.id, t.emp_id AS empId, e.name AS empName, e.employee_code AS code, t.type, t.request_type AS requestType,
        DATE_FORMAT(t.date_from, '%Y-%m-%d') AS `from`, DATE_FORMAT(t.date_to, '%Y-%m-%d') AS `to`, t.reason, t.status,
        DATE_FORMAT(t.created_at, '%Y-%m-%d') AS requested
        FROM time_off t JOIN employees e ON e.id = t.emp_id ORDER BY t.created_at DESC, t.id DESC LIMIT 1000")->fetchAll();
    ok(['company' => company($pdo), 'employees' => $emps, 'days' => (object)$days, 'leave' => $leave,
        'server' => ['today' => $today, 'now' => date('H:i'), 'database' => $cfg['db_host'] . ' / ' . $cfg['db_name']]]);

case 'activity':
    $st = $pdo->prepare(LOG_SELECT . ' WHERE l.work_date = ? ORDER BY l.event_time DESC, l.id DESC');
    $st->execute([date_arg($in, 'date')]);
    ok(['events' => $st->fetchAll()]);

case 'history':
    $st = $pdo->prepare(LOG_SELECT . ' WHERE l.emp_id = ? AND l.work_date = ? ORDER BY l.id DESC');
    $st->execute([int_arg($in, 'empId'), date_arg($in, 'date')]);
    ok(['events' => $st->fetchAll()]);

case 'export':
    $month = (string)($in['month'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) fail(400, 'Invalid month.');
    $st = $pdo->prepare("SELECT e.employee_code, e.name, e.position, DATE_FORMAT(a.work_date, '%Y-%m-%d') AS d, TIME_FORMAT(a.clock_in, '%H:%i') AS cin, TIME_FORMAT(a.clock_out, '%H:%i') AS cout, a.status
        FROM attendance a JOIN employees e ON e.id = a.emp_id WHERE DATE_FORMAT(a.work_date, '%Y-%m') = ? ORDER BY e.name, a.work_date");
    $st->execute([$month]);
    header('Content-Type: text/csv; charset=utf-8');
    header("Content-Disposition: attachment; filename=\"attendance-$month.csv\"");
    $out = fopen('php://output', 'w');
    fputcsv($out, ['Employee ID', 'Employee', 'Job position', 'Date', 'Clock in', 'Clock out', 'Status'], ',', '"', '');
    foreach ($st as $r) fputcsv($out, [$r['employee_code'], $r['name'], $r['position'], $r['d'], $r['cin'], $r['cout'], $r['status']], ',', '"', '');
    exit;
}

if ($method !== 'POST') fail(405, 'Use POST for changes.');

switch ($action) {
case 'employee.add':
case 'employee.update':
    $id = $action === 'employee.update' ? (int)active_employee($pdo, int_arg($in, 'id'))['id'] : null;
    $code = str($in, 'code', 20) ?? ($id ? null : next_code($pdo, company($pdo)['name']));
    $fields = [
        'employee_code' => $code, 'name' => str($in, 'name', 120, true), 'branch' => str($in, 'branch', 80),
        'department' => str($in, 'org', 80), 'position' => str($in, 'position', 80), 'job_level' => str($in, 'level', 40),
        'employment_status' => in_array($in['status'] ?? '', EMP_STATUSES, true) ? $in['status'] : 'Permanent',
        'join_date' => date_arg($in, 'joinDate', false),
    ];
    try {
        if ($id) {
            $set = implode(', ', array_map(function ($k) { return "$k = ?"; }, array_keys($fields)));
            $pdo->prepare("UPDATE employees SET $set WHERE id = ?")->execute([...array_values($fields), $id]);
        } else {
            $pdo->prepare('INSERT INTO employees (' . implode(', ', array_keys($fields)) . ') VALUES (' . rtrim(str_repeat('?, ', count($fields)), ', ') . ')')
                ->execute(array_values($fields));
            $id = (int)$pdo->lastInsertId();
        }
    } catch (PDOException $e) {
        if ($e->errorInfo[1] === 1062) fail(409, "Employee ID $code is already used by someone else.");
        throw $e;
    }
    ok(['id' => $id, 'code' => $code]);

case 'employee.remove':
    // Soft delete: past attendance and leave keep their name in reports.
    $pdo->prepare('UPDATE employees SET deleted_at = NOW(), employee_code = NULL WHERE id = ?')->execute([int_arg($in, 'id')]);
    ok();

case 'clock':
    $emp = active_employee($pdo, int_arg($in, 'empId'));
    $now = date('H:i');
    $lat = coord($in['lat'] ?? null, 90);
    $lng = coord($in['lng'] ?? null, 180);
    $note = str($in, 'note', 200);
    $st = $pdo->prepare('SELECT clock_in, clock_out, status FROM attendance WHERE emp_id = ? AND work_date = ?');
    $st->execute([$emp['id'], $today]);
    $cur = $st->fetch() ?: null;
    if (($in['kind'] ?? '') === 'in') {
        if ($cur && $cur['clock_in']) fail(409, "{$emp['name']} already clocked in at " . substr($cur['clock_in'], 0, 5) . '.');
        $status = is_late(company($pdo), $now) ? 'late' : 'present';
        $pdo->prepare('INSERT INTO attendance (emp_id, work_date, clock_in, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE clock_in = VALUES(clock_in), status = VALUES(status)')
            ->execute([$emp['id'], $today, $now, $status]);
        log_event($pdo, (int)$emp['id'], $today, 'clock_in', 'live', $note, $lat, $lng);
        ok(['time' => $now, 'status' => $status]);
    }
    if (!$cur || !$cur['clock_in']) fail(409, "{$emp['name']} hasn't clocked in today.");
    if ($cur['clock_out']) fail(409, "{$emp['name']} already clocked out at " . substr($cur['clock_out'], 0, 5) . '.');
    $pdo->prepare('UPDATE attendance SET clock_out = ? WHERE emp_id = ? AND work_date = ?')->execute([$now, $emp['id'], $today]);
    log_event($pdo, (int)$emp['id'], $today, 'clock_out', 'live', $note, $lat, $lng);
    ok(['time' => $now]);

case 'record.set':
    $emp = active_employee($pdo, int_arg($in, 'empId'));
    $date = date_arg($in, 'date');
    $st = $pdo->prepare("SELECT TIME_FORMAT(clock_in, '%H:%i') AS cin, TIME_FORMAT(clock_out, '%H:%i') AS cout, status FROM attendance WHERE emp_id = ? AND work_date = ?");
    $st->execute([$emp['id'], $date]);
    $old = $st->fetch() ?: ['cin' => null, 'cout' => null, 'status' => null];
    $row = $old;
    if (array_key_exists('in', $in)) $row['cin'] = time_arg($in['in']);
    if (array_key_exists('out', $in)) $row['cout'] = time_arg($in['out']);
    if (array_key_exists('status', $in)) {
        $s = $in['status'] ?: null;
        if ($s !== null && !in_array($s, STATUSES, true)) fail(400, 'Unknown status.');
        $row['status'] = $s;
    }
    if (!array_key_exists('status', $in) || in_array($row['status'], ['present', 'late'], true)) {
        if ($row['cin'] && in_array($row['status'], [null, 'present', 'late'], true)) $row['status'] = is_late(company($pdo), $row['cin']) ? 'late' : 'present';
    }
    $pdo->prepare('INSERT INTO attendance (emp_id, work_date, clock_in, clock_out, status) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE clock_in = VALUES(clock_in), clock_out = VALUES(clock_out), status = VALUES(status)')
        ->execute([$emp['id'], $date, $row['cin'], $row['cout'], $row['status']]);
    $changes = [];
    foreach (['cin' => 'Clock in', 'cout' => 'Clock out', 'status' => 'Status'] as $k => $label) {
        if ($old[$k] !== $row[$k]) $changes[] = "$label " . ($old[$k] ?? '–') . ' → ' . ($row[$k] ?? '–');
    }
    if ($changes) log_event($pdo, (int)$emp['id'], $date, 'edit', 'admin', implode('; ', $changes));
    ok();

case 'record.delete':
    $emp = active_employee($pdo, int_arg($in, 'empId'));
    $date = date_arg($in, 'date');
    $st = $pdo->prepare('DELETE FROM attendance WHERE emp_id = ? AND work_date = ?');
    $st->execute([$emp['id'], $date]);
    if ($st->rowCount()) log_event($pdo, (int)$emp['id'], $date, 'delete', 'admin', 'Attendance record deleted');
    ok();

case 'records.absent':
    $date = date_arg($in, 'date');
    $st = $pdo->prepare("INSERT INTO attendance (emp_id, work_date, status)
        SELECT e.id, ?, 'absent' FROM employees e
        WHERE e.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.emp_id = e.id AND a.work_date = ? AND (a.status IS NOT NULL OR a.clock_in IS NOT NULL))
          AND NOT EXISTS (SELECT 1 FROM time_off t WHERE t.emp_id = e.id AND t.status = 'approved' AND ? BETWEEN t.date_from AND t.date_to)
        ON DUPLICATE KEY UPDATE status = 'absent'");
    $st->execute([$date, $date, $date]);
    ok(['count' => max(0, $st->rowCount())]);

case 'leave.add':
    $emp = active_employee($pdo, int_arg($in, 'empId'));
    $type = in_array($in['type'] ?? '', LEAVE_TYPES, true) ? $in['type'] : fail(400, 'Choose a time off policy.');
    $rtype = in_array($in['requestType'] ?? '', REQUEST_TYPES, true) ? $in['requestType'] : fail(400, 'Choose a request type.');
    $from = date_arg($in, 'from');
    $to = date_arg($in, 'to');
    if ($to < $from) fail(400, 'The end date is before the start date.');
    if ($rtype !== 'full_day' && $from !== $to) fail(400, 'A half-day request must be for a single date.');
    $pdo->prepare('INSERT INTO time_off (emp_id, type, request_type, date_from, date_to, reason) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$emp['id'], $type, $rtype, $from, $to, str($in, 'reason', 200, true)]);
    ok(['id' => (int)$pdo->lastInsertId()]);

case 'leave.set':
    $status = $in['status'] ?? '';
    if (!in_array($status, ['approved', 'rejected'], true)) fail(400, 'Unknown decision.');
    $st = $pdo->prepare("UPDATE time_off SET status = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'");
    $st->execute([$status, int_arg($in, 'id')]);
    if (!$st->rowCount()) fail(409, 'That request was already decided.');
    ok();

case 'company.save':
    $grace = max(0, min(120, (int)($in['grace'] ?? 15)));
    $days = array_values(array_unique(array_filter(array_map('intval', (array)($in['workDays'] ?? [])), function ($d) { return $d >= 0 && $d <= 6; })));
    sort($days);
    $quota = max(0, min(60, (int)($in['leaveQuota'] ?? 12)));
    $pdo->prepare('INSERT INTO company_settings (id, name, work_start, work_end, grace_minutes, work_days, annual_leave_quota) VALUES (1, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), work_start = VALUES(work_start), work_end = VALUES(work_end), grace_minutes = VALUES(grace_minutes),
        work_days = VALUES(work_days), annual_leave_quota = VALUES(annual_leave_quota)')
        ->execute([str($in, 'name', 80, true), time_arg($in['workStart'] ?? '') ?? '09:00', time_arg($in['workEnd'] ?? '') ?? '17:00', $grace, implode(',', $days), $quota]);
    ok();
}

fail(400, 'Unknown action.');
