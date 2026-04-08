<?php
// Check payment status
// GET /pay/check.php?order_id=OC...
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

$ordersFile = __DIR__ . '/data/orders.json';

if (!file_exists($ordersFile)) {
    echo json_encode(['success' => false, 'error' => 'no orders']);
    exit;
}

$orderId = $_GET['order_id'] ?? '';
if (!$orderId) {
    echo json_encode(['success' => false, 'error' => 'missing order_id']);
    exit;
}

$orders = json_decode(file_get_contents($ordersFile), true) ?: [];
$found = null;
foreach ($orders as $o) {
    if ($o['order_id'] === $orderId) {
        $found = $o;
        break;
    }
}

if (!$found) {
    echo json_encode(['success' => false, 'error' => 'order not found']);
    exit;
}

echo json_encode([
    'success' => true,
    'order_id' => $found['order_id'],
    'status' => $found['status'],
    'amount' => $found['amount'],
    'months' => $found['months'],
    'paid_at' => $found['paid_at'],
]);
