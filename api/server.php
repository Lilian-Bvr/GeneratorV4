<?php
define('APP_LOADED', true);
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';

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
    // Query param (used for direct-link downloads)
    if (!empty($_GET['token'])) return $_GET['token'];
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

// Robustly extract and decode the first JSON object from an AI response,
// handling markdown fences, preamble text, and trailing content.
function extractJsonFromAI(string $text): ?array {
    // 1. Strip markdown code fences
    $text = preg_replace('/^```(?:json)?\s*/m', '', $text);
    $text = preg_replace('/```\s*$/m', '', $text);
    $text = trim($text);

    // 2. Try direct parse
    $parsed = json_decode($text, true);
    if (is_array($parsed)) return $parsed;

    // 3. Extract outermost {...} — handles preamble/trailing text
    if (preg_match('/\{.*\}/s', $text, $m)) {
        $parsed = json_decode($m[0], true);
        if (is_array($parsed)) return $parsed;
    }

    return null;
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

// Strip subfolder prefix (e.g. /experimental) so routes match regardless of install location
$baseDir = rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/');
if ($baseDir !== '' && strpos($path, $baseDir) === 0) {
    $path = substr($path, strlen($baseDir));
}

// Clean expired sessions occasionally (1 in 50 requests)
if (rand(1, 50) === 1) cleanExpiredSessions();

// Auto-migration: add modele_saved_at column if it doesn't exist yet
try {
    getDB()->exec('ALTER TABLE files ADD COLUMN modele_saved_at INT UNSIGNED DEFAULT NULL');
} catch (PDOException $e) { /* Column already exists — ignore */ }

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

// --- MODELE TIMESTAMPS ---

if ($path === '/api/modeles/timestamps' && $method === 'GET') {
    requireAuth();
    $base = __DIR__ . '/../Modele/';
    $names = ['Modele', 'Modele_Flashcards', 'Modele_QuickPreview'];
    $result = [];
    foreach ($names as $n) {
        $f = $base . $n . '.zip';
        $result[$n] = file_exists($f) ? filemtime($f) : null;
    }
    jsonResponse($result);
}

// --- API PROXY ENDPOINTS ---

if ($path === '/api/elevenlabs/voices' && $method === 'GET') {
    requireAuth();
    if (!ELEVENLABS_API_KEY) jsonResponse(['error' => 'Clé ElevenLabs non configurée'], 503);

    proxyRequest(
        'https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=default',
        'GET',
        ['xi-api-key' => ELEVENLABS_API_KEY]
    );
}

if (preg_match('#^/api/elevenlabs/tts/(.+)$#', $path, $matches) && $method === 'POST') {
    requireAuth();
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
    requireAuth();
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
    requireAuth();
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
    requireAuth();
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
            'model' => 'claude-sonnet-4-6',
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

        $resp   = json_decode($raw, true);
        $text   = $resp['content'][0]['text'] ?? '';
        $parsed = extractJsonFromAI($text);
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
            'model' => 'claude-sonnet-4-6',
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

        $resp   = json_decode($raw, true);
        $text   = $resp['content'][0]['text'] ?? '';
        $parsed = extractJsonFromAI($text);
        if (!$parsed || !isset($parsed['sentences'])) {
            jsonResponse(['error' => 'Réponse JSON invalide', 'raw' => $text], 502);
        }
        jsonResponse(['step' => 'sentences', 'sentences' => $parsed['sentences']]);

    } elseif ($step === 'seq-vocab') {
        // Step 0: generate vocabulary / expression list
        $docText    = trim($input['docText']    ?? '');
        $vocabCount = intval($input['vocabCount'] ?? 0);

        $contraintesBlock = $contraintes ? "\n\nContraintes supplémentaires : $contraintes" : '';
        $docBlock = $docText
            ? "\n\nDOCUMENT DE RÉFÉRENCE (extrait fourni par l'auteur — peut être du Markdown, JSON, XML, CSV ou texte brut) :\n\"\"\"$docText\"\"\"\nPrioritise les expressions, tournures et vocabulaire présents dans ce document."
            : '';
        $countInstruction = $vocabCount > 0
            ? "Génère exactement $vocabCount expressions."
            : "Génère entre 8 et 14 expressions — choisis le nombre optimal pour couvrir le thème de façon complète sans redondance.";

        $prompt = <<<VOCABPROMPT
Tu es un expert en conception pédagogique pour l'apprentissage du français langue seconde en contexte bancaire professionnel.

NIVEAU : $levelDesc

THÈME : $theme$contraintesBlock$docBlock

TÂCHE : $countInstruction
Chaque expression est un fragment réellement utilisé en milieu bancaire professionnel sur ce thème (groupe verbal à l'infinitif, groupe nominal, locution figée, tournure courante).

Pour chaque expression, fournis :
- "expression" : le fragment en français (2–7 mots)
- "example" : une phrase complète et naturelle en français illustrant l'expression dans un contexte bancaire oral
- "grammar" : note grammaticale courte si pertinente (genre, conjugaison, préposition associée…), sinon null

RÈGLES :
- Expressions variées : couvrir plusieurs aspects du thème (pas de doublets sémantiques)
- Complexité adaptée au niveau
- Chaque expression doit pouvoir s'entendre dans une vraie conversation de bureau ou call bancaire

RÉPONSE : JSON uniquement, sans balises markdown.
Format : {"vocabulary":[{"id":"v1","expression":"...","example":"...","grammar":null},{"id":"v2",...},...]}
VOCABPROMPT;

        $body = json_encode([
            'model'    => 'claude-sonnet-4-6',
            'max_tokens' => 2048,
            'system'   => 'Tu réponds uniquement en JSON valide, sans balises markdown ni commentaire.',
            'messages' => [['role' => 'user', 'content' => $prompt]]
        ]);

        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => [
                'x-api-key: ' . ANTHROPIC_API_KEY,
                'anthropic-version: 2023-06-01',
                'content-type: application/json'
            ],
            CURLOPT_TIMEOUT => 60
        ]);
        $raw      = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            $err = json_decode($raw, true);
            jsonResponse(['error' => $err['error']['message'] ?? 'Erreur Anthropic', 'raw' => $raw], 502);
        }
        $resp   = json_decode($raw, true);
        $text   = $resp['content'][0]['text'] ?? '';
        $parsed = extractJsonFromAI($text);
        if (!$parsed || !isset($parsed['vocabulary'])) {
            jsonResponse(['error' => 'Réponse JSON invalide', 'raw' => $text], 502);
        }
        jsonResponse(['step' => 'seq-vocab', 'vocabulary' => $parsed['vocabulary']]);

    } elseif ($step === 'seq-outline') {
        // Step 1: generate detailed outline with expression assignments
        $vocabulary = $input['vocabulary'] ?? [];
        $counts     = $input['counts']     ?? ['S1' => 5, 'S2' => 5, 'S3' => 5, 'S4' => 5];
        if (empty($vocabulary)) jsonResponse(['error' => 'Vocabulaire requis'], 400);

        $contraintesBlock = $contraintes ? "\n\nContraintes supplémentaires : $contraintes" : '';

        // Build vocab list for prompt
        $vocabDesc = '';
        foreach ($vocabulary as $v) {
            $g = $v['grammar'] ? " [{$v['grammar']}]" : '';
            $vocabDesc .= "- {$v['id']}: {$v['expression']}$g — ex. {$v['example']}\n";
        }

        $s1n = intval($counts['S1'] ?? 5);
        $s2n = intval($counts['S2'] ?? 5);
        $s3n = intval($counts['S3'] ?? 5);
        $s4n = intval($counts['S4'] ?? 5);

        $prompt = <<<OUTLINEPROMPT
Tu es un expert en conception pédagogique pour l'apprentissage du français langue seconde en contexte bancaire professionnel.

NIVEAU : $levelDesc

THÈME : $theme$contraintesBlock

LISTE DE VOCABULAIRE CIBLE (expressions à enseigner) :
$vocabDesc

TÂCHE : Conçois le plan pédagogique détaillé d'un module de 4 sections. Le module suit une progression de type Busuu : les mêmes expressions sont revisitées dans plusieurs exercices à des profondeurs croissantes, jamais une expression par exercice.

PROGRESSION DES SECTIONS :
- S1 Découvre ($s1n exercices) : introduit les expressions clés. L'entrée peut être un QCU, True or false, Matching, Complete, Dialogue — pas nécessairement un Media. Ne commence JAMAIS par une Leçon.
- S2 Pratique ($s2n exercices) : réancre les mêmes expressions depuis un autre angle — nouveau contexte, variation syntaxique, paraphrase.
- S3 Approfondis ($s3n exercices) : nuance et complexifie — variations grammaticales, synonymes, registres, contextes moins évidents.
- S4 Consolide ($s4n exercices) : drills plus complexes et moins guidés — mobilisation autonome, scénarios composites. Ne pas terminer systématiquement par des Flashcards.

TYPES D'ACTIVITÉS DISPONIBLES :
- "Leçon" subtype "simple" : présente 1 expression + traduction + 1 exemple. Utilisable dans toutes les sections, à n'importe quelle position — mais privilégier de placer un exercice pratique AVANT une Leçon plutôt qu'après (la Leçon confirme ou synthétise, elle n'introduit pas à froid).
- "Leçon" subtype "complexe" : leçon avec texte explicatif libre + tableau structuré optionnel. Mêmes règles de placement que la Leçon simple.
- "True or false" subtype null : 1 audio (2-3 répliques courtes) + UNE SEULE affirmation à évaluer vrai/faux.
- "QCU" subtype null : 1 audio + 1 question de compréhension + 4 réponses (1 correcte).
- "QCM" subtype null : 1 audio + 1 question + 4 réponses (2-3 correctes).
- "Matching" subtype "texte-texte" : 4 paires texte–texte à associer, pas d'audio.
- "Matching" subtype "audio-texte" : 4 paires audio–texte à associer.
- "Matching" subtype "audio-audio" : 4 paires audio–audio à associer.
- "Complete" subtype "options" : 1 audio + 1 texte à trous avec options à choisir.
- "Complete" subtype "reconstruit" : 1 audio + 1 phrase à reconstituer en remettant des mots dans l'ordre.
- "Flashcard" subtype "courte" : carte recto/verso courte — concept ou mot → réponse ou traduction courte.
- "Flashcard" subtype "longue" : carte recto/verso — expression → phrase d'usage complète en contexte.
- "Media" subtype null : extrait audio ou vidéo avec transcription, sans exercice interactif (introduit un contexte).
- "Dialogue" subtype null : script de dialogue entre 2-4 interlocuteurs, 4-10 répliques.

RÈGLES :
- Varier les types au sein de chaque section — éviter les répétitions excessives du même type
- Choisir l'exercice d'ouverture et de clôture de chaque section en fonction du thème et des expressions, pour que chaque module ait sa propre structure
- Utiliser l'ensemble des types disponibles de façon équilibrée sur l'ensemble du module
- Ne jamais commencer une section par une Leçon (simple ou complexe) — toujours au moins un exercice pratique avant
- Les Leçons peuvent apparaître à n'importe quelle autre position (milieu, fin) dans n'importe quelle section
- Chaque exercice cible exactement 1 expression du vocabulaire (champ vocab_ids), sauf Matching qui peut en cibler jusqu'à 4
- Toutes les expressions du vocabulaire doivent apparaître au moins deux fois dans le module au total
- Le champ "focus" décrit UNIQUEMENT le scénario/contexte en max 12 mots. Ne pas décrire la mécanique de l'exercice. Exemples : "Bulletin BCE — comprendre une annonce formelle", "Email client — reformuler une condition contractuelle"

RÉPONSE : JSON uniquement, sans balises markdown.
Format exact :
{"outline":{"S1":[{"id":"s1_1","type":"QCU","subtype":null,"focus":"Comprendre une annonce orale de la BCE","vocab_ids":["v1"]},...],"S2":[...],"S3":[...],"S4":[...]}}
OUTLINEPROMPT;

        $body = json_encode([
            'model'      => 'claude-sonnet-4-6',
            'max_tokens' => 8000,
            'system'     => 'Tu réponds uniquement en JSON valide, sans balises markdown ni commentaire.',
            'messages'   => [['role' => 'user', 'content' => $prompt]]
        ]);

        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => [
                'x-api-key: ' . ANTHROPIC_API_KEY,
                'anthropic-version: 2023-06-01',
                'content-type: application/json'
            ],
            CURLOPT_TIMEOUT => 120
        ]);
        set_time_limit(130);
        $raw      = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            $err = json_decode($raw, true);
            jsonResponse(['error' => $err['error']['message'] ?? 'Erreur Anthropic', 'raw' => $raw], 502);
        }
        $resp   = json_decode($raw, true);
        $text   = $resp['content'][0]['text'] ?? '';
        // Check for stop_reason: if truncated, report it clearly
        $stopReason = $resp['stop_reason'] ?? '';
        $parsed = extractJsonFromAI($text);
        if (!$parsed || !isset($parsed['outline'])) {
            $hint = $stopReason === 'max_tokens' ? ' (réponse tronquée — réduisez le nombre d\'exercices par section)' : '';
            jsonResponse(['error' => 'Réponse JSON invalide' . $hint, 'raw' => $text], 502);
        }
        jsonResponse(['step' => 'seq-outline', 'outline' => $parsed['outline']]);

    } elseif ($step === 'seq-exercise') {
        // Step 2: generate content for ONE exercise (called in parallel from browser)
        $vocabulary = $input['vocabulary'] ?? [];
        $outline    = $input['outline']    ?? [];
        $exercise   = $input['exercise']   ?? [];
        if (empty($exercise)) jsonResponse(['error' => 'Exercice requis'], 400);

        $contraintesBlock = $contraintes ? "\n\nContraintes supplémentaires : $contraintes" : '';

        // Build vocab context: mark targeted expressions with ★
        $targetedVocab = '';
        $vocabIds = $exercise['vocab_ids'] ?? [];
        foreach ($vocabulary as $v) {
            $g = $v['grammar'] ? " [{$v['grammar']}]" : '';
            $marker = in_array($v['id'], $vocabIds) ? ' ★' : '';
            $targetedVocab .= "- {$v['id']}$marker: {$v['expression']}$g — ex. {$v['example']}\n";
        }

        // Build full outline summary for coherence
        $sectionLabels = ['S1' => 'Découvre', 'S2' => 'Pratique', 'S3' => 'Approfondis', 'S4' => 'Consolide'];
        $outlineDesc = '';
        foreach ($outline as $sKey => $exList) {
            $outlineDesc .= "$sKey — {$sectionLabels[$sKey]}:\n";
            foreach ($exList as $ex) {
                $marker = ($ex['id'] === $exercise['id']) ? ' ← CET EXERCICE' : '';
                $sub = $ex['subtype'] ? " ({$ex['subtype']})" : '';
                $outlineDesc .= "  {$ex['id']}: {$ex['type']}$sub — {$ex['focus']}$marker\n";
            }
        }

        $exSection = $exercise['section'] ?? 'S1';
        $exType    = $exercise['type'];
        $exSub     = $exercise['subtype'] ? " ({$exercise['subtype']})" : '';
        $exFocus   = $exercise['focus'];
        $exLabel   = $sectionLabels[$exSection] ?? $exSection;

        $fmtBlock = <<<EXFMT
FORMAT DE RÉPONSE SELON LE TYPE :

"Leçon" subtype "simple" → {"expression_fr":"fragment 2-6 mots","expression_en":"traduction","exemple_fr":"phrase complète","exemple_en":"traduction exemple"}

"True or false" → {"audio_transcription":"script 2-3 répliques courtes","affirmation":"affirmation sur un détail","bonne_reponse":"True ou False","feedback":"explication courte"}

"QCU" → {"audio_transcription":"script 2-3 répliques courtes","question":"Dans la conversation, ...","answers":{"A":"bonne réponse","B":"distracteur","C":"distracteur","D":"distracteur"},"feedback":"explication courte"}

"QCM" → {"audio_transcription":"script 2-3 répliques courtes","question":"question","answers":{"A":"...","B":"...","C":"...","D":"..."},"correct":["A","C"],"feedback":"explication courte"}

"Matching" subtype "texte-texte" → {"pairs":[{"left":"...","right":"..."},{"left":"...","right":"..."},{"left":"...","right":"..."},{"left":"...","right":"..."}],"feedback":"..."}

"Matching" subtype "audio-texte" → {"pairs":[{"left_transcription":"1-2 phrases","right":"texte court"},...],"feedback":"..."}

"Complete" subtype "options" → {"audio_transcription":"2-3 répliques courtes (situation, question ou information)","texte_complet":"réponse ou reformulation en rapport avec l'audio — les mots clés à compléter sont écrits entre ##, ex: La BCE a décidé de #relever# les taux de #25# points de base.","options":["motCorrect1","motCorrect2","distracteur1","distracteur2"]}
(Le texte N'EST PAS une transcription de l'audio — c'est une réponse, reformulation ou vérification de compréhension. Court : 1-2 phrases max.)

"Complete" subtype "reconstruit" → {"audio_transcription":"2-3 répliques courtes posant une situation","texte_complet":"phrase-réponse à reconstituer en rapport avec l'audio — les mots à replacer sont entre ##, ex: Il faut #surveiller# l'#inflation# avant toute décision."}
(Le texte est la réponse attendue à l'audio, à reconstituer mot par mot. Court : 1 phrase.)

"Matching" subtype "audio-audio" → {"pairs":[{"left_transcription":"1-2 phrases authentiques","right_transcription":"1-2 phrases correspondantes à associer"},{"left_transcription":"...","right_transcription":"..."},{"left_transcription":"...","right_transcription":"..."},{"left_transcription":"...","right_transcription":"..."}],"feedback":"..."}

"Flashcard" subtype "courte" → {"cards":[{"front_text":"expression ou concept","back_text":"traduction ou réponse courte"},{"front_text":"expression sous un autre angle","back_text":"..."}]}
(1 à 3 cartes. Chaque front_text DOIT être différent — varier l'angle, la formulation ou le contexte. Pas d'audio — enregistré séparément.)

"Flashcard" subtype "longue" → {"cards":[{"front_text":"expression française","back_text":"phrase complète illustrant l'usage"},{"front_text":"même expression dans un autre contexte professionnel","back_text":"phrase complète différente"}]}
(1 à 3 cartes. Chaque front_text DOIT être différent — formuler différemment ou changer le contexte. Ne pas répéter le même front_text. Pas d'audio — enregistré séparément.)

"Leçon" subtype "complexe" → {"texte_html":"<p>texte explicatif en HTML simple</p>","has_header":true,"nb_cols":2,"nb_rows":3,"headers":["Colonne 1","Colonne 2"],"lignes":[{"ligne":1,"colonnes":[{"texte":"cellule 1.1"},{"texte":"cellule 1.2"}]},{"ligne":2,"colonnes":[{"texte":"cellule 2.1"},{"texte":"cellule 2.2"}]},{"ligne":3,"colonnes":[{"texte":"cellule 3.1"},{"texte":"cellule 3.2"}]}]}
(has_header: true si les headers ont du sens, false sinon. nb_cols: 1 ou 2. nb_rows: 1 à 3.)

"Media" subtype null → {"media_type":"image_audio","transcription":"script complet à enregistrer en audio (narration ou 2-4 répliques naturelles)"}

"Dialogue" subtype null → {"consigne":"courte instruction pour l'apprenant","script":[{"nom":"Chargé de clientèle","texte":"réplique 1"},{"nom":"Client","texte":"réplique 2"},{"nom":"Chargé de clientèle","texte":"réplique 3"},...]}
(4-6 répliques, 2-3 interlocuteurs, noms cohérents avec le contexte bancaire)
EXFMT;

        $prompt = <<<EXPROMPT
Tu es un expert en conception pédagogique pour l'apprentissage du français langue seconde en contexte bancaire professionnel.

NIVEAU : $levelDesc
THÈME : $theme$contraintesBlock

VOCABULAIRE DU MODULE (★ = expression ciblée pour cet exercice) :
$targetedVocab

RÈGLE IMPORTANTE : Concentre-toi UNIQUEMENT sur l'expression ★. Ne pas introduire d'autres expressions dans le contenu. Exception : Matching peut couvrir jusqu'à 4 expressions (une par paire).

PLAN COMPLET DU MODULE (pour cohérence — ne pas répéter les mêmes scénarios audio) :
$outlineDesc

EXERCICE À GÉNÉRER :
- Section : $exSection ($exLabel)
- Type : $exType$exSub
- Focus pédagogique : $exFocus

Génère le contenu de cet exercice uniquement. Assure-toi que le scénario audio (si applicable) est différent de ceux des autres exercices du module. Respecte la progression : $exSection est "$exLabel".

$fmtBlock

RÉPONSE : JSON uniquement représentant le contenu de l'exercice (pas de clé "content" englobante).
EXPROMPT;

        $body = json_encode([
            'model'      => 'claude-haiku-4-5-20251001',
            'max_tokens' => 1500,
            'system'     => 'Tu réponds uniquement en JSON valide, sans balises markdown ni commentaire.',
            'messages'   => [['role' => 'user', 'content' => $prompt]]
        ]);

        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => [
                'x-api-key: ' . ANTHROPIC_API_KEY,
                'anthropic-version: 2023-06-01',
                'content-type: application/json'
            ],
            CURLOPT_TIMEOUT => 45
        ]);
        $raw      = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            $err = json_decode($raw, true);
            jsonResponse(['error' => $err['error']['message'] ?? 'Erreur Anthropic', 'raw' => $raw], 502);
        }
        $resp   = json_decode($raw, true);
        $text   = $resp['content'][0]['text'] ?? '';
        $content = extractJsonFromAI($text);
        if (!$content) {
            jsonResponse(['error' => 'Réponse JSON invalide', 'raw' => $text], 502);
        }
        jsonResponse(['step' => 'seq-exercise', 'exercise_id' => $exercise['id'], 'content' => $content]);

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
        'launchUrl' => $baseDir . "/scorm-packages/$packageId/$mainHtml"
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

// ======== USER AUTH (email-based) ========

if ($path === '/api/users/login' && $method === 'POST') {
    $input    = json_decode(file_get_contents('php://input'), true);
    $email    = trim($input['email']    ?? '');
    $password = trim($input['password'] ?? '');

    if (!$email || !$password) jsonResponse(['error' => 'Email et mot de passe requis'], 400);

    $pdo  = getDB();
    $stmt = $pdo->prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        jsonResponse(['error' => 'Email ou mot de passe incorrect'], 401);
    }

    // Create session
    $token     = bin2hex(random_bytes(32));
    $expiresAt = time() + SESSION_EXPIRY;
    $pdo->prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
        ->execute([$token, $user['id'], $expiresAt]);

    jsonResponse([
        'token'     => $token,
        'expiresIn' => SESSION_EXPIRY * 1000,
        'user'      => ['id' => $user['id'], 'name' => $user['name'],
                        'email' => $user['email'], 'role' => $user['role']]
    ]);
}

