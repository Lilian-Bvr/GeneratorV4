# Documentation des types d'activités — GeneratorV4

Ce document décrit les trois types de fichiers pédagogiques générés par l'application, leur structure JSON, leur flux de génération IA et leur format d'export.

---

## Vue d'ensemble

L'application génère trois types de contenus SCORM, définis dans la DB par l'ENUM `('sequence', 'flashcards', 'court')` :

| Type | Template ZIP | Sections | Usage |
|------|-------------|----------|-------|
| `sequence` | `Modele/Modele.zip` | S1, S2, S3, S4 | Cours complet structuré |
| `court` | `Modele/Modele_Court.zip` | S1 uniquement | Pratique intensive ciblée |
| `flashcards` | `Modele/Modele_Flashcards.zip` | Courtes / Longues / Révision | Mémorisation vocabulaire |

---

## 1. TYPE `sequence` — Séquence complète

### Structure globale (ZIP exporté)

```
Ressources_Sequences/
├── S0/variables.json          ← Métadonnées globales
├── S1/
│   ├── variables.json         ← Exercices de S1
│   └── Audios/                ← Audios de S1
├── S2/ ...
├── S3/ ...
└── S4/ ...
```

### S0 — Métadonnées globales

```json
{
  "Chapter_Title": "Titre du chapitre",
  "Level": 1,
  "S1_Exo_Total": 5,
  "S2_Exo_Total": 5,
  "S3_Exo_Total": 5,
  "S4_Exo_Total": 5,
  "Durations": { "S1": 15, "S2": 20, "S3": 25, "S4": 20 }
}
```

### S1–S4 — variables.json

Chaque section contient un objet d'exercices indexés `EX1`, `EX2`, … et un objet `Recap`.

```json
{
  "EX1": { "Type": "...", ... },
  "EX2": { "Type": "...", ... },
  "Recap": { "Type": "Minimaliste|Liste|Texte", ... }
}
```

### Noms des sections

| Clé | Nom affiché |
|-----|-------------|
| S1 | Découvre |
| S2 | Pratique |
| S3 | Approfondis |
| S4 | Consolide |

### Champs communs à tous les exercices

```json
{
  "Type": "...",
  "Consigne": "Texte de la consigne",
  "Tentatives": 1,
  "Image": "Ressources_Sequences/S1/Images/S1_EX1.jpg",
  "Video": null,
  "Audio_Enonce": {
    "fichier": "Ressources_Sequences/S1/Audios/S1_EX1_main.mp3",
    "transcription": "Texte lu"
  }
}
```

### Les 12 types d'exercices disponibles

#### True or false
```json
{
  "Type": "True or false",
  "Affirmation": "La BCE fixe les taux directeurs.",
  "BonneReponse": "True",
  "Feedback": { "Type": "Simple" }
}
```

#### QCU
```json
{
  "Type": "QCU",
  "Question": "Qu'a décidé la BCE ?",
  "Reponses": { "A": "Relever", "B": "Baisser", "C": "Maintenir", "D": "Suspendre" },
  "BonneReponse": "A",
  "Feedback": { "Type": "Complet" }
}
```

#### QCM
```json
{
  "Type": "QCM",
  "Question": "Quels sont les impacts d'une hausse de taux ?",
  "Reponses": { "A": "...", "B": "...", "C": "...", "D": "..." },
  "Corrections": ["A", "C"],
  "Feedback": { "Type": "Simple" }
}
```

#### Matching
```json
{
  "Type": "Matching",
  "Match_Type": "audio-texte",
  "Paires": {
    "P1": {
      "Match_L1": "Ressources_Sequences/S1/Audios/S1_EX1_Match_L1.mp3",
      "Match_R1": "Définition correspondante",
      "Transcription_L1": "Script de l'audio"
    },
    "P2": { ... }, "P3": { ... }, "P4": { ... }
  }
}
```
`Match_Type` peut être `audio-texte`, `texte-texte` ou `audio-audio`.

#### Complete (lacunes)

