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

if ($path === '/api/deepl/translate' && $method === 'POST') {
    $token = extractToken();
    if (!validateSession($token)) jsonResponse(['error' => 'Non autorisé'], 401);
    if (!DEEPL_API_KEY) jsonResponse(['error' => 'Clé DeepL non configurée'], 503);

    $input = json_decode(file_get_contents('php://input'), true);
    $text = $input['text'] ?? '';
    $targetLang = $input['target_lang'] ?? 'EN';

    // Free tier uses api-free.deepl.com, Pro uses api.deepl.com
    // The free key ends with ':fx'
    $host = str_ends_with(DEEPL_API_KEY, ':fx') ? 'api-free.deepl.com' : 'api.deepl.com';

    proxyRequest(
        "https://$host/v2/translate",
        'POST',
        [
            'Authorization' => 'DeepL-Auth-Key ' . DEEPL_API_KEY,
            'Content-Type' => 'application/json'
        ],
        json_encode(['text' => [$text], 'target_lang' => $targetLang])
    );
}

// --- ANTHROPIC FLASHCARD GENERATION ---

if ($path === '/api/anthropic/generate' && $method === 'POST') {
    $token = extractToken();
    if (!validateSession($token)) jsonResponse(['error' => 'Non autorisé'], 401);
    if (!defined('ANTHROPIC_API_KEY') || !ANTHROPIC_API_KEY) jsonResponse(['error' => 'Clé Anthropic non configurée'], 503);

    $input = json_decode(file_get_contents('php://input'), true);
    $step       = $input['step']       ?? 'expressions'; // 'expressions' | 'sentences'
    $niveau     = intval($input['niveau'] ?? 1);
    $theme      = trim($input['theme']   ?? '');
    $contraintes = trim($input['contraintes'] ?? '');
    $expressions = $input['expressions'] ?? []; // used in step 2

    if (!$theme) jsonResponse(['error' => 'Thème requis'], 400);

    // Load curriculum for the requested level
    $curriculumFile = __DIR__ . '/../Curriculum/curriculum.json';
    $curriculum = file_exists($curriculumFile) ? json_decode(file_get_contents($curriculumFile), true) : [];
    $levelData = $curriculum[(string)$niveau] ?? null;
    $levelDesc = '';
    if ($levelData) {
        $label = $levelData['label'] ?? "Niveau $niveau";
        $cefr  = $levelData['cefr_approx'] ?? '';
        $peutFaire = implode('; ', array_slice($levelData['expression_orale']['peut_faire'] ?? [], 0, 5));
        $params    = implode('; ', array_slice($levelData['expression_orale']['parametres']  ?? [], 0, 4));
        $levelDesc = "Niveau $niveau — $label ($cefr).\nCe que l'employé peut faire : $peutFaire.\nCaractéristiques du discours : $params.";
    }

    if ($step === 'expressions') {
        // Step 1: generate 10 French expressions + English translations
        $contraintesBlock = $contraintes ? "\n\nContraintes supplémentaires de l'auteur : $contraintes" : '';
        $prompt = <<<PROMPT
Tu es un expert en conception pédagogique pour l'apprentissage du français langue seconde en contexte bancaire professionnel.

NIVEAU DE L'APPRENANT :
$levelDesc

THÈME DE LA LEÇON : $theme$contraintesBlock

TÂCHE : Génère exactement 10 expressions de vocabulaire français — chacune est un fragment court (2 à 6 mots) qu'un employé de banque utiliserait sur le thème donné. Pour chaque expression, fournis sa traduction anglaise équivalente, également sous forme de fragment court.

FORMAT DES EXPRESSIONS (appliquer strictement) :
- Groupe verbal à l'infinitif : "normaliser le bilan", "procéder à un virement", "accuser réception"
- Groupe nominal : "le taux directeur", "la capacité de remboursement", "un ordre de virement"
- Locution ou tournure figée : "en cours de traitement", "sous réserve de", "à titre indicatif"
- Traduction anglaise dans le même format court : "to normalize the balance sheet", "the key interest rate"

RÈGLES :
- Chaque expression est adaptée au niveau indiqué en termes de complexité lexicale
- Les expressions sont naturelles et réellement utilisées en contexte bancaire professionnel
- Les 10 expressions couvrent des aspects variés du thème (pas de doublets sémantiques)

RÉPONSE : JSON uniquement, sans commentaire, sans balises markdown.
Format exact :
{"expressions":[{"fr":"...","en":"..."},{"fr":"...","en":"..."},...]}
PROMPT;

        $body = json_encode([
            'model' => 'claude-opus-4-5',
            'max_tokens' => 1024,
            'system' => 'Tu réponds uniquement en JSON valide, sans balises markdown ni commentaire.',
            'messages' => [['role' => 'user', 'content' => $prompt]]
        ]);

        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => [
                'x-api-key: ' . ANTHROPIC_API_KEY,
                'anthropic-version: 2023-06-01',
                'content-type: application/json',
                'anthropic-beta: prompt-caching-2024-07-31'
            ],
            CURLOPT_TIMEOUT => 60
        ]);
        $raw = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            $err = json_decode($raw, true);
            jsonResponse(['error' => $err['error']['message'] ?? 'Erreur Anthropic', 'raw' => $raw], 502);
        }

        $resp = json_decode($raw, true);
        $text = $resp['content'][0]['text'] ?? '';
        // Strip possible markdown code fences
        $text = preg_replace('/^```(?:json)?\s*/m', '', $text);
        $text = preg_replace('/```\s*$/m', '', $text);
        $parsed = json_decode(trim($text), true);
        if (!$parsed || !isset($parsed['expressions'])) {
            jsonResponse(['error' => 'Réponse JSON invalide', 'raw' => $text], 502);
        }
        jsonResponse(['step' => 'expressions', 'expressions' => $parsed['expressions']]);

    } elseif ($step === 'sentences') {
        // Step 2: generate 10 authentic-context sentences from validated expressions
        if (count($expressions) !== 10) jsonResponse(['error' => '10 expressions requises'], 400);

        $exprList = '';
        foreach ($expressions as $i => $e) {
            $n = $i + 1;
            $exprList .= "$n. FR: \"{$e['fr']}\" / EN: \"{$e['en']}\"\n";
        }

        $contraintesBlock = $contraintes ? "\n\nContraintes supplémentaires : $contraintes" : '';
        $prompt = <<<PROMPT
Tu es un expert en conception pédagogique pour l'apprentissage du français langue seconde en contexte bancaire professionnel.

NIVEAU DE L'APPRENANT :
$levelDesc

THÈME : $theme$contraintesBlock

EXPRESSIONS VALIDÉES (à utiliser dans les phrases) :
$exprList

TÂCHE : Pour chacune des 10 expressions ci-dessus, écris UNE phrase authentique en français telle qu'un employé de banque la dirait ou l'écrirait dans un contexte professionnel réel.

RÈGLES :
- Chaque phrase DOIT contenir l'expression française correspondante telle quelle
- Les phrases sont authentiques : elles sonnent comme de vraies communications bancaires (email, réunion, appel, compte-rendu)
- La complexité des phrases correspond au niveau indiqué (pas plus complexe, pas plus simple)
- Varie les contextes : oral, écrit formel, échange informel entre collègues
- Chaque phrase tourne autour du thème "$theme"
- La phrase doit être complète et autonome (on comprend le sens sans contexte supplémentaire)
- Pour l'instruction de la carte (face avant des Flashcards Longues), génère une consigne courte et spécifique qui : (1) cite l'expression française entre guillemets, et (2) précise une situation bancaire réaliste. Format : 'Utilisez "[expression]" [contexte court].' Exemples : 'Utilisez "le taux directeur" pour expliquer une décision à un client.', 'Dites à votre collègue d\'utiliser "procéder à un virement" dans un email.', 'Conseillez un client en utilisant "la capacité de remboursement".'

RÉPONSE : JSON uniquement, sans commentaire, sans balises markdown.
Format exact :
{"sentences":[{"instruction":"...","sentence":"..."},...]  }
PROMPT;

        $body = json_encode([
            'model' => 'claude-opus-4-5',
            'max_tokens' => 2048,
            'system' => 'Tu réponds uniquement en JSON valide, sans balises markdown ni commentaire.',
            'messages' => [['role' => 'user', 'content' => $prompt]]
        ]);

        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => [
                'x-api-key: ' . ANTHROPIC_API_KEY,
                'anthropic-version: 2023-06-01',
                'content-type: application/json'
            ],
            CURLOPT_TIMEOUT => 60
        ]);
        $raw = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            $err = json_decode($raw, true);
            jsonResponse(['error' => $err['error']['message'] ?? 'Erreur Anthropic', 'raw' => $raw], 502);
        }

        $resp = json_decode($raw, true);
        $text = $resp['content'][0]['text'] ?? '';
        $text = preg_replace('/^```(?:json)?\s*/m', '', $text);
        $text = preg_replace('/```\s*$/m', '', $text);
        $parsed = json_decode(trim($text), true);
        if (!$parsed || !isset($parsed['sentences'])) {
            jsonResponse(['error' => 'Réponse JSON invalide', 'raw' => $text], 502);
        }
        jsonResponse(['step' => 'sentences', 'sentences' => $parsed['sentences']]);

    } else {
        jsonResponse(['error' => 'Step invalide'], 400);
    }
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