if ($path === '/api/users/logout' && $method === 'POST') {
    $token = extractToken();
    if ($token) {
        getDB()->prepare('DELETE FROM sessions WHERE token = ?')->execute([$token]);
    }
    jsonResponse(['success' => true]);
}

if ($path === '/api/users/me' && $method === 'GET') {
    $user = requireAuth();
    jsonResponse(['user' => $user]);
}

// ======== ADMIN — USER MANAGEMENT ========

// List all users
if ($path === '/api/admin/users' && $method === 'GET') {
    requireAdmin();
    $users = getDB()->query('SELECT id, name, email, role, created_at FROM users ORDER BY name')->fetchAll();
    jsonResponse(['users' => $users]);
}

// Create user
if ($path === '/api/admin/users' && $method === 'POST') {
    requireAdmin();
    $input    = json_decode(file_get_contents('php://input'), true);
    $name     = trim($input['name']     ?? '');
    $email    = trim($input['email']    ?? '');
    $password = trim($input['password'] ?? '');
    $role     = ($input['role'] ?? 'user') === 'admin' ? 'admin' : 'user';

    if (!$name || !$email || !$password)
        jsonResponse(['error' => 'Nom, email et mot de passe requis'], 400);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        jsonResponse(['error' => 'Email invalide'], 400);
    if (strlen($password) < 8)
        jsonResponse(['error' => 'Mot de passe trop court (min 8 caractères)'], 400);

    $pdo  = getDB();
    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) jsonResponse(['error' => 'Cet email est déjà utilisé'], 409);

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        ->execute([$name, $email, $hash, $role]);
    $id = $pdo->lastInsertId();

    jsonResponse(['user' => ['id' => $id, 'name' => $name, 'email' => $email, 'role' => $role]], 201);
}