Sous-type **options** :
```json
{
  "Type": "Complete",
  "Complete_Type": "options",
  "Texte_Complet": "La BCE a décidé de #relever# les taux de #25# points de base.",
  "Texte_Incomplet": "La BCE a décidé de ___ les taux de ___ points de base.",
  "Options": ["relever", "baisser", "25", "50"]
}
```

Sous-type **reconstruit** (remise en ordre) :
```json
{
  "Type": "Complete",
  "Complete_Type": "reconstruit",
  "Texte_Complet": "Il faut #surveiller# l'#inflation# avant toute décision.",
  "Texte_Incomplet": "surveiller inflation toute décision il faut l' avant",
  "Options": ["surveiller", "inflation", "toute", "décision", "il", "faut", "l'", "avant"]
}
```

#### Flashcard (dans séquence)

Sous-type **courte** :
```json
{
  "Type": "Flashcard",
  "Flashcard_Type": "courte",
  "Front_Text": "le taux directeur",
  "Back_Text": "the key interest rate",
  "Back_Audio": "Ressources_Sequences/S1/Audios/S1_EX1_back.mp3",
  "Extra": { "Type": "Aucune" }
}
```

Sous-type **longue** :
```json
{
  "Type": "Flashcard",
  "Flashcard_Type": "longue",
  "Front_Text": "le taux directeur",
  "Back_Text": "Taux fixé par la BCE pour guider la politique monétaire.",
  "Front_Audio": "Ressources_Sequences/S1/Audios/S1_EX1_front.mp3",
  "Back_Audio": "Ressources_Sequences/S1/Audios/S1_EX1_back.mp3",
  "Extra": { "Type": "Phrases|Expressions|Aucune", "Elements": [] }
}
```

#### Leçon

Sous-type **simple** :
```json
{
  "Type": "Leçon",
  "SubType": "simple",
  "Expression_FR": "le taux directeur",
  "Expression_EN": "the key interest rate",
  "Exemple_FR": "La BCE a décidé de relever le taux directeur.",
  "Exemple_EN": "The ECB decided to raise the key interest rate.",
  "Audio_Exemple": "Ressources_Sequences/S1/Audios/S1_EX1_example.mp3",
  "Audio_Expression": "Ressources_Sequences/S1/Audios/S1_EX1_exprFr.mp3"
}
```

Sous-type **complexe** (tableau) :
```json
{
  "Type": "Leçon",
  "SubType": "complexe",
  "Texte_HTML": "<p>Explication...</p>",
  "Has_Header": true,
  "Headers": ["Terme", "Définition"],
  "Lignes": [
    {
      "Ligne": 1,
      "Colonnes": [
        { "Texte": "le taux directeur", "Audio": "Ressources_Sequences/S1/Audios/S1_EX1_LessonTable_L1_C1.mp3" },
        { "Texte": "Taux fixé par la BCE", "Audio": "Ressources_Sequences/S1/Audios/S1_EX1_LessonTable_L1_C2.mp3" }
      ]
    }
  ]
}
```

#### Dialogue
```json
{
  "Type": "Dialogue",
  "Script": [
    { "Nom": "Chargé de clientèle", "Texte": "Bonjour, comment puis-je vous aider ?" },
    { "Nom": "Client", "Texte": "Je voudrais un conseil sur mon compte." }
  ],
  "Script_HTML": "<b>Chargé de clientèle :</b> Bonjour..."
}
```

#### Information
```json
{
  "Type": "Information",
  "Titre": "Titre de l'info",
  "Expression": "le taux directeur",
  "Exemple": "La BCE a relevé le taux directeur à 4%.",
  "Exemple_Audio": "Ressources_Sequences/S1/Audios/S1_EX1_exemple.mp3"
}
```

#### Media (contexte audio/vidéo)
```json
{
  "Type": "Media",
  "Media_Type": "video|image_audio",
  "Image": "Ressources_Sequences/S1/Images/S1_EX1.jpg",
  "Video": {
    "fichier": "Ressources_Sequences/S1/Videos/S1_EX1.mp4",
    "transcription": "Script vidéo"
  }
}
```

