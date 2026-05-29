<?php
// Prevent direct access
if (!defined('APP_LOADED')) { http_response_code(403); exit('Forbidden'); }

// Company password (bcrypt hash)
// Generate this with setup.php, then delete setup.php
define('COMPANY_PASSWORD_HASH', '');

// Company display name
define('COMPANY_NAME', 'Elearning');

// API Keys (keep these secret!)
define('ELEVENLABS_API_KEY', '');
define('GEMINI_API_KEY', '');
define('DEEPL_API_KEY', ''); // DeepL API key (free: api-free.deepl.com, pro: api.deepl.com)
define('ANTHROPIC_API_KEY', ''); // sk-ant-... from console.anthropic.com

// Azure Cognitive Services — Speech Assessment
define('AZURE_SPEECH_KEY', '');    // Clé depuis Azure Portal > Speech resource > Keys and Endpoint
define('AZURE_SPEECH_REGION', ''); // Ex: canadacentral, eastus, francecentral

// Session duration in seconds (8 hours)
define('SESSION_EXPIRY', 8 * 60 * 60);

// Sessions file path (outside public_html for security)
// __DIR__ = public_html/api/ → ../../ = home directory
define('SESSIONS_FILE', realpath(__DIR__ . '/../../') . '/generator_sessions.json');
