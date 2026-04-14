<?php
if (!defined('APP_LOADED')) { http_response_code(403); exit('Forbidden'); }

define('PROJECTS_DIR', __DIR__ . '/../data/projects');

function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

// Returns the authenticated user array or sends 401
function requireAuth(): array {
    $token = extractToken();
    if (!$token) jsonResponse(['error' => 'Non authentifié'], 401);
    $pdo  = getDB();
    $stmt = $pdo->prepare('
        SELECT u.id, u.name, u.email, u.role
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?
    ');
    $stmt->execute([$token, time()]);
    $user = $stmt->fetch();
    if (!$user) jsonResponse(['error' => 'Session expirée ou invalide'], 401);
    return $user;
}

function requireAdmin(): array {
    $user = requireAuth();
    if ($user['role'] !== 'admin') jsonResponse(['error' => 'Accès refusé'], 403);
    return $user;
}

function generateUUID(): string {
    return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

function projectDir(string $projectId): string {
    return PROJECTS_DIR . '/' . $projectId;
}

function fileZipPath(string $projectId, string $fileId): string {
    return projectDir($projectId) . '/' . $fileId . '.zip';
}
