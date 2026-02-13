<?php
define('APP_LOADED', true);
require_once __DIR__ . '/config.php';

// ======== CORS ========
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ======== HELPERS ========

function extractToken() {
    // Standard header
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (strpos($auth, 'Bearer ') === 0) {
        return substr($auth, 7);
    }
    // Fallback: getallheaders (some Apache configs strip the header)
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $key => $value) {
            if (strtolower($key) === 'authorization' && strpos($value, 'Bearer ') === 0) {
                return substr($value, 7);
            }
        }
    }
    return null;
}

function loadSessions() {
    $file = SESSIONS_FILE;
    if (!file_exists($file)) return [];
    $content = file_get_contents($file);
    return $content ? (json_decode($content, true) ?: []) : [];
}

function saveSessions($sessions) {
    file_put_contents(SESSIONS_FILE, json_encode($sessions), LOCK_EX);
}

function validateSession($token) {
    if (!$token) return false;
    $sessions = loadSessions();
    if (!isset($sessions[$token])) return false;
    if (time() > $sessions[$token]['expires_at']) {
        unset($sessions[$token]);
        saveSessions($sessions);
        return false;
    }
    return true;
}

function generateToken() {
    return bin2hex(random_bytes(32));
}

function cleanExpiredSessions() {
    $sessions = loadSessions();
    $now = time();
    $changed = false;
    foreach ($sessions as $token => $data) {
        if ($now > $data['expires_at']) {
            unset($sessions[$token]);
            $changed = true;
        }
    }
    if ($changed) saveSessions($sessions);
}

function jsonResponse($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function proxyRequest($url, $method, $headers, $body = null) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 120);

    $curlHeaders = [];
    foreach ($headers as $key => $value) {
        $curlHeaders[] = "$key: $value";
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $curlHeaders);

    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }

    $response = curl_exec($ch);

    if (curl_errno($ch)) {
        curl_close($ch);
        jsonResponse(['error' => 'Proxy request failed'], 502);
    }

    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $responseHeaders = substr($response, 0, $headerSize);
    $responseBody = substr($response, $headerSize);

    // Forward content-type from the proxied response
    if (preg_match('/Content-Type:\s*(.+)/i', $responseHeaders, $matches)) {
        header('Content-Type: ' . trim($matches[1]));
    }

    http_response_code($httpCode);
    echo $responseBody;
    exit;
}

// ======== ROUTING ========