#### Production orale — dictée
```json
{
  "Type": "Production orale - dictée",
  "Phrase": "La BCE a décidé de relever le taux directeur.",
  "Fournir_Audio": true,
  "Audio_Exemple": "Ressources_Sequences/S1/Audios/S1_EX1_main.mp3",
  "Feedback": { "Type": "Simple" }
}
```

#### Recap (fin de section)

```json
{ "Recap": { "Type": "Minimaliste" } }
```
```json
{
  "Recap": {
    "Type": "Liste",
    "Expressions": [
      { "Texte": "le taux directeur", "Audio": "Ressources_Sequences/S1/Audios/Recap_1.mp3" }
    ]
  }
}
```
```json
{ "Recap": { "Type": "Texte", "Texte": "Dans cette section, vous avez appris..." } }
```

### Audios dans le ZIP (convention de nommage)

```
Ressources_Sequences/S1/Audios/
├── S1_EX1_main.mp3              ← Audio principal / énoncé
├── S1_EX1_exemple.mp3           ← Exemple (Information)
├── S1_EX1_feedback.mp3          ← Feedback
├── S1_EX1_Match_L1.mp3          ← Matching côté gauche
├── S1_EX1_Match_R1.mp3          ← Matching côté droit
├── S1_EX1_front.mp3             ← Flashcard face avant
├── S1_EX1_back.mp3              ← Flashcard face arrière
├── S1_EX1_exprFr.mp3            ← Leçon simple : expression FR
├── S1_EX1_example.mp3           ← Leçon simple : exemple
├── S1_EX1_LessonTable_L1_C1.mp3 ← Leçon complexe : ligne 1 colonne 1
├── S1_EX1_LessonTable_L1_C2.mp3 ← Leçon complexe : ligne 1 colonne 2
└── Recap_1.mp3, Recap_2.mp3     ← Recap Liste
```

### Génération IA (endpoint `POST /api/anthropic/generate`)