// Update user (name, email, password, role)
if (preg_match('#^/api/admin/users/(\d+)$#', $path, $m) && $method === 'PATCH') {
    requireAdmin();
    $userId = (int)$m[1];
    $input  = json_decode(file_get_contents('php://input'), true);
    $pdo    = getDB();

    $stmt = $pdo->prepare('SELECT id FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    if (!$stmt->fetch()) jsonResponse(['error' => 'Utilisateur introuvable'], 404);

    $fields = [];
    $params = [];
    if (!empty($input['name']))  { $fields[] = 'name = ?';  $params[] = $input['name']; }
    if (!empty($input['email'])) { $fields[] = 'email = ?'; $params[] = $input['email']; }
    if (!empty($input['role']))  { $fields[] = 'role = ?';  $params[] = $input['role'] === 'admin' ? 'admin' : 'user'; }
    if (!empty($input['password'])) {
        if (strlen($input['password']) < 8) jsonResponse(['error' => 'Mot de passe trop court'], 400);
        $fields[] = 'password_hash = ?';
        $params[] = password_hash($input['password'], PASSWORD_BCRYPT);
    }
    if (empty($fields)) jsonResponse(['error' => 'Rien à mettre à jour'], 400);

    $params[] = $userId;
    $pdo->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    jsonResponse(['success' => true]);
}

// Delete user
if (preg_match('#^/api/admin/users/(\d+)$#', $path, $m) && $method === 'DELETE') {
    $admin  = requireAdmin();
    $userId = (int)$m[1];
    if ($userId === (int)$admin['id']) jsonResponse(['error' => 'Impossible de supprimer votre propre compte'], 400);
    getDB()->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
    jsonResponse(['success' => true]);
}

// ======== PROJECTS ========

// List projects (admin: all; user: assigned only)
if ($path === '/api/projects' && $method === 'GET') {
    $user = requireAuth();
    $pdo  = getDB();

    if ($user['role'] === 'admin') {
        $projects = $pdo->query('
            SELECT p.*, u.name AS created_by_name,
                   (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
            FROM projects p
            JOIN users u ON u.id = p.created_by
            ORDER BY p.updated_at DESC
        ')->fetchAll();
    } else {
        $stmt = $pdo->prepare('
            SELECT p.*, u.name AS created_by_name,
                   (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
            FROM projects p
            JOIN users u ON u.id = p.created_by
            JOIN project_assignments pa ON pa.project_id = p.id AND pa.user_id = ?
            ORDER BY p.updated_at DESC
        ');
        $stmt->execute([$user['id']]);
        $projects = $stmt->fetchAll();
    }
    jsonResponse(['projects' => $projects]);
}

// Create project
if ($path === '/api/projects' && $method === 'POST') {
    $user  = requireAdmin();
    $input = json_decode(file_get_contents('php://input'), true);
    $name  = trim($input['name'] ?? '');
    $desc  = trim($input['description'] ?? '');

    if (!$name) jsonResponse(['error' => 'Nom du projet requis'], 400);

    $id  = generateUUID();
    $pdo = getDB();
    $pdo->prepare('INSERT INTO projects (id, name, description, created_by) VALUES (?, ?, ?, ?)')
        ->execute([$id, $name, $desc, $user['id']]);

    $dir = projectDir($id);
    if (!is_dir($dir)) mkdir($dir, 0755, true);

    jsonResponse(['project' => ['id' => $id, 'name' => $name, 'description' => $desc]], 201);
}

// Get single project
if (preg_match('#^/api/projects/([a-f0-9\-]+)$#', $path, $m) && $method === 'GET') {
    $user      = requireAuth();
    $projectId = $m[1];
    $pdo       = getDB();

    $stmt = $pdo->prepare('
        SELECT p.*, u.name AS created_by_name FROM projects p
        JOIN users u ON u.id = p.created_by WHERE p.id = ?
    ');
    $stmt->execute([$projectId]);
    $project = $stmt->fetch();
    if (!$project) jsonResponse(['error' => 'Projet introuvable'], 404);

    // Check access
    if ($user['role'] !== 'admin') {
        $a = $pdo->prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?');
        $a->execute([$projectId, $user['id']]);
        if (!$a->fetch()) jsonResponse(['error' => 'Accès refusé'], 403);
    }

    // Assignees
    $assignees = $pdo->prepare('
        SELECT u.id, u.name, u.email FROM project_assignments pa
        JOIN users u ON u.id = pa.user_id WHERE pa.project_id = ?
    ');
    $assignees->execute([$projectId]);
    $project['assignees'] = $assignees->fetchAll();

    jsonResponse(['project' => $project]);
}

// Update project (name, description)
if (preg_match('#^/api/projects/([a-f0-9\-]+)$#', $path, $m) && $method === 'PATCH') {
    requireAdmin();
    $projectId = $m[1];
    $input     = json_decode(file_get_contents('php://input'), true);
    $pdo       = getDB();

    $stmt = $pdo->prepare('SELECT id FROM projects WHERE id = ?');
    $stmt->execute([$projectId]);
    if (!$stmt->fetch()) jsonResponse(['error' => 'Projet introuvable'], 404);

    $fields = [];
    $params = [];
    if (isset($input['name']))        { $fields[] = 'name = ?';        $params[] = $input['name']; }
    if (isset($input['description'])) { $fields[] = 'description = ?'; $params[] = $input['description']; }
    if (empty($fields)) jsonResponse(['error' => 'Rien à mettre à jour'], 400);

    $fields[] = 'updated_at = ?';
    $params[] = time();
    $params[] = $projectId;
    $pdo->prepare('UPDATE projects SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    jsonResponse(['success' => true]);
}

// Delete project
if (preg_match('#^/api/projects/([a-f0-9\-]+)$#', $path, $m) && $method === 'DELETE') {
    requireAdmin();
    $projectId = $m[1];
    $pdo       = getDB();

    $stmt = $pdo->prepare('SELECT id FROM projects WHERE id = ?');
    $stmt->execute([$projectId]);
    if (!$stmt->fetch()) jsonResponse(['error' => 'Projet introuvable'], 404);

    $pdo->prepare('DELETE FROM projects WHERE id = ?')->execute([$projectId]);
    deleteDirectory(projectDir($projectId));
    jsonResponse(['success' => true]);
}

// Assign / unassign users to project
if (preg_match('#^/api/projects/([a-f0-9\-]+)/assign$#', $path, $m) && $method === 'POST') {
    requireAdmin();
    $projectId = $m[1];
    $input     = json_decode(file_get_contents('php://input'), true);
    $userIds   = $input['user_ids'] ?? []; // array of user ids — replaces current assignments
    $pdo       = getDB();

    $pdo->prepare('DELETE FROM project_assignments WHERE project_id = ?')->execute([$projectId]);
    $stmt = $pdo->prepare('INSERT IGNORE INTO project_assignments (project_id, user_id) VALUES (?, ?)');
    foreach ($userIds as $uid) {
        $stmt->execute([$projectId, (int)$uid]);
    }
    // Update project timestamp
    $pdo->prepare('UPDATE projects SET updated_at = ? WHERE id = ?')->execute([time(), $projectId]);
    jsonResponse(['success' => true]);
}

// ======== FILES ========

// List files in a project (with filters)
if (preg_match('#^/api/projects/([a-f0-9\-]+)/files$#', $path, $m) && $method === 'GET') {
    $user      = requireAuth();
    $projectId = $m[1];
    $pdo       = getDB();

    // Access check
    if ($user['role'] !== 'admin') {
        $a = $pdo->prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?');
        $a->execute([$projectId, $user['id']]);
        if (!$a->fetch()) jsonResponse(['error' => 'Accès refusé'], 403);
    }

    // Build query with optional filters
    $where  = ['f.project_id = ?'];
    $params = [$projectId];

    $type   = $_GET['type']   ?? '';
    $level  = $_GET['level']  ?? '';
    $author = $_GET['author'] ?? '';
    $search = $_GET['search'] ?? '';

    if ($type)   { $where[] = 'f.type = ?';      $params[] = $type; }
    if ($level)  { $where[] = 'f.level = ?';     $params[] = (int)$level; }
    if ($author) { $where[] = 'f.author_id = ?'; $params[] = (int)$author; }
    if ($search) { $where[] = 'f.name LIKE ?';   $params[] = '%' . $search . '%'; }

    $sql = '
        SELECT f.*, u.name AS author_name,
               p.name AS parent_name,
               pu.name AS parent_author_name
        FROM files f
        JOIN users u ON u.id = f.author_id
        LEFT JOIN files p ON p.id = f.parent_id
        LEFT JOIN users pu ON pu.id = p.author_id
        WHERE ' . implode(' AND ', $where) . '
        ORDER BY f.updated_at DESC
    ';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    jsonResponse(['files' => $stmt->fetchAll()]);
}

// Upload / save a file (create or update)
if (preg_match('#^/api/projects/([a-f0-9\-]+)/files$#', $path, $m) && $method === 'POST') {
    $user      = requireAuth();
    $projectId = $m[1];
    $pdo       = getDB();

    // Access check
    if ($user['role'] !== 'admin') {
        $a = $pdo->prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?');
        $a->execute([$projectId, $user['id']]);
        if (!$a->fetch()) jsonResponse(['error' => 'Accès refusé'], 403);
    }

    $name          = trim($_POST['name']           ?? '');
    $type          = trim($_POST['type']           ?? 'sequence');
    $level         = (int)($_POST['level']         ?? 0);
    $fileId        = trim($_POST['file_id']        ?? ''); // empty = new file
    $modeleSavedAt = !empty($_POST['modele_saved_at']) ? (int)$_POST['modele_saved_at'] : null;

    if (!$name) jsonResponse(['error' => 'Nom du fichier requis'], 400);
    if (!isset($_FILES['zip']) || $_FILES['zip']['error'] !== UPLOAD_ERR_OK)
        jsonResponse(['error' => 'Fichier ZIP manquant ou invalide'], 400);

    $dir = projectDir($projectId);
    if (!is_dir($dir)) mkdir($dir, 0755, true);

    $now = time();

    if ($fileId) {
        // Update existing file — check author
        $stmt = $pdo->prepare('SELECT * FROM files WHERE id = ? AND project_id = ?');
        $stmt->execute([$fileId, $projectId]);
        $existing = $stmt->fetch();
        if (!$existing) jsonResponse(['error' => 'Fichier introuvable'], 404);

        // If not the author, create a fork instead
        if ((int)$existing['author_id'] !== (int)$user['id']) {
            $newId = generateUUID();
            $forkName = $name . ' (copie de ' . $existing['author_name'] . ')';
            // Fetch author name for fork label
            $au = $pdo->prepare('SELECT name FROM users WHERE id = ?');
            $au->execute([$existing['author_id']]);
            $authorRow = $au->fetch();
            $forkName = $name . ' (copie — ' . ($authorRow['name'] ?? 'auteur inconnu') . ')';

            $pdo->prepare('INSERT INTO files (id, project_id, name, type, level, author_id, parent_id, created_at, updated_at, modele_saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$newId, $projectId, $forkName, $type, $level, $user['id'], $fileId, $now, $now, $modeleSavedAt]);
            move_uploaded_file($_FILES['zip']['tmp_name'], fileZipPath($projectId, $newId));

            // Update project timestamp
            $pdo->prepare('UPDATE projects SET updated_at = ? WHERE id = ?')->execute([$now, $projectId]);
            jsonResponse(['file_id' => $newId, 'forked' => true, 'name' => $forkName], 201);
        }

        // Author updating their own file
        move_uploaded_file($_FILES['zip']['tmp_name'], fileZipPath($projectId, $fileId));
        $pdo->prepare('UPDATE files SET name = ?, type = ?, level = ?, updated_at = ?, modele_saved_at = ? WHERE id = ?')
            ->execute([$name, $type, $level, $now, $modeleSavedAt, $fileId]);
        $pdo->prepare('UPDATE projects SET updated_at = ? WHERE id = ?')->execute([$now, $projectId]);
        jsonResponse(['file_id' => $fileId, 'forked' => false]);

    } else {
        // New file
        $newId = generateUUID();
        $pdo->prepare('INSERT INTO files (id, project_id, name, type, level, author_id, created_at, updated_at, modele_saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$newId, $projectId, $name, $type, $level, $user['id'], $now, $now, $modeleSavedAt]);
        move_uploaded_file($_FILES['zip']['tmp_name'], fileZipPath($projectId, $newId));
        $pdo->prepare('UPDATE projects SET updated_at = ? WHERE id = ?')->execute([$now, $projectId]);
        jsonResponse(['file_id' => $newId, 'forked' => false], 201);
    }
}

// Download a file
if (preg_match('#^/api/projects/([a-f0-9\-]+)/files/([a-f0-9\-]+)/download$#', $path, $m) && $method === 'GET') {
    $user      = requireAuth();
    $projectId = $m[1];
    $fileId    = $m[2];
    $pdo       = getDB();

    if ($user['role'] !== 'admin') {
        $a = $pdo->prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?');
        $a->execute([$projectId, $user['id']]);
        if (!$a->fetch()) jsonResponse(['error' => 'Accès refusé'], 403);
    }

    $stmt = $pdo->prepare('SELECT * FROM files WHERE id = ? AND project_id = ?');
    $stmt->execute([$fileId, $projectId]);
    $file = $stmt->fetch();
    if (!$file) jsonResponse(['error' => 'Fichier introuvable'], 404);

    $zipPath = fileZipPath($projectId, $fileId);
    if (!file_exists($zipPath)) jsonResponse(['error' => 'Fichier ZIP introuvable sur le serveur'], 404);

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . rawurlencode($file['name']) . '.zip"');
    header('Content-Length: ' . filesize($zipPath));
    readfile($zipPath);
    exit;
}

// Delete a file
if (preg_match('#^/api/projects/([a-f0-9\-]+)/files/([a-f0-9\-]+)$#', $path, $m) && $method === 'DELETE') {
    $user      = requireAuth();
    $projectId = $m[1];
    $fileId    = $m[2];
    $pdo       = getDB();

    $stmt = $pdo->prepare('SELECT * FROM files WHERE id = ? AND project_id = ?');
    $stmt->execute([$fileId, $projectId]);
    $file = $stmt->fetch();
    if (!$file) jsonResponse(['error' => 'Fichier introuvable'], 404);

    // Only author or admin can delete
    if ($user['role'] !== 'admin' && (int)$file['author_id'] !== (int)$user['id'])
        jsonResponse(['error' => 'Seul l\'auteur ou un admin peut supprimer ce fichier'], 403);

    $pdo->prepare('DELETE FROM files WHERE id = ?')->execute([$fileId]);
    $zipPath = fileZipPath($projectId, $fileId);
    if (file_exists($zipPath)) unlink($zipPath);
    jsonResponse(['success' => true]);
}

// Duplicate a file explicitly (manual fork)
if (preg_match('#^/api/projects/([a-f0-9\-]+)/files/([a-f0-9\-]+)/duplicate$#', $path, $m) && $method === 'POST') {
    $user      = requireAuth();
    $projectId = $m[1];
    $fileId    = $m[2];
    $pdo       = getDB();

    if ($user['role'] !== 'admin') {
        $a = $pdo->prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?');
        $a->execute([$projectId, $user['id']]);
        if (!$a->fetch()) jsonResponse(['error' => 'Accès refusé'], 403);
    }

    $stmt = $pdo->prepare('SELECT * FROM files WHERE id = ? AND project_id = ?');
    $stmt->execute([$fileId, $projectId]);
    $file = $stmt->fetch();
    if (!$file) jsonResponse(['error' => 'Fichier introuvable'], 404);

    $srcZip = fileZipPath($projectId, $fileId);
    if (!file_exists($srcZip)) jsonResponse(['error' => 'Fichier ZIP source introuvable'], 404);

    $newId   = generateUUID();
    $newName = $file['name'] . ' (copie)';
    $now     = time();

    $pdo->prepare('INSERT INTO files (id, project_id, name, type, level, author_id, parent_id, created_at, updated_at, modele_saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$newId, $projectId, $newName, $file['type'], $file['level'], $user['id'], $fileId, $now, $now, $file['modele_saved_at'] ?? null]);
    copy($srcZip, fileZipPath($projectId, $newId));
    $pdo->prepare('UPDATE projects SET updated_at = ? WHERE id = ?')->execute([$now, $projectId]);

    jsonResponse(['file_id' => $newId, 'name' => $newName], 201);
}

// ======== UPGRADE MODELE (server-side zip merge) ========

if (preg_match('#^/api/projects/([a-f0-9\-]+)/files/([a-f0-9\-]+)/upgrade-modele$#', $path, $m) && $method === 'POST') {
    $user      = requireAuth();
    $projectId = $m[1];
    $fileId    = $m[2];
    $pdo       = getDB();

    // Verify project access
    if ($user['role'] !== 'admin') {
        $a = $pdo->prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?');
        $a->execute([$projectId, $user['id']]);
        if (!$a->fetch()) jsonResponse(['error' => 'Accès refusé'], 403);
    }

    // Load file and verify author access
    $stmt = $pdo->prepare('SELECT * FROM files WHERE id = ? AND project_id = ?');
    $stmt->execute([$fileId, $projectId]);
    $file = $stmt->fetch();
    if (!$file) jsonResponse(['error' => 'Fichier introuvable'], 404);

    if ((int)$file['author_id'] !== (int)$user['id'] && $user['role'] !== 'admin') {
        jsonResponse(['error' => 'Seul l\'auteur peut mettre à jour ce fichier. Dupliquez-le d\'abord pour créer votre propre copie.'], 403);
    }

    // Determine which Modele to use
    $modeleName = $file['type'] === 'flashcards' ? 'Modele_Flashcards' : 'Modele';
    $modeleZip  = __DIR__ . '/../Modele/' . $modeleName . '.zip';
    $storedZip  = fileZipPath($projectId, $fileId);

    if (!file_exists($modeleZip)) jsonResponse(['error' => 'Modèle introuvable sur le serveur'], 500);
    if (!file_exists($storedZip)) jsonResponse(['error' => 'Fichier ZIP source introuvable'], 404);

    // Build merged zip: Modele shell (no Ressources_Sequences/) + stored Ressources_Sequences/
    $tmpFile = tempnam(sys_get_temp_dir(), 'modele_merge_');

    $src   = new ZipArchive();
    $shell = new ZipArchive();
    $out   = new ZipArchive();

    if ($src->open($storedZip) !== true)           jsonResponse(['error' => 'Impossible d\'ouvrir le zip source'], 500);
    if ($shell->open($modeleZip) !== true)         { $src->close();   jsonResponse(['error' => 'Impossible d\'ouvrir le modèle'], 500); }
    if ($out->open($tmpFile, ZipArchive::OVERWRITE) !== true) { $src->close(); $shell->close(); jsonResponse(['error' => 'Impossible de créer le zip temporaire'], 500); }

    // 1. Everything from Modele except Ressources_Sequences/
    for ($i = 0; $i < $shell->numFiles; $i++) {
        $name = $shell->getNameIndex($i);
        if (strpos($name, 'Ressources_Sequences/') === 0) continue;
        $content = $shell->getFromIndex($i);
        if ($content !== false) $out->addFromString($name, $content);
    }
    $shell->close();

    // 2. Ressources_Sequences/ from stored project zip
    for ($i = 0; $i < $src->numFiles; $i++) {
        $name = $src->getNameIndex($i);
        if (strpos($name, 'Ressources_Sequences/') !== 0) continue;
        $content = $src->getFromIndex($i);
        if ($content !== false) $out->addFromString($name, $content);
    }
    $src->close();
    $out->close();

    // Replace stored zip with merged result
    if (!rename($tmpFile, $storedZip)) {
        @unlink($tmpFile);
        jsonResponse(['error' => 'Impossible de remplacer le fichier zip'], 500);
    }

    // Update DB
    $now           = time();
    $modeleSavedAt = filemtime($modeleZip);
    $pdo->prepare('UPDATE files SET updated_at = ?, modele_saved_at = ? WHERE id = ?')
        ->execute([$now, $modeleSavedAt, $fileId]);
    $pdo->prepare('UPDATE projects SET updated_at = ? WHERE id = ?')->execute([$now, $projectId]);

    jsonResponse(['success' => true, 'modele_saved_at' => $modeleSavedAt, 'updated_at' => $now]);
}

// ======== ADMIN — MODELE UPLOAD ========

if (preg_match('#^/api/admin/modeles/([a-zA-Z0-9_\-]+)$#', $path, $m) && $method === 'POST') {
    requireAdmin();

    $allowed = ['Modele', 'Modele_Flashcards', 'Modele_QuickPreview'];
    $name = $m[1];
    if (!in_array($name, $allowed, true)) {
        jsonResponse(['error' => 'Nom de modèle invalide'], 400);
    }

    if (empty($_FILES['file'])) {
        jsonResponse(['error' => 'Aucun fichier reçu'], 400);
    }

    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        jsonResponse(['error' => 'Erreur lors de l\'upload'], 500);
    }

    // Validate it's a zip
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime  = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
    if (!in_array($mime, ['application/zip', 'application/x-zip-compressed'], true)) {
        jsonResponse(['error' => 'Le fichier doit être un ZIP'], 400);
    }

    $dest = __DIR__ . '/../Modele/' . $name . '.zip';
    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        jsonResponse(['error' => 'Impossible d\'écrire le fichier sur le serveur'], 500);
    }

    jsonResponse(['success' => true, 'name' => $name]);
}

// --- FALLBACK ---
jsonResponse(['error' => 'Endpoint not found'], 404);
