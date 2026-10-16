<?php
// Copy this file to config.php and fill in the MySQL details.
// When the app runs on the XAMPP server itself, use 127.0.0.1 as the host.
return [
    'db_host'  => '192.168.20.102',
    'db_port'  => 3306,
    'db_name'  => 'wau_attendance',   // create this empty database first; tables are added automatically
    'db_user'  => 'attendance',
    'db_pass'  => '',
    'timezone' => 'Asia/Jakarta',
];