| `step` | Modèle | Rôle | Champs requis |
|--------|--------|------|---------------|
| `seq-vocab` | claude-sonnet-4-6 | Génère le vocabulaire cible | `theme`, `niveau` |
| `seq-outline` | claude-sonnet-4-6 | Génère le plan pédagogique (types d'exos par section) | `vocabulary`, `counts` |
| `seq-exercise` | claude-haiku-4-5 | Génère le contenu d'un exercice | `vocabulary`, `outline`, `exercise` |

Réponse de `seq-vocab` :
```json
{
  "vocabulary": [
    { "id": "v1", "expression": "le taux directeur", "example": "Phrase en contexte.", "grammar": "[nom masculin]" }
  ]
}
```

Réponse de `seq-outline` :
```json
{
  "outline": {
    "S1": [ { "id": "s1_1", "type": "QCU", "subtype": null, "focus": "...", "vocab_ids": ["v1"] } ],
    "S2": [ ... ], "S3": [ ... ], "S4": [ ... ]
  }
}
```

---

## 2. TYPE `court` — Séquence courte

Identique à `sequence` mais limité à **S1 uniquement**, appelée "Pratique".

Différences clés :
- Seul `S1/variables.json` est généré (pas de S2/S3/S4)
- Le prompt `seq-outline` est orienté "drill intensif" : pas de Leçon sauf en dernière position
- Template : `Modele/Modele_Court.zip`
- Types d'exercices autorisés : QCU, QCM, True or false, Matching, Complete, Flashcard, Dialogue

---

## 3. TYPE `flashcards` — Paquet de flashcards

### Structure globale (ZIP exporté)

```
Ressources_FCs/
├── S0/variables.json                      ← Métadonnées globales
├── Flashcards_Courtes/variables.json      ← Cartes courtes (expression → traduction)
├── Flashcards_Longues/variables.json      ← Cartes longues (expression → phrase)
├── Flashcards_Revision/variables.json     ← Exercices de révision (matching)
└── Audios/
    ├── Expressions/FC_1.mp3 …             ← Audios arrière des cartes courtes
    ├── LonguesFront/FC_1.mp3 …            ← Audios avant des cartes longues
    └── LonguesDef/FC_1.mp3 …             ← Audios arrière des cartes longues
```

### S0 — Métadonnées globales

```json
{
  "Titre": "Titre du paquet",
  "Niveau": "1",
  "Theme": "Thème",
  "FC_Courtes_Total": 10,
  "FC_Longues_Total": 10,
  "FC_Revision_Total": 3,
  "Durations": { "Courtes": 5, "Longues": 10, "Revision": 5 }
}
```

### Flashcards_Courtes/variables.json

```json
{
  "Card1": {
    "Consigne": "Texte instruction (optionnel)",
    "Front_Text": "le taux directeur",
    "Back_Text": "the key interest rate",
    "Back_Audio": "Ressources_FCs/Audios/Expressions/FC_1.mp3"
  },
  "Card2": { ... }
}
```

### Flashcards_Longues/variables.json

```json
{
  "Card1": {
    "Consigne": "Instruction spécifique",
    "Front_Text": "le taux directeur",
    "Front_Audio": "Ressources_FCs/Audios/LonguesFront/FC_1.mp3",
    "Back_Text": "La BCE a décidé de relever le taux directeur à 4%.",
    "Back_Audio": "Ressources_FCs/Audios/LonguesDef/FC_1.mp3",
    "Courte_Ref": 1
  }
}
```
`Courte_Ref` est l'index de la carte courte associée (0 = aucune).

### Flashcards_Revision/variables.json

Exercices de matching audio : associer expression à définition.

```json
{
  "Matching1": {
    "Consigne": "Associez les expressions à leurs définitions",
    "Paire_1": {
      "Audio_Definition": {
        "fichier": "Ressources_FCs/Audios/LonguesDef/FC_1.mp3",
        "transcription": "Définition ou phrase d'exemple"
      },
      "Audio_Expression": {
        "fichier": "Ressources_FCs/Audios/Expressions/FC_1.mp3",
        "transcription": "Traduction courte"
      }
    },
    "Paire_2": { ... }, "Paire_3": { ... }, "Paire_4": { ... }
  },
  "Matching2": { ... }
}
```
Chaque Matching contient 4 paires, construites à partir des cartes Courtes + Longues existantes.

### Génération IA

| `step` | Modèle | Rôle | Champs requis |
|--------|--------|------|---------------|
| `expressions` | claude-sonnet-4-6 | Génère 10 expressions FR + traduction EN | `theme`, `niveau` |
| `sentences` | claude-sonnet-4-6 | Génère phrase + consigne pour chaque expression | `theme`, `expressions` |

Réponse de `expressions` :
```json
{
  "expressions": [
    { "fr": "le taux directeur", "en": "the key interest rate" }
  ]
}
```

Réponse de `sentences` :
```json
{
  "sentences": [
    {
      "instruction": "Utilisez \"le taux directeur\" pour expliquer une décision à un client.",
      "sentence": "La BCE a décidé de relever le taux directeur à 4%."
    }
  ]
}
```

---

## 4. Endpoints API

### `POST /api/anthropic/generate`
Corps JSON : `{ "step": "...", ...champs selon le step }`

### `POST /api/projects/{projectId}/files`
Sauvegarde un ZIP généré. Retourne `{ file_id, forked }`.

### `GET /api/projects/{projectId}/files`
Liste les fichiers d'un projet. Retourne `{ files: [{id, name, type, level, ...}] }`.

### `POST /upload`
Upload temporaire pour preview SCORM. Retourne `{ launchUrl }`.

---

## 5. Fichiers clés

| Fichier | Rôle |
|---------|------|
| `script.js` | Frontend complet (génération, preview, export) |
| `api/server.php` | Backend : routing, génération IA, gestion fichiers |
| `Modele/Modele.zip` | Template SCORM séquence 4 sections |
| `Modele/Modele_Court.zip` | Template SCORM séquence courte |
| `Modele/Modele_Flashcards.zip` | Template SCORM flashcards mobile |
| `Modele/Modele_QuickPreview.zip` | Template preview rapide (1 exercice) |
| `Curriculum/curriculum.json` | Niveaux CEFR et descripteurs pour les prompts IA |
