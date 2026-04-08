<?php
// WeChat Pay order creation API
// POST /pay/create.php
// Returns: { "order_id": "...", "qrcode": "http://..." }
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) { mkdir($dataDir, 0755, true); }

$ordersFile = $dataDir . '/orders.json';

function loadOrders() {
    global $ordersFile;
    if (!file_exists($ordersFile)) return [];
    $raw = file_get_contents($ordersFile);
    return json_decode($raw, true) ?: [];
}

function saveOrders($orders) {
    global $ordersFile;
    file_put_contents($ordersFile, json_encode($orders, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// Generate unique order ID
$orderId = 'OC' . date('YmdHis') . rand(1000, 9999);

$input = json_decode(file_get_contents('php://input'), true);
$amount = 59;
$months = 1;

$order = [
    'order_id' => $orderId,
    'amount' => $amount,
    'months' => $months,
    'status' => 'pending',  // pending | paid | expired
    'created_at' => date('c'),
    'paid_at' => null,
    'device_id' => $input['device_id'] ?? 'unknown',
];

$orders = loadOrders();
$orders[] = $order;
saveOrders($orders);

echo json_encode([
    'success' => true,
    'order_id' => $orderId,
    'amount' => $amount,
    'qrcode' => 'http://120.27.16.1/pay/wxpay.png',
]);
