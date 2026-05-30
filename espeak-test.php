<?php
// Test phonetizers availability — DELETE THIS FILE AFTER TESTING
echo "<pre>\n";

$tools = [
    'espeak-ng' => 'espeak-ng --version 2>&1',
    'espeak'    => 'espeak --version 2>&1',
    'festival'  => 'festival --version 2>&1',
    'python3'   => 'python3 --version 2>&1',
    'php'       => 'php --version 2>&1',
];

foreach ($tools as $name => $cmd) {
    $out = shell_exec("which $name 2>&1");
    $ver = $out && !str_contains($out, 'no ') ? trim(shell_exec($cmd)) : 'non disponible';
    echo str_pad($name, 12) . " : " . ($out ? trim($out) : 'introuvable') . "\n";
    echo str_pad('', 12) . "   $ver\n\n";
}

echo "=== Test IPA espeak ===\n";
$ipa = shell_exec('espeak -v fr -q --ipa "bonjour" 2>&1');
echo "espeak fr    : " . ($ipa ?: "(vide)") . "\n";

$ipa2 = shell_exec('espeak -v fr-ca -q --ipa "bonjour" 2>&1');
echo "espeak fr-ca : " . ($ipa2 ?: "(vide)") . "\n";

echo "\n=== Python phonemizer ? ===\n";
$py = shell_exec('python3 -c "import phonemizer; print(phonemizer.__version__)" 2>&1');
echo "phonemizer : " . ($py ?: "(non installé)") . "\n";

echo "</pre>";