$requestUri = $_SERVER['REQUEST_URI'];
$path = parse_url($requestUri, PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Clean expired sessions occasionally (1 in 50 requests)
if (rand(1, 50) === 1) cleanExpiredSessions();

// --- AUTH ENDPOINTS ---

if ($path === '/auth/login' && $method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $password = $input['password'] ?? '';

    if (!COMPANY_PASSWORD_HASH) {
        jsonResponse(['success' => false, 'error' => 'Authentification non configurée sur le serveur'], 503);
    }

    if (password_verify($password, COMPANY_PASSWORD_HASH)) {
        $token = generateToken();
        $sessions = loadSessions();
        $sessions[$token] = [
            'created_at' => time(),
            'expires_at' => time() + SESSION_EXPIRY
        ];
        saveSessions($sessions);

        jsonResponse([
            'success' => true,
            'token' => $token,
            'companyName' => COMPANY_NAME,
            'expiresIn' => SESSION_EXPIRY * 1000
        ]);
    } else {
        jsonResponse(['success' => false, 'error' => 'Mot de passe incorrect'], 401);
    }
}

if ($path === '/auth/logout' && $method === 'POST') {
    $token = extractToken();
    if ($token) {
        $sessions = loadSessions();
        unset($sessions[$token]);
        saveSessions($sessions);
    }
    jsonResponse(['success' => true]);
}

if ($path === '/auth/status' && $method === 'GET') {
    $token = extractToken();
    $valid = validateSession($token);
    jsonResponse([
        'authenticated' => $valid,
        'companyName' => $valid ? COMPANY_NAME : null
    ]);
}

// --- API PROXY ENDPOINTS ---

if ($path === '/api/elevenlabs/voices' && $method === 'GET') {
    $token = extractToken();
    if (!validateSession($token)) jsonResponse(['error' => 'Non autorisé'], 401);
    if (!ELEVENLABS_API_KEY) jsonResponse(['error' => 'Clé ElevenLabs non configurée'], 503);

    proxyRequest(
        'https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=default',
        'GET',
        ['xi-api-key' => ELEVENLABS_API_KEY]
    );
}

if (preg_match('#^/api/elevenlabs/tts/(.+)$#', $path, $matches) && $method === 'POST') {
    $token = extractToken();
    if (!validateSession($token)) jsonResponse(['error' => 'Non autorisé'], 401);
    if (!ELEVENLABS_API_KEY) jsonResponse(['error' => 'Clé ElevenLabs non configurée'], 503);

    $voiceId = $matches[1];
    $body = file_get_contents('php://input');

    proxyRequest(
        "https://api.elevenlabs.io/v1/text-to-speech/$voiceId",
        'POST',
        [
            'Accept' => 'audio/mpeg',
            'Content-Type' => 'application/json',
            'xi-api-key' => ELEVENLABS_API_KEY
        ],
        $body
    );
}

if ($path === '/api/gemini/generate' && $method === 'POST') {
    $token = extractToken();
    if (!validateSession($token)) jsonResponse(['error' => 'Non autorisé'], 401);
    if (!GEMINI_API_KEY) jsonResponse(['error' => 'Clé Gemini non configurée'], 503);

    $body = file_get_contents('php://input');

    proxyRequest(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' . GEMINI_API_KEY,
        'POST',
        ['Content-Type' => 'application/json'],
        $body
    );
}

// --- SCORM PREVIEW ENDPOINTS ---

define('SCORM_DIR', __DIR__ . '/../scorm-packages');

// Auto-cleanup: delete SCORM packages older than 1 hour
function cleanOldPackages() {
    if (!is_dir(SCORM_DIR)) return;
    $maxAge = 3600; // 1 hour in seconds
    $now = time();
    foreach (scandir(SCORM_DIR) as $item) {
        if ($item === '.' || $item === '..') continue;
        $dir = SCORM_DIR . '/' . $item;
        if (is_dir($dir) && ($now - filemtime($dir)) > $maxAge) {
            deleteDirectory($dir);
        }
    }
}

if ($path === '/upload' && $method === 'POST') {
    // Create scorm-packages directory if needed
    if (!is_dir(SCORM_DIR)) {
        mkdir(SCORM_DIR, 0755, true);
    }

    // Cleanup old packages before creating a new one
    cleanOldPackages();

    $packageId = time() . '_' . bin2hex(random_bytes(4));
    $packageDir = SCORM_DIR . '/' . $packageId;
    mkdir($packageDir, 0755, true);

    // Save the uploaded zip
    $zipData = file_get_contents('php://input');
    $zipPath = $packageDir . '/package.zip';
    file_put_contents($zipPath, $zipData);

    // Extract the zip
    $zip = new ZipArchive();
    if ($zip->open($zipPath) === true) {
        $zip->extractTo($packageDir);
        $zip->close();
    } else {
        jsonResponse(['success' => false, 'error' => 'Failed to extract zip'], 500);
    }

    // Find the main HTML file
    $mainHtml = 'story.html';
    $possibleEntries = ['story.html', 'index.html', 'index_lms.html'];
    foreach ($possibleEntries as $entry) {
        if (findFileRecursive($packageDir, $entry)) {
            $mainHtml = $entry;
            break;
        }
    }

    jsonResponse([
        'success' => true,
        'packageId' => $packageId,
        'launchUrl' => "/scorm-packages/$packageId/$mainHtml"
    ]);
}

if (preg_match('#^/delete/(.+)$#', $path, $matches) && ($method === 'DELETE' || $method === 'POST')) {
    $packageId = basename($matches[1]); // basename prevents path traversal
    $packageDir = SCORM_DIR . '/' . $packageId;

    if (is_dir($packageDir)) {
        deleteDirectory($packageDir);
        jsonResponse(['success' => true, 'message' => 'Package deleted']);
    } else {
        jsonResponse(['success' => false, 'message' => 'Package not found']);
    }
}

// Helper: recursively find a file
function findFileRecursive($dir, $filename) {
    $items = scandir($dir);
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $fullPath = $dir . '/' . $item;
        if (is_dir($fullPath)) {
            $found = findFileRecursive($fullPath, $filename);
            if ($found) return $found;
        } elseif ($item === $filename) {
            return $fullPath;
        }
    }
    return null;
}

// Helper: recursively delete a directory
function deleteDirectory($dir) {
    if (!is_dir($dir)) return;
    $items = scandir($dir);
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $fullPath = $dir . '/' . $item;
        if (is_dir($fullPath)) {
            deleteDirectory($fullPath);
        } else {
            unlink($fullPath);
        }
    }
    rmdir($dir);
}

// --- FALLBACK ---
jsonResponse(['error' => 'Endpoint not found'], 404);
