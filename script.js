/*  ======  INITIALISATION  ======  */
const sections = { S1: { count: 0 }, S2: { count: 0 }, S3: { count: 0 }, S4: { count: 0 } };
const imagesData = {};
const audiosData = {};
const videosData = {};
const recapAudiosData = {};
let currentImageConfirmCallback = null;
let cropper, currentExId;
let ffmpeg = null;
let ffmpegLoaded = false;
let currentVideoFile = null;
let currentVideoId = null;
let devMode = false;
let isImporting = false;
let isDragging = false;

// ElevenLabs voice whitelist — only these voices are shown
const VOICE_WHITELIST = [
  { id: 'UJCi4DDncuo0VJDSIegj', name: '♀️ Amélie (Québec)' },
  { id: 'mActWQg9kibLro6Z2ouY', name: '♀️ Riya (Québec)' },
  { id: 'mVjOqyqTPfwlXPjV5sjX', name: '♂️ Thierry (Québec)' },
  { id: 'IPgYtHTNLjC7Bq7IPHrm', name: '♂️ Alexandre (Québec)' },
  { id: 'DOqLhiOMs8JmafdomNTP', name: '♀️ Cécile (France)' },
  { id: '3C1zYzXNXNzrB66ON8rj', name: '♀️ Jade (France)' },
  { id: 'xjN7jStE1u3GcbtBb0ln', name: '♂️ Charles (France)' },
  { id: 'APeMLYgzzS2PWgyn5j9V', name: '♂️ Pierre (France)' },
];
const VOICE_WHITELIST_IDS = new Set(VOICE_WHITELIST.map(v => v.id));

/*  ======  CONNEXION ENTREPRISE  ======  */
// Derived from current path so the app works at root or in any subfolder (e.g. /test/)
const SERVER_URL = window.location.pathname.replace(/\/[^/]*$/, '');
let sessionToken = sessionStorage.getItem('companySessionToken') || null;
let companyName = sessionStorage.getItem('companyName') || '';
let isCompanyLoggedIn = false;

async function checkSessionStatus() {
  if (!sessionToken) return;
  try {
    const res = await fetch(`${SERVER_URL}/auth/status`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      companyName = data.companyName || companyName;
      isCompanyLoggedIn = true;
      updateLoginUI(true);
    } else {
      clearSession();
    }
  } catch (e) {
    console.warn('Server not reachable, company login unavailable');
    clearSession();
  }
}

function showLoginModal() {
  const existing = document.getElementById('companyLoginModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'companyLoginModal';
  modal.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;z-index:3000;backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:white;border-radius:12px;padding:28px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h4 style="margin:0;color:#333;"><i class="bi bi-building"></i> Connexion Entreprise</h4>
        <button onclick="closeLoginModal()" style="border:none;background:none;font-size:24px;cursor:pointer;color:#666;">&times;</button>
      </div>
      <p class="text-muted small">Connectez-vous avec le mot de passe de votre entreprise pour utiliser les clés API partagées.</p>
      <div class="mb-3">
        <label class="form-label fw-bold">Mot de passe</label>
        <input type="password" id="companyPasswordInput" class="form-control" placeholder="Mot de passe entreprise"
          onkeydown="if(event.key==='Enter')handleLogin()">
      </div>
      <div id="loginError" class="text-danger small mb-2" style="display:none;"></div>
      <div class="d-flex gap-2">
        <button class="btn btn-secondary flex-fill" onclick="closeLoginModal()">Annuler</button>
        <button class="btn btn-primary flex-fill" id="loginSubmitBtn" onclick="handleLogin()">
          <i class="bi bi-box-arrow-in-right"></i> Se connecter
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('companyPasswordInput')?.focus(), 100);
}

function closeLoginModal() {
  const modal = document.getElementById('companyLoginModal');
  if (modal) modal.remove();
}

async function handleLogin() {
  const pwd = document.getElementById('companyPasswordInput')?.value;
  if (!pwd) return;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Connexion...';
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${SERVER_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      sessionToken = data.token;
      companyName = data.companyName || 'Entreprise';
      isCompanyLoggedIn = true;
      sessionStorage.setItem('companySessionToken', sessionToken);
      sessionStorage.setItem('companyName', companyName);
      updateLoginUI(true);
      closeLoginModal();
      // Pre-load ElevenLabs voices via proxy
      loadElevenLabsVoices();
    } else {
      errEl.textContent = data.error || 'Mot de passe incorrect';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = 'Impossible de joindre le serveur';
    errEl.style.display = 'block';
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Se connecter';
}

async function handleLogout() {
  try {
    await fetch(`${SERVER_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
  } catch (e) { /* ignore */ }
  clearSession();
}

async function handleGateLogin() {
  const pwd = document.getElementById('gatePasswordInput')?.value;
  if (!pwd) return;
  const errEl = document.getElementById('gateLoginError');
  const btn = document.getElementById('gateLoginBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Connexion...';
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${SERVER_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      sessionToken = data.token;
      companyName = data.companyName || 'Entreprise';
      isCompanyLoggedIn = true;
      sessionStorage.setItem('companySessionToken', sessionToken);
      sessionStorage.setItem('companyName', companyName);
      updateLoginUI(true);
      loadElevenLabsVoices();
      document.getElementById('gatePasswordInput').value = '';
    } else {
      errEl.textContent = data.error || 'Mot de passe incorrect';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = 'Impossible de joindre le serveur';
    errEl.style.display = 'block';
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Se connecter';
}

function clearSession() {
  sessionToken = null;
  companyName = '';
  isCompanyLoggedIn = false;
  sessionStorage.removeItem('companySessionToken');
  sessionStorage.removeItem('companyName');
  updateLoginUI(false);
}

function updateLoginUI(loggedIn) {
  const gate = document.getElementById('appLoginGate');
  const modeSelector = document.getElementById('appModeSelector');
  const loggedBadge = document.getElementById('companyLoggedBadge');
  const nameLabel = document.getElementById('companyNameLabel');
  const fixedBar = document.getElementById('fixedActionBar');
  if (loggedIn) {
    if (gate) gate.style.display = 'none';
    if (modeSelector) { modeSelector.style.display = 'flex'; }
    if (loggedBadge) loggedBadge.style.display = 'flex';
    if (nameLabel) nameLabel.textContent = companyName;
    if (fixedBar) fixedBar.style.display = 'none'; // hidden until sequenceur mode selected
  } else {
    if (gate) gate.style.display = 'flex';
    if (modeSelector) modeSelector.style.display = 'none';
    document.getElementById('appSequenceur').style.display = 'none';
    document.getElementById('appCartes').style.display = 'none';
    if (loggedBadge) loggedBadge.style.display = 'none';
    if (fixedBar) fixedBar.style.display = 'none';
    setTimeout(() => document.getElementById('gatePasswordInput')?.focus(), 50);
  }
}

function selectMode(mode) {
  const modeSelector = document.getElementById('appModeSelector');
  const fixedBar = document.getElementById('fixedActionBar');
  document.getElementById('appSequenceur').style.display = 'none';
  document.getElementById('appCartes').style.display = 'none';
  if (!mode) {
    if (modeSelector) modeSelector.style.display = 'flex';
    if (fixedBar) fixedBar.style.display = 'none';
  } else {
    if (modeSelector) modeSelector.style.display = 'none';
    if (mode === 'sequenceur') {
      document.getElementById('appSequenceur').style.display = 'block';
      if (fixedBar) fixedBar.style.display = 'flex';
    } else if (mode === 'cartes') {
      document.getElementById('appCartes').style.display = 'block';
      if (fixedBar) fixedBar.style.display = 'none';
      _initCartesMode();
    }
  }
}

function _initCartesMode() {
  // Show/hide add buttons based on fixed-count mode
  const addBtnIds = ['cartesAddBtn_courtes', 'cartesAddBtn_longues', 'cartesAddBtn_revision'];
  addBtnIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = CARTES_FIXED_COUNT !== null ? 'none' : '';
  });
  // Also hide the "+ Carte / + Matching" buttons in the tab headers
  ['cartesCourteAddBtn', 'cartesLongueAddBtn', 'cartesRevisionAddBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = CARTES_FIXED_COUNT !== null ? 'none' : '';
  });

  if (CARTES_FIXED_COUNT === null) return;

  // Auto-populate each section to CARTES_FIXED_COUNT if currently empty
  const count = CARTES_FIXED_COUNT;
  const empty = (listId, prefix) =>
    document.querySelectorAll(`#${listId} [id^="${prefix}"]`).length === 0;

  if (empty('carteCourtesList', 'carteCourte_')) {
    for (let i = 0; i < count; i++) addCarteCourte();
    showCarteCard('courtes', null);
  }
  if (empty('carteLonguesList', 'carteLongue_')) {
    for (let i = 0; i < count; i++) addCarteLongue();
    showCarteCard('longues', null);
  }
  if (empty('carteRevisionList', 'carteRevision_')) {
    for (let i = 0; i < count; i++) addCarteRevision();
    showCarteCard('revision', null);
  }
}

function handleBottomExport() {
  if (document.getElementById('appCartes')?.style.display !== 'none') {
    exportCartes();
  } else {
    generatePackage();
  }
}

function handleBottomPreview() {
  if (document.getElementById('appCartes')?.style.display !== 'none') {
    previewCartes();
  } else {
    previewWithLocalServer();
  }
}

function showApiKeyChoiceModal(serviceName, onPersonalKey, onCompanyLogin) {
  const existing = document.getElementById('apiKeyChoiceModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'apiKeyChoiceModal';
  modal.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;z-index:3000;backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:white;border-radius:12px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <h5 style="margin:0 0 12px;">Clé API ${serviceName} requise</h5>
      <p class="text-muted small">Choisissez comment accéder à ${serviceName} :</p>
      <div class="d-grid gap-2 mt-3">
        <button class="btn btn-primary" id="apiKeyChoiceCompanyBtn">
          <i class="bi bi-building"></i> Se connecter avec l'entreprise
        </button>
        <button class="btn btn-outline-secondary" id="apiKeyChoicePersonalBtn">
          <i class="bi bi-key"></i> Utiliser ma propre clé API
        </button>
        <button class="btn btn-link text-muted btn-sm" onclick="document.getElementById('apiKeyChoiceModal').remove();">Annuler</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('apiKeyChoicePersonalBtn').addEventListener('click', () => {
    modal.remove();
    if (onPersonalKey) onPersonalKey();
  });
  document.getElementById('apiKeyChoiceCompanyBtn').addEventListener('click', () => {
    modal.remove();
    showLoginModal();
    if (onCompanyLogin) onCompanyLogin();
  });
}



/*  ======  CONFIGURATION CENTRALE DES TYPES D'ACTIVITÉS  ======  */
const activityTypesConfig = {
  "True or false": {
    label: "True or false",
    defaultConsigne: "Vrai ou faux ?",
    feedback: ["Simple"],
    hasImage: true,
    hasAudio: true,
    hasVideo: true
  },

  "QCU": {
    label: "QCU",
    defaultConsigne: "Réponds à la question.",
    feedback: ["Simple", "Complet"],
    hasImage: true,
    hasAudio: true,
    hasVideo: true
  },

  "QCM": {
    label: "QCM",
    defaultConsigne: "Réponds à la question.",
    feedback: ["Simple", "Complet"],
    hasImage: true,
    hasAudio: true,
    hasVideo: true
  },

  "Matching": {
    label: "Matching",
    defaultConsigne: "Associe les paires.",
    hasAudio: true,
    hasImage: false,
    subtypes: {
      "audio-audio": {
        label: "Audio – Audio",
        feedback: ["Simple", "Complet"]
      },
      "audio-texte": {
        label: "Audio – Texte",
        feedback: ["Simple", "Complet"]
      },
      "texte-texte": {
        label: "Texte – Texte",
        feedback: ["Simple", "Complet"]
      }
    }
  },

  "Complete": {
    label: "Complete",
    defaultConsigne: "Écoute et complète.",
    hasAudio: true,
    subtypes: {
      "options": {
        label: "Compléter avec des options",
        feedback: ["Simple", "Complet"]
      },
      "reconstruit": {
        label: "Reconstruit la phrase",
        feedback: ["Simple", "Complet"]
      }
    }
  },

  "Flashcard": {
    label: "Flashcard",
    defaultConsigne: "Réfléchis et tourne la carte.",
    feedback: [],
  },

  "Leçon": {
    label: "Leçon",
    defaultConsigne: "Nouveautés !",
    hasImage: true,
    hasAudio: true,
    feedback: [],
    subtypes: {
      "simple": { label: "Leçon simple" },
      "complexe": { label: "Leçon complexe" }
    }
  },

  "Dialogue": {
    label: "Dialogue",
    defaultConsigne: "Écoute le dialogue.",
    feedback: [],
    hasAudio: true,
    hasImage: true
  },

  "Media": {
    label: "Media",
    feedback: [],
    hasImage: false,
    hasAudio: false,
    hasVideo: false
  }

  /*  ==============================================
  Ces activités ont été retirées pour le moment. L'activité Information a été remplacée par les leçons
  
  "Production orale - dictée": {
    label: "Production orale - dictée",
    feedback: ["Simple", "Complet"],
    hasImage: true,
    hasAudio: true
  },

  "Information": {
    label: "Information",
    feedback: []
  },

  ====================================================  */

};



function toggleDevMode() {
  devMode = document.getElementById("devModeSwitch")?.checked || false;
}



/*  ======  AJOUT/SUPPRESSION/DEPLACEMENT D'EXERCICES  ======  */
function addExercice(section) {
  sections[section].count++;
  const id = `${section}_${sections[section].count}`;
  const container = document.getElementById(`exercices_${section}`);

  const exDiv = document.createElement("div");
  exDiv.className = "exercice border rounded p-3 mb-3";
  exDiv.id = `exo_${id}`;

  // 🧩 Génération dynamique de la liste déroulante à partir de allowedTypes
  const optionsHtml = [
    `<option value="">--Choisir--</option>`,
    ...Object.keys(activityTypesConfig).map(key => `<option value="${key}">${activityTypesConfig[key].label}</option>`)
  ].join("");

  exDiv.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h3 class="mb-0">${section} – Exercice ${sections[section].count}</h3>
      <div class="btn-group">
        <button type="button" class="btn btn-sm btn-outline-secondary" title="Monter" onclick="moveExercice('${section}', ${sections[section].count}, -1)">🔼</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" title="Descendre" onclick="moveExercice('${section}', ${sections[section].count}, 1)">🔽</button>
        <button type="button" class="btn-close" onclick="removeExercice('${section}', ${sections[section].count})"></button>
      </div>
    </div>
    <label>Type</label>
    <select onchange="updateFields('${id}')" id="type_${id}" class="form-select mb-2">
      ${optionsHtml}
    </select>

    <div id="fields_${id}"></div>

    <div class="mt-3 text-center">
      <button type="button" class="btn btn-sm btn-outline-info" id="quickPreviewBtn_${id}"
        onclick="quickPreview('${id}')">
        <i class="bi bi-play-circle"></i> Quick Preview
      </button>
    </div>
    <div id="quickPreview_${id}" style="display:none;" class="mt-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>Quick Preview</strong>
        <button type="button" class="btn btn-sm btn-outline-secondary"
          onclick="closeQuickPreview('${id}')">Fermer</button>
      </div>
      <iframe id="quickPreviewFrame_${id}"
        style="width:100%;height:600px;border:1px solid #ccc;border-radius:8px;">
      </iframe>
    </div>
  `;

  container.appendChild(exDiv);
  if (!isImporting) {
    showExercise(section, sections[section].count);
  }
}
function removeExercice(section, index) {
  const id = `${section}_${index}`;

  // 🧹 Nettoyage des données associées
  delete imagesData[`${section}_EX${index}`];
  delete audiosData[`${section}_EX${index}`];
  delete videosData[`${section}_EX${index}`];

  // 🗑️ Suppression de l’exercice dans le DOM
  const exo = document.getElementById(`exo_${id}`);
  if (exo) exo.remove();

  // 🔄 Réindexation complète et uniforme (matching, QCU, etc.)
  reorderExercises(section);
}
function moveExercice(section, index, direction) {
  const container = document.getElementById(`exercices_${section}`);
  const exercises = Array.from(container.querySelectorAll(".exercice"));

  const currentIndex = index - 1;
  const targetIndex = currentIndex + direction;

  // Empêche de sortir des limites
  if (targetIndex < 0 || targetIndex >= exercises.length) return;

  const currentEx = exercises[currentIndex];
  const targetEx = exercises[targetIndex];

  // Déplace dans le DOM
  if (direction === -1) {
    container.insertBefore(currentEx, targetEx);
  } else {
    container.insertBefore(targetEx, currentEx);
  }

  // 🔁 Met à jour l'ordre et les numéros
  reorderExercises(section);
  currentExerciseId = `${section}_${targetIndex + 1}`;
  updateSidebarExerciseList();

  // 🧭 Fait défiler jusqu'en haut de l'exercice déplacé (avec une marge)
  const movedEx = document.getElementById(`exo_${section}_${targetIndex + 1}`);
  if (movedEx) {
    const offset = 100; // marge en pixels à garder au-dessus du bloc
    const rect = movedEx.getBoundingClientRect();
    const absoluteY = window.scrollY + rect.top - offset;

    window.scrollTo({
      top: absoluteY,
      behavior: "smooth"
    });
  }
}
function reorderExercises(section) {
  const container = document.getElementById(`exercices_${section}`);
  const exercises = Array.from(container.querySelectorAll(".exercice"));

  // 🔄 Réinitialise le compteur de la section
  sections[section].count = exercises.length;

  const newImages = {};
  const newAudios = {};
  const newVideos = {};

  exercises.forEach((exo, i) => {
    const newIndex = i + 1;
    const oldIdMatch = exo.id.match(/exo_(S\d+_\d+)/);
    const oldId = oldIdMatch ? oldIdMatch[1] : `${section}_${newIndex}`;
    const newId = `${section}_${newIndex}`;

    // 🟩 Mise à jour de l'ID principal
    exo.id = `exo_${newId}`;
    const title = exo.querySelector("h3");
    if (title) title.textContent = `${section} – Exercice ${newIndex}`;

    // 🔁 Mise à jour des boutons
    const buttons = exo.querySelectorAll(".btn-group button");
    if (buttons.length >= 2) {
      buttons[0].setAttribute("onclick", `moveExercice('${section}', ${newIndex}, -1)`);
      buttons[1].setAttribute("onclick", `moveExercice('${section}', ${newIndex}, 1)`);
    }

    const closeBtn = exo.querySelector(".btn-close");
    if (closeBtn) closeBtn.setAttribute("onclick", `removeExercice('${section}', ${newIndex})`);

    // 🔍 Quick Preview buttons
    const qpBtn = exo.querySelector(`[id^="quickPreviewBtn_"]`);
    if (qpBtn) qpBtn.setAttribute("onclick", `quickPreview('${newId}')`);
    const qpCloseBtn = exo.querySelector(`[id^="quickPreview_"] .btn-outline-secondary`);
    if (qpCloseBtn) qpCloseBtn.setAttribute("onclick", `closeQuickPreview('${newId}')`);

    // 🆔 Met à jour tous les ID internes
    const elements = exo.querySelectorAll("[id]");
    elements.forEach(el => {
      el.id = el.id.replace(/S\d+_\d+/, newId);
      if (el.tagName === "SELECT" && el.getAttribute("onchange")) {
        el.setAttribute("onchange", `updateFields('${newId}')`);
      }
    });

    // 🧩 Met à jour les toggles
    const imgToggle = exo.querySelector(`#imageSwitch_${newId}`);
    if (imgToggle) imgToggle.setAttribute("onchange", `toggleImageField('${newId}')`);

    const audioToggle = exo.querySelector(`#audioSwitch_${newId}`);
    if (audioToggle) audioToggle.setAttribute("onchange", `toggleAudioField('${newId}')`);

    const videoToggle = exo.querySelector(`#videoSwitch_${newId}`);
    if (videoToggle) videoToggle.setAttribute("onchange", `toggleVideoField('${newId}')`);

    const mediaTypeSelect = exo.querySelector(`#mediaType_${newId}`);
    if (mediaTypeSelect) mediaTypeSelect.setAttribute("onchange", `updateMediaTypeFields('${newId}')`);

    // 🗃 Synchronisation des blobs images/audios pour cette section
    const oldNum = oldId.split("_")[1];
    const oldKey = `${section}_EX${oldNum}`;
    const newKey = `${section}_EX${newIndex}`;

    if (imagesData[oldKey]) newImages[newKey] = imagesData[oldKey];
    if (videosData[oldKey]) newVideos[newKey] = videosData[oldKey];

    // ✅ FIX: Handle nested audio structures while preserving Blobs
    if (audiosData[oldKey]) {
      const audioData = { ...audiosData[oldKey] }; // Shallow clone preserves Blobs

      // Update nested lesson audio keys
      if (audioData.lesson && typeof audioData.lesson === 'object') {
        const updatedLesson = {};

        for (const [cellId, blob] of Object.entries(audioData.lesson)) {
          // Replace old exercise number with new one in cellId
          // Example: "S1_1_LessonTable_L1_C2" → "S1_3_LessonTable_L1_C2"
          const updatedCellId = cellId.replace(
            new RegExp(`^${section}_${oldNum}_`),
            `${section}_${newIndex}_`
          );
          updatedLesson[updatedCellId] = blob; // Preserve the actual Blob
        }

        audioData.lesson = updatedLesson;
      }

      newAudios[newKey] = audioData;
    }
  });

  // ✅ Met à jour uniquement les clés de la section concernée
  for (const key of Object.keys(imagesData)) {
    if (key.startsWith(`${section}_EX`)) delete imagesData[key];
  }
  Object.assign(imagesData, newImages);

  
  for (const key of Object.keys(videosData)) {  
    if (key.startsWith(`${section}_EX`)) delete videosData[key];
  }
  Object.assign(videosData, newVideos);

  for (const key of Object.keys(audiosData)) {
    if (key.startsWith(`${section}_EX`)) delete audiosData[key];
  }
  Object.assign(audiosData, newAudios);

  console.log(`✅ Exercices de ${section} réindexés (Blobs preserved)`);
}



/*  ======  Gestion des champs selon le type d'activité  ======  */
function updateFields(id) {
  const type = document.getElementById("type_" + id).value;
  const fieldsDiv = document.getElementById("fields_" + id);
  let html = "";
  // =====================================================
  // TRUE OR FALSE
  // =====================================================
  if (type === "True or false") {
    html = `
      <label>Consigne</label>
      <input type="text" id="consigne_${id}" class="form-control mb-2"
        value="${activityTypesConfig["True or false"].defaultConsigne}">
      
      <label>Nombre de tentatives</label>
      <input type="number" id="tentatives_${id}" class="form-control mb-2" min="1" max="5" value="1" disabled>
      
      ${createImageToggle(id)}
      ${createAudioToggle(id)}
      ${createVideoToggle(id)}

      <label>Affirmation</label>
      <textarea id="enonce_${id}" maxlength="350" class="form-control mb-2"
        placeholder="Écris ici l'affirmation">${devMode ? "L'adresse que vient de donner la cliente est complète." : ""}</textarea>

      <label>Bonne réponse</label>
      <select id="truth_${id}" class="form-select mb-2">
        <option value="True">Vraie</option>
        <option value="False">Fausse</option>
      </select>

      ${createFeedbackSelector(id, type)}

    `;
  }
  // =====================================================
  // QCU
  // =====================================================
  else if (type === "QCU") {
    html = `
      <label>Consigne</label>
      <input type="text" id="consigne_${id}" class="form-control mb-2"
        value="${activityTypesConfig["QCU"].defaultConsigne}">

      <label>Nombre de tentatives</label>
      <input type="number" id="tentatives_${id}" class="form-control mb-2" min="1" max="5" value="1" disabled>

      ${createImageToggle(id)}
      ${createAudioToggle(id)}
      ${createVideoToggle(id)}

      <label>Question</label>
      <textarea id="enonce_${id}" class="form-control mb-2"
        placeholder="Écris ici la question">${devMode ? "Que devrais-tu répondre à ce client ?" : ""}</textarea>

      <label>Réponses</label>
      <div class="d-flex flex-column gap-2 mb-2">
        <input type="text" id="qcuA_${id}" class="form-control" placeholder="Bonne réponse (A)"
          value="${devMode ? "Parlez-vous du plafond de retrait au guichet ou au distributeur ?" : ""}">
        <input type="text" id="qcuB_${id}" class="form-control" placeholder="Distracteur (B)"
          value="${devMode ? "Je vais vous donner les informations sur l'ouverture d'un nouveau compte d'épargne." : ""}">
        <input type="text" id="qcuC_${id}" class="form-control" placeholder="Distracteur (C)"
          value="${devMode ? "Pourriez-vous patienter un instant, je vais vérifier si le conseiller chargé des crédits est disponible." : ""}">
        <input type="text" id="qcuD_${id}" class="form-control" placeholder="Distracteur (D)"
          value="${devMode ? "Pourriez-vous m'indiquer si vous avez déjà activé votre carte bancaire ?" : ""}">
      </div>

      ${createFeedbackSelector(id, type)}

    `;
  }
  // =====================================================
  // QCM
  // =====================================================
  else if (type === "QCM") {
    html = `
      <label>Consigne</label>
      <input type="text" id="consigne_${id}" class="form-control mb-2"
        value="${activityTypesConfig["QCM"].defaultConsigne}">

      <label>Nombre de tentatives</label>
      <input type="number" id="tentatives_${id}" class="form-control mb-2" min="1" max="5" value="1" disabled>

      ${createImageToggle(id)}
      ${createAudioToggle(id)}
      ${createVideoToggle(id)}

      <label>Question</label>
      <textarea id="enonce_${id}" class="form-control mb-2"
        placeholder="Écris ici la question">${devMode ? "Quelles affirmations sont correctes ?" : ""}</textarea>

      <label>Réponses possibles</label>
      <div class="d-flex flex-column gap-2 mb-2">
        ${["A", "B", "C", "D"].map(letter => `
          <div class="input-group">
            <div class="input-group-text">
              <input type="checkbox" id="qcmCheck_${letter}_${id}" title="Bonne réponse ?">
            </div>
            <input type="text" id="qcm${letter}_${id}" class="form-control" placeholder="Réponse ${letter}">
          </div>
        `).join("")}
      </div>

      ${createFeedbackSelector(id, type)}

    `;
  }
  // =====================================================
  // MATCHING (Appariement)
  // =====================================================
  else if (type === "Matching") {
    html = `
      <label>Type d'appariement</label>
      <select id="matchType_${id}" class="form-select mb-3" onchange="updateMatchingFields('${id}')">
        <option value="">-- Choisir un type --</option>
        <option value="audio-audio">Audio – Audio</option>
        <option value="audio-texte">Audio – Texte</option>
        <option value="texte-texte">Texte – Texte</option>
      </select>

      <div id="matchingFields_${id}"></div>
    `;
  }
  // =====================================================
  // COMPLETE / Fill in the blanks
  // =====================================================
  else if (type === "Complete") {
    html = `
      <label>Type de complétion</label>
      <select id="completeType_${id}" class="form-select mb-3" onchange="updateCompleteFields('${id}')">
        <option value="">-- Choisir un type --</option>
        <option value="options">Compléter la phrase avec des options</option>
        <option value="reconstruit">Reconstruire la phrase avec des options</option>
      </select>

      <div id="completeFields_${id}"></div>
    `;
  }
  // =====================================================
  // PRODUCTION ORALE - DICTÉE
  // =====================================================
  else if (type === "Production orale - dictée") {
    html = `
      <label>Consigne</label>
      <input type="text" id="consigne_${id}" class="form-control mb-2"
        value="Lis la phrase à voix haute ou répète-la.">

      <label>Nombre de tentatives</label>
      <input type="number" id="tentatives_${id}" class="form-control mb-2" min="1" max="5" value="1">

      ${createImageToggle(id)}

      <label>Phrase à lire</label>
      <textarea id="phrase_${id}" class="form-control mb-2" rows="2"
        placeholder="Saisis ici la phrase que l'apprenant doit lire ou répéter.">${devMode ? "Bonjour, comment allez-vous ?" : ""}</textarea>

      ${createAudioToggle(id)}


      ${createFeedbackSelector(id, type)}

    `;
  }
  // =====================================================
  // FLASHCARD
  // =====================================================
  else if (type === "Flashcard") {
    html = `
      <label>Type de flashcard</label>
      <select id="flashcardType_${id}" class="form-select mb-3" onchange="updateFlashcardFields('${id}')">
        <option value="">-- Choisir un type --</option>
        <option value="courte">Flashcard courte (anglais → français)</option>
        <option value="longue">Flashcard longue (mot → phrase)</option>
      </select>

      <div id="flashcardFields_${id}"></div>
    `;
  }
  // =====================================================
  // INFORMATION
  // =====================================================
  else if (type === "Information") {
    html = `
      <label>Titre</label>
      <input type="text" id="titre_${id}" class="form-control mb-2"
        value="${devMode ? "Pour parler de ses émotions !" : ""}">

      <!-- 🖼️ Bloc image (facultatif)
      ${createImageToggle(id)}
       -->

      <label>Expression</label>
      <textarea id="expression_${id}" class="form-control mb-2"
        placeholder="Texte principal">${devMode ? "Être + Adjectif" : ""}</textarea>

      <label>Exemple</label>
      <textarea id="exemple_${id}" class="form-control mb-2"
        placeholder="Phrase d'exemple">${devMode ? "Nous sommes très stressés par ce changement d’équipe." : ""}</textarea>

      <label>Audio de l'exemple</label>
      ${createDualAudioButtons(
        `audioInput_${id}_exemple`,
        `handleAudioUpload(event, '${id}', true)`,
        `openElevenLabsForAudio('${id}', 'exemple')`,
        `openRecorderForAudio('${id}', 'exemple')`
      )}


    `;
  }
  // =====================================================
  // LEÇON
  // =====================================================
  else if (type === "Leçon") {
    html = `
      <label>Type de leçon</label>
      <select id="lessonType_${id}" class="form-select mb-3" onchange="updateLessonFields('${id}')">
        <option value="">-- Choisir un type --</option>
        <option value="simple">Leçon simple</option>
        <option value="complexe">Leçon complexe</option>
      </select>

      <div id="lessonFields_${id}"></div>
    `;
  }
  // =====================================================
  // Dialogue
  // =====================================================
  else if (type === "Dialogue") {
    html = `
      <label>Consigne</label>
      <input type="text" id="consigne_${id}" class="form-control mb-2"
        value="${activityTypesConfig["Dialogue"].defaultConsigne}">

      ${createImageToggle(id)}
      ${createAudioToggle(id)}

      <h6>💬 Script du dialogue</h6>
      <div id="dialogueContainer_${id}" class="mb-2"></div>
      <button type="button" class="btn btn-sm btn-outline-primary" onclick="addActivityDialogueLine('${id}')">+ Ajouter une réplique</button>
    `;
  }
  // =====================================================
  // MEDIA
  // =====================================================
  else if (type === "Media") {
    html = `
      <label>Type de média</label>
      <select id="mediaType_${id}" class="form-select mb-3" onchange="updateMediaTypeFields('${id}')">
        <option value="video">Vidéo</option>
        <option value="image_audio">Image + Audio</option>
      </select>

      <div id="mediaVideoSection_${id}">
        <label class="form-label">Vidéo</label>
        <div id="videoContainer_${id}">
          <div id="videoButtonsWrapper_${id}" class="d-flex gap-2 mb-2">
            <input type="file" accept="video/*" onchange="handleVideoUpload(event, '${id}')" id="videoInput_${id}" style="display:none;">
            <button class="btn btn-outline-secondary" type="button" onclick="document.getElementById('videoInput_${id}').click()">📁 Browse</button>
          </div>
          <div id="videoTranscriptionWrapper_${id}" class="mt-2">
            <label class="form-label small mb-1 text-muted">Transcription <span class="fw-normal">(optionnel)</span></label>
            <textarea id="videoTranscription_${id}" class="form-control form-control-sm" rows="2" placeholder="Transcription du contenu vidéo..."></textarea>
          </div>
        </div>
      </div>

      <div id="mediaImageAudioSection_${id}" style="display:none;">
        <label class="form-label">Image</label>
        <div id="imageContainer_${id}" class="mb-3">
          <input type="file" accept="image/*" id="imageInput_${id}" style="display:none;" onchange="handleImageUpload(event, '${id}')">
          <button class="btn btn-outline-secondary" type="button" onclick="document.getElementById('imageInput_${id}').click()">📁 Browse</button>
        </div>
        <label class="form-label">Audio</label>
        <div id="audioContainer_${id}">
          ${createDualAudioButtons(
            `audioInput_${id}_main`,
            `handleMainAudioUpload(event, '${id}')`,
            `openElevenLabsForMainAudio('${id}')`,
            `openRecorderForMainAudio('${id}')`
          )}
          <div id="audioTranscriptionWrapper_${id}" class="mt-2">
            <label class="form-label small mb-1 text-muted">Transcription <span class="fw-normal">(optionnel)</span></label>
            <textarea id="audioTranscription_${id}" class="form-control form-control-sm" rows="2" placeholder="Transcription du contenu audio..."></textarea>
          </div>
        </div>
      </div>
    `;
  }
  // =====================================================
  // (si aucun type sélectionné)
  // =====================================================
  else {
    html = `<p class="text-muted">Veuillez choisir un type d'exercice.</p>`;
  }

  fieldsDiv.innerHTML = html;
}



/*  ======  Gestion des sous-types d'activités  ======  */

//  MEDIA  //
function updateMediaTypeFields(id) {
  const type = document.getElementById(`mediaType_${id}`)?.value;
  const videoSection = document.getElementById(`mediaVideoSection_${id}`);
  const imageAudioSection = document.getElementById(`mediaImageAudioSection_${id}`);
  if (videoSection) videoSection.style.display = type === 'video' ? 'block' : 'none';
  if (imageAudioSection) imageAudioSection.style.display = type === 'image_audio' ? 'block' : 'none';
}

//  MATCHING  //
function updateMatchingFields(id) {
  const typeSelect = document.getElementById(`matchType_${id}`);
  const container = document.getElementById(`matchingFields_${id}`);
  const type = typeSelect.value;
  let html = "";

  // 🟦 Bloc de consigne (toujours visible)
  html += `
    <label>Consigne</label>
    <input type="text" id="consigne_${id}" class="form-control mb-3"
      placeholder="Indique la consigne à afficher"
      value="${activityTypesConfig["Matching"].defaultConsigne}">
    ${createAudioToggle(id)}
    <label>Nombre de tentatives</label>
    <input type="number" id="tentatives_${id}" class="form-control mb-3" min="1" max="9999" value="9999" disabled>
  `;

  // === Cas AUDIO–AUDIO ===
  if (type === "audio-audio") {
    html += `
      <p class="text-muted mb-2">Associe chaque audio de gauche à celui de droite.</p>
      <div class="row">
        <div class="col-md-6">
          <h6>Colonne gauche</h6>
          ${(() => {
        let inputs = "";
        for (let i = 1; i <= 4; i++) {
          inputs += `
                <div class="mb-2">
                  <label>Audio L${i}</label>
                  ${createDualAudioButtons(
                    `audioMatchInput_${id}_L${i}`,
                    `handleMatchAudioUpload(event, '${id}', 'L${i}')`,
                    `openElevenLabsForMatchAudio('${id}', 'L${i}')`,
                    `openRecorderForMatchAudio('${id}', 'L${i}')`
                  )}
                </div>
              `;
        }
        return inputs;
      })()}
        </div>
        <div class="col-md-6">
          <h6>Colonne droite</h6>
          ${(() => {
        let inputs = "";
        for (let i = 1; i <= 4; i++) {
          inputs += `
                <div class="mb-2">
                  <label>Audio R${i}</label>
                  ${createDualAudioButtons(
                    `audioMatchInput_${id}_R${i}`,
                    `handleMatchAudioUpload(event, '${id}', 'R${i}')`,
                    `openElevenLabsForMatchAudio('${id}', 'R${i}')`,
                    `openRecorderForMatchAudio('${id}', 'R${i}')`
                  )}
                </div>
              `;
        }
        return inputs;
      })()}
        </div>
      </div>
    `;
  }

  // === Cas AUDIO–TEXTE ===
  else if (type === "audio-texte") {
    html += `
      <p class="text-muted mb-2">Associe chaque audio à un texte correspondant.</p>
      <div class="row">
        <div class="col-md-6">
          <h6>Audios</h6>
          ${(() => {
        let inputs = "";
        for (let i = 1; i <= 4; i++) {
          inputs += `
                <div class="mb-2">
                  <label>Audio L${i}</label>
                  ${createDualAudioButtons(
                    `audioMatchInput_${id}_L${i}`,
                    `handleMatchAudioUpload(event, '${id}', 'L${i}')`,
                    `openElevenLabsForMatchAudio('${id}', 'L${i}')`,
                    `openRecorderForMatchAudio('${id}', 'L${i}')`
                  )}
                </div>
              `;
        }
        return inputs;
      })()}
        </div>
        <div class="col-md-6">
          <h6>Textes</h6>
          ${(() => {
        let inputs = "";
        for (let i = 1; i <= 4; i++) {
          inputs += `
                <div class="mb-2">
                  <label>Texte R${i}</label>
                  <input type="text" id="matchText_${id}_R${i}" class="form-control">
                </div>
              `;
        }
        return inputs;
      })()}
        </div>
      </div>
    `;
  }

  // === Cas TEXTE–TEXTE ===
  else if (type === "texte-texte") {
    html += `
      <p class="text-muted mb-2">Associe chaque expression de gauche à celle de droite.</p>
      <div class="row">
        <div class="col-md-6">
          <h6>Colonne gauche</h6>
          ${(() => {
        let inputs = "";
        for (let i = 1; i <= 4; i++) {
          inputs += `
                <div class="mb-2">
                  <label>Texte L${i}</label>
                  <input type="text" id="matchText_${id}_L${i}" class="form-control">
                </div>
              `;
        }
        return inputs;
      })()}
        </div>
        <div class="col-md-6">
          <h6>Colonne droite</h6>
          ${(() => {
        let inputs = "";
        for (let i = 1; i <= 4; i++) {
          inputs += `
                <div class="mb-2">
                  <label>Texte R${i}</label>
                  <input type="text" id="matchText_${id}_R${i}" class="form-control">
                </div>
              `;
        }
        return inputs;
      })()}
        </div>
      </div>
    `;
  }

  // === Feedback (toujours visible) ===
  html += `
    ${createFeedbackSelector(id, "Matching", type)}
  `;

  // === Cas par défaut : aucun type sélectionné ===
  if (!type) {
    html = `<p class="text-muted">Choisis d’abord un type d’appariement pour voir les options.</p>`;
  }

  container.innerHTML = html;
}
function handleMatchAudioUpload(event, id, keyLetter) {
  const file = event.target.files[0];
  if (!file) return;

  const [section, exNum] = id.split("_");
  const key = `${section}_EX${exNum}`;
  if (!audiosData[key]) audiosData[key] = { match: {} };
  if (!audiosData[key].match) audiosData[key].match = {};

  const reader = new FileReader();
  reader.onload = () => {
    const blob = new Blob([reader.result], { type: file.type });
    audiosData[key].match[`Match_${keyLetter}`] = blob;

    const previewId = `audioMatch_${id}_${keyLetter}`;

    addAudioPreviewWithDelete(event.target, blob, previewId, (data) => {
      // ✅ Supprime dynamiquement le bon audio dans la clé actuelle
      if (data.match && data.match[`Match_${keyLetter}`]) {
        delete data.match[`Match_${keyLetter}`];
      }

      // 🧹 Nettoyage complet si plus aucun audio
      if (Object.keys(data.match || {}).length === 0) delete data.match;
      if (Object.keys(data).length === 0) {
        const parentExo = event.target.closest(".exercice");
        if (parentExo) {
          const match = parentExo.id.match(/exo_(S\d+)_(\d+)/);
          if (match) {
            const dynKey = `${match[1]}_EX${match[2]}`;
            delete audiosData[dynKey];
          }
        }
      }
    });
  };

  reader.readAsArrayBuffer(file);
}

//  COMPLETE  //
function updateCompleteFields(id) {
  const typeSelect = document.getElementById(`completeType_${id}`);
  const container = document.getElementById(`completeFields_${id}`);
  const type = typeSelect.value;
  let html = "";

  // 🟦 Bloc consigne + audio principal
  html += `
    <label>Consigne</label>
    <input type="text" id="consigne_${id}" class="form-control mb-3"
      placeholder="Indique la consigne à afficher"
      value="${activityTypesConfig["Complete"].defaultConsigne}">

    <label>Nombre de tentatives</label>
    <input type="number" id="tentatives_${id}" class="form-control mb-3" min="1" max="5" value="1" disabled>

    ${createAudioToggle(id)}
  `;

  // 🟨 Type : Compléter avec des options
  if (type === "options") {
    html += `
      <label>Texte complet (mettez les mots à masquer entre #mot#)</label>
      <textarea id="texte_${id}" class="form-control mb-3"
        placeholder="Écris ici la phrase complète (les mots des options seront remplacés par des tirets)">${devMode ? "Je vais au bureau chaque matin." : ""}</textarea>

      <label>Options possibles (max 6)</label>
      <div id="optionsContainer_${id}" class="d-flex flex-column gap-2 mb-3">
        ${Array.from({ length: 6 }).map((_, i) => `
          <input type="text" id="opt${i + 1}_${id}" class="form-control"
            placeholder="${i === 0 ? 'Bonne réponse' : 'Distracteur optionnel'}">
        `).join("")}
      </div>

      <div class="mt-3">
        <h6 class="text-muted mb-1">Aperçu du texte à trous :</h6>
        <pre id="texteTronque_${id}" class="bg-light p-2 rounded small text-secondary">(prévisualisation)</pre>
      </div>
    `;
  }
  else if (type === "reconstruit") {
    html += `
      <label>Texte complet (Mettez jusqu'à 6 mots ou groupes de mots entre #mot# pour les masquer)</label>
      <textarea id="texte_${id}" class="form-control mb-3"
        placeholder="Écris ici la phrase complète (les mots des options seront remplacés par des tirets)">${devMode ? "Je vais au bureau chaque matin." : ""}</textarea>

      <label>Les mots à remettre dans l'ordre (max 6)</label>
      <div id="optionsContainer_${id}" class="d-flex flex-column gap-2 mb-3">
        ${Array.from({ length: 6 }).map((_, i) => `
          <input type="text" id="opt${i + 1}_${id}" class="form-control"
            placeholder="Mot caché" disabled="true">
        `).join("")}
      </div>

      <div class="mt-3">
        <h6 class="text-muted mb-1">Aperçu du texte à trous :</h6>
        <pre id="texteTronque_${id}" class="bg-light p-2 rounded small text-secondary">(prévisualisation)</pre>
      </div>
    `;
  }


  // 🟥 Feedback (toujours visible)
  html += `
    ${createFeedbackSelector(id, "Complete", type)}
  `;

  if (!type) {
    html = `<p class="text-muted">Choisis d’abord un type de complétion.</p>`;
  }

  container.innerHTML = html;

  // 🧩 Active la prévisualisation dynamique si type "options"
  if (type === "options") {
    initCompleteOptionsPreview(id);
  }
  // 🧩 Active la prévisualisation dynamique si type "reconstruit"
  if (type === "reconstruit") {
    initCompleteReconstruitPreview(id);
  }
}
function initCompleteOptionsPreview(id) {
  const texteInput = document.getElementById(`texte_${id}`);
  const optionInputs = Array.from({ length: 6 }).map((_, i) =>
    document.getElementById(`opt${i + 1}_${id}`)
  );
  const preview = document.getElementById(`texteTronque_${id}`);

  function updatePreview() {
    const texteOriginal = texteInput.value;
    if (!texteOriginal) {
      preview.textContent = "(prévisualisation)";
      optionInputs.forEach(inp => {
        inp.value = "";
        inp.disabled = false;
        inp.classList.remove("bg-light", "text-muted");
        inp.title = "";
      });
      return;
    }

    // 🧠 1️⃣ Détection des mots entre #
    const regexMots = /#(.*?)#/g;
    const motsTrouves = [];
    let match;
    while ((match = regexMots.exec(texteOriginal)) !== null) {
      motsTrouves.push(match[1].trim());
    }

    // 📏 2️⃣ Calcul de la longueur moyenne des réponses
    const moyenneLongueur = motsTrouves.length
      ? Math.ceil(
        motsTrouves.reduce((acc, m) => acc + m.length, 0) / motsTrouves.length
      ) - 1
      : 5; // valeur par défaut

    // 🧹 3️⃣ Nettoyage du texte pour la prévisualisation
    const texteSansHashtags = texteOriginal.replace(regexMots, () => {
      return "_".repeat(moyenneLongueur);
    });

    // 🧩 4️⃣ Injection automatique des mots trouvés dans les options (verrouillés)
    motsTrouves.slice(0, 6).forEach((mot, i) => {
      const input = optionInputs[i];
      if (input) {
        input.value = mot;
        input.disabled = true; // 🔒 on verrouille les bonnes réponses
        input.classList.add("bg-light", "text-muted");
        input.title = "Mot issu du texte (#...#)";
      }
    });

    // 🔓 5️⃣ Les champs restants deviennent éditables (distracteurs)
    for (let i = motsTrouves.length; i < 6; i++) {
      const input = optionInputs[i];
      if (input) {
        input.disabled = false;
        input.classList.remove("bg-light", "text-muted");
        input.title = "Ajouter un distracteur (mauvaise option)";
        // ⚠️ On ne vide pas la valeur ici : l’auteur peut conserver ses distracteurs
      }
    }

    // 🖋️ 6️⃣ Affichage du texte transformé
    preview.textContent = texteSansHashtags;
  }

  // 🔁 7️⃣ Mise à jour dynamique à chaque saisie
  texteInput.addEventListener("input", updatePreview);
  updatePreview();
}
function initCompleteReconstruitPreview(id) {
  const texteInput = document.getElementById(`texte_${id}`);
  const optionInputs = Array.from({ length: 6 }).map((_, i) =>
    document.getElementById(`opt${i + 1}_${id}`)
  );
  const preview = document.getElementById(`texteTronque_${id}`);

  function updatePreview() {
    const texteOriginal = texteInput.value;
    if (!texteOriginal) {
      preview.textContent = "(prévisualisation)";
      optionInputs.forEach(inp => {
        inp.value = "";
        inp.disabled = false;
        inp.classList.remove("bg-light", "text-muted");
        inp.title = "";
      });
      return;
    }

    // 🧠 1️⃣ Détection des mots entre #
    const regexMots = /#(.*?)#/g;
    const motsTrouves = [];
    let match;
    while ((match = regexMots.exec(texteOriginal)) !== null) {
      motsTrouves.push(match[1].trim());
    }

    // 📏 2️⃣ Calcul de la longueur moyenne des réponses
    const moyenneLongueur = motsTrouves.length
      ? Math.ceil(
        motsTrouves.reduce((acc, m) => acc + m.length, 0) / motsTrouves.length
      ) - 1
      : 5; // valeur par défaut

    // 🧹 3️⃣ Nettoyage du texte pour la prévisualisation
    const texteSansHashtags = texteOriginal.replace(regexMots, () => {
      return "_".repeat(moyenneLongueur);
    });

    // 🧩 4️⃣ Injection automatique des mots trouvés dans les options (verrouillés)
    motsTrouves.slice(0, 6).forEach((mot, i) => {
      const input = optionInputs[i];
      if (input) {
        input.value = mot;
        input.disabled = true; // 🔒 on verrouille les bonnes réponses
        input.classList.add("bg-light", "text-muted");
        input.title = "Mot issu du texte (#...#)";
      }
    });

    // 🔓 5️⃣ Les champs restants deviennent éditables (distracteurs)
    for (let i = motsTrouves.length; i < 6; i++) {
      const input = optionInputs[i];
      if (input) {
        input.disabled = true;
        input.classList.remove("bg-light", "text-muted");
        input.title = "...";
        // ⚠️ On ne vide pas la valeur ici : l’auteur peut conserver ses distracteurs
      }
    }

    // 🖋️ 6️⃣ Affichage du texte transformé
    preview.textContent = texteSansHashtags;
  }

  // 🔁 7️⃣ Mise à jour dynamique à chaque saisie
  texteInput.addEventListener("input", updatePreview);
  updatePreview();
}

//  FLASHCARDS  //
function updateFlashcardFields(id) {
  const typeSelect = document.getElementById(`flashcardType_${id}`);
  const container = document.getElementById(`flashcardFields_${id}`);
  const type = typeSelect.value;
  let html = "";

  html += `
    <label>Consigne</label>
    <input type="text" id="consigne_${id}" class="form-control mb-3"
      placeholder="Indique la consigne à afficher"
      value="${activityTypesConfig["Flashcard"].defaultConsigne}">
  `;

  // ==========================================================
  // TYPE : COURTE
  // ==========================================================
  if (type === "courte") {
    html += `
      <div class="d-flex align-items-center gap-2 mb-1">
        <label class="mb-0">Texte de la face avant</label>
        <button type="button" class="btn btn-sm btn-outline-info" id="translateFlashFrontBtn_${id}" data-fid="${id}" onclick="translateFlashFront(this.dataset.fid)">🌐 Traduire depuis la face arrière</button>
      </div>
      <textarea id="front_${id}" class="form-control mb-2"
        placeholder="Texte de la face avant (anglais)">${devMode ? "How are you?" : ""}</textarea>

      <label>Texte de la face arrière</label>
      <textarea id="back_${id}" class="form-control mb-2"
        placeholder="Texte de la face arrière (français)">${devMode ? "Comment vas-tu ?" : ""}</textarea>

      <label>Audio face arrière (identique au texte)</label>
      ${createDualAudioButtons(
        `audioFlashInput_${id}_back`,
        `handleFlashcardAudioUpload(event, '${id}', 'back')`,
        `openElevenLabsForFlashcardAudio('${id}', 'back')`,
        `openRecorderForFlashcardAudio('${id}', 'back')`
      )}
    `;
  }

  // ==========================================================
  // TYPE : LONGUE
  // ==========================================================
  else if (type === "longue") {
    html += `
      <label>Texte de la face avant</label>
      <textarea id="front_${id}" class="form-control mb-2"
        placeholder="Texte de la face avant (mot ou expression)">${devMode ? "To relax" : ""}</textarea>

      <label>Audio face avant (identique au texte)</label>
      ${createDualAudioButtons(
        `audioFlashInput_${id}_front`,
        `handleFlashcardAudioUpload(event, '${id}', 'front')`,
        `openElevenLabsForFlashcardAudio('${id}', 'front')`,
        `openRecorderForFlashcardAudio('${id}', 'front')`
      )}

      <label>Texte de la face arrière</label>
      <textarea id="back_${id}" class="form-control mb-2"
        placeholder="Texte de la face arrière (phrase complète)">${devMode ? "I like to relax on weekends." : ""}</textarea>

      <label>Audio face arrière (identique au texte)</label>
      ${createDualAudioButtons(
        `audioFlashInput_${id}_back`,
        `handleFlashcardAudioUpload(event, '${id}', 'back')`,
        `openElevenLabsForFlashcardAudio('${id}', 'back')`,
        `openRecorderForFlashcardAudio('${id}', 'back')`
      )}
    `;
  }

  // ==========================================================
  // 🔹 INFORMATIONS COMPLÉMENTAIRES
  // ==========================================================
  if (type === "courte" || type === "longue") {
    html += `
      <hr class="my-3">
      <label>Informations complémentaires</label>
      <select id="flashExtraType_${id}" class="form-select mb-3" onchange="updateFlashExtraFields('${id}')">
        <option value="Aucune">Aucune</option>
        <option value="Ajouter des phrases en exemples">Ajouter des phrases en exemples</option>
        <option value="Ajouter des expressions complémentaires">Ajouter des expressions complémentaires</option>
      </select>

      <div id="flashExtraContainer_${id}"></div>
    `;
  }

  // ==========================================================
  // FEEDBACK
  // ==========================================================
  html += `
    ${createFeedbackSelector(id, "Flashcard", type)}
  `;

  if (!type) {
    html = `<p class="text-muted">Choisis un type de flashcard pour afficher les champs.</p>`;
  }

  container.innerHTML = html;
}
function updateFlashExtraFields(id) {
  const select = document.getElementById(`flashExtraType_${id}`);
  const container = document.getElementById(`flashExtraContainer_${id}`);
  const type = select.value;
  let html = "";

  // --- Aucun ---
  if (type === "Aucune" || !type) {
    container.innerHTML = "";
    return;
  }

  // --- Ajouter des phrases en exemples ---
  if (type === "Ajouter des phrases en exemples") {
    html += `<h6>📝 Phrases en exemples (jusqu’à 5)</h6>`;
    for (let i = 1; i <= 5; i++) {
      html += `
        <input type="text" id="flashExtraPhrase_${id}_${i}" class="form-control mb-2"
          placeholder="Phrase ${i}">
      `;
    }
  }

  // --- Ajouter des expressions complémentaires ---
  if (type === "Ajouter des expressions complémentaires") {
    html += `<h6>💬 Expressions complémentaires (jusqu’à 5)</h6>`;
    for (let i = 1; i <= 5; i++) {
      html += `
        <div class="row g-2 align-items-start mb-2">
          <div class="col-md-5">
            <input type="text" id="flashExtraExpr_${id}_${i}" class="form-control" placeholder="Expression ${i}">
          </div>
          <div class="col-md-7">
            <input type="text" id="flashExtraExemple_${id}_${i}" class="form-control" placeholder="Exemple correspondant">
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}
function handleFlashcardAudioUpload(event, id, side) {
  const file = event.target.files[0];
  if (!file) return;

  const [section, exNum] = id.split("_");
  const key = `${section}_EX${exNum}`;
  if (!audiosData[key]) audiosData[key] = { flashcard: {} };
  if (!audiosData[key].flashcard) audiosData[key].flashcard = {};

  const reader = new FileReader();
  reader.onload = () => {
    const blob = new Blob([reader.result], { type: file.type });
    audiosData[key].flashcard[side] = blob;

    const previewId = `audioFlash_${id}_${side}`;
    addAudioPreviewWithDelete(event.target, blob, previewId, (data) => {
      // ✅ Supprime dynamiquement le bon audio dans la clé actuelle
      if (data.flashcard && data.flashcard[side]) {
        delete data.flashcard[side];
      }

      // 🧹 Si la flashcard n’a plus de face audio, on supprime la clé flashcard
      if (data.flashcard && Object.keys(data.flashcard).length === 0) {
        delete data.flashcard;
      }

      // 🧽 Et si plus aucun audio du tout, on supprime la clé globale
      if (Object.keys(data).length === 0) {
        const parentExo = event.target.closest(".exercice");
        if (parentExo) {
          const match = parentExo.id.match(/exo_(S\d+)_(\d+)/);
          if (match) {
            const dynKey = `${match[1]}_EX${match[2]}`;
            delete audiosData[dynKey];
          }
        }
      }
    });
  };

  reader.readAsArrayBuffer(file);
}

//  DIALOGUE  //
function addActivityDialogueLine(id, speaker = "", text = "") {
  const container = document.getElementById(`dialogueContainer_${id}`);
  const index = container.querySelectorAll(".dialogue-line").length + 1;

  const div = document.createElement("div");
  div.className = "dialogue-line row align-items-start mb-2";
  div.innerHTML = `
    <div class="col-md-3">
      <input type="text" class="form-control" id="dialogueNom_${id}_${index}"
        placeholder="Personne" value="${speaker}">
    </div>
    <div class="col-md-8">
      <input type="text" class="form-control" id="dialogueTexte_${id}_${index}"
        placeholder="Réplique" value="${text}">
    </div>
    <div class="col-md-1 d-flex justify-content-end">
      <button type="button" class="btn btn-outline-danger btn-sm" onclick="this.closest('.dialogue-line').remove()">❌</button>
    </div>
  `;
  container.appendChild(div);
}

//  LEÇON //
function updateLessonFields(id) {
  const typeSelect = document.getElementById(`lessonType_${id}`);
  const container = document.getElementById(`lessonFields_${id}`);
  const type = typeSelect.value;
  let html = "";

  // 🟦 Leçon simple
  if (type === "simple") {
    html = `
      <label>Consigne</label>
      <input type="text" id="lessonConsigne_${id}" class="form-control mb-3"
        placeholder="Indique la consigne à afficher"
        value="${activityTypesConfig["Leçon"].defaultConsigne}">

      
      ${createImageToggle(id)}

      <label>Expression (français)</label>
      <input type="text" id="lessonExprFr_${id}" class="form-control mb-2"
        placeholder="Expression en français" value="${devMode ? "Faire une pause" : ""}">
      
      <!-- 🎧 Audio pour l'expression -->
      <div class="mb-3 border rounded p-2 bg-light">
        <label class="form-label mb-1">Audio de l'expression (identique au texte)</label>
        ${createDualAudioButtons(
          `audioExprFrInput_${id}`,
          `handleLessonExprAudioUpload(event, '${id}')`,
          `openElevenLabsForLessonExpr('${id}')`,
          `openRecorderForLessonExpr('${id}')`
        )}
      </div>
      
      <div class="d-flex align-items-center gap-2 mb-1">
        <label class="mb-0">Traduction (anglais)</label>
        <button type="button" class="btn btn-sm btn-outline-info" id="translateExprBtn_${id}" onclick="translateLessonExpr('${id}')">🌐 Traduire</button>
      </div>
      <input type="text" id="lessonExprEn_${id}" class="form-control mb-3"
        placeholder="Traduction anglaise" value="${devMode ? "To take a break" : ""}">

      <label>Ajouter un exemple ? (optionnel)</label>
      <label>L'exemple en français</label>
      <input type="text" id="lessonExFr_${id}" class="form-control mb-2"
        placeholder="Exemple en français" value="${devMode ? "Je fais une pause après le déjeuner." : ""}">

      <!-- 🎧 Audio pour l'exemple -->
      <div class="mb-3 border rounded p-2 bg-light">
        <label class="form-label mb-1">Audio de l'exemple en français (identique au texte)</label>
        ${createDualAudioButtons(
          `audioExFrInput_${id}`,
          `handleLessonExampleAudioUpload(event, '${id}')`,
          `openElevenLabsForLessonExample('${id}')`,
          `openRecorderForLessonExample('${id}')`
        )}
      </div>

      <div class="d-flex align-items-center gap-2 mb-1">
        <label class="mb-0">Traduction de l’exemple en anglais</label>
        <button type="button" class="btn btn-sm btn-outline-info" id="translateExBtn_${id}" data-exid="${id}" onclick="translateLessonExample(this.dataset.exid)">🌐 Traduire</button>
      </div>
      <input type="text" id="lessonExEn_${id}" class="form-control mb-2"
        placeholder="Traduction de l’exemple" value="${devMode ? "I take a break after lunch." : ""}">
    `;
  }

  // 🟨 Leçon complexe
  else if (type === "complexe") {
    html = `
      <label>Consigne</label>
      <input type="text" id="lessonConsigne_${id}" class="form-control mb-3"
        placeholder="Indique la consigne à afficher"
        value="Nouveautés !">

      <label>Texte principal de la leçon</label>
      <div id="lessonTexte_${id}" class="quill-editor mb-3"></div>

      <hr>

      <div class="border rounded p-3 bg-light mb-3">
        <h6>Configuration de la grille</h6>
        <div class="row g-2">
          <div class="col-md-4">
            <label>En-tête</label>
            <select id="lessonHeader_${id}" class="form-select" onchange="buildLessonGrid('${id}')">
              <option value="non">Non</option>
              <option value="oui">Oui</option>
            </select>
          </div>
          <div class="col-md-4">
            <label>Colonnes</label>
            <select id="lessonCols_${id}" class="form-select" onchange="buildLessonGrid('${id}')">
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </div>
          <div class="col-md-4">
            <label>Lignes</label>
            <select id="lessonRows_${id}" class="form-select" onchange="buildLessonGrid('${id}')">
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        </div>
      </div>

      <div id="lessonGrid_${id}" class="lesson-grid d-flex flex-column gap-3"></div>
    `;
  }

  container.innerHTML = html;

  // Initialisation Quill
  if (type === "complexe") {
    const el = document.getElementById(`lessonTexte_${id}`);
    if (el && !el.dataset.quillInit) {
      new Quill(el, {
        theme: "snow",
        modules: { toolbar: [["bold", "italic"]] }
      });
      el.dataset.quillInit = "true";
    }

    buildLessonGrid(id); // crée une grille de base
  }
}
function buildLessonGrid(id) {
  const hasHeader = document.getElementById(`lessonHeader_${id}`).value === "oui";
  const cols = Number(document.getElementById(`lessonCols_${id}`).value || 1);
  const rows = Number(document.getElementById(`lessonRows_${id}`).value || 1);
  const container = document.getElementById(`lessonGrid_${id}`);

  let html = "";

  // 🧩 En-tête
  if (hasHeader) {
    html += `<div class="row g-2 mb-2">`;
    for (let c = 1; c <= cols; c++) {
      html += `
        <div class="col">
          <input 
            type="text" 
            id="lessonHeaderText_${id}_${c}" 
            class="form-control" 
            placeholder="Titre colonne ${c}">
        </div>
      `;
    }
    html += `</div>`;
  }

  // 🧩 Lignes
  for (let r = 1; r <= rows; r++) {
    html += `<div class="row g-2 mb-2">`;
    for (let c = 1; c <= cols; c++) {
      html += `
        <div class="col">
          <div class="border rounded p-2 bg-white">
            <small>Cellule ${r}.${c}</small>
            <input 
              type="text" 
              id="lessonCell_${id}_${r}_${c}" 
              class="form-control form-control-sm mb-1" 
              placeholder="Texte">

            <small class="text-muted">Audio (identique au texte) :</small>
            ${createDualAudioButtons(
              `lessonCellAudioInput_${id}_LessonTable_L${r}_C${c}`,
              `handleLessonAudioUpload(event, '${id}_LessonTable_L${r}_C${c}')`,
              `openElevenLabsForLessonCell('${id}', '${id}_LessonTable_L${r}_C${c}')`,
              `openRecorderForLessonCell('${id}', '${id}_LessonTable_L${r}_C${c}')`
            )}
          </div>
        </div>
      `;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
}
function handleLessonExprAudioUpload(event, id) {
  const file = event.target.files[0];
  if (!file) return;

  const [section, exNum] = id.split("_");
  const key = `${section}_EX${exNum}`;
  if (!audiosData[key]) audiosData[key] = {};

  const reader = new FileReader();
  reader.onload = () => {
    const blob = new Blob([reader.result], { type: file.type });

    // ✅ On stocke dans audiosData sous la clé "exprFr"
    audiosData[key].exprFr = blob;

    // ✅ Affiche un aperçu audio et gère suppression
    addAudioPreviewWithDelete(event.target, blob, `audio_${key}_exprFr`, (data) => {
      if (data.exprFr) delete data.exprFr;
      if (Object.keys(data).length === 0) delete audiosData[key];
    });
  };

  reader.readAsArrayBuffer(file);
}
function handleLessonExampleAudioUpload(event, id) {
  const file = event.target.files[0];
  if (!file) return;

  const [section, exNum] = id.split("_");
  const key = `${section}_EX${exNum}`;
  if (!audiosData[key]) audiosData[key] = {};

  const reader = new FileReader();
  reader.onload = () => {
    const blob = new Blob([reader.result], { type: file.type });

    // ✅ Enregistrement propre dans audiosData
    audiosData[key].example = blob;

    // ✅ Affiche un aperçu audio et gère suppression
    addAudioPreviewWithDelete(event.target, blob, `audio_${key}_example`, (data) => {
      if (data.example) delete data.example;
      if (Object.keys(data).length === 0) delete audiosData[key];
    });
  };

  reader.readAsArrayBuffer(file);
}
function handleLessonAudioUpload(event, cellId) {
  const file = event.target.files[0];
  if (!file) return;

  // Exemples de cellId : "S1_1_LessonTable_L1_C2"
  const [section, exNum] = cellId.split("_");
  const key = `${section}_EX${exNum}`;
  if (!audiosData[key]) audiosData[key] = { lesson: {} };

  const reader = new FileReader();
  reader.onload = () => {
    const blob = new Blob([reader.result], { type: file.type });

    // ✅ Enregistrement propre dans audiosData
    audiosData[key].lesson[cellId] = blob;

    // ✅ Affiche un aperçu audio et gère suppression
    addAudioPreviewWithDelete(event.target, blob, `audio_${cellId}`, (data) => {
      if (data.lesson && data.lesson[cellId]) delete data.lesson[cellId];
      if (Object.keys(data.lesson || {}).length === 0) delete data.lesson;
      if (Object.keys(data).length === 0) delete audiosData[key];
    });
  };

  reader.readAsArrayBuffer(file);
}



/*  ======  Synchronisation mots -> options  ======  */    //Vérifier la pertinence//
function attachMotsListeners(id) {
  const motInputs = [
    document.getElementById(`mot1_${id}`),
    document.getElementById(`mot2_${id}`),
    document.getElementById(`mot3_${id}`)
  ];

  function updateOptions() {
    const mots = motInputs.map(inp => inp.value.trim()).filter(Boolean);
    for (let j = 1; j <= 4; j++) {
      const opt = document.getElementById(`option${j}_${id}`);
      if (j <= mots.length) {
        opt.value = mots[j - 1];
        opt.readOnly = true;
        opt.placeholder = ""; // pas de placeholder pour les mots trouvés
      } else {
        opt.readOnly = false;
        opt.value = ""; // champ vide
        if (j === mots.length + 1) {
          opt.placeholder = "distracteur obligatoire";
        } else {
          opt.placeholder = "distracteur optionnel";
        }
      }
    }
  }

  motInputs.forEach(inp => inp.addEventListener("input", updateOptions));
  updateOptions(); // init
}
function initDynamicMots(id) {
  const container = document.getElementById(`motsContainer_${id}`);

  function addMotInput(placeholder = "optionnel") {
    const index = container.querySelectorAll("input").length + 1;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control";
    input.placeholder = placeholder;
    input.id = `motDyn_${id}_${index}`;

    input.addEventListener("input", () => {
      const allInputs = container.querySelectorAll("input");

      // 👉 Ajouter un champ si on écrit dans le dernier
      if (input.value.trim() !== "" && input === allInputs[allInputs.length - 1]) {
        addMotInput("optionnel");
      }

      // 👉 Supprimer les champs vides superflus en fin de liste
      let lastFilledIndex = -1;
      allInputs.forEach((inp, idx) => {
        if (inp.value.trim() !== "") lastFilledIndex = idx;
      });

      allInputs.forEach((inp, idx) => {
        if (idx > lastFilledIndex + 1) {
          container.removeChild(inp);
        }
      });
    });

    container.appendChild(input);
  }

  // Premier champ obligatoire
  addMotInput("obligatoire");
}
function initSelectOptions(id) {
  const maxFilled = 12;
  const good = document.getElementById(`selectGood_${id}`);
  const bad = document.getElementById(`selectBad_${id}`);

  // Crée un input et branche la synchro
  function createInput(placeholderText) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control";
    input.placeholder = placeholderText;
    input.addEventListener("input", sync);
    return input;
  }

  // S'assure que la colonne a son champ "obligatoire" (le tout premier)
  function ensureMandatory() {
    if (good.querySelectorAll("input").length === 0) {
      good.appendChild(createInput("Bonne réponse (obligatoire)"));
    }
    if (bad.querySelectorAll("input").length === 0) {
      bad.appendChild(createInput("Distracteur (obligatoire)"));
    }
  }

  // Garantit EXACTEMENT un champ vide "optionnel" par colonne (si on n'est pas à la limite)
  function ensureOneEmptyPerColumn() {
    [good, bad].forEach((col) => {
      const inputs = Array.from(col.querySelectorAll("input"));
      const empties = inputs.filter(i => i.value.trim() === "");

      // Si aucun vide -> on en ajoute un "optionnel"
      if (empties.length === 0) {
        col.appendChild(createInput("optionnel"));
      }
      // Si plusieurs vides -> on garde seulement le dernier (le plus bas), on retire les autres
      else if (empties.length > 1) {
        empties.slice(0, -1).forEach(e => e.remove());
      }
    });
  }

  // Applique la limite : à 12 réponses REMPLIES, on bloque tous les champs vides
  function enforceLimit() {
    const all = Array.from(document.querySelectorAll(`#selectGood_${id} input, #selectBad_${id} input`));
    const filledCount = all.filter(i => i.value.trim() !== "").length;
    const atCap = filledCount >= maxFilled;

    all.forEach(inp => {
      const col = inp.closest(`#selectGood_${id}`) ? good : bad;
      const isFirstInCol = col.querySelector("input") === inp;
      const isEmpty = inp.value.trim() === "";

      if (isEmpty) {
        if (atCap) {
          inp.readOnly = true;
          inp.placeholder = "limite atteinte";
        } else {
          inp.readOnly = false;
          // Restaurer placeholder contextuel si on est sous la limite
          if (isFirstInCol) {
            inp.placeholder = (col === good) ? "Bonne réponse (obligatoire)" : "Distracteur (obligatoire)";
          } else {
            inp.placeholder = "optionnel";
          }
        }
      }
    });
  }

  // Séquence de synchro appelée à chaque saisie
  function sync() {
    ensureOneEmptyPerColumn(); // garde 1 vide dispo par colonne
    enforceLimit();            // bloque/débloque selon le nombre rempli
  }

  // Initialisation
  ensureMandatory();
  ensureOneEmptyPerColumn(); // ajoute un "optionnel" dans chaque colonne au départ
  enforceLimit();
}



/*  ======  Gestion des images  ======  */
function handleImageUpload(event, id) {
  const file = event.target.files[0];
  if (!file) return;

  // Use the existing cropping workflow
  openCrop(event, id);
}

//  CROP  //
function openCropperWithBlob(blob, imageKey, onConfirm) {
  const match = imageKey.match(/^([^_]+)_EX(\d+)$/);
  if (!match) {
    console.error('Invalid imageKey:', imageKey);
    return;
  }
  const id = `${match[1]}_${match[2]}`;
  currentExId = id;
  currentImageConfirmCallback = onConfirm;

  const reader = new FileReader();
  reader.onload = e => {
    const cropImage = document.getElementById("cropImage");

    // ✅ CACHE BUSTING: Clear any existing src first
    cropImage.src = '';

    // ✅ Force garbage collection of old blob URLs
    if (cropImage.dataset.lastBlobURL) {
      try {
        URL.revokeObjectURL(cropImage.dataset.lastBlobURL);
      } catch (err) {
        // Ignore if already revoked
      }
      delete cropImage.dataset.lastBlobURL;
    }

    // Small delay to ensure cleanup
    setTimeout(() => {
      cropImage.src = e.target.result;
      document.getElementById("cropModal").style.display = "flex";

      // Destroy existing cropper if any
      if (cropper) cropper.destroy();

      // Create new cropper
      cropper = new Cropper(cropImage, {
        aspectRatio: 1280 / 720,
        viewMode: 1,
        autoCropArea: 1,
        responsive: true
      });

      console.log('✅ Cropper initialized (cache-busted)');
    }, 10);
  };
  reader.readAsDataURL(blob);
}
function openCrop(event, id) {
  const file = event.target.files[0];
  if (!file) return;
  currentExId = id;

  const reader = new FileReader();
  reader.onload = e => {
    const cropImage = document.getElementById("cropImage");
    const modal = document.getElementById("cropModal");

    cropImage.src = e.target.result;

    // Show modal with animation
    modal.classList.add('show');
    modal.style.display = 'flex';

    // Destroy existing cropper
    if (cropper) {
      cropper.destroy();
    }

    // Initialize cropper after a brief delay to ensure image is loaded
    setTimeout(() => {
      cropper = new Cropper(cropImage, {
        aspectRatio: 1280 / 720,
        viewMode: 1,
        autoCropArea: 1,
        responsive: true,
        restore: false,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
      });
    }, 100);
  };

  reader.readAsDataURL(file);
}
function closeCrop() {
  const modal = document.getElementById("cropModal");

  // Remove show class for animation
  modal.classList.remove('show');

  // Hide after animation completes
  setTimeout(() => {
    modal.style.display = "none";
  }, 200);

  // Destroy cropper
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
}
function validateCrop() {
  if (!cropper || !currentExId) return;

  // Get cropped canvas at exact 1280x720
  const canvas = cropper.getCroppedCanvas({ width: 1280, height: 720 });

  canvas.toBlob(blob => {
    if (!blob) {
      console.error('❌ Failed to create blob');
      return;
    }
    console.log(`✅ Blob created: ${blob.size} bytes`);
    detectCacheIssue(blob);
    const [section, exNum] = currentExId.split("_");
    const key = `${section}_EX${exNum}`;
    imagesData[key] = blob;

    // Get the input element to show preview
    const input = document.querySelector(`#imageContainer_${currentExId} input[type="file"]`);
    if (input) {
      addImagePreviewWithDelete(input, blob, currentExId);
    }

    console.log(`✅ Cropped image saved (1280x720): ${key}`);

    // ✅ Call the onConfirm callback if it exists (from NanoBanana)
    if (typeof currentImageConfirmCallback === 'function') {
      currentImageConfirmCallback(blob);
      currentImageConfirmCallback = null; // Clear it
    }

    if (detectCacheIssue(blob)) {
      // Issue detected and user was notified
    }

    closeCrop();
  }, "image/jpeg", 0.9);
}

//  PREVIEW //
function addImagePreviewWithDelete(previewEl, blob, id) {
  // Find the image container
  const container = document.getElementById(`imageContainer_${id}`);
  if (!container) {
    console.error(`Container not found: imageContainer_${id}`);
    return;
  }

  // Remove old preview if exists
  const oldWrapper = container.querySelector(".image-preview-wrapper");
  if (oldWrapper) oldWrapper.remove();

  // Create preview wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "image-preview-wrapper d-flex align-items-center gap-2 mt-2";

  // Preview image
  const img = document.createElement("img");
  img.src = URL.createObjectURL(blob);
  img.alt = "Aperçu image";
  img.className = "rounded border";
  img.style.maxWidth = "200px";
  img.style.maxHeight = "150px";
  img.style.objectFit = "cover";

  // Delete button
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "❌ Supprimer";
  btn.className = "btn btn-sm btn-outline-danger";
  btn.onclick = () => {
    if (!confirm("Supprimer cette image ?")) return;
    wrapper.remove();

    // Delete image data
    const [section, exNum] = id.split("_");
    const key = `${section}_EX${exNum}`;
    if (imagesData[key]) {
      delete imagesData[key];
    }
  };

  wrapper.appendChild(img);
  wrapper.appendChild(btn);

  // ✅ Insert at the END of the container (after buttons)
  container.appendChild(wrapper);
}

//  GESTION DU CACHE //
function clearImageCache() {
  console.log('🗑️ Clearing image cache...');
  
  let clearedCount = 0;
  
  // Clear crop modal
  const cropImage = document.getElementById("cropImage");
  if (cropImage) {
    if (cropImage.dataset.lastBlobURL) {
      URL.revokeObjectURL(cropImage.dataset.lastBlobURL);
      delete cropImage.dataset.lastBlobURL;
      clearedCount++;
    }
    cropImage.src = '';
  }
  
  // Destroy cropper
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
  
  // Clear all preview blob URLs
  document.querySelectorAll('.image-preview-wrapper img, .audio-preview-wrapper audio').forEach(el => {
    if (el.src && el.src.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(el.src);
        clearedCount++;
      } catch (e) { /* ignore */ }
    }
  });
  
  console.log(`✅ Cleared ${clearedCount} blob URLs`);
  alert(`✅ Cache vidé!\n\n${clearedCount} ressources nettoyées.\n\nRéessayez de générer une image.`);
}
function showCacheInfo() {
  let imageCount = Object.keys(imagesData).length;
  let audioCount = Object.keys(audiosData).length;
  let recapAudioCount = Object.keys(recapAudiosData).length;
  
  let totalSize = 0;
  for (const key in imagesData) {
    if (imagesData[key]) totalSize += imagesData[key].size;
  }
  for (const key in audiosData) {
    for (const audioKey in audiosData[key]) {
      if (audiosData[key][audioKey]) totalSize += audiosData[key][audioKey].size;
    }
  }
  for (const key in recapAudiosData) {
    if (recapAudiosData[key]) totalSize += recapAudiosData[key].size;
  }
  
  const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
  
  let blobURLCount = 0;
  document.querySelectorAll('img, audio, video').forEach(el => {
    if (el.src && el.src.startsWith('blob:')) blobURLCount++;
  });
  
  const display = document.getElementById('cacheInfoDisplay');
  if (display) {
    display.style.display = 'block';
    display.innerHTML = `
      <strong>📊 Cache actuel:</strong><br>
      <div class="mt-2">
        <span class="badge bg-primary">${imageCount} images</span>
        <span class="badge bg-success">${audioCount} audios</span>
        <span class="badge bg-info">${recapAudioCount} audios récap</span>
        <span class="badge bg-warning">${blobURLCount} blob URLs</span>
        <span class="badge bg-secondary">${sizeMB} MB</span>
      </div>
      <div class="mt-2 small text-muted">
        ${sizeMB > 100 ? '⚠️ Cache volumineux ! Envisagez de le vider.' : '✅ Taille raisonnable'}
      </div>
    `;
  }
  
  console.log('📊 Cache:', imageCount, 'images,', audioCount, 'audios,', sizeMB, 'MB');
}
function showCacheClearingInstructions() {
  const msg = `🗑️ VIDER LE CACHE DU NAVIGATEUR

📌 Chrome / Edge / Brave:
   Ctrl+Shift+Suppr → Cocher "Images et fichiers"
   → Période "Tout" → Effacer

📌 Firefox:
   Ctrl+Shift+Suppr → Cocher "Cache" → Effacer

📌 Safari (Mac):
   Cmd+Option+E

⚡ RAPIDE (tous):
   F12 → Clic-droit sur ↻ → "Vider le cache et actualiser"

💡 Le bouton "🧹 Vider le cache d'images"
   suffit généralement!`;
  
  alert(msg);
}
function detectCacheIssue(blob) {
  if (!blob || blob.size < 1000) {
    console.warn('⚠️ Suspicious blob:', blob?.size || 0, 'bytes');
    return true;
  }
  
  if (!window.recentBlobSizes) window.recentBlobSizes = [];
  window.recentBlobSizes.push(blob.size);
  window.recentBlobSizes = window.recentBlobSizes.slice(-5);
  
  if (window.recentBlobSizes.length >= 3) {
    const recentSmall = window.recentBlobSizes.slice(-3).every(s => s < 50000);
    if (recentSmall) {
      console.error('❌ Cache corruption detected!');
      if (confirm('❌ Corruption du cache détectée!\n\nPlusieurs images noires consécutives.\n\n✅ Vider le cache maintenant?')) {
        clearImageCache();
        window.recentBlobSizes = [];
      }
      return true;
    }
  }
  return false;
}



/*  ======  Gestion générale des audios  ======  */
function handleAudioUpload(event, id, isExemple) {
  const file = event.target.files[0];
  if (!file) return;

  const [section, exNum] = id.split("_");
  const key = `${section}_EX${exNum}`;
  if (!audiosData[key]) audiosData[key] = { main: null, exemple: null };

  const reader = new FileReader();
  reader.onload = () => {
    const blob = new Blob([reader.result], { type: file.type });

    // 🧩 Enregistrement dans la structure audio
    if (isExemple) audiosData[key].exemple = blob;
    else audiosData[key].main = blob;

    // 🎧 Création du preview + bouton de suppression
    const previewId = isExemple ? `audioPreviewEx_${id}` : `audioPreview_${id}`;
    addAudioPreviewWithDelete(event.target, blob, previewId, (data) => {
      if (isExemple && data.exemple) delete data.exemple;
      else if (!isExemple && data.main) delete data.main;

      // Supprime complètement la clé si vide
      if (Object.keys(data).length === 0) {
        const parentExo = event.target.closest(".exercice");
        if (parentExo) {
          const match = parentExo.id.match(/exo_(S\d+)_(\d+)/);
          if (match) {
            const dynKey = `${match[1]}_EX${match[2]}`;
            delete audiosData[dynKey];
          }
        }
      }
    });
  };
  reader.readAsArrayBuffer(file);
}
function addAudioPreviewWithDelete(targetInput, blob, previewId, deleteCallback) {
  // Try to find the audio container by working backwards from the input ID
  let container = null;

  // Try multiple ID patterns to find container
  if (targetInput.id) {
    // Pattern 1: audioInput_S1_1_main -> audioContainer_S1_1
    const match1 = targetInput.id.match(/audioInput_(.+?)_main$/);
    if (match1) {
      container = document.getElementById(`audioContainer_${match1[1]}`);
    }

    // Pattern 2: Direct parent lookup
    if (!container) {
      container = targetInput.closest('[id^="audioContainer_"]');
    }
  }

  // Pattern 3: createDualAudioButtons wraps the input in a plain flex div — use it as the container
  if (!container && targetInput.parentElement) {
    container = targetInput.parentElement;
  }

  // If container found, use new clean layout
  if (container) {
    // Remove old preview if exists
    const oldWrapper = container.querySelector(".audio-preview-wrapper");
    if (oldWrapper) oldWrapper.remove();

    // Create preview wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "audio-preview-wrapper d-flex align-items-center gap-2 mt-2";

    // Audio player
    const audio = document.createElement("audio");
    audio.id = previewId;
    audio.controls = true;
    audio.src = URL.createObjectURL(blob);
    audio.style.flex = "1";
    audio.style.maxWidth = "400px";

    // Delete button
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "❌ Supprimer";
    btn.className = "btn btn-sm btn-outline-danger";
    btn.onclick = () => {
      if (!confirm("Supprimer cet audio ?")) return;
      wrapper.remove();

      // Get dynamic key
      const parentExo = targetInput.closest(".exercice");
      if (parentExo) {
        const exoIdMatch = parentExo.id.match(/exo_(S\d+)_(\d+)/);
        if (exoIdMatch) {
          const dynamicKey = `${exoIdMatch[1]}_EX${exoIdMatch[2]}`;
          if (audiosData[dynamicKey]) {
            deleteCallback(audiosData[dynamicKey]);
            if (Object.keys(audiosData[dynamicKey]).length === 0)
              delete audiosData[dynamicKey];
          }
        }
      }
    };

    wrapper.appendChild(audio);
    wrapper.appendChild(btn);

    // Insert before transcription wrapper if present, otherwise at end
    const transcWrapper = container.querySelector('[id^="audioTranscriptionWrapper_"]');
    if (transcWrapper) container.insertBefore(wrapper, transcWrapper);
    else container.appendChild(wrapper);

  } else {
    // ❌ FALLBACK: Old behavior for compatibility with special cases
    console.warn('Audio container not found, using fallback insertion');

    // Remove old preview if exists
    const oldPreview = document.getElementById(previewId);
    if (oldPreview) {
      const oldWrapper = oldPreview.closest(".audio-wrapper");
      if (oldWrapper) oldWrapper.remove();
      else oldPreview.remove();
    }

    // Create wrapper (old style)
    const wrapper = document.createElement("div");
    wrapper.className = "audio-wrapper d-flex align-items-center gap-2 mt-1";

    // Audio player
    const audio = document.createElement("audio");
    audio.id = previewId;
    audio.controls = true;
    audio.src = URL.createObjectURL(blob);

    // Delete button
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "❌ Supprimer";
    btn.className = "btn btn-sm btn-outline-danger";
    btn.onclick = () => {
      if (!confirm("Supprimer cet audio ?")) return;
      wrapper.remove();

      const parentExo = targetInput.closest(".exercice");
      if (parentExo) {
        const exoIdMatch = parentExo.id.match(/exo_(S\d+)_(\d+)/);
        if (exoIdMatch) {
          const dynamicKey = `${exoIdMatch[1]}_EX${exoIdMatch[2]}`;
          if (audiosData[dynamicKey]) {
            deleteCallback(audiosData[dynamicKey]);
            if (Object.keys(audiosData[dynamicKey]).length === 0)
              delete audiosData[dynamicKey];
          }
        }
      }
    };

    wrapper.appendChild(audio);
    wrapper.appendChild(btn);

    // Insert after input (old fallback)
    targetInput.insertAdjacentElement("afterend", wrapper);
  }
}

/*  ======  Gestion des vidéos  ======  */
function handleVideoUpload(event, id) {
  const file = event.target.files[0];
  if (!file) return;
  openVideoCrop(file, id);
}

function addVideoPreviewWithDelete(targetInput, blob, id) {
  const container = document.getElementById(`videoContainer_${id}`);
  if (!container) {
    console.error(`Container not found: videoContainer_${id}`);
    return;
  }

  // Remove old preview if exists
  const oldWrapper = container.querySelector(".video-preview-wrapper");
  if (oldWrapper) oldWrapper.remove();

  // Create preview wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "video-preview-wrapper d-flex align-items-center gap-2 mt-2";

  // Video player
  const video = document.createElement("video");
  video.controls = true;
  video.src = URL.createObjectURL(blob);
  video.className = "rounded border";
  video.style.maxWidth = "320px";
  video.style.maxHeight = "180px";

  // Delete button
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "❌ Supprimer";
  btn.className = "btn btn-sm btn-outline-danger";
  btn.onclick = () => {
    if (!confirm("Supprimer cette vidéo ?")) return;
    wrapper.remove();

    // Delete video data
    const [section, exNum] = id.split("_");
    const key = `${section}_EX${exNum}`;
    if (videosData[key]) {
      delete videosData[key];
    }
  };

  wrapper.appendChild(video);
  wrapper.appendChild(btn);

  // Insert before transcription wrapper if present, otherwise at end
  const transcWrapper = container.querySelector(`#videoTranscriptionWrapper_${id}`);
  if (transcWrapper) container.insertBefore(wrapper, transcWrapper);
  else container.appendChild(wrapper);
}

/*  ======  Éditeur vidéo (Trim)  ======  */

// --- FFmpeg initialization ---
async function loadFFmpeg() {
  if (ffmpegLoaded && ffmpeg) return true;
  try {
    updateVideoProgress(5, "Chargement de FFmpeg (~25 Mo, première fois uniquement)...");
    const { FFmpeg } = FFmpegWASM;
    const { toBlobURL } = FFmpegUtil;
    ffmpeg = new FFmpeg();

    ffmpeg.on('progress', ({ progress }) => {
      const pct = 20 + Math.round(progress * 70);
      updateVideoProgress(pct, `Traitement de la vidéo... ${Math.round(progress * 100)}%`);
    });

    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegLoaded = true;
    updateVideoProgress(15, "FFmpeg prêt.");
    return true;
  } catch (err) {
    console.error('FFmpeg load error:', err);
    alert("Erreur lors du chargement de FFmpeg. Veuillez réessayer.");
    return false;
  }
}

// --- 16:9 format check ---
function checkVideoAspectRatio(video) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const ratio = w / h;
  const target = 16 / 9;
  const tolerance = 0.05; // ~2.8% margin
  const warning = document.getElementById('videoFormatWarning');

  if (Math.abs(ratio - target) > tolerance) {
    warning.style.display = 'block';
    warning.innerHTML =
      `<strong>Attention :</strong> Cette vidéo est en ${w}×${h} (ratio ${ratio.toFixed(2)}). ` +
      `Le format attendu est <strong>16:9</strong> (ratio 1.78). ` +
      `La vidéo risque d'être déformée ou mal affichée dans le module.`;
  } else {
    warning.style.display = 'none';
  }
}

// --- Modal open / close ---
function openVideoCrop(file, id) {
  currentVideoFile = file;
  currentVideoId = id;

  const video = document.getElementById('videoCropPreview');
  const modal = document.getElementById('videoCropModal');

  video.src = URL.createObjectURL(file);

  video.onloadedmetadata = () => {
    // Check aspect ratio
    checkVideoAspectRatio(video);

    // Setup trim sliders
    const startSlider = document.getElementById('videoTrimStart');
    const endSlider = document.getElementById('videoTrimEnd');
    startSlider.min = 0;
    startSlider.max = video.duration;
    startSlider.value = 0;
    startSlider.step = 0.01;
    endSlider.min = 0;
    endSlider.max = video.duration;
    endSlider.value = video.duration;
    endSlider.step = 0.01;

    updateTrimDisplay(0, video.duration);
  };

  // Reset progress
  document.getElementById('videoProcessingProgress').style.display = 'none';
  document.getElementById('videoFormatWarning').style.display = 'none';
  document.getElementById('validateVideoBtn').disabled = false;
  document.getElementById('validateVideoBtn').textContent = '✓ Valider et traiter';

  modal.classList.add('show');
  modal.style.display = 'flex';
}

function closeVideoCrop() {
  const modal = document.getElementById('videoCropModal');
  const video = document.getElementById('videoCropPreview');

  modal.classList.remove('show');
  setTimeout(() => {
    modal.style.display = 'none';
    if (video.src) { URL.revokeObjectURL(video.src); video.src = ''; }
  }, 200);

  currentVideoFile = null;
  currentVideoId = null;
  document.getElementById('videoProcessingProgress').style.display = 'none';
}

// --- Trim controls ---
function updateTrimPreview(which) {
  const video = document.getElementById('videoCropPreview');
  const startSlider = document.getElementById('videoTrimStart');
  const endSlider = document.getElementById('videoTrimEnd');

  let startVal = parseFloat(startSlider.value);
  let endVal = parseFloat(endSlider.value);

  // Prevent overlap
  if (which === 'start' && startVal >= endVal) {
    startVal = Math.max(0, endVal - 0.5);
    startSlider.value = startVal;
  } else if (which === 'end' && endVal <= startVal) {
    endVal = Math.min(video.duration, startVal + 0.5);
    endSlider.value = endVal;
  }

  // Seek video to preview position
  if (which === 'start') video.currentTime = startVal;
  else video.currentTime = endVal;

  updateTrimDisplay(startVal, endVal);
}

function updateTrimDisplay(start, end) {
  const fmt = s => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };
  document.getElementById('trimStartDisplay').textContent = fmt(start);
  document.getElementById('trimEndDisplay').textContent = fmt(end);
  document.getElementById('finalDuration').textContent = `${(end - start).toFixed(1)}s`;
}

// --- Progress UI ---
function updateVideoProgress(pct, text) {
  const bar = document.getElementById('videoProgressBar');
  const txt = document.getElementById('videoProgressText');
  const div = document.getElementById('videoProcessingProgress');
  div.style.display = 'block';
  bar.style.width = pct + '%';
  bar.textContent = pct + '%';
  txt.textContent = text;
}

// --- Main processing (trim only, no crop) ---
async function validateVideoCrop() {
  if (!currentVideoFile || !currentVideoId) return;

  const video = document.getElementById('videoCropPreview');
  const startTime = parseFloat(document.getElementById('videoTrimStart').value);
  const endTime = parseFloat(document.getElementById('videoTrimEnd').value);
  const needsTrim = startTime > 0.1 || endTime < video.duration - 0.1;

  // If no trim needed, store original file directly (no FFmpeg)
  if (!needsTrim) {
    const blob = new Blob([await currentVideoFile.arrayBuffer()], { type: currentVideoFile.type });
    const [section, exNum] = currentVideoId.split("_");
    const key = `${section}_EX${exNum}`;
    videosData[key] = blob;

    const input = document.getElementById(`videoInput_${currentVideoId}`);
    if (input) addVideoPreviewWithDelete(input, blob, currentVideoId);

    closeVideoCrop();
    return;
  }

  // Trim needed → use FFmpeg
  const btn = document.getElementById('validateVideoBtn');
  btn.disabled = true;
  btn.textContent = 'Traitement en cours...';

  try {
    const ok = await loadFFmpeg();
    if (!ok) throw new Error("FFmpeg n'a pas pu être chargé");

    updateVideoProgress(15, "Lecture du fichier vidéo...");

    const fileData = new Uint8Array(await currentVideoFile.arrayBuffer());
    await ffmpeg.writeFile('input.mp4', fileData);

    // Build FFmpeg command (trim only, re-encode to mp4)
    const args = ['-i', 'input.mp4'];
    if (startTime > 0) args.push('-ss', startTime.toFixed(2));
    if (endTime < video.duration) args.push('-to', endTime.toFixed(2));
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
    args.push('-c:a', 'aac', '-b:a', '128k');
    args.push('-movflags', '+faststart');
    args.push('output.mp4');

    console.log('FFmpeg args:', args.join(' '));
    updateVideoProgress(20, "Découpage de la vidéo (cela peut prendre un moment)...");

    await ffmpeg.exec(args);

    updateVideoProgress(92, "Récupération de la vidéo...");

    const outputData = await ffmpeg.readFile('output.mp4');
    const outputBlob = new Blob([outputData.buffer], { type: 'video/mp4' });

    const [section, exNum] = currentVideoId.split("_");
    const key = `${section}_EX${exNum}`;
    videosData[key] = outputBlob;

    const input = document.getElementById(`videoInput_${currentVideoId}`);
    if (input) addVideoPreviewWithDelete(input, outputBlob, currentVideoId);

    updateVideoProgress(100, "Vidéo traitée avec succès !");
    console.log(`Video processed: ${key} (${(outputBlob.size / 1024 / 1024).toFixed(1)} Mo)`);

    try { await ffmpeg.deleteFile('input.mp4'); } catch (_) {}
    try { await ffmpeg.deleteFile('output.mp4'); } catch (_) {}

    setTimeout(() => {
      closeVideoCrop();
      btn.disabled = false;
      btn.textContent = '✓ Valider et traiter';
    }, 800);

  } catch (err) {
    console.error('Video processing error:', err);
    alert(`Erreur lors du traitement : ${err.message}`);
    document.getElementById('videoProcessingProgress').style.display = 'none';
    btn.disabled = false;
    btn.textContent = '✓ Valider et traiter';
  }
}


/*  ======  Gestion des récap de fin de séquence  ======  */
function initRecapSections() {
  ["S1", "S2", "S3", "S4"].forEach(section => {
    const container = document.getElementById(`pane-${section}`);
    if (!container) return;

    const recapDiv = document.createElement("div");
    recapDiv.className = "recap-section border rounded p-3 mb-4 bg-light";
    recapDiv.innerHTML = `
      <h4>🧾 Récapitulatif final de la section</h4>
      <label>Format du récapitulatif</label>
      <select class="form-select mb-3" onchange="updateRecapFields('${section}')" id="recapType_${section}">
        <option value="Minimaliste">Minimaliste (Score)</option>
        <option value="Liste">Normal (Score + liste)</option>
        <option value="Texte">Normal (Score + texte)</option>
      </select>
      <div id="recapFields_${section}" class="mt-2"></div>
    `;
    container.appendChild(recapDiv);
  });
}
function updateRecapFields(section) {
  const type = document.getElementById(`recapType_${section}`).value;
  const container = document.getElementById(`recapFields_${section}`);
  let html = "";

  if (type === "Minimaliste") {
    html = `<p class="text-muted">Aucun contenu supplémentaire. Seul le score sera affiché.</p>`;
  }

  else if (type === "Liste") {
    html = `
      <p class="text-muted mb-3">Ajoutez jusqu’à 6 expressions avec un audio associé.</p>
      ${Array.from({ length: 6 }).map((_, i) => `
        <div class="mb-4 p-3 border rounded bg-light">
          <label for="recapExpr_${section}_${i + 1}" class="form-label fw-bold">
            Expression ${i + 1}
          </label>
          <input type="text" id="recapExpr_${section}_${i + 1}" class="form-control mb-2"
            placeholder="Saisissez ici le texte de l’expression ${i + 1}">
          
          <label class="form-label small text-muted mb-1">Audio associé (facultatif)</label>
          <input type="file" accept="audio/*"
            onchange="handleRecapAudioUpload(event, '${section}', ${i + 1})"
            class="form-control form-control-sm">
        </div>
      `).join("")}
    `;
  }


  else if (type === "Texte") {
    html = `
      <label>Texte du récapitulatif</label>
      <textarea id="recapTexte_${section}" class="form-control" rows="3"
        placeholder="Texte à afficher après le score."></textarea>
    `;
  }

  container.innerHTML = html;
}
function handleRecapAudioUpload(event, section, index) {
  const file = event.target.files[0];
  if (!file) return;

  if (!recapAudiosData[section]) recapAudiosData[section] = {};

  const reader = new FileReader();
  reader.onload = () => {
    const blob = new Blob([reader.result], { type: file.type });
    recapAudiosData[section][index] = blob;

    // 🧩 Appelle la fonction dédiée au récap (indépendante du système principal)
    addRecapAudioPreviewWithDelete(event.target, blob, section, index);
  };
  reader.readAsArrayBuffer(file);
}
function addRecapAudioPreviewWithDelete(targetInput, blob, section, index) {
  const previewId = `audioRecap_${section}_${index}`;

  // Supprime un ancien preview s'il existe
  const old = document.getElementById(previewId);
  if (old) {
    const wrapper = old.closest(".audio-wrapper");
    if (wrapper) wrapper.remove();
    else old.remove();
  }

  // Crée un conteneur
  const wrapper = document.createElement("div");
  wrapper.className = "audio-wrapper d-flex align-items-center gap-2 mt-1";

  // Lecteur audio
  const audio = document.createElement("audio");
  audio.id = previewId;
  audio.controls = true;
  audio.src = URL.createObjectURL(blob);

  // Bouton de suppression
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "❌ Supprimer";
  btn.className = "btn btn-sm btn-outline-danger";
  btn.onclick = () => {
    if (!confirm("Supprimer cet audio du récapitulatif ?")) return;
    wrapper.remove();

    // ✅ Supprime uniquement dans recapAudiosData
    if (recapAudiosData[section] && recapAudiosData[section][index]) {
      delete recapAudiosData[section][index];
      //console.log(`🗑️ Audio du récap ${section} #${index} supprimé`);
    }

    // 🧹 Si plus aucun audio pour la section, supprime la clé
    if (recapAudiosData[section] && Object.keys(recapAudiosData[section]).length === 0) {
      delete recapAudiosData[section];
      //console.log(`🧹 Section ${section} vidée du récap.`);
    }
  };

  wrapper.appendChild(audio);
  wrapper.appendChild(btn);

  targetInput.insertAdjacentElement("afterend", wrapper);
}



/*  ======  Construction et preview JSON  ======  */

// Wraps a main audio path + optional transcription textarea into the Audio_Enonce object.
// Returns null if no audio. Always reads transcription from the DOM textarea.
function _buildAudioEnonce(id, filePath) {
  if (!filePath) return null;
  const transcription = document.getElementById(`audioTranscription_${id}`)?.value?.trim() || null;
  return { Fichier: filePath, Transcription: transcription };
}

function _buildVideoEnonce(id, filePath) {
  if (!filePath) return null;
  const transcription = document.getElementById(`videoTranscription_${id}`)?.value?.trim() || null;
  return { Fichier: filePath, Transcription: transcription };
}

function buildResult() {
  const title = document.getElementById("chapterTitle").value.trim() || "Parcours sans nom";
  const level = Number(document.getElementById("chapterLevel")?.value || 1);
  const safeName = title.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "") || "chapitre";

  // --- ⏱️ Lecture des durées estimées par section ---
  const durationS1 = Number(document.getElementById("duration_S1")?.value || 0);
  const durationS2 = Number(document.getElementById("duration_S2")?.value || 0);
  const durationS3 = Number(document.getElementById("duration_S3")?.value || 0);
  const durationS4 = Number(document.getElementById("duration_S4")?.value || 0);

  // --- S0 : infos générales ---
  const S0 = {
    Chapter_Title: title,
    Level: level,
    S1_Exo_Total: sections.S1.count,
    S2_Exo_Total: sections.S2.count,
    S3_Exo_Total: sections.S3.count,
    S4_Exo_Total: sections.S4.count,
    Durations: {
      S1: durationS1,
      S2: durationS2,
      S3: durationS3,
      S4: durationS4
    }
  };

  const sectionsData = { S1: {}, S2: {}, S3: {}, S4: {} };

  // --- 🧩 On sauvegarde aussi la durée dans chaque section (optionnel mais pratique)
  for (const [key, val] of Object.entries({
    S1: durationS1,
    S2: durationS2,
    S3: durationS3,
    S4: durationS4
  })) {
    if (val > 0) {
      sectionsData[key].Duration = val;
    }
  }

  // --- Sections ---
  for (const s of ["S1", "S2", "S3", "S4"]) {
    for (let i = 1; i <= sections[s].count; i++) {
      const id = `${s}_${i}`;
      const type = document.getElementById(`type_${id}`)?.value;
      if (!type) continue;

      const consigne = document.getElementById(`consigne_${id}`)?.value || "";
      const tentatives = Number(document.getElementById(`tentatives_${id}`)?.value || (
        type === "QCU" || type === "Matching" || type === "Complete" ? 2 : 1
      ));

      // Images
      const imagePath = imagesData[`${s}_EX${i}`]
        ? `Ressources_Sequences/${s}/Images/${s}_EX${i}.jpg`
        : null;
      
      // Vidéo AJOUT
      const videoPath = videosData[`${s}_EX${i}`]
        ? `Ressources_Sequences/${s}/Videos/${s}_EX${i}.mp4`
        : null;

      // Audios
      const audioData = audiosData[`${s}_EX${i}`];
      const basePath = `Ressources_Sequences/${s}/Audios/${s}_EX${i}`;

      // =====================================================
      // FEEDBACK — gestion dynamique (Simple / Complet)
      // =====================================================
      let feedbackData = null; // par défaut : aucun feedback
      // 👉 On ne traite le feedback que si le type le permet
      const feedbackAllowed =
        activityTypesConfig[type]?.feedback?.length ||
        (activityTypesConfig[type]?.subtypes &&
          Object.values(activityTypesConfig[type].subtypes).some(st => st.feedback?.length));
      if (feedbackAllowed) {
        const feedbackType = document.getElementById(`feedbackType_${id}`)?.value || "Simple";

        if (feedbackType === "Simple") {
          const fbEl = document.getElementById(`feedback_${id}`);
          const fbText = fbEl?.dataset.html || fbEl?.querySelector(".ql-editor")?.innerHTML || "";
          feedbackData = { Type: "Simple", Texte_HTML: fbText };
        } else if (feedbackType === "Complet") {
          const correctionEl = document.getElementById(`feedbackCorrection_${id}`);
          const tradEl = document.getElementById(`feedbackTrad_${id}`);
          const phraseEl = document.getElementById(`feedbackSimple_${id}`);

          const correction = correctionEl?.dataset.html || correctionEl?.querySelector(".ql-editor")?.innerHTML || "";
          const traduction = tradEl?.dataset.html || tradEl?.querySelector(".ql-editor")?.innerHTML || "";
          const phrase = phraseEl?.dataset.html || phraseEl?.querySelector(".ql-editor")?.innerHTML || "";

          const fbAudio = audioData?.feedback ? `${basePath}_feedback.mp3` : null;

          feedbackData = {
            Type: "Complet",
            Correction_HTML: correction,
            Traduction_HTML: traduction,
            Phrase_HTML: phrase,
            Audio: fbAudio
          };
        }
      }

      // =====================================================
      // TRUE OR FALSE
      // =====================================================
      if (type === "True or false") {
        const affirmation = document.getElementById(`enonce_${id}`)?.value || "";
        const truth = document.getElementById(`truth_${id}`)?.value || "True";
        const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;

        sectionsData[s][`EX${i}`] = {
          Type: "True or false",
          Consigne: consigne,
          Affirmation: affirmation,
          BonneReponse: truth,
          Feedback: feedbackData,
          Tentatives: tentatives,
          Image: imagePath,
          Video: _buildVideoEnonce(id, videoPath),
          Audio_Enonce: _buildAudioEnonce(id, audioEnonce)
        };
        continue;
      }

      // =====================================================
      // QCU
      // =====================================================
      if (type === "QCU") {
        const question = document.getElementById(`enonce_${id}`)?.value || "";
        const reponses = {
          A: document.getElementById(`qcuA_${id}`)?.value || "",
          B: document.getElementById(`qcuB_${id}`)?.value || "",
          C: document.getElementById(`qcuC_${id}`)?.value || "",
          D: document.getElementById(`qcuD_${id}`)?.value || ""
        };
        const bonneReponse = "A";
        const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;

        sectionsData[s][`EX${i}`] = {
          Type: "QCU",
          Consigne: consigne,
          Question: question,
          Reponses: reponses,
          BonneReponse: bonneReponse,
          Feedback: feedbackData,
          Tentatives: tentatives,
          Image: imagePath,
          Video: _buildVideoEnonce(id, videoPath),
          Audio_Enonce: _buildAudioEnonce(id, audioEnonce)
        };
        continue;
      }

      // =====================================================
      // QCM
      // =====================================================
      if (type === "QCM") {
        const question = document.getElementById(`enonce_${id}`)?.value || "";
        const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;

        const reponses = {};
        const corrections = [];

        ["A", "B", "C", "D"].forEach(letter => {
          const text = document.getElementById(`qcm${letter}_${id}`)?.value || "";
          const isGood = document.getElementById(`qcmCheck_${letter}_${id}`)?.checked || false;
          reponses[letter] = text;
          if (isGood) corrections.push(letter);
        });

        sectionsData[s][`EX${i}`] = {
          Type: "QCM",
          Consigne: consigne,
          Question: question,
          Reponses: reponses,
          Corrections: corrections,
          Feedback: feedbackData,
          Tentatives: tentatives,
          Image: imagePath,
          Video: _buildVideoEnonce(id, videoPath),
          Audio_Enonce: _buildAudioEnonce(id, audioEnonce)
        };
        continue;
      }

      // =====================================================
      // MATCHING
      // =====================================================
      if (type === "Matching") {
        const consigne = document.getElementById(`consigne_${id}`)?.value || "";
        const matchType = document.getElementById(`matchType_${id}`)?.value || "";

        const [section, num] = id.split("_");
        const key = `${section}_EX${num}`;
        const basePath = `Ressources_Sequences/${section}/Audios/${key}`;

        const matchAudios = audiosData[key]?.match || {};
        const audioEnonce = audiosData?.[key]?.main ? `${basePath}_main.mp3` : null;

        const paires = {};

        // 4 paires par défaut
        for (let i = 1; i <= 4; i++) {
          const leftKey = `Match_L${i}`;
          const rightKey = `Match_R${i}`;
          const leftValue = matchType.includes("audio")
            ? (matchAudios[leftKey] ? `${basePath}_${leftKey}.mp3` : "")
            : document.getElementById(`matchText_${id}_L${i}`)?.value || "";
          const rightValue = matchType.endsWith("audio")
            ? (matchAudios[rightKey] ? `${basePath}_${rightKey}.mp3` : "")
            : document.getElementById(`matchText_${id}_R${i}`)?.value || "";

          paires[`P${i}`] = {
            [leftKey]: leftValue,
            [rightKey]: rightValue
          };
        }

        sectionsData[s][`EX${i}`] = {
          Type: "Matching",
          Consigne: consigne,
          Feedback: feedbackData,
          Match_Type: matchType,
          Tentatives: tentatives,
          Audio_Enonce: _buildAudioEnonce(id, audioEnonce),
          Paires: paires
        };
        continue;
      }

      // =====================================================
      // COMPLETE
      // =====================================================
      if (type === "Complete") {
        const completeType = document.getElementById(`completeType_${id}`)?.value || "";
        const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;

        if (completeType === "options") {
          const options = [];
          for (let j = 1; j <= 6; j++) {
            const val = document.getElementById(`opt${j}_${id}`)?.value?.trim();
            if (val) options.push(val);
          }

          const texteComplet = document.getElementById(`texte_${id}`)?.value || "";
          let texteIncomplet = "(prévisualisation non générée)";
          const previewEl = document.getElementById(`texteTronque_${id}`);
          if (previewEl && previewEl.textContent && previewEl.textContent !== "(prévisualisation)") {
            texteIncomplet = previewEl.textContent;
          }

          sectionsData[s][`EX${i}`] = {
            Type: "Complete",
            Complete_Type: "options",
            Consigne: consigne,
            Texte_Complet: texteComplet,
            Texte_Incomplet: texteIncomplet,
            Options: options,
            Feedback: feedbackData,
            Tentatives: tentatives,
            Audio_Enonce: _buildAudioEnonce(id, audioEnonce)
          };
        }
        else if (completeType === "reconstruit") {
          const options = [];
          for (let j = 1; j <= 6; j++) {
            const val = document.getElementById(`opt${j}_${id}`)?.value?.trim();
            if (val) options.push(val);
          }

          const texteComplet = document.getElementById(`texte_${id}`)?.value || "";
          let texteIncomplet = "(prévisualisation non générée)";
          const previewEl = document.getElementById(`texteTronque_${id}`);
          if (previewEl && previewEl.textContent && previewEl.textContent !== "(prévisualisation)") {
            texteIncomplet = previewEl.textContent;
          }

          sectionsData[s][`EX${i}`] = {
            Type: "Complete",
            Complete_Type: "reconstruit",
            Consigne: consigne,
            Texte_Complet: texteComplet,
            Texte_Incomplet: texteIncomplet,
            Options: options,
            Feedback: feedbackData,
            Tentatives: tentatives,
            Audio_Enonce: _buildAudioEnonce(id, audioEnonce)
          };
        }

        continue;
      }

      // =====================================================
      // FLASHCARD
      // =====================================================
      if (type === "Flashcard") {
        const flashType = document.getElementById(`flashcardType_${id}`)?.value || "";
        const consigne = document.getElementById(`consigne_${id}`)?.value || "";
        const frontText = document.getElementById(`front_${id}`)?.value || "";
        const backText = document.getElementById(`back_${id}`)?.value || "";

        const frontAudio = audioData?.flashcard?.front ? `${basePath}_front.mp3` : null;
        const backAudio = audioData?.flashcard?.back ? `${basePath}_back.mp3` : null;

        // 🔹 Lecture du type d'informations complémentaires
        const extraType = document.getElementById(`flashExtraType_${id}`)?.value || "Aucune";
        let extraData = { Type: extraType };

        if (extraType === "Ajouter des phrases en exemples") {
          extraData = {
            Type: "Phrases",
            Elements: []
          };
          for (let j = 1; j <= 5; j++) {
            const val = document.getElementById(`flashExtraPhrase_${id}_${j}`)?.value?.trim();
            if (val) extraData.Elements.push(val);
          }
        }
        else if (extraType === "Ajouter des expressions complémentaires") {
          extraData = {
            Type: "Expressions",
            Elements: []
          };
          for (let j = 1; j <= 5; j++) {
            const expr = document.getElementById(`flashExtraExpr_${id}_${j}`)?.value?.trim();
            const ex = document.getElementById(`flashExtraExemple_${id}_${j}`)?.value?.trim();
            if (expr || ex) {
              extraData.Elements.push({
                Expression: expr || "",
                Exemple: ex || ""
              });
            }
          }
        }

        // ✅ On ne met Feedback que s’il existe vraiment
        const flashcardObject = {
          Type: "Flashcard",
          Flashcard_Type: flashType,
          Consigne: consigne,
          Front_Text: frontText,
          Back_Text: backText,
          Tentatives: 1,
          Image: imagePath,
          Front_Audio: frontAudio,
          Back_Audio: backAudio,
          Extra: extraData
        };

        if (feedbackData) flashcardObject.Feedback = feedbackData; // 🔥

        sectionsData[s][`EX${i}`] = flashcardObject;
        continue;
      }

      // =====================================================
      // INFORMATION
      // =====================================================
      if (type === "Information") {
        const titre = document.getElementById(`titre_${id}`)?.value || "";
        const expression = document.getElementById(`expression_${id}`)?.value || "";
        const exemple = document.getElementById(`exemple_${id}`)?.value || "";
        const exempleAudio = audioData?.exemple ? `${basePath}_exemple.mp3` : null;

        sectionsData[s][`EX${i}`] = {
          Type: "Information",
          Titre: titre,
          Expression: expression,
          Exemple: exemple,
          Exemple_Audio: exempleAudio,
          Tentatives: 1,
          Image: imagePath
        };
        continue;
      }

      // =====================================================
      // LEÇON
      // =====================================================
      if (type === "Leçon") {
        const subType = document.getElementById(`lessonType_${id}`)?.value || "";

        if (subType === "simple") {
          const consigne = document.getElementById(`lessonConsigne_${id}`)?.value || "";
          const exprFr = document.getElementById(`lessonExprFr_${id}`)?.value || "";
          const exprEn = document.getElementById(`lessonExprEn_${id}`)?.value || "";
          const exFr = document.getElementById(`lessonExFr_${id}`)?.value || "";
          const exEn = document.getElementById(`lessonExEn_${id}`)?.value || "";

          const audioExample = audiosData?.[`${s}_EX${i}`]?.example ? `${basePath}_example.mp3` : null;
          const audioExpressionFr = audiosData?.[`${s}_EX${i}`]?.exprFr ? `${basePath}_exprFr.mp3` : null;

          sectionsData[s][`EX${i}`] = {
            Type: "Leçon",
            SubType: "simple",
            Consigne: consigne,
            Expression_FR: exprFr,
            Expression_EN: exprEn,
            Exemple_FR: exFr,
            Exemple_EN: exEn,
            Image: imagePath,
            Audio_Exemple: audioExample,
            Audio_Expression: audioExpressionFr
          };
        }
        else if (subType === "complexe") {
          const consigne = document.getElementById(`lessonConsigne_${id}`)?.value || "";
          const texteHTML = document.querySelector(`#lessonTexte_${id} .ql-editor`)?.innerHTML || "";

          const hasHeader = document.getElementById(`lessonHeader_${id}`).value === "oui";
          const cols = Number(document.getElementById(`lessonCols_${id}`).value || 1);
          const rows = Number(document.getElementById(`lessonRows_${id}`).value || 1);

          const headers = [];
          if (hasHeader) {
            for (let c = 1; c <= cols; c++) {
              headers.push(document.getElementById(`lessonHeaderText_${id}_${c}`)?.value || "");
            }
          }

          const lignes = [];
          for (let r = 1; r <= rows; r++) {
            const colonnes = [];
            for (let c = 1; c <= cols; c++) {
              const txt = document.getElementById(`lessonCell_${id}_${r}_${c}`)?.value || "";

              // 🔹 Nouveau schéma de nommage
              const audioId = `${id}_LessonTable_L${r}_C${c}`;
              const audioPath = audiosData?.[`${s}_EX${i}`]?.lesson?.[audioId]
                ? `Ressources_Sequences/${s}/Audios/${s}_EX${i}_LessonTable_L${r}_C${c}.mp3`
                : null;

              colonnes.push({
                Texte: txt,
                Audio: audioPath
              });
            }
            lignes.push({ Ligne: r, Colonnes: colonnes });
          }

          sectionsData[s][`EX${i}`] = {
            Type: "Leçon",
            SubType: "complexe",
            Consigne: consigne,
            Texte_HTML: texteHTML,
            Has_Header: hasHeader,
            Headers: headers,
            Lignes: lignes
          };
        }
        continue;
      }

      // =====================================================
      // DIALOGUE
      // =====================================================
      if (type === "Dialogue") {
        const consigne = document.getElementById(`consigne_${id}`)?.value || "";
        const tentatives = Number(document.getElementById(`tentatives_${id}`)?.value || 1);
        const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;

        // Récupération du script
        const lignes = [];
        const container = document.getElementById(`dialogueContainer_${id}`);
        if (container) {
          const lines = container.querySelectorAll(".dialogue-line");
          lines.forEach((line) => {
            const nom = line.querySelector(`[id^="dialogueNom_"]`)?.value.trim();
            const texte = line.querySelector(`[id^="dialogueTexte_"]`)?.value.trim();
            if (nom && texte) lignes.push({ Nom: nom, Texte: texte });
          });
        }

        // Format HTML pour Storyline
        const scriptHTML = lignes
          .map(l => `<b>${l.Nom} :</b> ${l.Texte}<br><br>`)
          .join("");

        sectionsData[s][`EX${i}`] = {
          Type: "Dialogue",
          Consigne: consigne,
          Tentatives: tentatives,
          Image: imagePath,
          Audio_Enonce: _buildAudioEnonce(id, audioEnonce),
          Script: lignes,
          Script_HTML: scriptHTML,
        };
        continue;
      }

      // =====================================================
      // MEDIA
      // =====================================================
      if (type === "Media") {
        const mediaType = document.getElementById(`mediaType_${id}`)?.value || "video";
        const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;

        sectionsData[s][`EX${i}`] = {
          Type: "Media",
          Media_Type: mediaType,
          Image: mediaType === "image_audio" ? imagePath : null,
          Video: mediaType === "video" ? _buildVideoEnonce(id, videoPath) : null,
          Audio_Enonce: mediaType === "image_audio" ? _buildAudioEnonce(id, audioEnonce) : null
        };
        continue;
      }

      // =====================================================
      // PRODUCTION ORALE - DICTÉE
      // =====================================================
      if (type === "Production orale - dictée") {
        const consigne = document.getElementById(`consigne_${id}`)?.value || "";
        const tentatives = Number(document.getElementById(`tentatives_${id}`)?.value || 1);
        const phrase = document.getElementById(`phrase_${id}`)?.value || "";
        const hasAudio = document.getElementById(`audioSwitch_${id}`)?.checked || false;
        const audioEnonce = hasAudio && audioData?.main ? `${basePath}_main.mp3` : null;

        sectionsData[s][`EX${i}`] = {
          Type: "Production orale - dictée",
          Consigne: consigne,
          Phrase: phrase,
          Tentatives: tentatives,
          Fournir_Audio: hasAudio,
          Audio_Exemple: audioEnonce,
          Image: imagePath,
          Feedback: feedbackData
        };
        continue;
      }


    }
    // =====================================================
    // RECAP
    // =====================================================   
    const recapType = document.getElementById(`recapType_${s}`)?.value || "Minimaliste";
    if (recapType === "Minimaliste") {
      sectionsData[s].Recap = { Type: "Minimaliste" };
    }
    else if (recapType === "Liste") {
      const expressions = [];
      for (let i = 1; i <= 6; i++) {
        const texte = document.getElementById(`recapExpr_${s}_${i}`)?.value?.trim();
        const audio = recapAudiosData[s]?.[i]
          ? `Ressources_Sequences/${s}/Audios/Recap_${i}.mp3`
          : null;
        if (texte) expressions.push({ Texte: texte, Audio: audio });
      }
      sectionsData[s].Recap = { Type: "Liste", Expressions: expressions };
    }
    else if (recapType === "Texte") {
      const texte = document.getElementById(`recapTexte_${s}`)?.value?.trim() || "";
      sectionsData[s].Recap = { Type: "Texte", Texte: texte };
    }

  }

  return { S0, sectionsData, safeName };
}
// =====================================================
// Quick Preview — Collecte d'un seul exercice remappé en S1_EX1
// =====================================================
function buildSingleExerciseResult(id) {
  const [origSection, origNumStr] = id.split("_");
  const origNum = Number(origNumStr);
  const type = document.getElementById(`type_${id}`)?.value;
  if (!type) throw new Error("Aucun type sélectionné pour cet exercice.");

  // Remapped base path (everything becomes S1_EX1)
  const basePath = `Ressources_Sequences/S1/Audios/S1_EX1`;

  const consigne = document.getElementById(`consigne_${id}`)?.value || "";
  const tentatives = Number(document.getElementById(`tentatives_${id}`)?.value || (
    type === "QCU" || type === "Matching" || type === "Complete" ? 2 : 1
  ));

  // Media — lookup with original keys
  const origMediaKey = `${origSection}_EX${origNum}`;
  const imagePath = imagesData[origMediaKey]
    ? `Ressources_Sequences/S1/Images/S1_EX1.jpg`
    : null;
  const videoPath = videosData[origMediaKey]
    ? `Ressources_Sequences/S1/Videos/S1_EX1.mp4`
    : null;
  const audioData = audiosData[origMediaKey];

  // --- Feedback ---
  let feedbackData = null;
  const feedbackAllowed =
    activityTypesConfig[type]?.feedback?.length ||
    (activityTypesConfig[type]?.subtypes &&
      Object.values(activityTypesConfig[type].subtypes).some(st => st.feedback?.length));
  if (feedbackAllowed) {
    const feedbackType = document.getElementById(`feedbackType_${id}`)?.value || "Simple";
    if (feedbackType === "Simple") {
      const fbEl = document.getElementById(`feedback_${id}`);
      const fbText = fbEl?.dataset.html || fbEl?.querySelector(".ql-editor")?.innerHTML || "";
      feedbackData = { Type: "Simple", Texte_HTML: fbText };
    } else if (feedbackType === "Complet") {
      const correctionEl = document.getElementById(`feedbackCorrection_${id}`);
      const tradEl = document.getElementById(`feedbackTrad_${id}`);
      const phraseEl = document.getElementById(`feedbackSimple_${id}`);
      const correction = correctionEl?.dataset.html || correctionEl?.querySelector(".ql-editor")?.innerHTML || "";
      const traduction = tradEl?.dataset.html || tradEl?.querySelector(".ql-editor")?.innerHTML || "";
      const phrase = phraseEl?.dataset.html || phraseEl?.querySelector(".ql-editor")?.innerHTML || "";
      const fbAudio = audioData?.feedback ? `${basePath}_feedback.mp3` : null;
      feedbackData = { Type: "Complet", Correction_HTML: correction, Traduction_HTML: traduction, Phrase_HTML: phrase, Audio: fbAudio };
    }
  }

  // --- Build exercise data (same logic as buildResult, remapped to S1_EX1) ---
  let exData = null;

  if (type === "True or false") {
    const affirmation = document.getElementById(`enonce_${id}`)?.value || "";
    const truth = document.getElementById(`truth_${id}`)?.value || "True";
    const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;
    exData = { Type: "True or false", Consigne: consigne, Affirmation: affirmation, BonneReponse: truth, Feedback: feedbackData, Tentatives: tentatives, Image: imagePath, Video: _buildVideoEnonce(id, videoPath), Audio_Enonce: _buildAudioEnonce(id, audioEnonce) };
  }
  else if (type === "QCU") {
    const question = document.getElementById(`enonce_${id}`)?.value || "";
    const reponses = { A: document.getElementById(`qcuA_${id}`)?.value || "", B: document.getElementById(`qcuB_${id}`)?.value || "", C: document.getElementById(`qcuC_${id}`)?.value || "", D: document.getElementById(`qcuD_${id}`)?.value || "" };
    const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;
    exData = { Type: "QCU", Consigne: consigne, Question: question, Reponses: reponses, BonneReponse: "A", Feedback: feedbackData, Tentatives: tentatives, Image: imagePath, Video: _buildVideoEnonce(id, videoPath), Audio_Enonce: _buildAudioEnonce(id, audioEnonce) };
  }
  else if (type === "QCM") {
    const question = document.getElementById(`enonce_${id}`)?.value || "";
    const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;
    const reponses = {};
    const corrections = [];
    ["A", "B", "C", "D"].forEach(letter => {
      reponses[letter] = document.getElementById(`qcm${letter}_${id}`)?.value || "";
      if (document.getElementById(`qcmCheck_${letter}_${id}`)?.checked) corrections.push(letter);
    });
    exData = { Type: "QCM", Consigne: consigne, Question: question, Reponses: reponses, Corrections: corrections, Feedback: feedbackData, Tentatives: tentatives, Image: imagePath, Video: _buildVideoEnonce(id, videoPath), Audio_Enonce: _buildAudioEnonce(id, audioEnonce) };
  }
  else if (type === "Matching") {
    const matchConsigne = document.getElementById(`consigne_${id}`)?.value || "";
    const matchType = document.getElementById(`matchType_${id}`)?.value || "";
    const matchAudios = audioData?.match || {};
    const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;
    const paires = {};
    for (let p = 1; p <= 4; p++) {
      const leftKey = `Match_L${p}`;
      const rightKey = `Match_R${p}`;
      const leftValue = matchType.includes("audio")
        ? (matchAudios[leftKey] ? `${basePath}_${leftKey}.mp3` : "")
        : document.getElementById(`matchText_${id}_L${p}`)?.value || "";
      const rightValue = matchType.endsWith("audio")
        ? (matchAudios[rightKey] ? `${basePath}_${rightKey}.mp3` : "")
        : document.getElementById(`matchText_${id}_R${p}`)?.value || "";
      paires[`P${p}`] = { [leftKey]: leftValue, [rightKey]: rightValue };
    }
    exData = { Type: "Matching", Consigne: matchConsigne, Feedback: feedbackData, Match_Type: matchType, Tentatives: tentatives, Audio_Enonce: _buildAudioEnonce(id, audioEnonce), Paires: paires };
  }
  else if (type === "Complete") {
    const completeType = document.getElementById(`completeType_${id}`)?.value || "";
    const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;
    const options = [];
    for (let j = 1; j <= 6; j++) {
      const val = document.getElementById(`opt${j}_${id}`)?.value?.trim();
      if (val) options.push(val);
    }
    const texteComplet = document.getElementById(`texte_${id}`)?.value || "";
    let texteIncomplet = "(prévisualisation non générée)";
    const previewEl = document.getElementById(`texteTronque_${id}`);
    if (previewEl && previewEl.textContent && previewEl.textContent !== "(prévisualisation)") {
      texteIncomplet = previewEl.textContent;
    }
    exData = { Type: "Complete", Complete_Type: completeType, Consigne: consigne, Texte_Complet: texteComplet, Texte_Incomplet: texteIncomplet, Options: options, Feedback: feedbackData, Tentatives: tentatives, Audio_Enonce: _buildAudioEnonce(id, audioEnonce) };
  }
  else if (type === "Flashcard") {
    const flashType = document.getElementById(`flashcardType_${id}`)?.value || "";
    const flashConsigne = document.getElementById(`consigne_${id}`)?.value || "";
    const frontText = document.getElementById(`front_${id}`)?.value || "";
    const backText = document.getElementById(`back_${id}`)?.value || "";
    const frontAudio = audioData?.flashcard?.front ? `${basePath}_front.mp3` : null;
    const backAudio = audioData?.flashcard?.back ? `${basePath}_back.mp3` : null;
    const extraType = document.getElementById(`flashExtraType_${id}`)?.value || "Aucune";
    let extraData = { Type: extraType };
    if (extraType === "Ajouter des phrases en exemples") {
      extraData = { Type: "Phrases", Elements: [] };
      for (let j = 1; j <= 5; j++) {
        const val = document.getElementById(`flashExtraPhrase_${id}_${j}`)?.value?.trim();
        if (val) extraData.Elements.push(val);
      }
    } else if (extraType === "Ajouter des expressions complémentaires") {
      extraData = { Type: "Expressions", Elements: [] };
      for (let j = 1; j <= 5; j++) {
        const expr = document.getElementById(`flashExtraExpr_${id}_${j}`)?.value?.trim();
        const ex = document.getElementById(`flashExtraExemple_${id}_${j}`)?.value?.trim();
        if (expr || ex) extraData.Elements.push({ Expression: expr || "", Exemple: ex || "" });
      }
    }
    exData = { Type: "Flashcard", Flashcard_Type: flashType, Consigne: flashConsigne, Front_Text: frontText, Back_Text: backText, Tentatives: 1, Image: imagePath, Front_Audio: frontAudio, Back_Audio: backAudio, Extra: extraData };
    if (feedbackData) exData.Feedback = feedbackData;
  }
  else if (type === "Leçon") {
    const subType = document.getElementById(`lessonType_${id}`)?.value || "";
    if (subType === "simple") {
      const lessonConsigne = document.getElementById(`lessonConsigne_${id}`)?.value || "";
      const exprFr = document.getElementById(`lessonExprFr_${id}`)?.value || "";
      const exprEn = document.getElementById(`lessonExprEn_${id}`)?.value || "";
      const exFr = document.getElementById(`lessonExFr_${id}`)?.value || "";
      const exEn = document.getElementById(`lessonExEn_${id}`)?.value || "";
      const audioExample = audioData?.example ? `${basePath}_example.mp3` : null;
      const audioExpressionFr = audioData?.exprFr ? `${basePath}_exprFr.mp3` : null;
      exData = { Type: "Leçon", SubType: "simple", Consigne: lessonConsigne, Expression_FR: exprFr, Expression_EN: exprEn, Exemple_FR: exFr, Exemple_EN: exEn, Image: imagePath, Audio_Exemple: audioExample, Audio_Expression: audioExpressionFr };
    } else if (subType === "complexe") {
      const lessonConsigne = document.getElementById(`lessonConsigne_${id}`)?.value || "";
      const texteHTML = document.querySelector(`#lessonTexte_${id} .ql-editor`)?.innerHTML || "";
      const hasHeader = document.getElementById(`lessonHeader_${id}`).value === "oui";
      const cols = Number(document.getElementById(`lessonCols_${id}`).value || 1);
      const rows = Number(document.getElementById(`lessonRows_${id}`).value || 1);
      const headers = [];
      if (hasHeader) {
        for (let c = 1; c <= cols; c++) {
          headers.push(document.getElementById(`lessonHeaderText_${id}_${c}`)?.value || "");
        }
      }
      const lignes = [];
      for (let r = 1; r <= rows; r++) {
        const colonnes = [];
        for (let c = 1; c <= cols; c++) {
          const txt = document.getElementById(`lessonCell_${id}_${r}_${c}`)?.value || "";
          const audioId = `${id}_LessonTable_L${r}_C${c}`;
          const audioPath = audioData?.lesson?.[audioId]
            ? `Ressources_Sequences/S1/Audios/S1_EX1_LessonTable_L${r}_C${c}.mp3`
            : null;
          colonnes.push({ Texte: txt, Audio: audioPath });
        }
        lignes.push({ Ligne: r, Colonnes: colonnes });
      }
      exData = { Type: "Leçon", SubType: "complexe", Consigne: lessonConsigne, Texte_HTML: texteHTML, Has_Header: hasHeader, Headers: headers, Lignes: lignes };
    }
  }
  else if (type === "Dialogue") {
    const dialogueConsigne = document.getElementById(`consigne_${id}`)?.value || "";
    const dialogueTentatives = Number(document.getElementById(`tentatives_${id}`)?.value || 1);
    const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;
    const lignes = [];
    const dialogueContainer = document.getElementById(`dialogueContainer_${id}`);
    if (dialogueContainer) {
      dialogueContainer.querySelectorAll(".dialogue-line").forEach(line => {
        const nom = line.querySelector(`[id^="dialogueNom_"]`)?.value.trim();
        const texte = line.querySelector(`[id^="dialogueTexte_"]`)?.value.trim();
        if (nom && texte) lignes.push({ Nom: nom, Texte: texte });
      });
    }
    const scriptHTML = lignes.map(l => `<b>${l.Nom} :</b> ${l.Texte}<br><br>`).join("");
    exData = { Type: "Dialogue", Consigne: dialogueConsigne, Tentatives: dialogueTentatives, Image: imagePath, Audio_Enonce: _buildAudioEnonce(id, audioEnonce), Script: lignes, Script_HTML: scriptHTML };
  }
  else if (type === "Media") {
    const mediaType = document.getElementById(`mediaType_${id}`)?.value || "video";
    const audioEnonce = audioData?.main ? `${basePath}_main.mp3` : null;
    exData = {
      Type: "Media",
      Media_Type: mediaType,
      Image: mediaType === "image_audio" ? (imagesData[origMediaKey] ? `Ressources_Sequences/S1/Images/S1_EX1.jpg` : null) : null,
      Video: mediaType === "video" ? _buildVideoEnonce(id, videoPath) : null,
      Audio_Enonce: mediaType === "image_audio" ? _buildAudioEnonce(id, audioEnonce) : null
    };
  }
  else if (type === "Production orale - dictée") {
    const dicteeConsigne = document.getElementById(`consigne_${id}`)?.value || "";
    const dicteeTentatives = Number(document.getElementById(`tentatives_${id}`)?.value || 1);
    const phrase = document.getElementById(`phrase_${id}`)?.value || "";
    const hasAudio = document.getElementById(`audioSwitch_${id}`)?.checked || false;
    const audioEnonce = hasAudio && audioData?.main ? `${basePath}_main.mp3` : null;
    exData = { Type: "Production orale - dictée", Consigne: dicteeConsigne, Phrase: phrase, Tentatives: dicteeTentatives, Fournir_Audio: hasAudio, Audio_Exemple: audioEnonce, Image: imagePath, Feedback: feedbackData };
  }

  if (!exData) throw new Error(`Type d'exercice non reconnu: ${type}`);

  const S0 = {
    Chapter_Title: "Preview",
    S1_Exo_Total: 1,
    S2_Exo_Total: 0,
    S3_Exo_Total: 0,
    S4_Exo_Total: 0,
    Durations: { S1: 0, S2: 0, S3: 0, S4: 0 }
  };

  const sectionsData = {
    S1: { EX1: exData },
    S2: {},
    S3: {},
    S4: {}
  };

  return { S0, sectionsData, safeName: "preview", origSection, origNum, origMediaKey };
}

function previewJSON() {
  const { S0, sectionsData } = buildResult();
  const container = document.getElementById("jsonPreview");
  container.style.display = "block";
  container.innerHTML = `
    <h4>S0 – Infos générales</h4>
    <pre>${JSON.stringify(S0, null, 2)}</pre>
    ${["S1", "S2", "S3", "S4"].map(s => `
      <h4>${s}</h4>
      <pre>${JSON.stringify(sectionsData[s], null, 2)}</pre>
    `).join("")}
  `;
}
function previewDebug() {
  const { sectionsData } = buildResult();

  const debugData = {
    S1: sectionsData.S1,
    S2: sectionsData.S2,
    S3: sectionsData.S3,
    S4: sectionsData.S4
  };

  // Convertit en texte JS lisible (sans guillemets autour des clés)
  let formatted = JSON.stringify(debugData, null, 2)
    .replace(/"([^"]+)":/g, "$1:") // retire les guillemets autour des clés
    .replace(/null/g, "null")      // garde null en minuscule
    .replace(/"([^"]*)"/g, (_, v) => {
      // ✅ Échappe les guillemets ET les balises HTML
      const safeValue = v
        .replace(/"/g, '\\"')
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `"${safeValue}"`;
    });

  const container = document.getElementById("jsonPreview");
  container.style.display = "block";
  container.innerHTML = `
    <h4>🧩 Variable de debug</h4>
    <pre>const debugData = ${formatted};</pre>
  `;
}
//  GENERATION DU PAQUET  //
async function generatePackage(templatePath = "Modele/Modele.zip") {
  let data;
  try {
    data = buildResult();
  } catch (e) {
    alert(e.message || "Erreur de génération !");
    console.error(e);
    return null;
  }

  const { S0, sectionsData, safeName } = data;

  // --- Charger le modèle ZIP ---
  const response = await fetch(templatePath);
  if (!response.ok) {
    alert(`Impossible de charger ${templatePath} !`);
    return null;
  }
  const arrayBuffer = await response.arrayBuffer();
  const templateZip = await JSZip.loadAsync(arrayBuffer);
  const rootFolder = templateZip.folder("Ressources_Sequences");

  /* ========= S0 ========= */
  const S0Folder = rootFolder.folder("S0");
  S0Folder.file("variables.json", JSON.stringify(S0, null, 2));

  /* ========= S1–S4 ========= */
  for (const section of ["S1", "S2", "S3", "S4"]) {
    const sectionFolder = rootFolder.folder(section);
    const imgFolder = sectionFolder.folder("Images");
    const audioFolder = sectionFolder.folder("Audios");
    const videoFolder = sectionFolder.folder("Videos");
    sectionFolder.file("variables.json", JSON.stringify(sectionsData[section], null, 2));

    // --- Images ---
    for (const [key, blob] of Object.entries(imagesData)) {
      if (key.startsWith(section + "_")) {
        imgFolder.file(`${key}.jpg`, blob);
      }
    }

    // --- Videos ---
    for (const [key, blob] of Object.entries(videosData)) {
      if (key.startsWith(section + "_")) {
        videoFolder.file(`${key}.mp4`, blob);
      }
    }

    // --- Audios (activités) ---
    for (const [key, data] of Object.entries(audiosData)) {
      if (!key.startsWith(section + "_")) continue;

      // 🎙️ Audios principaux
      if (data.main) audioFolder.file(`${key}_main.mp3`, data.main);
      if (data.exemple) audioFolder.file(`${key}_exemple.mp3`, data.exemple);
      if (data.feedback) audioFolder.file(`${key}_feedback.mp3`, data.feedback);

      // 🧩 Matching
      if (data.match) {
        for (const [subKey, blob] of Object.entries(data.match)) {
          audioFolder.file(`${key}_${subKey}.mp3`, blob);
        }
      }

      // 🧠 Flashcards
      if (data.flashcard) {
        if (data.flashcard.front)
          audioFolder.file(`${key}_front.mp3`, data.flashcard.front);
        if (data.flashcard.back)
          audioFolder.file(`${key}_back.mp3`, data.flashcard.back);
      }

      // 🧠 Leçons simples (Expression FR + Exemple)
      if (data.exprFr) audioFolder.file(`${key}_exprFr.mp3`, data.exprFr);
      if (data.example) audioFolder.file(`${key}_example.mp3`, data.example);

      // 📘 Leçons complexes
      if (data.lesson) {
        for (const [lessonKey, blob] of Object.entries(data.lesson)) {
          // Exemple : lessonKey = "S1_1_LessonTable_L1_C2"
          const pathMatch = lessonKey.match(/(S\d+)_(\d+)_LessonTable_L(\d+)_C(\d+)/);
          if (pathMatch) {
            const sectionId = pathMatch[1];
            const exoNum = pathMatch[2];
            const ligne = pathMatch[3];
            const col = pathMatch[4];
            const fileName = `${sectionId}_EX${exoNum}_LessonTable_L${ligne}_C${col}.mp3`;
            audioFolder.file(fileName, blob);
          }
        }
      }
    }


    // --- 🔊 Audios du récapitulatif final ---
    if (recapAudiosData[section]) {
      for (const [index, blob] of Object.entries(recapAudiosData[section])) {
        audioFolder.file(`Recap_${index}.mp3`, blob);
      }
    }
  }

  // --- Génération du ZIP final ---
  const content = await templateZip.generateAsync({ type: "blob" });
  saveAs(content, `${safeName}.zip`);
}



/*  ======  Import d'un projet  ======  */
//VERIFIER POURQUOI CETTE PARTIE EST COMME ÇA
//HELPER
/**
 * Wait for a DOM element to exist, with a timeout
 * @param {string} selector - CSS selector or element ID
 * @param {number} timeout - Max wait time in ms (default 500)
 * @returns {Promise<Element|null>}
 */
function waitForElement(selector, timeout = 500) {
  return new Promise((resolve) => {
    // Try immediate lookup
    const el = selector.startsWith('#')
      ? document.getElementById(selector.slice(1))
      : document.querySelector(selector);

    if (el) {
      resolve(el);
      return;
    }

    // Use MutationObserver for efficient waiting
    const observer = new MutationObserver(() => {
      const el = selector.startsWith('#')
        ? document.getElementById(selector.slice(1))
        : document.querySelector(selector);

      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Timeout fallback
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}
let _importOverlayTimer = null;

function _removeImportOverlay() {
  clearTimeout(_importOverlayTimer);
  const overlay = document.getElementById('importOverlay');
  if (!overlay) return;
  overlay.style.opacity = '0';
  setTimeout(() => overlay.remove(), 300);
}

function showImportOverlay() {
  let overlay = document.getElementById('importOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'importOverlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9998;
      background: rgba(0,0,0,0.7);
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.3s ease;
    `;
    // Spinner + label
    overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
        <div id="importSpinner" style="
          width:48px;height:48px;border:4px solid rgba(255,255,255,0.3);
          border-top-color:#fff;border-radius:50%;
          animation:importSpin 0.8s linear infinite;
        "></div>
        <span id="importOverlayMsg" style="color:#fff;font-size:16px;font-weight:500;letter-spacing:0.02em;">
          Importation en cours...
        </span>
      </div>
    `;
    // Inject keyframe if not already present
    if (!document.getElementById('importSpinStyle')) {
      const style = document.createElement('style');
      style.id = 'importSpinStyle';
      style.textContent = '@keyframes importSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  }
}

function hideImportOverlay(withSuccess) {
  const overlay = document.getElementById('importOverlay');
  if (!overlay) return;

  if (!withSuccess) {
    _removeImportOverlay();
    return;
  }

  // Swap spinner for success message — entire overlay becomes clickable
  overlay.style.cursor = 'pointer';
  overlay.onclick = _removeImportOverlay;
  overlay.innerHTML = `
    <div style="
      background:white;border-radius:12px;padding:24px 40px;
      font-size:20px;font-weight:600;color:#222;
      box-shadow:0 8px 32px rgba(0,0,0,0.25);
      pointer-events:none;
    ">
      Import r&#233;ussi
    </div>
  `;

  // Auto-dismiss after 3 s
  _importOverlayTimer = setTimeout(_removeImportOverlay, 500);
}

async function importZipProject(event) {
  const file = event.target.files[0];
  if (!file) return;

  showImportOverlay('');
  try {
    //console.time("⏱️ Import total");
    const zip = await JSZip.loadAsync(file);
    //console.log("📦 Projet chargé :", file.name);
    // --- Réinitialisation des données globales ---
    for (const s of ["S1", "S2", "S3", "S4"]) {
      document.getElementById(`exercices_${s}`).innerHTML = "";
      sections[s].count = 0;
    }
    Object.keys(imagesData).forEach(k => delete imagesData[k]);
    Object.keys(audiosData).forEach(k => delete audiosData[k]);
    Object.keys(videosData).forEach(k => delete videosData[k]);
    Object.keys(recapAudiosData).forEach(k => delete recapAudiosData[k]);

    // --- Lecture S0 ---
    const s0File = zip.file("Ressources_Sequences/S0/variables.json");
    if (!s0File) throw new Error("Fichier S0 manquant !");
    const s0Content = JSON.parse(await s0File.async("string"));
    document.getElementById("chapterTitle").value = s0Content.Chapter_Title || "";
    if (s0Content.Level) document.getElementById("chapterLevel").value = s0Content.Level;

    if (s0Content.Durations) {
      // Helper function with null safety
      const setDuration = (section, value) => {
        const input = document.getElementById(`duration_${section}`);
        if (input) {
          input.value = value || 10;
        } else {
          console.warn(`⚠️ Duration input for ${section} not found, skipping`);
        }
      };
      
      setDuration('S1', s0Content.Durations.S1);
      setDuration('S2', s0Content.Durations.S2);
      setDuration('S3', s0Content.Durations.S3);
      setDuration('S4', s0Content.Durations.S4);
    }

    // --- Parcours des sections S1–S4 ---
    for (const s of ["S1", "S2", "S3", "S4"]) {
      const sectionFile = zip.file(`Ressources_Sequences/${s}/variables.json`);
      if (!sectionFile) continue;

      const sectionData = JSON.parse(await sectionFile.async("string"));
      const imgFolder = zip.folder(`Ressources_Sequences/${s}/Images`);
      const audioFolder = zip.folder(`Ressources_Sequences/${s}/Audios`);
      const videoFolder = zip.folder(`Ressources_Sequences/${s}/Videos`);

      // 🧩 Tri des exercices : EX1, EX2, EX3...
      const exoKeys = Object.keys(sectionData)
        .filter(k => k.startsWith("EX"))
        .sort((a, b) => parseInt(a.replace("EX", "")) - parseInt(b.replace("EX", "")));

      // 🧩 Boucle sur les exercices triés
      for (const exoKey of exoKeys) {
        const exoData = sectionData[exoKey];
        addExercice(s);
        const index = sections[s].count;
        const id = `${s}_${index}`;
        const realKey = `${s}_${exoKey}`; // CHECK ❓❓❓

        const type = exoData.Type || "";
        const typeSelect = document.getElementById(`type_${id}`);
        if (typeSelect) {
          typeSelect.value = type;
          updateFields(id);
        }

        const safeSet = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.value = val || "";
        };

        //---------------------- CHAMPS TEXTUELS ----------------------
        switch (type) {
          case "True or false":
            safeSet(`consigne_${id}`, exoData.Consigne);
            safeSet(`enonce_${id}`, exoData.Affirmation);
            safeSet(`truth_${id}`, exoData.BonneReponse);
            break;

          case "QCU":
            safeSet(`consigne_${id}`, exoData.Consigne);
            safeSet(`enonce_${id}`, exoData.Question);
            if (exoData.Reponses) {
              for (const [letter, val] of Object.entries(exoData.Reponses))
                safeSet(`qcu${letter}_${id}`, val);
            }
            break;

          case "QCM":
            safeSet(`consigne_${id}`, exoData.Consigne);
            safeSet(`enonce_${id}`, exoData.Question);
            if (exoData.Reponses) {
              for (const [letter, val] of Object.entries(exoData.Reponses))
                safeSet(`qcm${letter}_${id}`, val);
            }
            if (Array.isArray(exoData.Corrections)) {
              exoData.Corrections.forEach(letter => {
                const check = document.getElementById(`qcmCheck_${letter}_${id}`);
                if (check) check.checked = true;
              });
            }
            break;

          case "Flashcard":
            safeSet(`flashcardType_${id}`, exoData.Flashcard_Type);
            updateFlashcardFields(id);
            safeSet(`consigne_${id}`, exoData.Consigne);
            safeSet(`front_${id}`, exoData.Front_Text);
            safeSet(`back_${id}`, exoData.Back_Text);

            if (exoData.Extra) {
              const typeExtra = exoData.Extra.Type || "Aucune";
              const selectExtra = document.getElementById(`flashExtraType_${id}`);
              if (selectExtra) {
                if (typeExtra === "Phrases") selectExtra.value = "Ajouter des phrases en exemples";
                else if (typeExtra === "Expressions") selectExtra.value = "Ajouter des expressions complémentaires";
                else selectExtra.value = "Aucune";
                updateFlashExtraFields(id);

                if (typeExtra === "Phrases" && Array.isArray(exoData.Extra.Elements)) {
                  exoData.Extra.Elements.forEach((txt, i) => safeSet(`flashExtraPhrase_${id}_${i + 1}`, txt));
                }

                if (typeExtra === "Expressions" && Array.isArray(exoData.Extra.Elements)) {
                  exoData.Extra.Elements.forEach((obj, i) => {
                    safeSet(`flashExtraExpr_${id}_${i + 1}`, obj.Expression || "");
                    safeSet(`flashExtraExemple_${id}_${i + 1}`, obj.Exemple || "");
                  });
                }
              }
            }
            break;

          case "Information":
            safeSet(`titre_${id}`, exoData.Titre);
            safeSet(`expression_${id}`, exoData.Expression);
            safeSet(`exemple_${id}`, exoData.Exemple);
            break;

          case "Leçon":
            const subType = exoData.SubType || "simple";
            const lessonTypeSelect = document.getElementById(`lessonType_${id}`);
            if (lessonTypeSelect) {
              lessonTypeSelect.value = subType;
              updateLessonFields(id);
            }

            //------------------------------------------------------------
            //  🟢 Leçon simple
            //------------------------------------------------------------
            if (subType === "simple") {
              //console.log(`🟢 [${id}] Import leçon simple`);
              safeSet(`lessonConsigne_${id}`, exoData.Consigne);
              safeSet(`lessonExprFr_${id}`, exoData.Expression_FR);
              safeSet(`lessonExprEn_${id}`, exoData.Expression_EN);
              safeSet(`lessonExFr_${id}`, exoData.Exemple_FR);
              safeSet(`lessonExEn_${id}`, exoData.Exemple_EN);
            }

            //------------------------------------------------------------
            //🔵 Leçon complexe
            //------------------------------------------------------------
            else if (subType === "complexe") {
              safeSet(`lessonConsigne_${id}`, exoData.Consigne);

              // 🧾 Texte HTML principal
              const qlEditor = document.querySelector(`#lessonTexte_${id} .ql-editor`);
              if (qlEditor) qlEditor.innerHTML = exoData.Texte_HTML || "";

              // ✅ Configuration de la grille
              const hasHeader = exoData.Has_Header;

              // 🔍 Nombre de colonnes : 
              // si headers vides → on regarde la première ligne pour deviner
              let cols = 1;
              if (Array.isArray(exoData.Headers) && exoData.Headers.length > 0) {
                cols = exoData.Headers.length;
              } else if (Array.isArray(exoData.Lignes) && exoData.Lignes.length > 0) {
                cols = exoData.Lignes[0].Colonnes?.length || 1;
              }

              // 🔍 Nombre de lignes
              const rows = Array.isArray(exoData.Lignes) ? exoData.Lignes.length : 1;

              document.getElementById(`lessonHeader_${id}`).value = hasHeader ? "oui" : "non";
              document.getElementById(`lessonCols_${id}`).value = cols;
              document.getElementById(`lessonRows_${id}`).value = rows;

              document.getElementById(`lessonHeader_${id}`).value = hasHeader ? "oui" : "non";
              document.getElementById(`lessonCols_${id}`).value = cols;
              document.getElementById(`lessonRows_${id}`).value = rows;

              //console.log(`📊 Reconstruction de la grille (${rows}×${cols}) pour ${id}`);

              // ⚡ On attend que les sélecteurs soient appliqués avant de régénérer
              requestAnimationFrame(() => {
                buildLessonGrid(id);

                // 🧩 En-têtes
                if (hasHeader && Array.isArray(exoData.Headers)) {
                  exoData.Headers.forEach((h, i) => {
                    const input = document.getElementById(`lessonHeaderText_${id}_${i + 1}`);
                    if (input) input.value = h;
                  });
                }

                // 🧩 Cellules (texte)
                if (Array.isArray(exoData.Lignes)) {
                  exoData.Lignes.forEach((ligne, rIdx) => {
                    ligne.Colonnes.forEach((col, cIdx) => {
                      const txtInput = document.getElementById(`lessonCell_${id}_${rIdx + 1}_${cIdx + 1}`);
                      if (txtInput) txtInput.value = col.Texte || "";
                    });
                  });
                }
              });
            }


            break;

          case "Matching":
            // --- 1️⃣ Sélectionne et applique le sous-type ---
            const matchType = exoData.Match_Type || "texte-texte";
            console.log(`📘 [${id}] Type d’appariement détecté : ${matchType}`);

            const matchTypeSelect = document.getElementById(`matchType_${id}`);
            if (matchTypeSelect) {
              matchTypeSelect.value = matchType;
              console.log(`⚙️ [${id}] updateMatchingFields() appelé`);
              updateMatchingFields(id); // régénère la structure HTML selon le sous-type
            }

            // --- 2️⃣ Remplit les champs de base ---
            safeSet(`consigne_${id}`, exoData.Consigne);
            const tentativesInputMatch = document.getElementById(`tentatives_${id}`);
            if (tentativesInputMatch) {
              tentativesInputMatch.value = exoData.Tentatives || 9999;
              console.log(`✅ [${id}] Tentatives définies à ${tentativesInputMatch.value}`);
            }

            // --- 3️⃣ Remplit les paires selon le sous-type ---
            if (exoData.Paires && typeof exoData.Paires === "object") {
              const pairs = Object.entries(exoData.Paires);
              console.log(`📋 [${id}] ${pairs.length} paires détectées dans le JSON`);

              // ⚡ Attente que les inputs soient dans le DOM
              requestAnimationFrame(() => {
                pairs.forEach(([key, pair]) => {
                  const index = parseInt(key.replace("P", ""), 10);
                  const leftVal = pair[`Match_L${index}`] || "";
                  const rightVal = pair[`Match_R${index}`] || "";

                  console.log(`🔍 [${id}] Traitement de ${key} → L="${leftVal}" / R="${rightVal}"`);

                  if (matchType === "texte-texte") {
                    const leftInput = document.getElementById(`matchText_${id}_L${index}`);
                    const rightInput = document.getElementById(`matchText_${id}_R${index}`);
                    if (leftInput) leftInput.value = leftVal;
                    if (rightInput) rightInput.value = rightVal;
                    console.log(`✅ [${id}] Texte-texte injecté pour paire ${index}`);
                  }

                  else if (matchType === "audio-texte") {
                    const rightInput = document.getElementById(`matchText_${id}_R${index}`);
                    if (rightInput) {
                      rightInput.value = rightVal;
                      console.log(`✅ [${id}] Texte (droite) injecté pour paire ${index}`);
                    } else {
                      console.warn(`⚠️ [${id}] Champ texte droit introuvable pour paire ${index}`);
                    }
                    // les audios gauches seront traités dans la section "📁 MÉDIAS"
                  }

                  else if (matchType === "audio-audio") {
                    console.log(`🎧 [${id}] Appariement audio détecté pour la paire ${index}`);
                    // rien à injecter ici (audios uniquement)
                  }
                });
              });

            }

            break;

          case "Complete":
            // --- 1️⃣ Sélectionne et applique le sous-type ---
            const completeType = exoData.Complete_Type || "options";
            const completeTypeSelect = document.getElementById(`completeType_${id}`);
            if (completeTypeSelect) {
              completeTypeSelect.value = completeType;
              updateCompleteFields(id); // régénère la structure HTML dynamique
            }

            // --- 2️⃣ Remplit les champs de base ---
            safeSet(`consigne_${id}`, exoData.Consigne);
            const tentativesInput = document.getElementById(`tentatives_${id}`);
            if (tentativesInput) tentativesInput.value = exoData.Tentatives || 1;

            // --- 3️⃣ Type "options" ---
            if (completeType === "options") {
              // ✅ Texte complet
              const texteField = document.getElementById(`texte_${id}`);
              if (texteField) texteField.value = exoData.Texte_Complet || "";

              // ✅ Prévisualisation du texte à trous
              const preview = document.getElementById(`texteTronque_${id}`);
              if (preview && exoData.Texte_Incomplet) {
                preview.textContent = exoData.Texte_Incomplet;
              }

              // ✅ Options
              if (Array.isArray(exoData.Options)) {
                exoData.Options.forEach((opt, i) => {
                  const input = document.getElementById(`opt${i + 1}_${id}`);
                  if (input) input.value = opt;
                });
              }

              // 🔁 Active la prévisualisation dynamique
              initCompleteOptionsPreview(id);
            }
            else if (completeType === "reconstruit") {
              // ✅ Texte complet
              const texteField = document.getElementById(`texte_${id}`);
              if (texteField) texteField.value = exoData.Texte_Complet || "";

              // ✅ Prévisualisation du texte à trous
              const preview = document.getElementById(`texteTronque_${id}`);
              if (preview && exoData.Texte_Incomplet) {
                preview.textContent = exoData.Texte_Incomplet;
              }

              // ✅ Options
              if (Array.isArray(exoData.Options)) {
                exoData.Options.forEach((opt, i) => {
                  const input = document.getElementById(`opt${i + 1}_${id}`);
                  if (input) input.value = opt;
                });
              }

              // 🔁 Active la prévisualisation dynamique
              initCompleteReconstruitPreview(id);
            }

            break;

          case "Media":
            if (exoData.Media_Type) {
              const mediaTypeEl = document.getElementById(`mediaType_${id}`);
              if (mediaTypeEl) {
                mediaTypeEl.value = exoData.Media_Type;
                updateMediaTypeFields(id);
              }
            }
            break;

          case "Dialogue":
            console.log(`💬 [${id}] Import du Dialogue`);

            // --- Champs de base ---
            safeSet(`consigne_${id}`, exoData.Consigne || "");
            const tentativesInputDialogue = document.getElementById(`tentatives_${id}`);
            if (tentativesInputDialogue) tentativesInputDialogue.value = exoData.Tentatives || 1;

            // --- Script du dialogue ---
            if (Array.isArray(exoData.Script)) {
              // On attend que le conteneur soit généré par updateFields()
              requestAnimationFrame(() => {
                exoData.Script.forEach(line => {
                  addActivityDialogueLine(id, line.Nom || "", line.Texte || "");
                });
                console.log(`✅ [${id}] ${exoData.Script.length} répliques importées.`);
              });
            }

            break;

        }

        // Restore transcription (new format only — old format has Audio_Enonce as a plain string)
        if (exoData.Audio_Enonce && typeof exoData.Audio_Enonce === 'object' && exoData.Audio_Enonce.Transcription) {
          const transcEl = document.getElementById(`audioTranscription_${id}`);
          if (transcEl) transcEl.value = exoData.Audio_Enonce.Transcription;
        }
        if (exoData.Video && typeof exoData.Video === 'object' && exoData.Video.Transcription) {
          const transcEl = document.getElementById(`videoTranscription_${id}`);
          if (transcEl) transcEl.value = exoData.Video.Transcription;
        }

        //============================================================
        //   📁 MÉDIAS
        //============================================================
        const exNum = parseInt(exoKey.replace("EX", ""));
        const exKey = `${s}_EX${exNum}`;

        // === Image ===
        if (imgFolder) {
          const imgFile = imgFolder.file(`${exKey}.jpg`);
          if (imgFile) {
            const blob = await imgFile.async("blob");
            imagesData[exKey] = blob;
            const imgSwitch = document.getElementById(`imageSwitch_${id}`);
            if (imgSwitch) {
              imgSwitch.checked = true;
              toggleImageField(id);
            }
            const input = document.querySelector(`#imageContainer_${id} input[type="file"]`);
            if (input) addImagePreviewWithDelete(input, blob, id);
          }
        }

        // === Video ===
        if (videoFolder) {
          const videoFile = videoFolder.file(`${exKey}.mp4`);
          if (videoFile) {
            const blob = await videoFile.async("blob");
            videosData[exKey] = blob;
            const videoSwitch = document.getElementById(`videoSwitch_${id}`);
            if (videoSwitch) {
              videoSwitch.checked = true;
              toggleVideoField(id);
            }
            const input = document.querySelector(`#videoContainer_${id} input[type="file"]`);
            if (input) addVideoPreviewWithDelete(input, blob, id);
          }
        }

        // === Audios ===
        if (audioFolder) {
          const audios = {};
          const audioPrefix = `${s}_${exoKey}_`;
          for (const f of Object.values(audioFolder.files)) {
            if (!f.name.includes(audioPrefix)) continue;
            const blob = await f.async("blob");
            // === Audios principaux ===
            if (f.name.includes("_main")) audios.main = blob;
            else if (f.name.includes("_feedback")) audios.feedback = blob;
            // === Flashcard ===
            else if (f.name.includes("_front")) {
              audios.flashcard = audios.flashcard || {};
              audios.flashcard.front = blob;
            }
            else if (f.name.includes("_back")) {
              audios.flashcard = audios.flashcard || {};
              audios.flashcard.back = blob;
            }
            // === Leçon simple ===
            else if (f.name.includes("_exprFr")) audios.exprFr = blob;
            else if (f.name.includes("_example")) audios.example = blob;
            // === Leçon complexe ===
            else if (f.name.includes("LessonTable_L")) {
              audios.lesson = audios.lesson || {};
              const match = f.name.match(/(S\d+)_EX(\d+)_LessonTable_L(\d+)_C(\d+)/);
              if (match) {
                const sectionId = match[1];
                const exNum = match[2];
                const ligne = match[3];
                const col = match[4];
                const audioKey = `${sectionId}_${exNum}_LessonTable_L${ligne}_C${col}`;
                audios.lesson[audioKey] = blob;
              }
            }
            // === Audios de Matching
            else if (f.name.includes("_Match_")) {
              audios.match = audios.match || {}; // ⬅️ au lieu de audios.matching
              const match = f.name.match(/EX(\d+)_Match_(L|R)(\d+)\.mp3$/);
              if (match) {
                const [, ex, side, idx] = match;
                const audioKey = `Match_${side}${idx}`;
                audios.match[audioKey] = blob;
              }
            }

            // ✅ Enregistre uniquement les audios de ce couple section/exo
            if (Object.keys(audios).length) {
              audiosData[exKey] = audios;
            }
          }

          if (Object.keys(audios).length) audiosData[exKey] = audios;

          // === Audios de True or false : ajout des aperçus ===
          if (exoData.Type === "True or false" && audios.main) {
            //console.log(`🎧 [${id}] Ajout du preview audio (True or false)`);

            // Active le toggle audio si présent
            const audioSwitch = document.getElementById(`audioSwitch_${id}`);
            if (audioSwitch && !audioSwitch.checked) {
              audioSwitch.checked = true;
              toggleAudioField(id);
              //console.log(`🔊 Toggle audio activé pour ${id}`);
            }

            // Récupération de l’input file audio (unique)
            const input = document.querySelector(`#exo_${id} input[type="file"][accept="audio/*"]`);
            if (input) {
              addAudioPreviewWithDelete(
                input,
                audios.main,
                `audio_${exKey}_main`,
                (data) => {
                  if (data.main) delete data.main;
                  if (Object.keys(data).length === 0) delete audiosData[exKey];
                }
              );
              //console.log(`✅ Preview audio ajouté pour ${id}`);
            } else {
              console.warn(`⚠️ [${id}] Aucun input audio trouvé pour True or false`);
            }
          }

          // === Audios de QCU : ajout des aperçus ===
          if (exoData.Type === "QCU" && audios.main) {
            console.log(`🎧 [${id}] Ajout du preview audio (QCU)`);

            // 🟩 Active automatiquement le toggle audio s’il existe
            const audioSwitch = document.getElementById(`audioSwitch_${id}`);
            if (audioSwitch && !audioSwitch.checked) {
              audioSwitch.checked = true;
              toggleAudioField(id); // affiche le champ audio
              console.log(`🔊 Toggle audio activé pour ${id}`);
            }

            // 🎯 Récupération du champ file audio principal
            const input = document.querySelector(`#exo_${id} input[type="file"][accept="audio/*"]`);
            if (input) {
              addAudioPreviewWithDelete(
                input,
                audios.main,
                `audio_${exKey}_main`,
                (data) => {
                  if (data.main) delete data.main;
                  if (Object.keys(data).length === 0) delete audiosData[exKey];
                }
              );
              console.log(`✅ Preview audio ajouté pour ${id}`);
            } else {
              console.warn(`⚠️ [${id}] Aucun input audio trouvé pour QCU`);
            }
          }

          // === Audios de QCM : ajout des aperçus ===
          if (exoData.Type === "QCM" && audios.main) {
            console.log(`🎧 [${id}] Ajout du preview audio (QCM)`);

            // 🟩 Active automatiquement le toggle audio s’il existe
            const audioSwitch = document.getElementById(`audioSwitch_${id}`);
            if (audioSwitch && !audioSwitch.checked) {
              audioSwitch.checked = true;
              toggleAudioField(id); // affiche le champ audio
              console.log(`🔊 Toggle audio activé pour ${id}`);
            }

            // 🎯 Récupération du champ file audio principal
            const input = document.querySelector(`#exo_${id} input[type="file"][accept="audio/*"]`);
            if (input) {
              addAudioPreviewWithDelete(
                input,
                audios.main,
                `audio_${exKey}_main`,
                (data) => {
                  if (data.main) delete data.main;
                  if (Object.keys(data).length === 0) delete audiosData[exKey];
                }
              );
              console.log(`✅ Preview audio ajouté pour ${id}`);
            } else {
              console.warn(`⚠️ [${id}] Aucun input audio trouvé pour QCM`);
            }
          }

          // === Audios de Complete : ajout des aperçus ===
          if (exoData.Type === "Complete" && audios.main) {
            //console.log(`🎧 [${id}] Ajout du preview audio (Complete)`);

            // 🟩 Active automatiquement le toggle audio s’il existe
            const audioSwitch = document.getElementById(`audioSwitch_${id}`);
            if (audioSwitch && !audioSwitch.checked) {
              audioSwitch.checked = true;
              toggleAudioField(id); // affiche le champ audio
              //console.log(`🔊 Toggle audio activé pour ${id}`);
            }

            // 🎯 Récupération du champ file audio principal
            const input = document.querySelector(`#exo_${id} input[type="file"][accept="audio/*"]`);
            if (input) {
              addAudioPreviewWithDelete(
                input,
                audios.main,
                `audio_${exKey}_main`,
                (data) => {
                  if (data.main) delete data.main;
                  if (Object.keys(data).length === 0) delete audiosData[exKey];
                }
              );
              //console.log(`✅ Preview audio ajouté pour ${id}`);
            } else {
              console.warn(`⚠️ [${id}] Aucun input audio trouvé pour Complete`);
            }
          }

          // === AUDIOS MATCHING ===
          if (exoData.Type === "Matching" && audios.main) {
            console.log(`🎧 [${id}] Ajout du preview audio (énoncé Matching)`);

            // 🟩 Active le toggle audio s’il existe
            const audioSwitch = document.getElementById(`audioSwitch_${id}`);
            if (audioSwitch && !audioSwitch.checked) {
              audioSwitch.checked = true;
              toggleAudioField(id);
              console.log(`🔊 Toggle audio activé pour ${id}`);
            }

            // 🎯 Récupération du champ file audio principal
            const input = document.querySelector(`#exo_${id} input[type="file"][accept="audio/*"]`);
            if (input) {
              addAudioPreviewWithDelete(
                input,
                audios.main,
                `audio_${exKey}_main`,
                (data) => {
                  if (data.main) delete data.main;
                  if (Object.keys(data).length === 0) delete audiosData[exKey];
                }
              );
              console.log(`✅ Preview audio ajouté pour ${id} (Matching)`);
            } else {
              console.warn(`⚠️ [${id}] Aucun input audio trouvé pour Matching`);
            }
          }
          // === Audios de Matching (audio-audio ou audio-texte) ===
          if (exoData.Type === "Matching" && exoData.Match_Type && exoData.Match_Type.includes("audio") && audios.match) {
            console.groupCollapsed(`🎧 [${id}] Import des audios de Matching (${Object.keys(audios.match).length} fichiers)`);

            // 🕓 Attente que les inputs audio soient dans le DOM
            const waitForMatchingInputs = async (timeoutMs = 6000) => {
              return new Promise((resolve, reject) => {
                const start = performance.now();
                const check = () => {
                  const ready = document.getElementById(`audioMatchInput_${id}_L1`);
                  if (ready) resolve();
                  else if (performance.now() - start > timeoutMs)
                    reject(new Error(`⏰ Timeout : inputs Matching non détectés (${id})`));
                  else requestAnimationFrame(check);
                };
                check();
              });
            };

            try {
              await waitForMatchingInputs();
            } catch (e) {
              console.warn(`⚠️ [${id}] Impossible de détecter les inputs audio Matching`, e);
            }

            // 🧩 Injection des previews audio paire par paire
            for (const [audioKey, blob] of Object.entries(audios.match)) {
              const match = audioKey.match(/Match_(L|R)(\d+)/);
              if (!match) continue;
              const [_, side, idx] = match;
              // audioMatchInput_${id}_L1 is the actual file <input> created by createDualAudioButtons
              const inputId = `audioMatchInput_${id}_${side}${idx}`;
              const previewId = `audioMatch_${id}_${side}${idx}`;

              const fileInput = document.getElementById(inputId);
              if (!fileInput) {
                console.warn(`⚠️ [${id}] Input introuvable : ${inputId}`);
                continue;
              }

              addAudioPreviewWithDelete(
                fileInput,
                blob,
                previewId,
                (data) => {
                  if (data.match && data.match[audioKey]) delete data.match[audioKey];
                  if (Object.keys(data.match || {}).length === 0) delete data.match;
                  if (Object.keys(data).length === 0) delete audiosData[exKey];
                }
              );
            }

            console.groupEnd();
          }

          // === Audios de Flashcard ===
          if (exoData.Type === "Flashcard" && audios.flashcard) {
            // updateFlashcardFields() was already called synchronously above, inputs are in the DOM
            const inputFront = document.getElementById(`audioFlashInput_${id}_front`);
            const inputBack = document.getElementById(`audioFlashInput_${id}_back`);

            if (audios.flashcard.front && inputFront) {
              addAudioPreviewWithDelete(inputFront, audios.flashcard.front, `audio_${id}_front`, (data) => {
                if (data.flashcard && data.flashcard.front) delete data.flashcard.front;
                if (Object.keys(data.flashcard || {}).length === 0) delete data.flashcard;
                if (Object.keys(data).length === 0) delete audiosData[`${s}_EX${exNum}`];
              });
              console.log(`✅ [${id}] Preview audio ajouté pour la face avant`);
            }

            if (audios.flashcard.back && inputBack) {
              addAudioPreviewWithDelete(inputBack, audios.flashcard.back, `audio_${id}_back`, (data) => {
                if (data.flashcard && data.flashcard.back) delete data.flashcard.back;
                if (Object.keys(data.flashcard || {}).length === 0) delete data.flashcard;
                if (Object.keys(data).length === 0) delete audiosData[`${s}_EX${exNum}`];
              });
              console.log(`✅ [${id}] Preview audio ajouté pour la face arrière`);
            }
          }

          // === Leçon complexe ===
          if (exoData.Type === "Leçon" && exoData.SubType === "complexe" && audios.lesson) {
            console.log(`🎧 [${id}] Import des audios de leçon complexe (${Object.keys(audios.lesson).length} fichiers)`);

            // 🕓 Attente préalable que la grille soit prête
            const waitForGridReady = async (timeoutMs = 6000) => {
              return new Promise((resolve, reject) => {
                const start = performance.now();
                const check = () => {
                  const grid = document.getElementById(`lessonGrid_${id}`);
                  const inputs = grid ? grid.querySelectorAll('input[type="file"][accept="audio/*"]') : [];
                  if (inputs.length > 0) resolve();
                  else if (performance.now() - start > timeoutMs) reject(new Error(`⏰ Timeout : grille non prête pour ${id}`));
                  else requestAnimationFrame(check);
                };
                check();
              });
            };

            try {
              await waitForGridReady();
              console.log(`✅ Grille prête pour ${id}, import des audios...`);
            } catch (e) {
              console.warn(`⚠️ Grille non détectée pour ${id}`, e);
            }
            // 🧹 On ne garde que les audios correspondant à la section et exo courants
            // Keys are stored as S1_1_LessonTable_... (number only, no "EX" prefix)
            const currentExNum = exoKey.replace("EX", "");
            const currentPrefix = `${s}_${currentExNum}_LessonTable_`;
            const lessonAudios = Object.entries(audios.lesson).filter(([key]) => key.startsWith(currentPrefix));
            // 🧩 Injection des previews audio cellule par cellule
            for (const [audioKey, blob] of lessonAudios) {
              const match = audioKey.match(/LessonTable_L(\d+)_C(\d+)/);
              if (!match) continue;
              const [_, ligne, col] = match;
              const inputId = `lessonCellAudioInput_${id}_LessonTable_L${ligne}_C${col}`;

              const waitForInput = async (timeoutMs = 5000) => {
                return new Promise((resolve, reject) => {
                  const start = performance.now();
                  const check = () => {
                    const input = document.getElementById(inputId);
                    if (input) resolve(input);
                    else if (performance.now() - start > timeoutMs) reject(new Error(`Timeout ${inputId}`));
                    else requestAnimationFrame(check);
                  };
                  check();
                });
              };

              try {
                const input = await waitForInput();
                addAudioPreviewWithDelete(
                  input,
                  blob,
                  `audioLesson_${id}_${ligne}_${col}`,
                  (data) => {
                    if (data.lesson && data.lesson[audioKey]) delete data.lesson[audioKey];
                    if (Object.keys(data.lesson || {}).length === 0) delete data.lesson;
                    if (Object.keys(data).length === 0) delete audiosData[`${s}_EX${exNum}`];
                  }
                );
                console.log(`✅ Preview ajouté pour cellule ${ligne}.${col}`);
              } catch (e) {
                console.warn(`⚠️ Impossible d’ajouter le preview pour ${inputId}`, e);
              }
            }

            console.log(`✅ [${id}] Tous les audios de la leçon complexe ont été traités.`);

            // ♻️ Réinjection immédiate (optimisé)
            requestAnimationFrame(() => {
              Object.entries(audios.lesson).forEach(([audioKey, blob]) => {
                const match = audioKey.match(/LessonTable_L(\d+)_C(\d+)/);
                if (!match) return;
                const [_, ligne, col] = match;
                const inputId = `lessonCellAudioInput_${id}_LessonTable_L${ligne}_C${col}`;
                const input = document.getElementById(inputId);
                const alreadyHasPreview = input?.parentElement?.querySelector(".audio-wrapper");
                if (input && !alreadyHasPreview) {
                  console.log(`♻️ Réinjection du preview audio pour ${inputId}`);
                  addAudioPreviewWithDelete(
                    input,
                    blob,
                    `audioLesson_${id}_${ligne}_${col}`,
                    (data) => {
                      if (data.lesson && data.lesson[audioKey]) delete data.lesson[audioKey];
                      if (Object.keys(data.lesson || {}).length === 0) delete data.lesson;
                      if (Object.keys(data).length === 0) delete audiosData[`${s}_EX${exNum}`];
                    }
                  );
                }
              });
            });
          }

          // === Audios de Leçon simple (harmonisé) ===
          if (exoData.Type === "Leçon" && exoData.SubType === "simple") {
            const hasExprFr = audios.exprFr;
            const hasExample = audios.example;

            // 🎧 Audio Expression (EX..._exprFr.mp3)
            if (hasExprFr) {
              const inputExprFr = document.getElementById(`audioExprFrInput_${id}`);
              if (inputExprFr) {
                addAudioPreviewWithDelete(
                  inputExprFr,
                  audios.exprFr,
                  `audio_${exKey}_exprFr`,
                  (data) => {
                    if (data.exprFr) delete data.exprFr;
                    if (Object.keys(data).length === 0) delete audiosData[exKey];
                  }
                );
                console.log(`✅ [${id}] Preview audio ajouté pour l’expression FR`);
              } else {
                console.warn(`⚠️ [${id}] Aucun input trouvé pour l’audio de l’expression (${id})`);
              }
            }

            // 🎧 Audio Exemple (EX..._example.mp3)
            if (hasExample) {
              const inputExFr = document.getElementById(`audioExFrInput_${id}`);
              if (inputExFr) {
                addAudioPreviewWithDelete(
                  inputExFr,
                  audios.example,
                  `audio_${exKey}_example`,
                  (data) => {
                    if (data.example) delete data.example;
                    if (Object.keys(data).length === 0) delete audiosData[exKey];
                  }
                );
                console.log(`✅ [${id}] Preview audio ajouté pour l’exemple FR`);
              } else {
                console.warn(`⚠️ [${id}] Aucun input trouvé pour l’audio de l’exemple (${id})`);
              }
            }
          }

          // === Audios de Dialogue : ajout des aperçus ===
          if (exoData.Type === "Dialogue" && audios.main) {
            console.log(`🎧 [${id}] Ajout du preview audio (Dialogue)`);

            // 🟩 Active automatiquement le toggle audio s’il existe
            const audioSwitch = document.getElementById(`audioSwitch_${id}`);
            if (audioSwitch && !audioSwitch.checked) {
              audioSwitch.checked = true;
              toggleAudioField(id); // affiche le champ audio
              console.log(`🔊 Toggle audio activé pour ${id}`);
            }

            // 🎯 Récupération du champ file audio principal
            const input = document.querySelector(`#exo_${id} input[type="file"][accept="audio/*"]`);
            if (input) {
              addAudioPreviewWithDelete(
                input,
                audios.main,
                `audio_${exKey}_main`,
                (data) => {
                  if (data.main) delete data.main;
                  if (Object.keys(data).length === 0) delete audiosData[exKey];
                }
              );
              console.log(`✅ Preview audio ajouté pour ${id}`);
            } else {
              console.warn(`⚠️ [${id}] Aucun input audio trouvé pour Dialogue`);
            }
          }

        }

        //============================================================
        //  💬 FEEDBACK
        //============================================================
        if (exoData.Feedback) {
          await importFeedback(exoData, id, s, exoKey);
        }
      }
    }

    //console.timeEnd("⏱️ Import total");
    hideImportOverlay(true);
  } catch (err) {
    console.error("Erreur d’import :", err);
    hideImportOverlay(false);
    alert("Erreur lors de l’import du projet !");
  }
}



/*  ======  Fonctions utilitaires  ======  */
//  Une fonction qui permet d'échapper les caractère spéciaux (À VERIFIER)
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//  Affiche ou masque l'audio des activités de type dictées (actuellement désactivées)
function toggleDictéeAudio(id) {
  const checked = document.getElementById(`dictéeAudioSwitch_${id}`).checked;
  const container = document.getElementById(`dictéeAudioContainer_${id}`);
  container.style.display = checked ? "block" : "none";
}
// Génère le toggle image
function createImageToggle(id) {
  return `
    <div class="form-check form-switch mb-2">
      <input class="form-check-input" type="checkbox" id="imageSwitch_${id}" onchange="toggleImageField('${id}')">
      <label class="form-check-label" for="imageSwitch_${id}">Ajouter une image</label>
    </div>
    <div id="imageContainer_${id}" style="display:none;">
      <label class="mb-2">Image</label>
      
      <!-- ✅ Buttons container - stays separate -->
      <div id="imageButtonsWrapper_${id}" class="d-flex gap-2 mb-2">
        <input type="file" accept="image/*" 
          onchange="handleImageUpload(event, '${id}')"
          id="imageInput_${id}"
          style="display: none;">
        
        <button class="btn btn-outline-secondary" type="button"
          onclick="document.getElementById('imageInput_${id}').click()"
          title="Choose an image file">
          📁 Browse
        </button>
        
        <button class="btn btn-outline-primary" type="button"
          onclick="openNanoBananaForImage('${id}')"
          title="Generate with NanoBanana AI">
          🎨 Générer
        </button>
      </div>
      
      <!-- ✅ Preview will be inserted here (separate from buttons) -->
    </div>
  `;
}
// Affiche ou masque le champ image
function toggleImageField(id) {
  //console.log(id)
  const toggle = document.getElementById(`imageSwitch_${id}`);
  const container = document.getElementById(`imageContainer_${id}`);
  if (!container || !toggle) return;

  const checked = toggle.checked;
  container.style.display = checked ? "block" : "none";

  // 🧹 Si on désactive le toggle : on demande confirmation
  if (!checked) {
    const [section, exNum] = id.split("_");
    const key = `${section}_EX${exNum}`;
    const wrapper = container.querySelector(".image-wrapper");

    if (wrapper) {
      const confirmDelete = confirm("Supprimer l’image associée à cet exercice ?");
      if (confirmDelete) {
        wrapper.remove();
        if (imagesData[key]) {
          delete imagesData[key];
          //console.log(`🗑️ Image supprimée pour ${key}`);
        }
      } else {
        // ❌ Annulation → on remet le toggle à ON
        toggle.checked = true;
        container.style.display = "block";
      }
    }
  }
}
// Génère le toggle des audios
function createAudioToggle(id) {
  return `
    <div class="form-check form-switch mb-2">
      <input class="form-check-input" type="checkbox" id="audioSwitch_${id}" onchange="toggleAudioField('${id}')">
      <label class="form-check-label" for="audioSwitch_${id}">Ajouter un audio</label>
    </div>
    <div id="audioContainer_${id}" style="display:none;">
      <label class="mb-2">Audio principal</label>
      
      <!-- Buttons container - stays separate from preview -->
      <div id="audioButtonsWrapper_${id}" class="d-flex gap-2 mb-2">
        <!-- Hidden file input -->
        <input type="file" accept="audio/*"
          onchange="handleAudioUpload(event, '${id}', false)"
          id="audioInput_${id}_main"
          style="display: none;">
        
        <!-- Browse button -->
        <button class="btn btn-outline-secondary" type="button"
          onclick="document.getElementById('audioInput_${id}_main').click()"
          title="Choose an audio file">
          📁 Browse
        </button>
        
        <!-- Generate button -->
        <button class="btn btn-outline-primary" type="button"
          onclick="openElevenLabsForMainAudio('${id}')"
          title="Generate with ElevenLabs">
          🎙️ Générer
        </button>

        <!-- Record button -->
        <button class="btn btn-outline-danger" type="button"
          onclick="openRecorderForMainAudio('${id}')"
          title="Enregistrer">
          ⏺ Enregistrer
        </button>
      </div>
      
      <!-- Preview will be inserted here (separate from buttons) -->

      <!-- Transcription — preview is inserted BEFORE this div -->
      <div id="audioTranscriptionWrapper_${id}" class="mt-2">
        <label class="form-label small mb-1 text-muted">Transcription de l'audio</label>
        <textarea id="audioTranscription_${id}" class="form-control form-control-sm" rows="2"
          placeholder="Transcription du contenu audio..."></textarea>
      </div>
    </div>
  `;
}
// Affiche ou masque le champ audio
function toggleAudioField(id) {
  //console.log(id)
  const toggle = document.getElementById(`audioSwitch_${id}`);
  const container = document.getElementById(`audioContainer_${id}`);
  if (!container || !toggle) return;

  const checked = toggle.checked;
  container.style.display = checked ? "block" : "none";

  // 🧹 Si on désactive le toggle : on demande confirmation
  if (!checked) {
    const [section, exNum] = id.split("_");
    const key = `${section}_EX${exNum}`;
    const wrapper = container.querySelector(".audio-wrapper");

    if (wrapper) {
      const confirmDelete = confirm("Supprimer l’audio associé à cet exercice ?");
      if (confirmDelete) {
        wrapper.remove();
        if (audiosData[key]?.main) {
          delete audiosData[key].main;
          //console.log(`🗑️ Audio supprimé pour ${key}`);
          if (Object.keys(audiosData[key]).length === 0) delete audiosData[key];
        }
      } else {
        // ❌ Annulation → on remet le toggle à ON
        toggle.checked = true;
        container.style.display = "block";
      }
    }
  }
}

// Génère le toggle vidéo
function createVideoToggle(id) {
  return `
    <div class="form-check form-switch mb-2">
      <input class="form-check-input" type="checkbox" id="videoSwitch_${id}" onchange="toggleVideoField('${id}')">
      <label class="form-check-label" for="videoSwitch_${id}">Ajouter une vidéo (Pensez à retirer l'image et l'audio)</label>
    </div>
    <div id="videoContainer_${id}" style="display:none;">
      <label class="mb-2">Vidéo</label>
      
      <!-- ✅ Buttons container - stays separate -->
      <div id="videoButtonsWrapper_${id}" class="d-flex gap-2 mb-2">
        <input type="file" accept="video/*" 
          onchange="handleVideoUpload(event, '${id}')"
          id="videoInput_${id}"
          style="display: none;">
        
        <button class="btn btn-outline-secondary" type="button"
          onclick="document.getElementById('videoInput_${id}').click()"
          title="Choose a video file">
          📁 Browse
        </button>
      </div>
      
      <!-- ✅ Preview will be inserted here (separate from buttons) -->

      <div id="videoTranscriptionWrapper_${id}" class="mt-2">
        <label class="form-label small mb-1 text-muted">Transcription de la vidéo <span class="fw-normal">(optionnel)</span></label>
        <textarea id="videoTranscription_${id}" class="form-control form-control-sm" rows="2" placeholder="Transcription du contenu vidéo..."></textarea>
      </div>
    </div>
  `;
}
// Affiche ou masque le champ vidéo
function toggleVideoField(id) {
  //console.log(id)
  const toggle = document.getElementById(`videoSwitch_${id}`);
  const container = document.getElementById(`videoContainer_${id}`);
  if (!container || !toggle) return;
  const checked = toggle.checked;
  container.style.display = checked ? "block" : "none";
  // 🧹 Si on désactive le toggle : on demande confirmation
  if (!checked) {
    const [section, exNum] = id.split("_");
    const key = `${section}_EX${exNum}`;
    const wrapper = container.querySelector(".video-wrapper");
    if (wrapper) {
      const confirmDelete = confirm("Supprimer la vidéo associée à cet exercice ?");
      if (confirmDelete) {
        wrapper.remove();
        if (videosData[key]) {
          delete videosData[key];
        }
      } else {
        // ❌ Annulation → on remet le toggle à ON
        toggle.checked = true;
        container.style.display = "block";
      }
    }
  }
}

/*  ======  Gestion des feedbacks  ======  */
function createFeedbackSelector(id, activityType, subType = null) {
  const config = activityTypesConfig[activityType];
  let feedbacks = [];

  if (config?.subtypes && subType && config.subtypes[subType]) {
    feedbacks = config.subtypes[subType].feedback || [];
  } else {
    feedbacks = config?.feedback || [];
  }

  // 🚫 Si aucune option de feedback n’est définie, on ne crée rien
  if (feedbacks.length === 0) {
    return "";
  }

  const selectOptions = feedbacks.map(opt => {
    const label = opt === "Complet"
      ? "Complet (correction + traduction + audio + phrase)"
      : "Simple";
    return `<option value="${opt}">${label}</option>`;
  }).join("");

  // 🧩 Construction du bloc
  const html = `
    <label class="mt-3">Type de feedback</label>
    <select id="feedbackType_${id}" class="form-select mb-2"
      onchange="updateFeedbackFields('${id}')">
      ${selectOptions}
    </select>
    <div id="feedbackContainer_${id}"></div>
  `;

  // ✅ Appel différé pour que le feedback initial s’affiche
  setTimeout(() => {
    updateFeedbackFields(id);
  }, 0);

  return html;
}
function createSimpleFeedback(id) {
  return `
    <label>Feedback</label>
    <div id="feedback_${id}" class="quill-editor mb-2">${devMode ? "Bonne réponse !" : ""}</div>
  `;
}
function createFullFeedback(id) {
  return `
    <div class="border rounded p-3 mb-2 bg-light">
      <label>Correction (langue cible)</label>
      <div id="feedbackCorrection_${id}" class="quill-editor mb-2">${devMode ? "Je vais au bureau tous les jours." : ""}</div>

      <div class="d-flex align-items-center gap-2 mb-1">
        <label class="mb-0">Traduction</label>
        <button type="button" class="btn btn-sm btn-outline-info" id="translateTradBtn_${id}" onclick="translateFeedbackTrad(‘${id}’)">🌐 Traduire</button>
      </div>
      <div id="feedbackTrad_${id}" class="quill-editor mb-2">${devMode ? "Je vais au bureau tous les jours." : ""}</div>

      <div class="form-check form-switch mb-2">
        <input class="form-check-input" type="checkbox" id="feedbackAudioSwitch_${id}" onchange="toggleFeedbackAudio(‘${id}’)">
        <label class="form-check-label" for="feedbackAudioSwitch_${id}">Ajouter un audio de la correction</label>
      </div>

      <div id="feedbackAudioContainer_${id}" style="display:none;">
        <label>Audio de la correction</label>
        <input type="file" accept="audio/*" class="form-control mb-2"
          onchange="handleFeedbackAudioUpload(event, ‘${id}’)">
      </div>

      <label>Phrase de feedback</label>
      <div id="feedbackSimple_${id}" class="quill-editor mb-2">${devMode ? "Bravo, c’est la bonne phrase !" : ""}</div>
    </div>
  `;
}
function updateFeedbackFields(id, preserveContent = false) {
  const container = document.getElementById(`feedbackContainer_${id}`);
  if (!container) return;

  const type = document.getElementById(`feedbackType_${id}`)?.value || "Simple";

  // ✅ Sauvegarde du contenu existant avant de tout réécrire
  let savedHTML = {};
  if (preserveContent) {
    container.querySelectorAll(".quill-editor").forEach(el => {
      const editor = el.querySelector(".ql-editor");
      if (editor) savedHTML[el.id] = editor.innerHTML;
    });
  }

  // ✅ Si on est en mode import (preserveContent), on NE vide pas brutalement
  // mais seulement si le type change (ex: Simple → Complet)
  const alreadyType = container.dataset.feedbackType;
  const typeChanged = alreadyType && alreadyType !== type;
  if (!preserveContent || typeChanged) {
    container.innerHTML = "";

    if (type === "Simple") {
      container.innerHTML = `
        <div class="border rounded p-3 mb-2 bg-light">
          <label>Feedback</label>
          <div id="feedback_${id}" class="quill-editor mb-2"></div>
        </div>
      `;
    } else if (type === "Complet") {
      container.innerHTML = `
        <div class="border rounded p-3 mb-2 bg-light">
          <label>Correction (langue cible)</label>
          <div id="feedbackCorrection_${id}" class="quill-editor mb-2"></div>

          <div class="d-flex align-items-center gap-2 mb-1">
            <label class="mb-0">Traduction</label>
            <button type="button" class="btn btn-sm btn-outline-info" id="translateTradBtn_${id}" onclick="translateFeedbackTrad('${id}')">🌐 Traduire</button>
          </div>
          <div id="feedbackTrad_${id}" class="quill-editor mb-2"></div>

          <div class="form-check form-switch mb-2">
            <input class="form-check-input" type="checkbox" id="feedbackAudioSwitch_${id}" onchange="toggleFeedbackAudio('${id}')">
            <label class="form-check-label" for="feedbackAudioSwitch_${id}">Ajouter un audio de la correction</label>
          </div>

          <div id="feedbackAudioContainer_${id}" style="display:none;">
            <label>Audio de la correction</label>
            <input type="file" accept="audio/*" class="form-control mb-2"
              onchange="handleFeedbackAudioUpload(event, '${id}')">
          </div>

          <label>Phrase de feedback</label>
          <div id="feedbackSimple_${id}" class="quill-editor mb-2"></div>
        </div>
      `;
    }
    container.dataset.feedbackType = type;
  }

  // ✅ Initialisation Quill sécurisée
  container.querySelectorAll(".quill-editor").forEach(el => {
    if (!el.dataset.quillInit) {
      const quill = new Quill(el, {
        theme: "snow",
        modules: {
          toolbar: [["bold", "italic"]],
        },
      });
      el.dataset.quillInit = "true";
      el.dataset.quillId = id;
    }
  });

  // ✅ Réinjection du contenu sauvegardé
  if (preserveContent && Object.keys(savedHTML).length > 0) {
    Object.entries(savedHTML).forEach(([key, html]) => {
      const el = document.getElementById(key);
      const editor = el?.querySelector(".ql-editor");
      if (editor) editor.innerHTML = html;
    });
  }
}
function toggleFeedbackAudio(id) {
  const toggle = document.getElementById(`feedbackAudioSwitch_${id}`);
  const container = document.getElementById(`feedbackAudioContainer_${id}`);
  if (!container || !toggle) return;

  const checked = toggle.checked;
  container.style.display = checked ? "block" : "none";

  // 🧹 Si on désactive le toggle : on demande confirmation et on supprime
  if (!checked) {
    const [section, exNum] = id.split("_");
    const key = `${section}_EX${exNum}`; // ✅ Corrigé ici
    const wrapper = container.querySelector(".audio-wrapper");

    if (wrapper) {
      const confirmDelete = confirm("Supprimer l’audio de correction ?");
      if (confirmDelete) {
        wrapper.remove();
        if (audiosData[key]?.feedback) {
          delete audiosData[key].feedback;
          //console.log(`🗑️ Audio de feedback supprimé pour ${key}`);
          if (Object.keys(audiosData[key]).length === 0) delete audiosData[key];
        }
      } else {
        // ❌ Annulation → on remet le toggle à ON
        toggle.checked = true;
        container.style.display = "block";
      }
    }
  }
}
async function _callDeepL(text, btnEl) {
  if (!text) { alert('Le champ source est vide.'); return null; }
  if (btnEl) { btnEl.disabled = true; btnEl.dataset.origText = btnEl.textContent; btnEl.textContent = '⏳'; }
  try {
    const res = await fetch('/api/deepl/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
      body: JSON.stringify({ text, target_lang: 'EN' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    const translated = data.translations?.[0]?.text;
    if (!translated) throw new Error('Réponse inattendue de DeepL');
    return translated;
  } catch (e) {
    alert(`Erreur de traduction : ${e.message}`);
    return null;
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnEl.dataset.origText || '🌐 Traduire'; }
  }
}

async function translateFeedbackTrad(id) {
  const corrEl = document.querySelector(`#feedbackCorrection_${id} .ql-editor`);
  const text = corrEl?.innerText?.trim();
  const btn = document.getElementById(`translateTradBtn_${id}`);
  const translated = await _callDeepL(text, btn);
  if (!translated) return;
  const tradEl = document.querySelector(`#feedbackTrad_${id} .ql-editor`);
  if (tradEl) tradEl.innerHTML = `<p>${translated}</p>`;
}

async function translateLessonExpr(id) {
  const text = document.getElementById(`lessonExprFr_${id}`)?.value?.trim();
  const btn = document.getElementById(`translateExprBtn_${id}`);
  const translated = await _callDeepL(text, btn);
  if (!translated) return;
  const target = document.getElementById(`lessonExprEn_${id}`);
  if (target) target.value = translated;
}

async function translateFlashFront(id) {
  const text = document.getElementById(`back_${id}`)?.value?.trim();
  const btn = document.getElementById(`translateFlashFrontBtn_${id}`);
  const translated = await _callDeepL(text, btn);
  if (!translated) return;
  const target = document.getElementById(`front_${id}`);
  if (target) target.value = translated;
}

async function translateLessonExample(id) {
  const text = document.getElementById(`lessonExFr_${id}`)?.value?.trim();
  const btn = document.getElementById(`translateExBtn_${id}`);
  const translated = await _callDeepL(text, btn);
  if (!translated) return;
  const target = document.getElementById(`lessonExEn_${id}`);
  if (target) target.value = translated;
}

function handleFeedbackAudioUpload(event, id) {
  const file = event.target.files[0];
  if (!file) return;

  const [section, exNum] = id.split("_");
  const key = `${section}_EX${exNum}`; // ✅ On garde la clé standard
  if (!audiosData[key]) audiosData[key] = {};

  const reader = new FileReader();
  reader.onload = () => {
    const blob = new Blob([reader.result], { type: file.type });
    audiosData[key].feedback = blob; // ✅ On stocke dans .feedback

    addAudioPreviewWithDelete(event.target, blob, `audioFeedback_${id}`, (data) => {
      if (data.feedback) delete data.feedback; // ✅ Suppression propre
      if (Object.keys(data).length === 0) delete audiosData[key];
    });
  };
  reader.readAsArrayBuffer(file);
}
async function importFeedback(exoData, id, section, exoKey) {
  //console.group(`💬 Import feedback pour ${id}`);

  try {
    const feedback = exoData.Feedback;
    if (!feedback) return;

    const fbType = feedback.Type || "Simple";

    const fbSelect = document.getElementById(`feedbackType_${id}`);
    if (!fbSelect) {
      console.warn(`⚠️ [${id}] Aucun sélecteur feedbackType trouvé`);
      return;
    }

    fbSelect.value = fbType;
    //console.log(`📘 Type de feedback : ${fbType}`);

    // 🔧 On force la construction du feedback (et on attend qu’elle soit prête)
    updateFeedbackFields(id);
    await new Promise(resolve => setTimeout(resolve, 200)); // délai min. pour laisser Quill s’initialiser

    // 🕐 Attente que les éditeurs Quill soient bien montés
    const waitForEditor = async (selector, timeout = 2000) => {
      const start = performance.now();
      return new Promise((resolve, reject) => {
        const check = () => {
          const el = document.querySelector(selector);
          if (el?.querySelector(".ql-editor")) return resolve(el);
          if (performance.now() - start > timeout)
            return reject(new Error(`⏰ Timeout éditeur non prêt : ${selector}`));
          requestAnimationFrame(check);
        };
        check();
      });
    };

    // Injection du contenu selon le type
    if (fbType === "Simple") {
      const fbEditor = await waitForEditor(`#feedback_${id}`);
      fbEditor.querySelector(".ql-editor").innerHTML = feedback.Texte_HTML || "";
      //console.log(`✅ [${id}] Feedback simple injecté`);
    } else if (fbType === "Complet") {
      const fbCorrection = await waitForEditor(`#feedbackCorrection_${id}`);
      const fbTrad = await waitForEditor(`#feedbackTrad_${id}`);
      const fbPhrase = await waitForEditor(`#feedbackSimple_${id}`);

      if (fbCorrection) fbCorrection.querySelector(".ql-editor").innerHTML = feedback.Correction_HTML || "";
      if (fbTrad) fbTrad.querySelector(".ql-editor").innerHTML = feedback.Traduction_HTML || "";
      if (fbPhrase) fbPhrase.querySelector(".ql-editor").innerHTML = feedback.Phrase_HTML || "";

      //console.log(`✅ [${id}] Feedback complet injecté`);

      // 🎧 Audio de feedback
      if (feedback.Audio) {
        const audioSwitch = document.getElementById(`feedbackAudioSwitch_${id}`);
        const audioContainer = document.getElementById(`feedbackAudioContainer_${id}`);
        if (audioSwitch && audioContainer) {
          audioSwitch.checked = true;
          audioContainer.style.display = "block";

          const exKey = `${section}_EX${parseInt(exoKey.replace("EX", ""))}`;
          const audioBlob = audiosData[exKey]?.feedback;
          const input = audioContainer.querySelector(`input[type="file"][accept="audio/*"]`);

          if (input && audioBlob) {
            addAudioPreviewWithDelete(
              input,
              audioBlob,
              `audioFeedback_${id}`,
              (data) => {
                if (data.feedback) delete data.feedback;
                if (Object.keys(data).length === 0) delete audiosData[exKey];
              }
            );
            //console.log(`🎧 [${id}] Audio de feedback ajouté`);
          }
        }
      }
    }

  } catch (err) {
    console.error(`❌ Erreur d’import du feedback pour ${id} :`, err);
  } finally {
    //console.groupEnd();
  }
}



/*  ======  Génération des audios avec Eleven Labs  ======  */
//  Config API
let elevenLabsApiKey = localStorage.getItem('elevenLabsApiKey') || '';
let elevenLabsVoices = [];
let currentDialogueContext = null;
let dialogueLineCounter = 0;
let currentGeneratedBlob = null;
//  Gestion de la clé API
async function promptForApiKey() {
  const key = prompt('Colle ta clé ElevenLabs API:\n\n(Tu peux la récupérer ici : https://elevenlabs.io/app/settings/api-keys)\n\nCette clé sera ensuite stocker dans le cache du navigateur.');
  if (key && key.trim()) {
    elevenLabsApiKey = key.trim();
    localStorage.setItem('elevenLabsApiKey', elevenLabsApiKey);
    await loadElevenLabsVoices();
    return true;
  }
  return false;
}
function clearApiKey() {
  if (confirm('Supprimer votre clé API ?')) {
    elevenLabsApiKey = '';
    elevenLabsVoices = [];
    localStorage.removeItem('elevenLabsApiKey');
    alert('✅ API key cleared!');
  }
}
//  Chargement des voix
async function loadElevenLabsVoices() {
  if (!isCompanyLoggedIn && !elevenLabsApiKey) return;
  try {
    let response;
    if (isCompanyLoggedIn) {
      response = await fetch(`${SERVER_URL}/api/elevenlabs/voices`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
    } else {
      response = await fetch(
        'https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=default',
        { headers: { 'xi-api-key': elevenLabsApiKey } }
      );
    }
    if (response.status === 401) { clearSession(); return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Populate from whitelist (no need to parse API response)
    elevenLabsVoices = VOICE_WHITELIST.map(wv => ({
      voice_id: wv.id,
      name: wv.name
    }));
  } catch (error) {
    console.error('❌ Error loading voices:', error);
    elevenLabsVoices = [];
  }
}
//  Génère les dialogues
async function generateSpeech(text, voiceId, model = 'eleven_multilingual_v2') {
  if (!isCompanyLoggedIn && !elevenLabsApiKey) {
    throw new Error('Aucune clé API');
  }
  let response;
  const bodyData = JSON.stringify({
    text: text,
    model_id: model,
    language_code: 'fr',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    }
  });
  if (isCompanyLoggedIn) {
    response = await fetch(`${SERVER_URL}/api/elevenlabs/tts/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: bodyData
    });
    if (response.status === 401) { clearSession(); throw new Error('Session expirée'); }
  } else {
    response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': elevenLabsApiKey
      },
      body: bodyData
    });
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TTS failed (${response.status}): ${errorText}`);
  }
  return await response.blob();
}
//  Gestion de la fenêtre modale de Eleven Labs
function openElevenLabsModal(audioKey, onConfirm) {
  // Check API key or company login
  if (!isCompanyLoggedIn && !elevenLabsApiKey) {
    showApiKeyChoiceModal('ElevenLabs', () => {
      promptForApiKey().then(success => {
        if (success) openElevenLabsModal(audioKey, onConfirm);
      });
    }, () => {
      // After login, re-open
      const checkInterval = setInterval(() => {
        if (isCompanyLoggedIn) { clearInterval(checkInterval); openElevenLabsModal(audioKey, onConfirm); }
      }, 500);
      setTimeout(() => clearInterval(checkInterval), 60000);
    });
    return;
  }
  // Load voices if needed
  if (elevenLabsVoices.length === 0) {
    alert('Chargement des voix...');
    loadElevenLabsVoices().then(() => {
      if (elevenLabsVoices.length > 0) {
        openElevenLabsModal(audioKey, onConfirm);
      }
    });
    return;
  }
  currentDialogueContext = { audioKey, onConfirm };
  dialogueLineCounter = 0;
  // Remove existing modal if any
  const existing = document.getElementById('elevenLabsModal');
  if (existing) existing.remove();
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'elevenLabsModal';
  modal.style.cssText = `
    display: flex;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    align-items: center;
    justify-content: center;
    z-index: 2000;
    backdrop-filter: blur(4px);
  `;
  modal.innerHTML = `
    <div style="background: white; border-radius: 12px; padding: 24px; max-width: 750px; width: 90%; max-height: 85vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #e0e0e0;">
        <h3 style="margin: 0; color: #333;">🎙️ Générer le dialogue avec ElevenLabs</h3>
        <button onclick="closeElevenLabsModal()" style="border: none; background: none; font-size: 28px; cursor: pointer; color: #666; line-height: 1;">&times;</button>
      </div>

      <div style="background: #f8f9fa; padding: 12px; border-radius: 6px; margin-bottom: 20px; font-size: 13px; color: #555;">
        💡 <strong>Tip:</strong> Ajoute plusieurs lignes avec différents locuteurs pour créer des dialogues naturels. Chaque ligne sera générée avec la voix sélectionnée.
      </div>

      <div id="dialogueLines" style="margin-bottom: 20px; max-height: 300px; overflow-y: auto;">
        <!-- Les lignes de dialogues seront ajoutées ici. -->
      </div>

      <button onclick="addDialogueLine()" class="btn btn-sm btn-outline-primary mb-3">
        ➕ Ajouter une réplique
      </button>

      <div id="audioPreviewSection" style="display: none; margin-top: 20px; padding: 20px; background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%); border-radius: 8px; border: 2px solid #81c784;">
        <h4 style="margin-top: 0; color: #2e7d32;">✨ Preview de l'audio généré</h4>
        <audio id="generatedAudioPreview" controls style="width: 100%; margin-bottom: 15px;"></audio>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button onclick="regenerateDialogue()" class="btn btn-warning">
            🔄 Re-générer
          </button>
          <button onclick="confirmDialogue()" class="btn btn-success">
            ✅ Utiliser cet audio
          </button>
        </div>
      </div>

      <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #e0e0e0; display: flex; gap: 10px; justify-content: space-between; align-items: center;">
        <div style="font-size: 11px; color: #999;">
          <a href="#" onclick="event.preventDefault(); clearApiKey();" style="color: #666; text-decoration: underline;">Supprimer la clé API</a>
        </div>
        <div style="display: flex; gap: 10px;">
          <button onclick="closeElevenLabsModal()" class="btn btn-secondary">
            Annuler
          </button>
          <button onclick="generateDialogue()" class="btn btn-primary" id="generateBtn">
            🎬 Générer le dialogue
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add initial line
  addDialogueLine();
}
function closeElevenLabsModal() {
  const modal = document.getElementById('elevenLabsModal');
  if (modal) {
    modal.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => modal.remove(), 200);
  }
  currentDialogueContext = null;
  currentGeneratedBlob = null;
}
function addDialogueLine() {
  dialogueLineCounter++;
  const container = document.getElementById('dialogueLines');

  if (!container) {
    console.error('❌ dialogueLines container not found');
    return;
  }

  const voiceOptions = elevenLabsVoices
    .map(v => `<option value="${v.voice_id}">${v.name}</option>`)
    .join('');

  const lineDiv = document.createElement('div');
  lineDiv.className = 'dialogue-line';
  lineDiv.style.cssText = `
    border: 1px solid #ddd;
    padding: 15px;
    margin-bottom: 12px;
    border-radius: 8px;
    background: #fafafa;
    transition: all 0.2s ease;
  `;
  lineDiv.dataset.lineId = dialogueLineCounter;

  lineDiv.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <strong style="color: #555;">Réplique ${dialogueLineCounter}</strong>
      <button onclick="removeDialogueLine(${dialogueLineCounter})"
        class="btn btn-sm btn-outline-danger"
        style="padding: 2px 8px; font-size: 12px;">
        🗑️ Retirer
      </button>
    </div>
    <div style="margin-bottom: 10px;">
      <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; color: #555;">La voix</label>
      <div style="display: flex; gap: 6px; align-items: center;">
        <select class="form-select form-select-sm dialogue-voice" data-line="${dialogueLineCounter}" style="font-size: 13px; flex: 1;">
          <option value="">-- Choisir une voix --</option>
          ${voiceOptions}
        </select>
        <button type="button" class="btn btn-sm btn-outline-secondary voice-preview-btn" data-line="${dialogueLineCounter}"
          title="Écouter un extrait" style="padding: 2px 8px; font-size: 14px; white-space: nowrap;"
          onclick="previewVoiceSample(this)">
          &#9654;
        </button>
      </div>
    </div>
    <div>
      <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; color: #555;">Texte du dialogue</label>
      <textarea class="form-control form-control-sm dialogue-text"
        data-line="${dialogueLineCounter}"
        rows="2"
        placeholder="Ecris la ligne de dialogue..."
        style="font-size: 13px; resize: vertical;"></textarea>
    </div>
  `;

  container.appendChild(lineDiv);

  // Add hover effect
  lineDiv.addEventListener('mouseenter', () => {
    lineDiv.style.background = '#f0f0f0';
    lineDiv.style.borderColor = '#007bff';
  });
  lineDiv.addEventListener('mouseleave', () => {
    lineDiv.style.background = '#fafafa';
    lineDiv.style.borderColor = '#ddd';
  });
}
function removeDialogueLine(lineId) {
  const line = document.querySelector(`[data-line-id="${lineId}"]`);
  if (line) {
    line.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => line.remove(), 200);
  }
}
// Voice sample preview — uses free preview_url from ElevenLabs API (no tokens consumed)
let _voicePreviewAudio = null;
function previewVoiceSample(btn) {
  // Stop any currently playing preview
  if (_voicePreviewAudio) {
    _voicePreviewAudio.pause();
    _voicePreviewAudio = null;
  }
  const lineId = btn.dataset.line;
  const select = document.querySelector(`.dialogue-voice[data-line="${lineId}"]`);
  if (!select || !select.value) { alert('Choisis une voix d\'abord.'); return; }
  btn.innerHTML = '&#9632;'; // stop icon
  _voicePreviewAudio = new Audio(`samples/${select.value}.mp3`);
  _voicePreviewAudio.play();
  _voicePreviewAudio.onended = () => { btn.innerHTML = '&#9654;'; _voicePreviewAudio = null; };
  _voicePreviewAudio.onerror = () => { btn.innerHTML = '&#9654;'; _voicePreviewAudio = null; alert('Erreur lors de la lecture.'); };
  btn.onclick = function() {
    if (_voicePreviewAudio) { _voicePreviewAudio.pause(); _voicePreviewAudio = null; }
    btn.innerHTML = '&#9654;';
    btn.onclick = function() { previewVoiceSample(btn); };
  };
}
async function generateDialogue() {
  const lines = [];
  const textInputs = document.querySelectorAll('.dialogue-text');
  const voiceSelects = document.querySelectorAll('.dialogue-voice');

  // Validate and collect all lines
  for (let i = 0; i < textInputs.length; i++) {
    const text = textInputs[i].value.trim();
    const voiceId = voiceSelects[i].value;

    if (!text) {
      alert(`❌ Line ${i + 1} is empty!\n\nPlease enter text for all dialogue lines.`);
      textInputs[i].focus();
      return;
    }

    if (!voiceId) {
      alert(`❌ Line ${i + 1} has no speaker selected!\n\nPlease select a voice for each line.`);
      voiceSelects[i].focus();
      return;
    }

    lines.push({ text, voiceId, lineNum: i + 1 });
  }

  if (lines.length === 0) {
    alert('❌ Please add at least one dialogue line!');
    return;
  }

  const generateBtn = document.getElementById('generateBtn');
  if (!generateBtn) return;

  const originalText = generateBtn.textContent;
  generateBtn.disabled = true;
  generateBtn.textContent = '⏳ Generating...';
  generateBtn.style.opacity = '0.6';

  try {
    console.log(`🎬 Generating ${lines.length} dialogue line(s)...`);

    const audioBlobs = [];

    // Generate each line sequentially
    for (let i = 0; i < lines.length; i++) {
      const { text, voiceId, lineNum } = lines[i];

      generateBtn.textContent = `⏳ Generating line ${lineNum}/${lines.length}...`;
      console.log(`  → Line ${lineNum}: "${text.substring(0, 30)}..."`);

      const blob = await generateSpeech(text, voiceId);
      audioBlobs.push(blob);

      // Small delay between requests to be nice to API
      if (i < lines.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('✅ All lines generated successfully');

    // Combine audio blobs (simple concatenation for MP3)
    const combinedBlob = new Blob(audioBlobs, { type: 'audio/mpeg' });
    currentGeneratedBlob = combinedBlob;

    // Show preview section
    const previewSection = document.getElementById('audioPreviewSection');
    const audioPlayer = document.getElementById('generatedAudioPreview');

    if (previewSection && audioPlayer) {
      audioPlayer.src = URL.createObjectURL(combinedBlob);
      previewSection.style.display = 'block';
      previewSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    alert(`✅ Dialogue generated successfully!\n\n${lines.length} line(s) combined into one audio file.\n\nListen to the preview below.`);

  } catch (error) {
    console.error('❌ Error generating dialogue:', error);
    alert(`❌ Failed to generate dialogue:\n\n${error.message}\n\nPlease check your API key and try again.`);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = originalText;
    generateBtn.style.opacity = '1';
  }
}
async function regenerateDialogue() {
  if (!confirm('🔄 Regenerate the dialogue?\n\nThis will create a new version with the same settings.')) {
    return;
  }

  currentGeneratedBlob = null;
  const previewSection = document.getElementById('audioPreviewSection');
  if (previewSection) {
    previewSection.style.display = 'none';
  }

  await generateDialogue();
}
function confirmDialogue() {
  if (!currentGeneratedBlob || !currentDialogueContext) {
    alert('❌ No audio to confirm!');
    return;
  }

  const { audioKey, onConfirm } = currentDialogueContext;

  console.log(`✅ Confirming dialogue for key: ${audioKey}`);

  // Call the callback with the generated blob
  if (onConfirm) {
    onConfirm(currentGeneratedBlob);
  }

  alert('✅ Audio confirmed and added to your exercise!');
  closeElevenLabsModal();
}
//  HELPER pour les "audios main" -> utilisé par createAudioToggle (À VERIFIER)
function openElevenLabsForMainAudio(id) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;

  openElevenLabsModal(audioKey, (blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = {};
    audiosData[audioKey].main = blob;

    // Auto-fill transcription from the dialogue text(s) typed in the modal
    const voiceToSpeaker = {};
    let speakerCount = 0;
    const lines = [...document.querySelectorAll('#elevenLabsModal .dialogue-line')]
      .map(line => {
        const text = line.querySelector('.dialogue-text')?.value?.trim();
        if (!text) return null;
        const voiceId = line.querySelector('.dialogue-voice')?.value || '';
        if (!(voiceId in voiceToSpeaker)) voiceToSpeaker[voiceId] = ++speakerCount;
        return `Locuteur ${voiceToSpeaker[voiceId]} : ${text}`;
      }).filter(Boolean).join('\n');
    if (lines) {
      const transcEl = document.getElementById(`audioTranscription_${id}`);
      if (transcEl) transcEl.value = lines;
    }

    console.log(`✅ Audio stored for ${audioKey}, now looking for input...`);

    // ✅ FIX 1: Correct syntax and ID
    const inputElement = document.getElementById(`audioInput_${id}_main`);
    //                                          ^                    ^^^^
    // Added the _main suffix to match the ID in createAudioToggle

    console.log(`🔍 Looking for: audioInput_${id}_main`, inputElement);

    if (inputElement && typeof addAudioPreviewWithDelete === 'function') {
      console.log("✅ Adding preview now!");
      addAudioPreviewWithDelete(
        inputElement,
        blob,
        `audio_${id}_main`,
        (data) => {
          if (data.main) delete data.main;
          if (Object.keys(data).length === 0) delete audiosData[audioKey];
        }
      );
    } else {
      console.error("❌ Could not add preview:");
      console.error("  - Input element found?", !!inputElement);
      console.error("  - Function exists?", typeof addAudioPreviewWithDelete);
    }
  });
}
//  HELPER qui lie les audios Eleven Labs au bon champ (À VERIFIER)
function openElevenLabsForAudio(id, audioType = 'main') {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;

  console.log(`🎙️ Opening ElevenLabs for: ${audioKey}, type: ${audioType}`);

  openElevenLabsModal(audioKey, (blob) => {
    // Store the generated audio in audiosData
    if (!audiosData[audioKey]) {
      audiosData[audioKey] = {};
    }
    audiosData[audioKey][audioType] = blob;

    console.log(`✅ Audio stored in audiosData["${audioKey}"]["${audioType}"]`);

    // Add preview with delete functionality
    const inputElement = document.getElementById(`audioInput_${id}_${audioType}`);
    if (inputElement && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(
        inputElement,
        blob,
        `audio_${id}_${audioType}`,
        (data) => {
          if (data[audioType]) delete data[audioType];
          if (Object.keys(data).length === 0) delete audiosData[audioKey];
        }
      );
    } else {
      // Fallback: just show an alert
      alert('✅ Audio generated! (Preview function not available)');
    }
  });
}

// =====================================================
// ENREGISTREUR AUDIO (EXPÉRIMENTAL)
// =====================================================
let _recorderStream = null;
let _mediaRecorder = null;
let _recorderChunks = [];
let _recorderOnConfirm = null;
let _recorderInterval = null;

function openRecorderModal(onConfirm, referenceText) {
  _recorderOnConfirm = onConfirm;
  const existing = document.getElementById('audioRecorderModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'audioRecorderModal';
  modal.style.cssText = `
    display:flex; position:fixed; inset:0;
    background:rgba(0,0,0,0.85); align-items:center; justify-content:center;
    z-index:2000; backdrop-filter:blur(4px);
  `;
  const refBlock = referenceText
    ? `<div style="background:#f0f4ff;border-left:4px solid #0d6efd;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:15px;color:#1a1a2e;line-height:1.5;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6c757d;margin-bottom:4px;">Texte à lire</div>
        <strong>${referenceText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</strong>
       </div>`
    : '';
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;padding:28px;width:460px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h5 style="margin:0;">🎤 Enregistrement <span style="font-size:12px;color:#888;font-weight:normal;"></span></h5>
        <button onclick="closeRecorderModal()" class="btn btn-sm btn-outline-secondary">✕</button>
      </div>
      ${refBlock}
      <div id="recorderStatus" style="text-align:center;padding:12px 0;color:#666;font-size:14px;">
        Cliquez sur "Démarrer" pour commencer.
      </div>
      <div id="recorderTimer" style="text-align:center;font-size:40px;font-weight:bold;color:#dc3545;display:none;padding:8px 0;">
        0:00
      </div>
      <div id="recorderPreview" style="display:none;margin:16px 0;">
        <audio id="recorderAudioPreview" controls style="width:100%;"></audio>
      </div>
      <div id="recorderError" class="text-danger small text-center" style="display:none;margin-bottom:8px;"></div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px;">
        <button id="recorderStartBtn" class="btn btn-danger" onclick="recorderStart()">⏺ Démarrer</button>
        <button id="recorderStopBtn" class="btn btn-secondary" onclick="recorderStop()" style="display:none;">⏹ Arrêter</button>
        <button id="recorderUseBtn" class="btn btn-success" onclick="recorderUse()" style="display:none;">✅ Utiliser</button>
        <button id="recorderRetryBtn" class="btn btn-outline-secondary" onclick="recorderRetry()" style="display:none;">🔄 Recommencer</button>
        <button class="btn btn-outline-danger" onclick="closeRecorderModal()">❌ Annuler</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeRecorderModal() {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
  if (_recorderStream) { _recorderStream.getTracks().forEach(t => t.stop()); _recorderStream = null; }
  clearInterval(_recorderInterval);
  _mediaRecorder = null; _recorderChunks = []; _recorderOnConfirm = null;
  const modal = document.getElementById('audioRecorderModal');
  if (modal) modal.remove();
}

async function recorderStart() {
  const errEl = document.getElementById('recorderError');
  errEl.style.display = 'none';
  try {
    _recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    errEl.textContent = 'Accès au microphone refusé. Vérifiez les permissions du navigateur.';
    errEl.style.display = 'block';
    return;
  }
  _recorderChunks = [];
  _mediaRecorder = new MediaRecorder(_recorderStream);
  _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _recorderChunks.push(e.data); };
  _mediaRecorder.onstop = () => {
    clearInterval(_recorderInterval);
    _recorderStream.getTracks().forEach(t => t.stop());
    const blob = new Blob(_recorderChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const preview = document.getElementById('recorderAudioPreview');
    if (preview) preview.src = url;
    document.getElementById('recorderPreview').style.display = 'block';
    document.getElementById('recorderTimer').style.display = 'none';
    document.getElementById('recorderStopBtn').style.display = 'none';
    document.getElementById('recorderUseBtn').style.display = '';
    document.getElementById('recorderRetryBtn').style.display = '';
    document.getElementById('recorderStatus').textContent = 'Enregistrement terminé. Écoutez et cliquez sur "Utiliser".';
  };
  _mediaRecorder.start();
  let seconds = 0;
  document.getElementById('recorderTimer').style.display = 'block';
  document.getElementById('recorderStatus').textContent = '🔴 Enregistrement en cours...';
  document.getElementById('recorderStartBtn').style.display = 'none';
  document.getElementById('recorderStopBtn').style.display = '';
  _recorderInterval = setInterval(() => {
    seconds++;
    const timerEl = document.getElementById('recorderTimer');
    if (timerEl) timerEl.textContent = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  }, 1000);
}

function recorderStop() {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
}

function recorderRetry() {
  document.getElementById('recorderPreview').style.display = 'none';
  document.getElementById('recorderUseBtn').style.display = 'none';
  document.getElementById('recorderRetryBtn').style.display = 'none';
  document.getElementById('recorderStartBtn').style.display = '';
  document.getElementById('recorderTimer').textContent = '0:00';
  document.getElementById('recorderStatus').textContent = 'Cliquez sur "Démarrer" pour recommencer.';
  _recorderChunks = [];
}

function recorderUse() {
  const blob = new Blob(_recorderChunks, { type: 'audio/webm' });
  if (_recorderOnConfirm) _recorderOnConfirm(blob);
  closeRecorderModal();
}

// =====================================================
// Helpers pour les boutons Browse + Générer (audios secondaires)
// =====================================================
function createDualAudioButtons(inputId, browseHandler, generateFn, recordFn) {
  return `
    <div class="d-flex gap-2 mb-2 flex-wrap">
      <input type="file" accept="audio/*" id="${inputId}" style="display:none"
        onchange="${browseHandler}">
      <button class="btn btn-sm btn-outline-secondary" type="button"
        onclick="document.getElementById('${inputId}').click()">
        📁 Browse
      </button>
      <button class="btn btn-sm btn-outline-primary" type="button"
        onclick="${generateFn}">
        🎙️ Générer
      </button>
      <button class="btn btn-sm btn-outline-danger" type="button"
        onclick="${recordFn}" title="Enregistrer">
        ⏺ Enregistrer
      </button>
    </div>
  `;
}

function openElevenLabsForMatchAudio(id, position) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openElevenLabsModal(audioKey, (blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = { match: {} };
    if (!audiosData[audioKey].match) audiosData[audioKey].match = {};
    audiosData[audioKey].match[`Match_${position}`] = blob;
    const inputEl = document.getElementById(`audioMatchInput_${id}_${position}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audioMatch_${id}_${position}`, (data) => {
        if (data.match && data.match[`Match_${position}`]) delete data.match[`Match_${position}`];
        if (data.match && Object.keys(data.match).length === 0) delete data.match;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openElevenLabsForFlashcardAudio(id, side) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openElevenLabsModal(audioKey, (blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = { flashcard: {} };
    if (!audiosData[audioKey].flashcard) audiosData[audioKey].flashcard = {};
    audiosData[audioKey].flashcard[side] = blob;
    const inputEl = document.getElementById(`audioFlashInput_${id}_${side}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audioFlash_${id}_${side}`, (data) => {
        if (data.flashcard && data.flashcard[side]) delete data.flashcard[side];
        if (data.flashcard && Object.keys(data.flashcard).length === 0) delete data.flashcard;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openElevenLabsForLessonExpr(id) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openElevenLabsModal(audioKey, (blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = {};
    audiosData[audioKey].exprFr = blob;
    const inputEl = document.getElementById(`audioExprFrInput_${id}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audio_${audioKey}_exprFr`, (data) => {
        if (data.exprFr) delete data.exprFr;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openElevenLabsForLessonExample(id) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openElevenLabsModal(audioKey, (blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = {};
    audiosData[audioKey].example = blob;
    const inputEl = document.getElementById(`audioExFrInput_${id}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audio_${audioKey}_example`, (data) => {
        if (data.example) delete data.example;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openElevenLabsForLessonCell(id, cellId) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openElevenLabsModal(audioKey, (blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = { lesson: {} };
    if (!audiosData[audioKey].lesson) audiosData[audioKey].lesson = {};
    audiosData[audioKey].lesson[cellId] = blob;
    const inputEl = document.getElementById(`lessonCellAudioInput_${cellId}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audioLesson_${cellId}`, (data) => {
        if (data.lesson && data.lesson[cellId]) delete data.lesson[cellId];
        if (data.lesson && Object.keys(data.lesson).length === 0) delete data.lesson;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

// =====================================================
// openRecorderFor* — mirrors of ElevenLabs openers for the mic recorder
// =====================================================
function openRecorderForMainAudio(id) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openRecorderModal((blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = {};
    audiosData[audioKey].main = blob;
    const inputEl = document.getElementById(`audioInput_${id}_main`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audio_${id}_main`, (data) => {
        if (data.main) delete data.main;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openRecorderForAudio(id, audioType = 'main') {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openRecorderModal((blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = {};
    audiosData[audioKey][audioType] = blob;
    const inputEl = document.getElementById(`audioInput_${id}_${audioType}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audio_${id}_${audioType}`, (data) => {
        if (data[audioType]) delete data[audioType];
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openRecorderForMatchAudio(id, position) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openRecorderModal((blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = { match: {} };
    if (!audiosData[audioKey].match) audiosData[audioKey].match = {};
    audiosData[audioKey].match[`Match_${position}`] = blob;
    const inputEl = document.getElementById(`audioMatchInput_${id}_${position}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audioMatch_${id}_${position}`, (data) => {
        if (data.match && data.match[`Match_${position}`]) delete data.match[`Match_${position}`];
        if (data.match && Object.keys(data.match).length === 0) delete data.match;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openRecorderForFlashcardAudio(id, side) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openRecorderModal((blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = { flashcard: {} };
    if (!audiosData[audioKey].flashcard) audiosData[audioKey].flashcard = {};
    audiosData[audioKey].flashcard[side] = blob;
    const inputEl = document.getElementById(`audioFlashInput_${id}_${side}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audioFlash_${id}_${side}`, (data) => {
        if (data.flashcard && data.flashcard[side]) delete data.flashcard[side];
        if (data.flashcard && Object.keys(data.flashcard).length === 0) delete data.flashcard;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openRecorderForLessonExpr(id) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openRecorderModal((blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = {};
    audiosData[audioKey].exprFr = blob;
    const inputEl = document.getElementById(`audioExprFrInput_${id}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audio_${audioKey}_exprFr`, (data) => {
        if (data.exprFr) delete data.exprFr;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openRecorderForLessonExample(id) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openRecorderModal((blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = {};
    audiosData[audioKey].example = blob;
    const inputEl = document.getElementById(`audioExFrInput_${id}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audio_${audioKey}_example`, (data) => {
        if (data.example) delete data.example;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}

function openRecorderForLessonCell(id, cellId) {
  const [section, exNum] = id.split("_");
  const audioKey = `${section}_EX${exNum}`;
  openRecorderModal((blob) => {
    if (!audiosData[audioKey]) audiosData[audioKey] = { lesson: {} };
    if (!audiosData[audioKey].lesson) audiosData[audioKey].lesson = {};
    audiosData[audioKey].lesson[cellId] = blob;
    const inputEl = document.getElementById(`lessonCellAudioInput_${cellId}`);
    if (inputEl && typeof addAudioPreviewWithDelete === 'function') {
      addAudioPreviewWithDelete(inputEl, blob, `audioLesson_${cellId}`, (data) => {
        if (data.lesson && data.lesson[cellId]) delete data.lesson[cellId];
        if (data.lesson && Object.keys(data.lesson).length === 0) delete data.lesson;
        if (Object.keys(data).length === 0) delete audiosData[audioKey];
      });
    }
  });
}


/*  ======  Génération des images avec GEMINI API  ======  */
//  Config initiale
let geminiApiKey = localStorage.getItem('geminiApiKey') || '';
let currentGeneratedImages = []; // Store the generated image blobs
let currentImageContext = null; // Store context for confirmation
let selectedImageIndex = null;
//  Gestion de la clé API
function saveGeminiApiKey(apiKey) {
  localStorage.setItem('geminiApiKey', apiKey);
  geminiApiKey = apiKey;
}
function getGeminiApiKey() {
  return localStorage.getItem('geminiApiKey') || geminiApiKey;
}
//  Compatibilité
function saveNanoBananaApiKey(apiKey) {
  saveGeminiApiKey(apiKey);
}
function getNanoBananaApiKey() {
  return getGeminiApiKey();
}
function clearGeminiKey() {
  localStorage.removeItem('geminiApiKey');
  geminiApiKey = '';
  alert('🔑 API key cleared. You will be prompted to enter a new one.');
}
function promptForGeminiKey() {
  const key = prompt('Enter your Gemini API key:\n\nGet a free key at: https://aistudio.google.com/app/apikey');
  if (key && key.trim()) {
    saveGeminiApiKey(key.trim());
    return true;
  }
  return false;
}
//  Check KEY
async function generateImageGemini(userPrompt) {
  if (!isCompanyLoggedIn && !geminiApiKey) {
    throw new Error('No API key set');
  }

  // Enhanced prompt with professional characteristics
  const enhancedPrompt = `
Professional photorealistic image for e-learning content: ${userPrompt}.

Technical specifications:
- Photorealistic style with vibrant, saturated colors
- Professional photography quality with sharp focus
- Diverse representation: varied ethnicities, genders, and ages
- Natural lighting with professional studio quality
- High detail and clarity
- Modern, clean aesthetic
- 16:9 widescreen composition (1280x720 suitable)
- Suitable for educational/professional context
`.trim();

  console.log('🎨 Generating image with Gemini API');
  console.log('User prompt:', userPrompt);

  const requestBody = JSON.stringify({
    contents: [{
      parts: [{ text: enhancedPrompt }]
    }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: '16:9'
      }
    }
  });

  let response;
  if (isCompanyLoggedIn) {
    response = await fetch(`${SERVER_URL}/api/gemini/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: requestBody
    });
    if (response.status === 401) { clearSession(); throw new Error('Session expirée'); }
  } else {
    response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': geminiApiKey,
          'Content-Type': 'application/json'
        },
        body: requestBody
      }
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Gemini API error:', errorText);
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  console.log('✅ Gemini response received:', data);

  // Extract image from response
  const imagePart = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

  if (!imagePart || !imagePart.inlineData) {
    console.error('❌ No image data in response:', data);
    throw new Error('No image data in response');
  }

  // Convert base64 to blob
  const base64Data = imagePart.inlineData.data;
  const mimeType = imagePart.inlineData.mimeType || 'image/png';

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });

  console.log(`✅ Image blob created: ${blob.size} bytes`);
  return blob;
}
//  Fenêtre modale Gemini
function openGeminiModal(imageKey, onConfirm) {
  // Check for API key or company login
  if (!isCompanyLoggedIn && !geminiApiKey) {
    showApiKeyChoiceModal('Gemini', () => {
      const hasKey = promptForGeminiKey();
      if (hasKey) openGeminiModal(imageKey, onConfirm);
    }, () => {
      const checkInterval = setInterval(() => {
        if (isCompanyLoggedIn) { clearInterval(checkInterval); openGeminiModal(imageKey, onConfirm); }
      }, 500);
      setTimeout(() => clearInterval(checkInterval), 60000);
    });
    return;
  }

  // Store context for later confirmation
  currentImageContext = { imageKey, onConfirm };
  currentGeneratedImages = [];
  selectedImageIndex = null;

  // Create modal HTML
  const modalHTML = `
    <div id="geminiModal" style="
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    ">
      <div style="
        background: white;
        border-radius: 12px;
        padding: 24px;
        max-width: 900px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="margin: 0; color: #1967d2; display: flex; align-items: center; gap: 8px;">
            <span>🎨</span>
            <span>Générer l'image avec l'IA de Gemini</span>
          </h3>
          <button onclick="closeGeminiModal()" class="btn-close" aria-label="Close"></button>
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #333;">
            Décris la scène que tu veux :
          </label>
          <textarea 
            id="imagePromptInput" 
            class="form-control" 
            rows="3" 
            placeholder="Example: Une femme pointe du doigt l'écran de sa collègue pour lui expliquer quelque chose."
            style="resize: vertical; font-size: 14px;"
          ></textarea>
          <small class="text-muted" style="display: block; margin-top: 4px;">
            💡 Astuce : Soyez précis à propos de la scène, des personnes, et du cadre.
          </small>
        </div>

        <!-- Image generation buttons -->
        <div style="margin-bottom: 24px;">
          <div style="display: flex; gap: 12px; margin-bottom: 12px;">
            <button 
              id="generateOneImageBtn" 
              class="btn btn-outline-primary" 
              onclick="generateImagesGemini(1)"
              style="flex: 1;"
              title="Generate 1 image (~$0.039)"
            >
              🎨 Générer l'image
            </button>
            <!-- ⚠️⚠️⚠️ j'ai retiré le bouton pour générer deux images
            <button
              id="generateTwoImagesBtn" 
              class="btn btn-primary" 
              onclick="generateImagesGemini(2)"
              style="flex: 1;"
              title="Generate 2 images to choose from (~$0.078)"
            >
              ✨ Generate 2 Images
            </button>
            --!>
          </div>
          
          <!-- Secondary actions -->
          <div style="display: flex; gap: 12px; align-items: center;">
            <button 
              class="btn btn-outline-secondary btn-sm" 
              onclick="clearGeminiKey()"
              style="white-space: nowrap;"
            >
              🔑 Changer la clé API
            </button>
            <!--
            <small class="text-muted" style="font-size: 0.8rem;">
              💡 Tip: Generate 1 for testing, 2 for best results
            </small>
            --!>
          </div>
        </div>

        <div id="imagePreviewContainer" style="margin-top: 20px;"></div>

        <div id="imageActionsContainer" style="display: none; margin-top: 20px; text-align: right;">
          <button class="btn btn-success" onclick="confirmSelectedImageGemini()">
            ✅ Utiliser l'image sélectionnée
          </button>
        </div>
      </div>
    </div>
  `;

  // Remove existing modal if any
  const existing = document.getElementById('geminiModal');
  if (existing) existing.remove();

  // Add modal to page
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}
function closeGeminiModal() {
  const modal = document.getElementById('geminiModal');
  if (modal) modal.remove();
  currentGeneratedImages = [];
  currentImageContext = null;
  selectedImageIndex = null;
}
//  Générer des images
async function generateImagesGemini(numImages = 2) {
  const promptInput = document.getElementById('imagePromptInput');
  const userPrompt = promptInput.value.trim();

  if (!userPrompt) {
    alert('⚠️ Please describe the image you want to generate');
    promptInput.focus();
    return;
  }

  const btn1 = document.getElementById('generateOneImageBtn');
  const btn2 = document.getElementById('generateTwoImagesBtn');
  const container = document.getElementById('imagePreviewContainer');
  const actionsContainer = document.getElementById('imageActionsContainer');

  // Reset state
  currentGeneratedImages = [];
  selectedImageIndex = null;
  container.innerHTML = '';
  actionsContainer.style.display = 'none';

  // Disable buttons
  btn1.disabled = true;
  if (btn2) btn2.disabled = true;

  // Update button text based on number of images
  if (numImages === 1) {
    btn1.textContent = '⏳ Generating...';
    if (btn2) btn2.textContent = '✨ Generate 2 Images';
  } else {
    btn1.textContent = "🎨 Générer l'image";
    if (btn2) btn2.textContent = "⏳ Génération en cours...";
  }

  try {
    // Generate images
    for (let i = 0; i < numImages; i++) {
      if (numImages > 1 && btn2) {
        btn2.textContent = `⏳ Generating image ${i + 1} of ${numImages}...`;
      }
      
      console.log(`🎨 Generating image ${i + 1} of ${numImages}...`);
      const blob = await generateImageGemini(userPrompt);
      currentGeneratedImages.push(blob);
      displayImageOption(blob, i, container);
    }

    console.log(`✅ All ${numImages} image(s) generated successfully`);
    
    // If only 1 image, auto-select it
    if (numImages === 1) {
      selectImageGemini(0);
    }
    
    // Show confirmation button
    actionsContainer.style.display = 'block';
    
    // Re-enable buttons
    btn1.disabled = false;
    if (btn2) btn2.disabled = false;
    btn1.textContent = '🎨 Generate 1 Image';
    if (btn2) btn2.textContent = '✨ Generate 2 Images';

  } catch (error) {
    console.error('❌ Error generating images:', error);

    let errorMessage = error.message;

    // Parse Gemini-specific errors
    if (errorMessage.includes('API_KEY_INVALID')) {
      errorMessage = 'Invalid API key. Please check your Gemini API key.';
      clearGeminiKey();
    } else if (errorMessage.includes('QUOTA_EXCEEDED')) {
      errorMessage = 'API quota exceeded. Please try again later or check your quota.';
    } else if (errorMessage.includes('SAFETY')) {
      errorMessage = 'Content blocked by safety filters. Please try a different prompt.';
    }

    container.innerHTML = `
      <div class="alert alert-danger">
        <strong>Error:</strong> ${errorMessage}
        <br><small>Check console for details</small>
      </div>
    `;

    // Reset buttons
    btn1.disabled = false;
    if (btn2) btn2.disabled = false;
    btn1.textContent = "🎨 Regénérer l'image";
    if (btn2) btn2.textContent = "🎨 Regénérer les images";
  }
}
//  Afficher les images
function displayImageOption(blob, index, container) {
  const url = URL.createObjectURL(blob);
  const imageHTML = `
    <div class="image-option" style="
      display: inline-block;
      width: calc(50% - 10px);
      margin: ${index === 0 ? '0 10px 0 0' : '0 0 0 10px'};
      border: 3px solid transparent;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.2s;
      vertical-align: top;
    " 
    onclick="selectImageGemini(${index})"
    id="imageOption${index}"
    >
      <img 
        src="${url}" 
        alt="Generated option ${index + 1}"
        style="
          width: 100%;
          height: auto;
          display: block;
        "
      >
      <div style="
        text-align: center;
        padding: 8px;
        background: #f8f9fa;
        font-size: 13px;
        font-weight: 600;
      ">
        Option ${index + 1}
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', imageHTML);

  // Add hover effect
  const imageDiv = document.getElementById(`imageOption${index}`);
  imageDiv.addEventListener('mouseenter', () => {
    if (!imageDiv.classList.contains('selected')) {
      imageDiv.style.borderColor = '#dee2e6';
    }
  });
  imageDiv.addEventListener('mouseleave', () => {
    if (!imageDiv.classList.contains('selected')) {
      imageDiv.style.borderColor = 'transparent';
    }
  });
}
//  Sélectionner une image
function selectImageGemini(index) {
  selectedImageIndex = index;

  // Update visual selection
  document.querySelectorAll('.image-option').forEach((div, i) => {
    if (i === index) {
      div.style.borderColor = '#1967d2';
      div.style.boxShadow = '0 4px 12px rgba(25, 103, 210, 0.3)';
      div.classList.add('selected');
    } else {
      div.style.borderColor = 'transparent';
      div.style.boxShadow = 'none';
      div.classList.remove('selected');
    }
  });

  console.log(`✅ Image ${index + 1} selected`);
}
//  Confirmer la sélection
function confirmSelectedImageGemini() {
  if (selectedImageIndex === null) {
    alert('⚠️ Please select an image first');
    return;
  }

  if (!currentImageContext || !currentGeneratedImages[selectedImageIndex]) {
    alert('❌ No image data available');
    return;
  }

  const { imageKey, onConfirm } = currentImageContext;
  const selectedBlob = currentGeneratedImages[selectedImageIndex];

  console.log(`✅ Confirming image ${selectedImageIndex + 1} for key: ${imageKey}`);

  // Close Gemini modal first
  closeGeminiModal();

  // ✅ Open cropper with the selected image
  openCropperWithBlob(selectedBlob, imageKey, onConfirm);
}
//  Helper gemini (le nom est pour la compatibilité)
function openNanoBananaForImage(id) {
  // Keep this function name for backward compatibility
  const [section, exNum] = id.split("_");
  const imageKey = `${section}_EX${exNum}`;

  console.log(`🎨 Opening Gemini AI for: ${imageKey}`);

  openGeminiModal(imageKey, (blob) => {
    // This callback is now just a placeholder
    // The actual work is done after cropping
    console.log(`✅ Image cropped and stored in imagesData["${imageKey}"]`);
  });
}



/*  ======  PREVIEW LOCAL  ======  */
async function previewWithLocalServer() {
  console.log('🎬 Starting SCORM preview with local server...');
  
  //  Cleanup any existing package before creating new one
  deleteCurrentPackage();
  //  Show loading modal
  const modal = new bootstrap.Modal(document.getElementById('scormPlayerModal'));
  modal.show();
  //  Get elements
  const loadingDiv = document.getElementById('scormLoading');
  const iframe = document.getElementById('scormPlayerFrame');
  //  Make sure loading is visible and iframe is hidden
  if (loadingDiv) {
    loadingDiv.style.cssText = 'display: flex !important;';
  }
  if (iframe) {
    iframe.style.display = 'none';
  }  
  try {
    //  Step 1: Generate SCORM package
    updateLoadingStatus('Génération du package SCORM...', 20);
    const zipObject = await generateSCORMPackageInMemory();    
    //  Step 2: Generate blob
    updateLoadingStatus('Préparation du fichier...', 40);
    const zipBlob = await zipObject.generateAsync({ type: 'blob' });    
    //  Step 3: Upload to server
    updateLoadingStatus('Upload vers le serveur...', 60);
    const response = await fetch(`${SERVER_URL}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip'
      },
      body: zipBlob
    });
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Upload failed');
    }
    console.log('✅ Package uploaded:', result.packageId);
    //  Store package ID for cleanup
    currentPackageId = result.packageId;
    //  Step 4: Load in iframe
    updateLoadingStatus('Chargement du contenu...', 90);
    //  Function to hide loading and show iframe
    const showContent = () => {
      console.log('🎉 Showing content...');
      if (loadingDiv) {
        loadingDiv.style.cssText = 'display: none !important;';
      }
      if (iframe) {
        iframe.style.display = 'block';
      }
    };
    //  Wait for iframe to load
    iframe.onload = function() {
      console.log('✅ Iframe loaded successfully');
      showContent();
    };
    //  Backup timeout
    setTimeout(() => {
      console.log('⏰ Timeout reached, hiding loading screen');
      showContent();
    }, 2000);
    //  Load the URL
    iframe.src = result.launchUrl;
    console.log('✅ Preview initiated successfully!');
  } catch (error) {
    console.error('❌ Preview error:', error);
    //  Hide loading on error
    if (loadingDiv) {
      loadingDiv.style.cssText = 'display: none !important;';
    }
    //  Cleanup failed package
    deleteCurrentPackage();
    //  Show helpful error message
    let errorMsg = '❌ Erreur:\n\n' + error.message;
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMsg += '\n\n⚠️ Le serveur local ne semble pas être démarré.\n\n';
      errorMsg += 'Étapes:\n';
      errorMsg += '1. Ouvrez un terminal\n';
      errorMsg += '2. Allez dans le dossier du serveur\n';
      errorMsg += '3. Exécutez: npm install\n';
      errorMsg += '4. Puis: npm start\n';
      errorMsg += '5. Réessayez la prévisualisation';
    }
    alert(errorMsg);
  }
}
//  Récupère l'information de loading
function updateLoadingStatus(message, progress) {
  const statusEl = document.getElementById('scormLoadingStatus');
  const progressBar = document.getElementById('scormLoadingProgress');
  if (statusEl) statusEl.textContent = message;
  if (progressBar) progressBar.style.width = progress + '%';
}
//  Génère le paquet en mémoire
async function generateSCORMPackageInMemory(templatePath = "Modele/Modele.zip") {
  let data;
  try {
    data = buildResult();
  } catch (e) {
    throw new Error(e.message || "Erreur de génération !");
  }
  const { S0, sectionsData, safeName } = data;
  //  Load du template zip
  const response = await fetch(templatePath);
  if (!response.ok) {
    throw new Error(`Impossible de charger ${templatePath} !`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const templateZip = await JSZip.loadAsync(arrayBuffer);
  const rootFolder = templateZip.folder("Ressources_Sequences");

  /* ========= S0 ========= */
  const S0Folder = rootFolder.folder("S0");
  S0Folder.file("variables.json", JSON.stringify(S0, null, 2));

  /* ========= S1–S4 ========= */
  for (const section of ["S1", "S2", "S3", "S4"]) {
    const sectionFolder = rootFolder.folder(section);
    const imgFolder = sectionFolder.folder("Images");
    const audioFolder = sectionFolder.folder("Audios");
    const videoFolder = sectionFolder.folder("Videos");
    sectionFolder.file("variables.json", JSON.stringify(sectionsData[section], null, 2));

    // --- Images ---
    for (const [key, blob] of Object.entries(imagesData)) {
      if (key.startsWith(section + "_")) {
        imgFolder.file(`${key}.jpg`, blob);
      }
    }

    // --- Vidéos ---
    for (const [key, blob] of Object.entries(videosData)) {
      if (key.startsWith(section + "_")) {
        videoFolder.file(`${key}.mp4`, blob);
      }
    }

    // --- Audios (activités) ---
    for (const [key, data] of Object.entries(audiosData)) {
      if (!key.startsWith(section + "_")) continue;

      // 🎙️ Main audios
      if (data.main) audioFolder.file(`${key}_main.mp3`, data.main);
      if (data.exemple) audioFolder.file(`${key}_exemple.mp3`, data.exemple);
      if (data.feedback) audioFolder.file(`${key}_feedback.mp3`, data.feedback);

      // 🧩 Matching
      if (data.match) {
        for (const [subKey, blob] of Object.entries(data.match)) {
          audioFolder.file(`${key}_${subKey}.mp3`, blob);
        }
      }

      // 🧠 Flashcards
      if (data.flashcard) {
        if (data.flashcard.front)
          audioFolder.file(`${key}_front.mp3`, data.flashcard.front);
        if (data.flashcard.back)
          audioFolder.file(`${key}_back.mp3`, data.flashcard.back);
      }

      // 🧠 Simple lessons
      if (data.exprFr) audioFolder.file(`${key}_exprFr.mp3`, data.exprFr);
      if (data.example) audioFolder.file(`${key}_example.mp3`, data.example);

      // 📘 Complex lessons
      if (data.lesson) {
        for (const [lessonKey, blob] of Object.entries(data.lesson)) {
          const pathMatch = lessonKey.match(/(S\d+)_(\d+)_LessonTable_L(\d+)_C(\d+)/);
          if (pathMatch) {
            const sectionId = pathMatch[1];
            const exoNum = pathMatch[2];
            const ligne = pathMatch[3];
            const col = pathMatch[4];
            const fileName = `${sectionId}_EX${exoNum}_LessonTable_L${ligne}_C${col}.mp3`;
            audioFolder.file(fileName, blob);
          }
        }
      }
    }

    // --- 🔊 Recap audios ---
    if (recapAudiosData[section]) {
      for (const [index, blob] of Object.entries(recapAudiosData[section])) {
        audioFolder.file(`Recap_${index}.mp3`, blob);
      }
    }
  }

  // --- Return the JSZip object (not the Blob) ---
  return templateZip;
}

// =====================================================
// Quick Preview — Génération du package pour un seul exercice
// =====================================================
async function generateQuickPreviewPackage(id) {
  const data = buildSingleExerciseResult(id);
  const { S0, sectionsData, origMediaKey } = data;

  // Load the QuickPreview template
  const response = await fetch("Modele/Modele_QuickPreview.zip");
  if (!response.ok) throw new Error("Impossible de charger Modele_QuickPreview.zip !");
  const arrayBuffer = await response.arrayBuffer();
  const templateZip = await JSZip.loadAsync(arrayBuffer);
  const rootFolder = templateZip.folder("Ressources_Sequences");

  // S0
  rootFolder.folder("S0").file("variables.json", JSON.stringify(S0, null, 2));

  // S1 only (exercise remapped to EX1)
  const s1Folder = rootFolder.folder("S1");
  const imgFolder = s1Folder.folder("Images");
  const audioFolder = s1Folder.folder("Audios");
  const videoFolder = s1Folder.folder("Videos");
  s1Folder.file("variables.json", JSON.stringify(sectionsData.S1, null, 2));

  // Image (remap original key to S1_EX1)
  if (imagesData[origMediaKey]) {
    imgFolder.file("S1_EX1.jpg", imagesData[origMediaKey]);
  }

  // Video
  if (videosData[origMediaKey]) {
    videoFolder.file("S1_EX1.mp4", videosData[origMediaKey]);
  }

  // Audios
  const audioData = audiosData[origMediaKey];
  if (audioData) {
    if (audioData.main) audioFolder.file("S1_EX1_main.mp3", audioData.main);
    if (audioData.exemple) audioFolder.file("S1_EX1_exemple.mp3", audioData.exemple);
    if (audioData.feedback) audioFolder.file("S1_EX1_feedback.mp3", audioData.feedback);
    // Matching
    if (audioData.match) {
      for (const [subKey, blob] of Object.entries(audioData.match)) {
        audioFolder.file(`S1_EX1_${subKey}.mp3`, blob);
      }
    }
    // Flashcards
    if (audioData.flashcard) {
      if (audioData.flashcard.front) audioFolder.file("S1_EX1_front.mp3", audioData.flashcard.front);
      if (audioData.flashcard.back) audioFolder.file("S1_EX1_back.mp3", audioData.flashcard.back);
    }
    // Simple lessons
    if (audioData.exprFr) audioFolder.file("S1_EX1_exprFr.mp3", audioData.exprFr);
    if (audioData.example) audioFolder.file("S1_EX1_example.mp3", audioData.example);
    // Complex lessons
    if (audioData.lesson) {
      for (const [lessonKey, blob] of Object.entries(audioData.lesson)) {
        const pathMatch = lessonKey.match(/(S\d+)_(\d+)_LessonTable_L(\d+)_C(\d+)/);
        if (pathMatch) {
          audioFolder.file(`S1_EX1_LessonTable_L${pathMatch[3]}_C${pathMatch[4]}.mp3`, blob);
        }
      }
    }
  }

  // Empty S2-S4 variables.json
  for (const sec of ["S2", "S3", "S4"]) {
    rootFolder.folder(sec).file("variables.json", JSON.stringify({}, null, 2));
  }

  return templateZip;
}

// =====================================================
// Quick Preview — Lancement et fermeture
// =====================================================
async function quickPreview(id) {
  const btn = document.getElementById(`quickPreviewBtn_${id}`);
  const container = document.getElementById(`quickPreview_${id}`);
  const iframe = document.getElementById(`quickPreviewFrame_${id}`);
  if (!btn || !container || !iframe) return;

  // Close any existing quick preview first
  const openPreview = document.querySelector('[id^="quickPreview_"][data-package-id]');
  if (openPreview) {
    const openId = openPreview.id.replace('quickPreview_', '');
    closeQuickPreview(openId);
  }

  // Show loading state
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Chargement...';
  container.style.display = 'block';
  iframe.style.display = 'none';

  try {
    // Generate and upload
    const zipObject = await generateQuickPreviewPackage(id);
    const zipBlob = await zipObject.generateAsync({ type: 'blob' });
    const response = await fetch(`${SERVER_URL}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: zipBlob
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    const result = await response.json();
    if (!result.success) throw new Error(result.error || 'Upload failed');

    // Store packageId for cleanup
    container.dataset.packageId = result.packageId;

    // Load in iframe
    iframe.onload = () => { iframe.style.display = 'block'; };
    setTimeout(() => { iframe.style.display = 'block'; }, 2000);
    iframe.src = result.launchUrl;

    // Reset button
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Rafraichir Preview';

  } catch (error) {
    console.error('Quick Preview error:', error);
    container.style.display = 'none';
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-play-circle"></i> Quick Preview';
    alert('Erreur Quick Preview:\n' + error.message);
  }
}

function closeQuickPreview(id) {
  const container = document.getElementById(`quickPreview_${id}`);
  const iframe = document.getElementById(`quickPreviewFrame_${id}`);
  const btn = document.getElementById(`quickPreviewBtn_${id}`);

  // Cleanup server package
  const packageId = container?.dataset.packageId;
  if (packageId) {
    fetch(`${SERVER_URL}/delete/${packageId}`, { method: 'DELETE' }).catch(() => {});
    delete container.dataset.packageId;
  }

  // Reset UI
  if (iframe) { iframe.src = ''; iframe.style.display = 'none'; }
  if (container) container.style.display = 'none';
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-play-circle"></i> Quick Preview';
  }
}

//  Stockage de l'ID puis suppression
let currentPackageId = null;
function deleteCurrentPackage() {
  if (currentPackageId) {
    console.log('🗑️ Deleting package:', currentPackageId);
    
    const url = `${SERVER_URL}/delete/${currentPackageId}`;
    
    //  Try DELETE request with keepalive for page unload scenarios
    fetch(url, { 
      method: 'DELETE',
      keepalive: true  //  Ensures request completes even if page is closing
    })
    .then(response => response.json())
    .then(data => {
      console.log('✅ Cleanup response:', data.message);
    })
    .catch(err => {
      console.error('❌ Cleanup error:', err);
    });
    
    currentPackageId = null;
  }
}

//  Tous les cas où on envoit l'informations vers le serveur pour supprimer le preview
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('scormPlayerModal');  
  // 1. Cleanup on modal close (normal usage)
  if (modal) {
    modal.addEventListener('hidden.bs.modal', function () {
      console.log('🔒 Modal closed, cleaning up...');
      deleteCurrentPackage();
      // Clear iframe
      const iframe = document.getElementById('scormPlayerFrame');
      if (iframe) {
        iframe.src = '';
      }
    });
  }
  
  // 2. Cleanup on page unload (refresh, close tab, navigate away)
  window.addEventListener('beforeunload', function() {
    console.log('🔄 Page unloading, cleaning up...');
    deleteCurrentPackage();
  });
  
  // 3. Cleanup when opening a new preview (replaces old one)
  // This is handled in previewWithLocalServer() function
});



/*  ======  Gestion de l'UI avec la sidebar  ======  */
//  Global state
let currentView = 'welcome'; // 'welcome', 'section-overview', 'exercise', 'preview'
let currentSection = null;
let currentExerciseId = null;
let sortableInstances = {};
//  Section metadata
const sectionMetadata = {
  S1: {
    title: 'Section 1 : Découvre',
    desc: 'Introduction au thème, découverte des expressions clés.',
    icon: 'bi-1-circle',
    color: 'primary'
  },
  S2: {
    title: 'Section 2 : Pratique',
    desc: 'Mise en pratique guidée et compréhension orale.',
    icon: 'bi-2-circle',
    color: 'success'
  },
  S3: {
    title: 'Section 3 : Approfondis',
    desc: 'Consolidation des structures linguistiques.',
    icon: 'bi-3-circle',
    color: 'warning'
  },
  S4: {
    title: 'Section 4 : Consolide',
    desc: 'Révision, synthèse et automatisation des acquis.',
    icon: 'bi-4-circle',
    color: 'danger'
  }
};

//  ======  Gestion de ce qui est montré
//  Montre les informations globale de la section quand on clique sur la section
function showSectionOverview(sectionId) {
  console.log('📋 Showing section overview:', sectionId);
  currentView = 'section-overview';
  currentSection = sectionId;
  currentExerciseId = null;
  //  Cache les autres infos
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('section-overview').style.display = 'block';
  document.getElementById('exercise-view').style.display = 'none';
  document.getElementById('preview-section').style.display = 'none';
  // Montre les infos
  const metadata = sectionMetadata[sectionId];
  document.getElementById('overview-icon').className = `bi ${metadata.icon} text-${metadata.color} me-2`;
  document.getElementById('overview-title').textContent = metadata.title;
  document.getElementById('overview-description').textContent = metadata.desc; 
  //  Sync duration
  const durationInput = document.getElementById(`duration_${sectionId}`);
  if (durationInput) {
    document.getElementById('overview-duration').value = durationInput.value;
  }
  //  Update exercise count
  const container = document.getElementById(`exercices_${sectionId}`);
  const count = container ? container.children.length : 0;
  document.getElementById('overview-exercise-count').textContent = count;
  //  Store current section for add button
  document.getElementById('overview-add-btn').onclick = () => addExercice(sectionId);
  // Update sidebar
  updateSidebarState();
  autoExpandSection(sectionId);
}
//  Montre un exercice quand on clique dessus
function showExercise(sectionId, exerciseNum) {
  console.log('📝 Affichage de l\'exercice:', sectionId, exerciseNum);
  currentView = 'exercise';
  currentSection = sectionId;
  currentExerciseId = `${sectionId}_${exerciseNum}`;
  // 1. Masquer tous les écrans principaux
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('section-overview').style.display = 'none';
  document.getElementById('exercise-view').style.display = 'block';
  document.getElementById('preview-section').style.display = 'none';
  // 2. Afficher le conteneur de la section parente
  ['S1', 'S2', 'S3', 'S4'].forEach(s => {
    const sectionContainer = document.getElementById(`exercices_${s}`);
    if (sectionContainer) {
      sectionContainer.style.display = (s === sectionId) ? 'block' : 'none';
    }
  });
  // 3. Masquer TOUS les exercices, puis n'afficher que le sélectionné
  const allExercises = document.querySelectorAll('.exercice');
  allExercises.forEach(ex => {
    ex.style.display = 'none'; 
  });
  const targetExo = document.getElementById(`exo_${sectionId}_${exerciseNum}`);
  if (targetExo) {
    targetExo.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // 4. Mettre à jour l'état de la sidebar
  updateSidebarState();
  autoExpandSection(sectionId);
}
//  Montre les preview
function showPreview() {
  console.log('🐞 Showing preview');
  currentView = 'preview';
  currentSection = 'preview';
  currentExerciseId = null;
  // Hide all views
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('section-overview').style.display = 'none';
  document.getElementById('exercise-view').style.display = 'none';
  document.getElementById('preview-section').style.display = 'block';
  // Update sidebar
  updateSidebarState();
}

//  ======  Gestion de la barre sur le côté
//  Toggle section, et expand
function toggleSection(sectionId) {
  const header = document.querySelector(`.section-header[data-section="${sectionId}"]`);
  const list = document.getElementById(`nav-exercises-${sectionId}`);
  const addBtn = document.getElementById(`add-btn-${sectionId}`);
  if (!header || !list) return;
  const isExpanded = header.classList.contains('expanded');
  if (isExpanded) {
    // Collapse
    header.classList.remove('expanded');
    list.classList.remove('show');
    list.style.display = 'none';
    if (addBtn) addBtn.style.display = 'none';
  } else {
    // Expand
    header.classList.add('expanded');
    list.classList.add('show');
    list.style.display = 'block';
    if (addBtn) addBtn.style.display = 'block';
  }
}
//  Auto expand quand on ouvre une section
function autoExpandSection(sectionId) {
  const header = document.querySelector(`.section-header[data-section="${sectionId}"]`);
  if (header && !header.classList.contains('expanded')) {
    toggleSection(sectionId);
  }
}
//  Update des états dans la barre
function updateSidebarState() {
  // Clear all active states
  document.querySelectorAll('.section-header').forEach(h => h.classList.remove('active'));
  document.querySelectorAll('.exercise-list li').forEach(li => li.classList.remove('active'));
  // Set active section
  if (currentSection) {
    const header = document.querySelector(`.section-header[data-section="${currentSection}"]`);
    if (header) header.classList.add('active');
  }
  // Set active exercise
  if (currentView === 'exercise' && currentExerciseId) {
    const exerciseItem = document.querySelector(`.exercise-list li[data-exercise-id="${currentExerciseId}"]`);
    if (exerciseItem) exerciseItem.classList.add('active');
  }
}
//  Update de la liste d'exercices
function updateSidebarExerciseList() {
  const sections = ['S1', 'S2', 'S3', 'S4'];
  sections.forEach(section => {
    const navList = document.getElementById(`nav-exercises-${section}`);
    const container = document.getElementById(`exercices_${section}`);
    if (!navList || !container) return;
    const exercises = Array.from(container.children);
    // Clear list
    navList.innerHTML = '';
    // Add each exercise
    exercises.forEach((exerciseDiv, index) => {
      const exerciseNum = index + 1;
      const exerciseId = `${section}_${exerciseNum}`;
      // Get exercise type
      const typeSelect = exerciseDiv.querySelector('[id^="type_"]');
      let activityType = 'Exercise';
      if (typeSelect && typeSelect.value) {
        const config = activityTypesConfig[typeSelect.value];
        activityType = config ? config.label : typeSelect.value;
      }
      // Create list item
      const li = document.createElement('li');
      li.dataset.exerciseId = exerciseId;
      li.dataset.section = section;
      li.dataset.exerciseNum = exerciseNum;
      li.innerHTML = `
        <i class="bi bi-grip-vertical drag-handle"></i>
        <span class="flex-grow-1">
          <strong>Exercice ${exerciseNum}</strong>
          <span class="exercise-type">(${activityType})</span>
        </span>
        <button class="btn btn-sm btn-outline-danger delete-exercise" 
                onclick="deleteExerciseFromSidebar('${section}', ${exerciseNum}); event.stopPropagation();">
          <i class="bi bi-trash"></i>
        </button>
      `;
      li.onclick = (e) => {
        if (!e.target.closest('.delete-exercise')) {
          showExercise(section, exerciseNum);
        }
      };
      navList.appendChild(li);
    });  
    // Update add button visibility
    const addBtn = document.getElementById(`add-btn-${section}`);
    const header = document.querySelector(`.section-header[data-section="${section}"]`);
    if (addBtn && header && header.classList.contains('expanded')) {
      addBtn.style.display = exercises.length === 0 || header.classList.contains('expanded') ? 'block' : 'none';
    }
  });
  // Re-initialize sortable
  initializeSortable();
  // Update active states
  updateSidebarState();
}

//  ======  Gestion du drag and drop des exercices
//  Initialisation des sortables
function initializeSortable() {
  const sections = ['S1', 'S2', 'S3', 'S4'];  
  sections.forEach(section => {
    const list = document.getElementById(`nav-exercises-${section}`);
    if (!list) return;
    // Destroy existing instance
    if (sortableInstances[section]) {
      if (isDragging) {
        console.log('⏸️ Skipping re-init during drag');
        return;  // Don't destroy while dragging!
      }
      sortableInstances[section].destroy();
    }
    // Create new Sortable instance
    sortableInstances[section] = new Sortable(list, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      fallbackOnBody: true,      // Append to body (prevents clipping)
      swapThreshold: 0.65,       // More predictable swapping
      invertSwap: true,          // Better edge handling
      scroll: true,              // Enable auto-scroll
      scrollSensitivity: 30,     // Scroll when 30px from edge
      scrollSpeed: 10,           // Scroll speed
      bubbleScroll: true,        // Allow parent scrolling
      onStart: function(evt) {
        isDragging = true;
        //console.log('🎯 Drag started');
      },
      onEnd: function(evt) {
        isDragging = false;
        //console.log('✅ Drag ended');
        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;
        if (oldIndex === newIndex) return;
        //console.log(`🔄 Reordering ${section}: ${oldIndex} → ${newIndex}`);
        // Check if we're moving the currently selected exercise
        const wasCurrentlySelected = (currentView === 'exercise' && 
                                      currentSection === section && 
                                      currentExerciseId === `${section}_${oldIndex + 1}`);
        // Reorder in DOM
        const container = document.getElementById(`exercices_${section}`);
        if (!container) return;
        const exercises = Array.from(container.children);
        const movedExercise = exercises[oldIndex];
        // Remove and reinsert
        container.removeChild(movedExercise);
        if (newIndex >= exercises.length) {
          container.appendChild(movedExercise);
        } else {
          container.insertBefore(movedExercise, exercises[newIndex]);
        }
        // Reorder exercise numbers
        if (typeof reorderExercises === 'function') {
          reorderExercises(section);
        }
        // Update currentExerciseId if we moved the selected exercise
        if (wasCurrentlySelected) {
          const newExerciseNum = newIndex + 1;
          currentExerciseId = `${section}_${newExerciseNum}`;
          //console.log(`✅ Updated currentExerciseId to: ${currentExerciseId}`);
        }
        // Or if another exercise moved into/past the current position
        else if (currentView === 'exercise' && currentSection === section) {
          const currentNum = parseInt(currentExerciseId.split('_')[1]);
          // If something moved from before to after current (current shifts up)
          if (oldIndex < currentNum - 1 && newIndex >= currentNum - 1) {
            currentExerciseId = `${section}_${currentNum - 1}`;
            //console.log(`⬆️ Current exercise shifted up to: ${currentExerciseId}`);
          }
          // If something moved from after to before current (current shifts down)
          else if (oldIndex > currentNum - 1 && newIndex <= currentNum - 1) {
            currentExerciseId = `${section}_${currentNum + 1}`;
            //console.log(`⬇️ Current exercise shifted down to: ${currentExerciseId}`);
          }
        }
        // Update sidebar
        setTimeout(() => {
          updateSidebarExerciseList();
          updateSidebarState(); // Make sure active state reflects new position
        }, 100);
      }
    });
  });
}

//  ======  Gestion des exercices dans la barre
//  Ajout depuis l'overview (❓❓❓)
function addFromOverview() {
  if (currentSection) {
    addExercice(currentSection);
  }
}
//  Sync overview et hidden (❓❓❓)
function syncDuration() {
  if (currentSection) {
    const overviewDuration = document.getElementById('overview-duration');
    const hiddenDuration = document.getElementById(`duration_${currentSection}`);
    if (overviewDuration && hiddenDuration) {
      hiddenDuration.value = overviewDuration.value;
    }
  }
}
//  Supprime exercice dans la barre
function deleteExerciseFromSidebar(section, exerciseNum) {
  if (confirm(`Supprimer l'exercice ${exerciseNum} ?`)) {
    //console.log('🗑️ Deleting exercise:', section, exerciseNum);
    // Call the existing removeExercice function
    if (typeof removeExercice === 'function') {
      removeExercice(section, exerciseNum);
    }
    // Update sidebar
    setTimeout(() => {
      updateSidebarExerciseList();
      // If we deleted the current exercise, go back to overview
      if (currentView === 'exercise' && currentExerciseId === `${section}_${exerciseNum}`) {
        const container = document.getElementById(`exercices_${section}`);
        if (!container || container.children.length === 0) {
          showSectionOverview(section);
        } else {
          // Show first exercise
          showExercise(section, 1);
        }
      }
    }, 100);
  }
}

//  ======  FORCE la réécriture des fonctions ❓❓❓
// Store original addExercice function
const _originalAddExercice = typeof addExercice !== 'undefined' ? addExercice : null;
// Override addExercice to update sidebar
addExercice = function(section) {
  console.log('➕ Adding exercise to:', section);
  // Call original
  if (_originalAddExercice) {
    _originalAddExercice(section);
  }
  // Update sidebar and show new exercise
  setTimeout(() => {
    updateSidebarExerciseList(); 
    const container = document.getElementById(`exercices_${section}`);
    const exerciseCount = container ? container.children.length : 0;
    if (exerciseCount > 0) {
      showExercise(section, exerciseCount);
    }
  }, 100);
};

//  ======  Création d'un menu mobile (❓❓❓)
function createMobileMenu() {
  // Check if already exists
  if (document.querySelector('.mobile-menu-toggle')) return;
  // Create button
  const button = document.createElement('button');
  button.className = 'mobile-menu-toggle d-md-none';
  button.innerHTML = '<i class="bi bi-list"></i>';
  button.onclick = toggleMobileSidebar;
  document.body.appendChild(button);
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.onclick = toggleMobileSidebar;
  document.body.appendChild(overlay);
}
function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar-nav');
  const overlay = document.querySelector('.sidebar-overlay');

  if (sidebar) sidebar.classList.toggle('show');
  if (overlay) overlay.classList.toggle('show');
}



/*  ======  Initialisation du DOM  ======  */
// Add to existing DOMContentLoaded listener
document.addEventListener('DOMContentLoaded', () => {
  //console.log('🎨 Initializing sidebar navigation...');
  // Create mobile menu
  createMobileMenu();
  // Update sidebar every 2 seconds
  setInterval(() => {
    if (!isDragging) {
      updateSidebarExerciseList();
    }
  }, 2000);
  // Initial update
  updateSidebarExerciseList();
  //console.log('✅ Sidebar navigation initialized');
});
window.showSectionOverview = showSectionOverview;
window.showExercise = showExercise;
window.showPreview = showPreview;
window.toggleSection = toggleSection;
window.updateSidebarExerciseList = updateSidebarExerciseList;
window.deleteExerciseFromSidebar = deleteExerciseFromSidebar;
window.addFromOverview = addFromOverview;
window.syncDuration = syncDuration;



/*  ======  Attendre chargement du DOM (À VERIFIER)  ======  */
// ============================================================
// CONSOLIDATED DOMContentLoaded INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Application initializing...');
  // 1. DEV MODE INITIALIZATION
  const devSwitch = document.getElementById("devModeSwitch");
  if (devSwitch) {
    devSwitch.checked = false;
    toggleDevMode();
  }
  // 2. RECAP SECTIONS INITIALIZATION
  if (typeof initRecapSections === 'function') {
    initRecapSections();
  }
  // 3. CACHE MANAGEMENT UI
  if (devMode && typeof addCacheManagementUI === 'function') {
    addCacheManagementUI();
  }
  // 4. CACHE INFO CHECK
  setTimeout(() => {
    console.log('🔍 Cache check on startup:');
    if (typeof showCacheInfo === 'function') {
      const imageCount = Object.keys(imagesData || {}).length;
      const audioCount = Object.keys(audiosData || {}).length;
      const recapAudioCount = Object.keys(recapAudiosData || {}).length;
      console.log(`  📷 Images: ${imageCount}`);
      console.log(`  🔊 Audios: ${audioCount}`);
      console.log(`  🎙️ Recap audios: ${recapAudioCount}`);
    }
  }, 1000);
  // 5. COMPANY SESSION CHECK
  checkSessionStatus();
  console.log('✅ Application initialized');
});

// ============================================================
// 🃏  GÉNÉRATEUR DE JEU DE CARTES
// ============================================================

// ── Fixed-count mode ─────────────────────────────────────────
// Set to a number to lock all sections to that exact count (hides add/remove UI).
// Set to null to allow free-form add/remove.
const CARTES_FIXED_COUNT = 10;

let cartesCourtesIdCounter = 0;
let cartesLonguesIdCounter = 0;
let cartesRevisionIdCounter = 0;

// Audio blobs
const cartesAudioBlobs = {
  expressions:  {},  // courtesStableId → blob  (Courtes face arrière)
  longuesFront: {},  // longuesStableId  → blob  (Longues face avant)
  longuesDef:   {}   // longuesStableId  → blob  (Longues face arrière)
};

// Currently shown card per section (stable ID or null)
const currentCarteCardId = { courtes: null, longues: null, revision: null };
let _carteDragSrc = null; // { section, stableId }

// Selected visual theme for flashcard export (V3–V6)
let carteTheme = 'V6';

function setCarteTheme(version) {
  carteTheme = version;
  // Update theme picker cards
  ['V3','V4','V5','V6'].forEach(v => {
    const card = document.getElementById(`themeCard_${v}`);
    if (card) card.classList.toggle('active', v === version);
  });
  // Update sidebar label
  const label = document.getElementById('cartesThemeLabel');
  if (label) label.textContent = version;
}

// ── Show one card at a time ────────────────────────────────────
function showCarteCard(section, stableId) {
  const listIdMap    = { courtes: 'carteCourtesList',  longues: 'carteLonguesList',  revision: 'carteRevisionList' };
  const prefixMap    = { courtes: 'carteCourte_',      longues: 'carteLongue_',      revision: 'carteRevision_'    };
  const welcomeIdMap = { courtes: 'cartesWelcome_courtes', longues: 'cartesWelcome_longues', revision: 'cartesWelcome_revision' };

  const welcome = document.getElementById(welcomeIdMap[section]);
  const list    = document.getElementById(listIdMap[section]);

  if (!stableId) {
    // Show welcome, hide all cards
    if (welcome) welcome.style.display = 'block';
    if (list) [...list.children].forEach(c => c.style.display = 'none');
    currentCarteCardId[section] = null;
  } else {
    if (welcome) welcome.style.display = 'none';
    if (list) [...list.children].forEach(c => c.style.display = 'none');
    const card = document.getElementById(prefixMap[section] + stableId);
    if (card) card.style.display = 'block';
    currentCarteCardId[section] = stableId;
  }
  // Update active state in nav list
  const navList = document.getElementById(`cartesNavList_${section}`);
  if (navList) {
    [...navList.querySelectorAll('li')].forEach(li => {
      li.classList.toggle('active', parseInt(li.dataset.stableId) === stableId);
    });
  }
}

// ── Live nav label update on input ────────────────────────────
function updateCarteNavLabel(section, stableId) {
  const cfgMap = {
    courtes: { listId: 'carteCourtesList', prefix: 'carteCourte_', label: 'Carte',    textFn: (id) => document.getElementById(`carteCourteFront_${id}`)?.value?.trim() || '' },
    longues: { listId: 'carteLonguesList', prefix: 'carteLongue_', label: 'Carte',    textFn: (id) => document.getElementById(`carteLongueFrontText_${id}`)?.value?.trim() || '' }
  };
  const cfg = cfgMap[section];
  if (!cfg) return;
  const navList = document.getElementById(`cartesNavList_${section}`);
  if (!navList) return;
  const li = navList.querySelector(`[data-stable-id="${stableId}"]`);
  if (!li) return;
  const cards = [...document.querySelectorAll(`#${cfg.listId} [id^="${cfg.prefix}"]`)];
  const idx = cards.findIndex(c => parseInt(c.id.replace(cfg.prefix, '')) === stableId);
  if (idx === -1) return;
  const snippet = cfg.textFn(stableId);
  const label = snippet ? snippet.substring(0, 25) + (snippet.length > 25 ? '\u2026' : '') : '';
  const span = li.querySelector('span.flex-grow-1');
  if (span) {
    span.innerHTML =
      `<strong>${cfg.label} ${idx + 1}</strong>` +
      (label ? ` <span class="exercise-type">&ndash; ${label}</span>` : '');
  }
}

// ── Native drag-and-drop for cartes nav ───────────────────────
function _carteDragStart(e) {
  _carteDragSrc = {
    section: this.dataset.section,
    stableId: parseInt(this.dataset.stableId)
  };
  e.dataTransfer.effectAllowed = 'move';
  this.style.opacity = '0.4';
}

function _carteDragEnd() {
  _carteDragSrc = null;
  this.style.opacity = '';
  document.querySelectorAll('.carte-drop-zone.active').forEach(z => z.classList.remove('active'));
}

function _createCarteDropZone(section, insertIndex) {
  const dz = document.createElement('li');
  dz.className = 'carte-drop-zone';
  dz.dataset.section = section;
  dz.dataset.insertIndex = insertIndex;
  dz.addEventListener('dragover', function(e) {
    e.preventDefault();
    if (_carteDragSrc && _carteDragSrc.section === section) this.classList.add('active');
  });
  dz.addEventListener('dragleave', function() { this.classList.remove('active'); });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    this.classList.remove('active');
    if (!_carteDragSrc || _carteDragSrc.section !== section) return;
    _carteDropReorder(section, _carteDragSrc.stableId, parseInt(this.dataset.insertIndex));
  });
  return dz;
}

function _carteDropReorder(section, stableId, insertIndex) {
  const cfgMap = {
    courtes:  { listId: 'carteCourtesList',  prefix: 'carteCourte_',   numberFn: updateCarteCourteNumbers  },
    longues:  { listId: 'carteLonguesList',  prefix: 'carteLongue_',   numberFn: updateCarteLongueNumbers  },
    revision: { listId: 'carteRevisionList', prefix: 'carteRevision_', numberFn: updateCarteRevisionNumbers }
  };
  const cfg = cfgMap[section];
  if (!cfg) return;
  const contentList = document.getElementById(cfg.listId);
  if (!contentList) return;
  const cards = Array.from(contentList.children);
  const dragIdx = cards.findIndex(c => parseInt(c.id.replace(cfg.prefix, '')) === stableId);
  if (dragIdx === -1 || dragIdx === insertIndex || dragIdx + 1 === insertIndex) return;
  const moved = cards[dragIdx];
  contentList.removeChild(moved);
  const adjustedIdx = dragIdx < insertIndex ? insertIndex - 1 : insertIndex;
  const remaining = Array.from(contentList.children);
  contentList.insertBefore(moved, remaining[adjustedIdx] || null);
  cfg.numberFn();
  if (section === 'courtes') refreshCartesSelects();
  rebuildCartesNavList(section);
  showCarteCard(section, currentCarteCardId[section]);
}

// ── Tabs ──────────────────────────────────────────────────────
function showCartesTab(tab) {
  ['courtes', 'longues', 'revision', 'theme', 'generate'].forEach(t => {
    const el = document.getElementById(`cartesTab_${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`cartesSideBtn_${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
  });
}

// ── AI Generation ─────────────────────────────────────────────
let _aiGenExpressions = [];

function _aiSpinner(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.setProperty('display', show ? 'inline-block' : 'none', 'important');
}

async function aiGenerateExpressions() {
  const theme = document.getElementById('aiGenTheme')?.value?.trim();
  if (!theme) { alert('Veuillez saisir un thème.'); return; }
  const niveau = document.getElementById('aiGenNiveau')?.value || '3';
  const contraintes = document.getElementById('aiGenContraintes')?.value?.trim() || '';

  _aiSpinner('aiGenStep1Spinner', true);
  const btn1 = document.querySelector('#aiGenStep1 .btn-primary');
  if (btn1) btn1.disabled = true;

  try {
    const res = await fetch(`${SERVER_URL}/api/anthropic/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
      body: JSON.stringify({ step: 'expressions', niveau: parseInt(niveau), theme, contraintes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    _aiRenderExpressionsTable(data.expressions);
    document.getElementById('aiGenStep1').style.display = 'none';
    document.getElementById('aiGenStep2').style.display = 'block';
    document.getElementById('aiGenStep3').style.display = 'none';
  } catch (e) {
    alert(`Erreur : ${e.message}`);
  } finally {
    _aiSpinner('aiGenStep1Spinner', false);
    if (btn1) btn1.disabled = false;
  }
}

function _aiRenderExpressionsTable(expressions) {
  const container = document.getElementById('aiGenExpressionsTable');
  let html = `<div class="table-responsive"><table class="table table-bordered table-sm align-middle" style="font-size:14px;">
    <thead class="table-light"><tr>
      <th style="width:2.5rem;">#</th>
      <th>🇫🇷 Français <span class="fw-normal text-muted">(face arrière Courte)</span></th>
      <th>🇬🇧 Anglais <span class="fw-normal text-muted">(face avant Courte)</span></th>
    </tr></thead><tbody>`;
  expressions.forEach((e, i) => {
    html += `<tr>
      <td class="text-center text-muted fw-bold">${i + 1}</td>
      <td><input type="text" class="form-control form-control-sm border-0 bg-transparent ai-expr-fr" data-idx="${i}" value="${e.fr.replace(/"/g, '&quot;')}"></td>
      <td><input type="text" class="form-control form-control-sm border-0 bg-transparent ai-expr-en" data-idx="${i}" value="${e.en.replace(/"/g, '&quot;')}"></td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function _aiCollectExpressions() {
  return [...document.querySelectorAll('#aiGenExpressionsTable tbody tr')].map(row => ({
    fr: row.querySelector('.ai-expr-fr')?.value?.trim() || '',
    en: row.querySelector('.ai-expr-en')?.value?.trim() || ''
  }));
}

function aiBackToStep1() {
  document.getElementById('aiGenStep1').style.display = 'block';
  document.getElementById('aiGenStep2').style.display = 'none';
  document.getElementById('aiGenStep3').style.display = 'none';
}

function aiBackToStep2() {
  document.getElementById('aiGenStep2').style.display = 'block';
  document.getElementById('aiGenStep3').style.display = 'none';
}

async function aiGenerateSentences() {
  _aiGenExpressions = _aiCollectExpressions();
  if (_aiGenExpressions.some(e => !e.fr || !e.en)) {
    alert('Veuillez remplir toutes les expressions avant de continuer.');
    return;
  }
  const theme = document.getElementById('aiGenTheme')?.value?.trim() || '';
  const niveau = document.getElementById('aiGenNiveau')?.value || '3';
  const contraintes = document.getElementById('aiGenContraintes')?.value?.trim() || '';

  _aiSpinner('aiGenStep2Spinner', true);
  const btn2 = document.querySelector('#aiGenStep2 .btn-success');
  if (btn2) btn2.disabled = true;

  try {
    const res = await fetch(`${SERVER_URL}/api/anthropic/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
      body: JSON.stringify({ step: 'sentences', niveau: parseInt(niveau), theme, contraintes, expressions: _aiGenExpressions })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    _aiRenderSentencesTable(_aiGenExpressions, data.sentences);
    document.getElementById('aiGenStep2').style.display = 'none';
    document.getElementById('aiGenStep3').style.display = 'block';
  } catch (e) {
    alert(`Erreur : ${e.message}`);
  } finally {
    _aiSpinner('aiGenStep2Spinner', false);
    if (btn2) btn2.disabled = false;
  }
}

function _aiRenderSentencesTable(expressions, sentences) {
  const container = document.getElementById('aiGenSentencesTable');
  let html = '';
  expressions.forEach((e, i) => {
    const s = sentences[i] || { instruction: '', sentence: '' };
    html += `<div class="card mb-2 border-0" style="background:#f8f9fa;border-radius:8px;">
      <div class="card-body py-2 px-3">
        <div class="d-flex gap-3 align-items-start">
          <span class="badge bg-primary mt-1" style="min-width:1.6rem;text-align:center;">${i + 1}</span>
          <div class="flex-grow-1">
            <div class="small text-muted mb-1"><strong>${e.fr}</strong> &nbsp;·&nbsp; <em>${e.en}</em></div>
            <input type="text" class="form-control form-control-sm mb-1 ai-sent-instruction" data-idx="${i}"
              placeholder="Instruction (face avant Longue)" value="${(s.instruction || '').replace(/"/g, '&quot;')}">
            <textarea class="form-control form-control-sm ai-sent-sentence" data-idx="${i}" rows="2"
              placeholder="Phrase en contexte (face arrière Longue)">${s.sentence || ''}</textarea>
          </div>
        </div>
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

function aiPopulateCards() {
  const sentences = [...document.querySelectorAll('#aiGenSentencesTable .ai-sent-sentence')].map((el, i) => ({
    instruction: document.querySelector(`.ai-sent-instruction[data-idx="${i}"]`)?.value?.trim() || '',
    sentence: el.value.trim()
  }));

  if (!confirm('Cela va remplacer TOUT le contenu actuel des flashcards. Continuer ?')) return;

  // Clear existing cards and audio
  ['courtes', 'longues', 'revision'].forEach(section => {
    const ids = { courtes: 'carteCourtesList', longues: 'carteLonguesList', revision: 'carteRevisionList' };
    const list = document.getElementById(ids[section]);
    if (list) list.innerHTML = '';
    currentCarteCardId[section] = null;
    showCarteCard(section, null);
  });
  cartesCourtesIdCounter = 0;
  cartesLonguesIdCounter = 0;
  cartesRevisionIdCounter = 0;
  Object.keys(cartesAudioBlobs.expressions).forEach(k => delete cartesAudioBlobs.expressions[k]);
  Object.keys(cartesAudioBlobs.longuesFront).forEach(k => delete cartesAudioBlobs.longuesFront[k]);
  Object.keys(cartesAudioBlobs.longuesDef).forEach(k => delete cartesAudioBlobs.longuesDef[k]);

  // Set deck title + level from generation params
  const theme = document.getElementById('aiGenTheme')?.value?.trim() || '';
  const niveau = document.getElementById('aiGenNiveau')?.value || '3';
  const titleEl = document.getElementById('cartesDeckTitle');
  if (titleEl && !titleEl.value.trim()) titleEl.value = theme;
  const levelEl = document.getElementById('cartesDeckLevel');
  if (levelEl) levelEl.value = niveau;

  // Populate Courtes
  _aiGenExpressions.forEach(expr => {
    addCarteCourte();
    const id = cartesCourtesIdCounter;
    const frontEl = document.getElementById(`carteCourteFront_${id}`);
    const backEl  = document.getElementById(`carteCourteBack_${id}`);
    if (frontEl) frontEl.value = expr.en;
    if (backEl)  backEl.value  = expr.fr;
    updateCarteNavLabel('courtes', id);
  });

  // Populate Longues, link each to the matching Courte
  const courteCards = [...document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]')];
  sentences.forEach((s, i) => {
    addCarteLongue();
    const id = cartesLonguesIdCounter;
    const instrEl = document.getElementById(`carteLongueFrontText_${id}`);
    const sentEl  = document.getElementById(`carteLongueBack_${id}`);
    const refEl   = document.getElementById(`carteLongueFrontRef_${id}`);
    if (instrEl) instrEl.value = s.instruction;
    if (sentEl)  sentEl.value  = s.sentence;
    if (refEl && courteCards[i]) {
      refEl.value = parseInt(courteCards[i].id.replace('carteCourte_', ''));
      if (typeof updateCarteLongueFront === 'function') updateCarteLongueFront(id);
    }
    updateCarteNavLabel('longues', id);
  });

  // Populate Révision: each matching pairs the Courte expression with its Longue sentence
  courteCards.slice(0, 10).forEach((card, i) => {
    addCarteRevision();
    const id = cartesRevisionIdCounter;
    const courteStableId = parseInt(card.id.replace('carteCourte_', ''));
    const p1El = document.getElementById(`carteRevisionPaire1_${id}`);
    const p2El = document.getElementById(`carteRevisionPaire2_${id}`);
    if (p1El) p1El.value = courteStableId;
    if (p2El) p2El.value = courteStableId;
    if (typeof updateCarteRevisionInfo === 'function') updateCarteRevisionInfo(id);
  });

  ['courtes', 'longues', 'revision'].forEach(s => rebuildCartesNavList(s));

  showCartesTab('courtes');
  const first = document.querySelector('#carteCourtesList [id^="carteCourte_"]');
  if (first) showCarteCard('courtes', parseInt(first.id.replace('carteCourte_', '')));
}

// ── Extra UI helpers ──────────────────────────────────────────
function createCarteExtraUI(prefix) {
  return `
    <select id="carteExtraType_${prefix}" class="form-select form-select-sm mb-1" onchange="updateCarteExtraFields('${prefix}')">
      <option value="Aucune">Aucune</option>
      <option value="Phrases">Phrases</option>
      <option value="Expressions">Expressions</option>
    </select>
    <div id="carteExtraFields_${prefix}"></div>`;
}

function updateCarteExtraFields(prefix) {
  const type = document.getElementById(`carteExtraType_${prefix}`)?.value;
  const container = document.getElementById(`carteExtraFields_${prefix}`);
  if (!container) return;
  if (type === 'Phrases') {
    container.innerHTML = [1,2,3,4,5].map(i =>
      `<input type="text" id="carteExtraPhrase_${prefix}_${i}" class="form-control form-control-sm mb-1" placeholder="Phrase ${i}">`
    ).join('');
  } else if (type === 'Expressions') {
    container.innerHTML = [1,2,3,4,5].map(i => `
      <div class="row g-1 mb-1">
        <div class="col"><input type="text" id="carteExtraExpr_${prefix}_${i}" class="form-control form-control-sm" placeholder="Expression ${i}"></div>
        <div class="col"><input type="text" id="carteExtraExemple_${prefix}_${i}" class="form-control form-control-sm" placeholder="Exemple ${i}"></div>
      </div>`).join('');
  } else {
    container.innerHTML = '';
  }
}

function buildCarteExtraData(prefix) {
  const type = document.getElementById(`carteExtraType_${prefix}`)?.value || 'Aucune';
  if (type === 'Phrases') {
    const elements = [1,2,3,4,5]
      .map(i => document.getElementById(`carteExtraPhrase_${prefix}_${i}`)?.value?.trim())
      .filter(Boolean);
    return { Type: 'Phrases', Elements: elements };
  }
  if (type === 'Expressions') {
    const elements = [1,2,3,4,5].map(i => ({
      Expression: document.getElementById(`carteExtraExpr_${prefix}_${i}`)?.value?.trim() || '',
      Exemple: document.getElementById(`carteExtraExemple_${prefix}_${i}`)?.value?.trim() || ''
    })).filter(e => e.Expression);
    return { Type: 'Expressions', Elements: elements };
  }
  return { Type: 'Aucune' };
}

// ── Audio helpers ─────────────────────────────────────────────
function createCarteAudioButtons(audioType, stableId) {
  const inputId = `carteAudioInput_${audioType}_${stableId}`;
  return `
    <div class="d-flex gap-2 flex-wrap">
      <input type="file" accept="audio/*" id="${inputId}" style="display:none"
        onchange="handleCarteAudio(event,'${audioType}',${stableId})">
      <button class="btn btn-sm btn-outline-secondary" type="button"
        onclick="document.getElementById('${inputId}').click()">&#128193; Browse</button>
      <button class="btn btn-sm btn-outline-primary" type="button"
        onclick="openElevenLabsForCarte('${audioType}',${stableId})">&#127897;&#65039; G&#233;n&#233;rer</button>
      <button class="btn btn-sm btn-outline-danger" type="button"
        onclick="openRecorderForCarte('${audioType}',${stableId})" title="Exp&#233;rimental">&#9210; Enregistrer</button>
    </div>`;
}

function handleCarteAudio(event, audioType, stableId) {
  const file = event.target.files[0];
  if (!file) return;
  cartesAudioBlobs[audioType][stableId] = file;
  refreshCarteAudioPreview(audioType, stableId);
  if (audioType === 'expressions') refreshCarteLonguesFrontAudioInfo();
}

function openElevenLabsForCarte(audioType, stableId) {
  openElevenLabsModal(`CARTE_${audioType}_${stableId}`, (blob) => {
    cartesAudioBlobs[audioType][stableId] = blob;
    refreshCarteAudioPreview(audioType, stableId);
  });
}

function openRecorderForCarte(audioType, stableId) {
  const textMap = {
    expressions:  () => document.getElementById(`carteCourteBack_${stableId}`)?.value?.trim(),
    longuesFront: () => document.getElementById(`carteLongueFrontText_${stableId}`)?.value?.trim(),
    longuesDef:   () => document.getElementById(`carteLongueBack_${stableId}`)?.value?.trim()
  };
  const refText = textMap[audioType]?.() || '';
  openRecorderModal((blob) => {
    cartesAudioBlobs[audioType][stableId] = blob;
    refreshCarteAudioPreview(audioType, stableId);
  }, refText);
}

function refreshCarteAudioPreview(audioType, stableId) {
  const containerIdMap = {
    expressions:  `carteExprPreview_${stableId}`,
    longuesFront: `carteLongueFrontPreview_${stableId}`,
    longuesDef:   `carteLongueDefPreview_${stableId}`
  };
  const containerId = containerIdMap[audioType];
  if (containerId) {
    const container = document.getElementById(containerId);
    if (container) renderCarteAudioPreview(container, audioType, stableId);
  }
}

function renderCarteAudioPreview(container, audioType, stableId) {
  const blob = cartesAudioBlobs[audioType][stableId];
  if (!blob) { container.innerHTML = ''; return; }
  const url = URL.createObjectURL(blob);
  container.innerHTML = `
    <div class="d-flex align-items-center gap-2 mt-1">
      <audio controls src="${url}" style="height:32px; flex:1;"></audio>
      <button type="button" class="btn btn-sm btn-outline-danger"
        onclick="deleteCarteAudio('${audioType}',${stableId})">&#10060;</button>
    </div>`;
}

function deleteCarteAudio(audioType, stableId) {
  delete cartesAudioBlobs[audioType][stableId];
  refreshCarteAudioPreview(audioType, stableId);
}

// ── Flashcards Courtes ────────────────────────────────────────
function addCarteCourte() {
  if (CARTES_FIXED_COUNT !== null &&
      document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]').length >= CARTES_FIXED_COUNT) return;
  cartesCourtesIdCounter++;
  const id = cartesCourtesIdCounter;
  const list = document.getElementById('carteCourtesList');
  const div = document.createElement('div');
  div.id = `carteCourte_${id}`;
  div.className = 'card mb-3';
  div.innerHTML = `
    <div class="card-header d-flex justify-content-between align-items-center py-2">
      <strong class="carte-number">Carte ?</strong>
      ${CARTES_FIXED_COUNT === null ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="removeCarteCourte(${id})">&#10060;</button>` : ''}
    </div>
    <div class="card-body">
      <div class="mb-2">
        <label class="form-label small fw-bold">Consigne</label>
        <input type="text" id="carteCourteConsigne_${id}" class="form-control form-control-sm" value="Traduisez en fran&#231;ais">
      </div>
      <div class="row g-2 mb-2">
        <div class="col-md-6">
          <label class="form-label small fw-bold">Face avant <span class="fw-normal text-muted">(anglais)</span></label>
          <textarea id="carteCourteFront_${id}" class="form-control form-control-sm" rows="2" placeholder="English expression..."
            oninput="updateCarteNavLabel('courtes',${id})"></textarea>
          <button type="button" class="btn btn-sm btn-outline-info mt-1 py-0 px-2" style="font-size:0.75rem;"
            onclick="translateCarteCourte(${id})">&#127760; Traduire depuis la face arri&#232;re</button>
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-bold">Face arri&#232;re <span class="fw-normal text-muted">(fran&#231;ais)</span></label>
          <textarea id="carteCourteBack_${id}" class="form-control form-control-sm" rows="2"
            placeholder="Expression fran&#231;aise..."></textarea>
        </div>
      </div>
      <div class="mb-2">
        <label class="form-label small fw-bold">Audio face arri&#232;re <span class="fw-normal text-muted">(expression fran&#231;aise)</span></label>
        ${createCarteAudioButtons('expressions', id)}
        <div id="carteExprPreview_${id}"></div>
      </div>
      <div class="mb-2">
        <label class="form-label small fw-bold">Extra</label>
        ${createCarteExtraUI(`C${id}`)}
      </div>
    </div>`;
  div.style.display = 'none';
  list.appendChild(div);
  updateCarteCourteNumbers();
  refreshCartesSelects();
  rebuildCartesNavList('courtes');
  autoExpandCartesSection('courtes');
  showCarteCard('courtes', id);
}

function removeCarteCourte(id) {
  if (CARTES_FIXED_COUNT !== null) return;
  const list = document.getElementById('carteCourtesList');
  const card = document.getElementById(`carteCourte_${id}`);
  let nextId = null;
  if (list && card) {
    const sibling = card.nextElementSibling || card.previousElementSibling;
    if (sibling) nextId = parseInt(sibling.id.replace('carteCourte_', ''));
  }
  card?.remove();
  document.querySelectorAll('[id^="carteLongueFrontRef_"]').forEach(select => {
    if (parseInt(select.value) === id) {
      select.value = '';
      updateCarteLongueFront(select.id.replace('carteLongueFrontRef_', ''));
    }
  });
  updateCarteCourteNumbers();
  refreshCartesSelects();
  rebuildCartesNavList('courtes');
  showCarteCard('courtes', nextId);
}

function updateCarteCourteNumbers() {
  document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]').forEach((card, idx) => {
    const num = card.querySelector('.carte-number');
    if (num) num.textContent = `Carte ${idx + 1}`;
  });
}

async function translateCarteCourte(id) {
  const backEl  = document.getElementById(`carteCourteBack_${id}`);
  const frontEl = document.getElementById(`carteCourteFront_${id}`);
  if (!backEl || !frontEl) return;
  const text = backEl.value.trim();
  if (!text) { alert('La face arrière est vide — rien à traduire.'); return; }
  const btn = document.querySelector(`#carteCourte_${id} button[onclick="translateCarteCourte(${id})"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const res = await fetch(`${SERVER_URL}/api/deepl/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({ text, target_lang: 'EN' })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erreur ${res.status}`);
    }
    const data = await res.json();
    const translated = data?.translations?.[0]?.text;
    if (!translated) throw new Error('Réponse inattendue de DeepL.');
    frontEl.value = translated;
    frontEl.dispatchEvent(new Event('input'));
  } catch (e) {
    alert(`Traduction échouée : ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#127760; Traduire'; }
  }
}

// ── Flashcards Longues ────────────────────────────────────────
function addCarteLongue() {
  if (CARTES_FIXED_COUNT !== null &&
      document.querySelectorAll('#carteLonguesList [id^="carteLongue_"]').length >= CARTES_FIXED_COUNT) return;
  cartesLonguesIdCounter++;
  const id = cartesLonguesIdCounter;
  const list = document.getElementById('carteLonguesList');
  const div = document.createElement('div');
  div.id = `carteLongue_${id}`;
  div.className = 'card mb-3';
  div.innerHTML = `
    <div class="card-header d-flex justify-content-between align-items-center py-2">
      <strong class="carte-number">Carte ?</strong>
      ${CARTES_FIXED_COUNT === null ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="removeCarteLongue(${id})">&#10060;</button>` : ''}
    </div>
    <div class="card-body">
      <div class="mb-2">
        <label class="form-label small fw-bold">Consigne</label>
        <input type="text" id="carteLongueConsigne_${id}" class="form-control form-control-sm" value="Mettez l'expression dans une phrase">
      </div>
      <div class="mb-3 p-2 border rounded bg-light">
        <label class="form-label small fw-bold">Lien Révision <span class="fw-normal text-muted">(association pour le matching)</span></label>
        <select id="carteLongueFrontRef_${id}" class="form-select form-select-sm mb-1"
          onchange="updateCarteLongueFront(${id})">
          <option value="">&#8212; Associer &#224; une carte Courte &#8212;</option>
        </select>
        <div id="carteLongueFrontAudioInfo_${id}" class="small text-muted"></div>
      </div>
      <div class="mb-2">
        <label class="form-label small fw-bold">Face avant <span class="fw-normal text-muted">(texte)</span></label>
        <input type="text" id="carteLongueFrontText_${id}" class="form-control form-control-sm mb-1"
          placeholder="Texte de la face avant (pr&#233;-rempli depuis Courtes, modifiable)"
          oninput="updateCarteNavLabel('longues',${id})">
        <label class="form-label small fw-bold mt-1">Audio face avant</label>
        ${createCarteAudioButtons('longuesFront', id)}
        <div id="carteLongueFrontPreview_${id}"></div>
      </div>
      <div class="mb-2">
        <label class="form-label small fw-bold">Face arri&#232;re <span class="fw-normal text-muted">(phrase)</span></label>
        <textarea id="carteLongueBack_${id}" class="form-control form-control-sm" rows="2"
          placeholder="La phrase compl&#232;te avec l'expression..."
          oninput="updateCarteNavLabel('longues',${id})"></textarea>
        <label class="form-label small fw-bold mt-1">Audio face arri&#232;re</label>
        ${createCarteAudioButtons('longuesDef', id)}
        <div id="carteLongueDefPreview_${id}"></div>
      </div>
      <div class="mb-2">
        <label class="form-label small fw-bold">Extra</label>
        ${createCarteExtraUI(`L${id}`)}
      </div>
    </div>`;
  div.style.display = 'none';
  list.appendChild(div);
  updateCarteLongueNumbers();
  refreshCarteLongueSelects(id);
  rebuildCartesNavList('longues');
  autoExpandCartesSection('longues');
  showCarteCard('longues', id);
}

function removeCarteLongue(id) {
  if (CARTES_FIXED_COUNT !== null) return;
  const list = document.getElementById('carteLonguesList');
  const card = document.getElementById(`carteLongue_${id}`);
  let nextId = null;
  if (list && card) {
    const sibling = card.nextElementSibling || card.previousElementSibling;
    if (sibling) nextId = parseInt(sibling.id.replace('carteLongue_', ''));
  }
  card?.remove();
  updateCarteLongueNumbers();
  rebuildCartesNavList('longues');
  showCarteCard('longues', nextId);
}

function updateCarteLongueNumbers() {
  document.querySelectorAll('#carteLonguesList [id^="carteLongue_"]').forEach((card, idx) => {
    const num = card.querySelector('.carte-number');
    if (num) num.textContent = `Carte ${idx + 1}`;
  });
}

function updateCarteLongueFront(id) {
  const select   = document.getElementById(`carteLongueFrontRef_${id}`);
  const textInput = document.getElementById(`carteLongueFrontText_${id}`);
  const info     = document.getElementById(`carteLongueFrontAudioInfo_${id}`);
  const refId    = parseInt(select?.value);

  if (!refId) {
    if (info) info.innerHTML = '';
    return;
  }
  // Pre-fill text only if the field is still empty
  if (textInput && !textInput.value.trim()) {
    textInput.value = document.getElementById(`carteCourteBack_${refId}`)?.value || '';
  }
  // Show link status
  const courtes = [...document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]')];
  const pos = courtes.findIndex(c => parseInt(c.id.replace('carteCourte_', '')) === refId);
  if (info) info.innerHTML = pos >= 0
    ? `<span class="text-success">&#10003; Li&#233;e &#224; Carte Courte ${pos + 1}</span>`
    : '';
}

function refreshCarteLonguesFrontText(courtesId) {
  const newText = document.getElementById(`carteCourteBack_${courtesId}`)?.value || '';
  document.querySelectorAll('[id^="carteLongueFrontRef_"]').forEach(select => {
    if (parseInt(select.value) === courtesId) {
      const tid = select.id.replace('carteLongueFrontRef_', '');
      const textInput = document.getElementById(`carteLongueFrontText_${tid}`);
      if (textInput) textInput.value = newText;
    }
  });
}

function refreshCarteLonguesFrontAudioInfo() {
  document.querySelectorAll('[id^="carteLongueFrontRef_"]').forEach(select => {
    const refId = parseInt(select.value);
    if (!refId) return;
    const tid = select.id.replace('carteLongueFrontRef_', '');
    const audioInfo = document.getElementById(`carteLongueFrontAudioInfo_${tid}`);
    if (!audioInfo) return;
    const hasExpr = !!cartesAudioBlobs.expressions[refId];
    audioInfo.innerHTML = hasExpr
      ? '&#128266; Audio li&#233; : <span class="text-success">&#10003; disponible (depuis Courtes)</span>'
      : '&#128266; Audio li&#233; : <span class="text-warning">&#9888;&#65039; pas encore enregistr&#233; dans Courtes</span>';
  });
}

// ── Révision ──────────────────────────────────────────────────
function addCarteRevision() {
  if (CARTES_FIXED_COUNT !== null &&
      document.querySelectorAll('#carteRevisionList [id^="carteRevision_"]').length >= CARTES_FIXED_COUNT) return;
  cartesRevisionIdCounter++;
  const id = cartesRevisionIdCounter;
  const list = document.getElementById('carteRevisionList');
  const div = document.createElement('div');
  div.id = `carteRevision_${id}`;
  div.className = 'card mb-3';
  div.innerHTML = `
    <div class="card-header d-flex justify-content-between align-items-center py-2">
      <strong class="carte-number">Matching ?</strong>
      ${CARTES_FIXED_COUNT === null ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="removeCarteRevision(${id})">&#10060;</button>` : ''}
    </div>
    <div class="card-body">
      <div class="mb-2">
        <label class="form-label small fw-bold">Consigne</label>
        <input type="text" id="carteRevisionConsigne_${id}" class="form-control form-control-sm"
          value="Associez chaque expression &#224; sa d&#233;finition">
      </div>
      <div class="row g-2">
        <div class="col-md-6">
          <label class="form-label small fw-bold">Paire 1</label>
          <select id="carteRevisionPaire1_${id}" class="form-select form-select-sm mb-1"
            onchange="updateCarteRevisionInfo(${id})">
            <option value="">&#8212; Expression 1 &#8212;</option>
          </select>
          <div id="carteRevisionInfo1_${id}" class="small text-muted"></div>
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-bold">Paire 2</label>
          <select id="carteRevisionPaire2_${id}" class="form-select form-select-sm mb-1"
            onchange="updateCarteRevisionInfo(${id})">
            <option value="">&#8212; Expression 2 &#8212;</option>
          </select>
          <div id="carteRevisionInfo2_${id}" class="small text-muted"></div>
        </div>
      </div>
    </div>`;
  div.style.display = 'none';
  list.appendChild(div);
  updateCarteRevisionNumbers();
  refreshCarteRevisionSelects(id);
  rebuildCartesNavList('revision');
  autoExpandCartesSection('revision');
  showCarteCard('revision', id);
}

function removeCarteRevision(id) {
  if (CARTES_FIXED_COUNT !== null) return;
  const list = document.getElementById('carteRevisionList');
  const card = document.getElementById(`carteRevision_${id}`);
  let nextId = null;
  if (list && card) {
    const sibling = card.nextElementSibling || card.previousElementSibling;
    if (sibling) nextId = parseInt(sibling.id.replace('carteRevision_', ''));
  }
  card?.remove();
  updateCarteRevisionNumbers();
  rebuildCartesNavList('revision');
  showCarteCard('revision', nextId);
}

function updateCarteRevisionNumbers() {
  document.querySelectorAll('#carteRevisionList [id^="carteRevision_"]').forEach((card, idx) => {
    const num = card.querySelector('.carte-number');
    if (num) num.textContent = `Matching ${idx + 1}`;
  });
}

function updateCarteRevisionInfo(id) {
  [1, 2].forEach(p => {
    const select = document.getElementById(`carteRevisionPaire${p}_${id}`);
    const info = document.getElementById(`carteRevisionInfo${p}_${id}`);
    if (!select || !info) return;
    const refId = parseInt(select.value);
    if (!refId) { info.innerHTML = ''; return; }
    const expr = document.getElementById(`carteCourteBack_${refId}`)?.value || '?';
    const hasExpr = !!cartesAudioBlobs.expressions[refId];
    const { lId: linkedLId } = _findLinkedLongue(refId);
    const hasDef = linkedLId ? !!cartesAudioBlobs.longuesDef[linkedLId] : false;
    info.innerHTML = `<em>${expr}</em> &mdash;
      Expr: ${hasExpr ? '<span class="text-success">&#10003;</span>' : '<span class="text-danger">&#10007;</span>'}
      D&#233;f: ${hasDef ? '<span class="text-success">&#10003;</span>' : '<span class="text-danger">&#10007;</span>'}`;
  });
  rebuildCartesNavList('revision');
}

// ── Select refresh ────────────────────────────────────────────
function refreshCartesSelects() {
  document.querySelectorAll('[id^="carteLongueFrontRef_"]').forEach(select => {
    refreshCarteLongueSelects(select.id.replace('carteLongueFrontRef_', ''));
  });
  document.querySelectorAll('#carteRevisionList [id^="carteRevision_"]').forEach(card => {
    refreshCarteRevisionSelects(card.id.replace('carteRevision_', ''));
  });
}

function getCarteCourteOptions(currentVal) {
  const cards = document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]');
  let opts = '<option value="">&#8212; S&#233;lectionner &#8212;</option>';
  cards.forEach((card, idx) => {
    const sId = parseInt(card.id.replace('carteCourte_', ''));
    const backText = document.getElementById(`carteCourteBack_${sId}`)?.value?.trim() || '';
    const label = `Carte ${idx + 1}${backText ? ' \u2013 ' + backText.substring(0, 28) : ''}`;
    opts += `<option value="${sId}"${parseInt(currentVal) === sId ? ' selected' : ''}>${label}</option>`;
  });
  return opts;
}

function refreshCarteLongueSelects(id) {
  const select = document.getElementById(`carteLongueFrontRef_${id}`);
  if (!select) return;
  select.innerHTML = getCarteCourteOptions(select.value);
}

function refreshCarteRevisionSelects(id) {
  [1, 2].forEach(p => {
    const select = document.getElementById(`carteRevisionPaire${p}_${id}`);
    if (!select) return;
    const cur = select.value;
    const cards = document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]');
    let opts = `<option value="">&#8212; Expression ${p} &#8212;</option>`;
    cards.forEach((card, idx) => {
      const sId = parseInt(card.id.replace('carteCourte_', ''));
      const backText = document.getElementById(`carteCourteBack_${sId}`)?.value?.trim() || '';
      const label = `Carte ${idx + 1}${backText ? ' \u2013 ' + backText.substring(0, 28) : ''}`;
      opts += `<option value="${sId}"${parseInt(cur) === sId ? ' selected' : ''}>${label}</option>`;
    });
    select.innerHTML = opts;
  });
}

// ── Build ZIP (shared between export and preview) ─────────────
async function _buildCartesZip() {
  const templatePath = 'Modele/Modele_Flashcards.zip';
  const response = await fetch(templatePath);
  if (!response.ok) throw new Error(`Impossible de charger ${templatePath} !`);
  const arrayBuffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const courteCards = [...document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]')];
  const stableToPos = {};
  courteCards.forEach((card, idx) => {
    stableToPos[parseInt(card.id.replace('carteCourte_', ''))] = idx + 1;
  });

  // Metadata (Title, Level, Theme, card counts, durations)
  const courteCount  = document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]').length;
  const longueCount  = document.querySelectorAll('#carteLonguesList [id^="carteLongue_"]').length;
  const revisionCount = document.querySelectorAll('#carteRevisionList [id^="carteRevision_"]').length;
  const metaJSON = {
    Titre: document.getElementById('cartesDeckTitle')?.value?.trim() || '',
    Niveau: document.getElementById('cartesDeckLevel')?.value || '1',
    Theme: carteTheme,
    FC_Courtes_Total: courteCount,
    FC_Longues_Total: longueCount,
    FC_Revision_Total: revisionCount,
    Durations: {
      Courtes:  parseInt(document.getElementById('cartesDurationCourtes')?.value)  || 5,
      Longues:  parseInt(document.getElementById('cartesDurationLongues')?.value)  || 10,
      Revision: parseInt(document.getElementById('cartesDurationRevision')?.value) || 5
    }
  };
  zip.file('Ressources_FCs/S0/variables.json', JSON.stringify(metaJSON, null, 2));

  // Courtes JSON
  const courtesJSON = {};
  courteCards.forEach((card, idx) => {
    const sId = parseInt(card.id.replace('carteCourte_', ''));
    const pos = idx + 1;
    courtesJSON[`Card${pos}`] = {
      Consigne: document.getElementById(`carteCourteConsigne_${sId}`)?.value || '',
      Front_Text: document.getElementById(`carteCourteFront_${sId}`)?.value || '',
      Back_Text: document.getElementById(`carteCourteBack_${sId}`)?.value || '',
      Back_Audio: cartesAudioBlobs.expressions[sId] ? `Ressources_FCs/Audios/Expressions/FC_${pos}.mp3` : '',
      Extra: buildCarteExtraData(`C${sId}`)
    };
    if (cartesAudioBlobs.expressions[sId])
      zip.file(`Ressources_FCs/Audios/Expressions/FC_${pos}.mp3`, cartesAudioBlobs.expressions[sId]);
  });
  zip.file('Ressources_FCs/Flashcards_Courtes/variables.json', JSON.stringify(courtesJSON, null, 2));

  // Longues JSON
  const longueCards = [...document.querySelectorAll('#carteLonguesList [id^="carteLongue_"]')];
  const longuesJSON = {};
  longueCards.forEach((card, idx) => {
    const lId = parseInt(card.id.replace('carteLongue_', ''));
    const pos = idx + 1;
    const refId = parseInt(document.getElementById(`carteLongueFrontRef_${lId}`)?.value) || 0;
    const frontAudioPath = cartesAudioBlobs.longuesFront[lId] ? `Ressources_FCs/Audios/LonguesFront/FC_${pos}.mp3` : '';
    const defAudioPath   = cartesAudioBlobs.longuesDef[lId]   ? `Ressources_FCs/Audios/LonguesDef/FC_${pos}.mp3`   : '';
    longuesJSON[`Card${pos}`] = {
      Consigne:   document.getElementById(`carteLongueConsigne_${lId}`)?.value || '',
      Front_Text: document.getElementById(`carteLongueFrontText_${lId}`)?.value || '',
      Front_Audio: frontAudioPath,
      Back_Text:  document.getElementById(`carteLongueBack_${lId}`)?.value || '',
      Back_Audio:  defAudioPath,
      Courte_Ref: refId || '',
      Extra: buildCarteExtraData(`L${lId}`)
    };
    if (cartesAudioBlobs.longuesFront[lId])
      zip.file(`Ressources_FCs/Audios/LonguesFront/FC_${pos}.mp3`, cartesAudioBlobs.longuesFront[lId]);
    if (cartesAudioBlobs.longuesDef[lId])
      zip.file(`Ressources_FCs/Audios/LonguesDef/FC_${pos}.mp3`, cartesAudioBlobs.longuesDef[lId]);
  });
  zip.file('Ressources_FCs/Flashcards_Longues/variables.json', JSON.stringify(longuesJSON, null, 2));

  // Révision JSON
  const revisionCards = [...document.querySelectorAll('#carteRevisionList [id^="carteRevision_"]')];
  const revisionJSON = {};
  revisionCards.forEach((card, idx) => {
    const rId = parseInt(card.id.replace('carteRevision_', ''));
    const pos = idx + 1;
    const ref1 = parseInt(document.getElementById(`carteRevisionPaire1_${rId}`)?.value);
    const ref2 = parseInt(document.getElementById(`carteRevisionPaire2_${rId}`)?.value);
    const pos1 = stableToPos[ref1] || 0;
    const pos2 = stableToPos[ref2] || 0;
    const { pos: lPos1 } = _findLinkedLongue(ref1);
    const { pos: lPos2 } = _findLinkedLongue(ref2);
    revisionJSON[`Matching${pos}`] = {
      Consigne: document.getElementById(`carteRevisionConsigne_${rId}`)?.value || '',
      Paire_1: {
        Audio_Definition: {
          fichier: lPos1 ? `Ressources_FCs/Audios/LonguesDef/FC_${lPos1}.mp3` : '',
          transcription: _findLongueBackText(ref1)
        },
        Audio_Expression: {
          fichier: pos1 ? `Ressources_FCs/Audios/Expressions/FC_${pos1}.mp3` : '',
          transcription: ref1 ? (document.getElementById(`carteCourteBack_${ref1}`)?.value || '') : ''
        }
      },
      Paire_2: {
        Audio_Definition: {
          fichier: lPos2 ? `Ressources_FCs/Audios/LonguesDef/FC_${lPos2}.mp3` : '',
          transcription: _findLongueBackText(ref2)
        },
        Audio_Expression: {
          fichier: pos2 ? `Ressources_FCs/Audios/Expressions/FC_${pos2}.mp3` : '',
          transcription: ref2 ? (document.getElementById(`carteCourteBack_${ref2}`)?.value || '') : ''
        }
      }
    };
  });
  zip.file('Ressources_FCs/Flashcards_Revision/variables.json', JSON.stringify(revisionJSON, null, 2));

  // Replace decorative images if a non-default theme is chosen
  if (carteTheme !== 'V6') {
    const themePath = `Modele/Images_Flashcards/${carteTheme}`;
    const courteImgs = [
      '5W58HS3AJ2E.jpg','5bkEbV55pos.jpg','5xBSyQMS7Ic.jpg','67PxTV5Wyu0.jpg',
      '6JWEZOTKGDz.jpg','6Jtn6Gp9v28.jpg','6YJF9zix7qV.jpg','6nd6yWucSra.jpg',
      '6oUVHWzbjDV.jpg','6qKHdzJvoip.jpg'
    ];
    const longueImgs = [
      '5k3S7tf1xGz.jpg','5pFIufFFQCw.jpg','5wLYLITyPRS.jpg','5xWwdJe0lwW.jpg',
      '5zgnc47DEJA.jpg','6CV1mLuHSdn.jpg','6LXazCjYi03.jpg','6cy2aWU9b9p.jpg',
      '6g5yBoSmkqY.jpg','6qWyu3z3UaV.jpg'
    ];
    const replaceImages = async (subFolder, filenames) => {
      for (const name of filenames) {
        const r = await fetch(`${themePath}/${subFolder}/${name}`);
        if (r.ok) {
          const buf = await r.arrayBuffer();
          zip.file(`mobile/${name}`, buf);
        }
      }
    };
    await replaceImages('Flashcards_Courtes', courteImgs);
    await replaceImages('Flashcards_Longues', longueImgs);
  }

  return zip;
}

// ── Export ────────────────────────────────────────────────────
async function exportCartes() {
  try {
    const zip = await _buildCartesZip();
    const blob = await zip.generateAsync({ type: 'blob' });
    const title = document.getElementById('cartesDeckTitle')?.value?.trim();
    const filename = title ? `${title}.zip` : 'Modele_Flashcards.zip';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  } catch (e) {
    alert(e.message);
  }
}

// ── Preview ───────────────────────────────────────────────────
async function previewCartes() {
  deleteCurrentPackage();
  const modal = new bootstrap.Modal(document.getElementById('scormPlayerModal'));
  modal.show();
  const loadingDiv = document.getElementById('scormLoading');
  const iframe = document.getElementById('scormPlayerFrame');
  if (loadingDiv) loadingDiv.style.cssText = 'display: flex !important;';
  if (iframe) iframe.style.display = 'none';
  try {
    updateLoadingStatus('Génération du package Flashcards...', 20);
    const zipObject = await _buildCartesZip();
    updateLoadingStatus('Préparation du fichier...', 40);
    const zipBlob = await zipObject.generateAsync({ type: 'blob' });
    updateLoadingStatus('Upload vers le serveur...', 60);
    const response = await fetch(`${SERVER_URL}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: zipBlob
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    const result = await response.json();
    if (!result.success) throw new Error(result.error || 'Upload failed');
    currentPackageId = result.packageId;
    updateLoadingStatus('Chargement du contenu...', 90);
    iframe.onload = function() {
      if (loadingDiv) loadingDiv.style.cssText = 'display: none !important;';
      if (iframe) iframe.style.display = 'block';
    };
    setTimeout(() => {
      if (loadingDiv) loadingDiv.style.cssText = 'display: none !important;';
      if (iframe) iframe.style.display = 'block';
    }, 2000);
    iframe.src = result.launchUrl;
  } catch (error) {
    console.error('❌ Preview cartes error:', error);
    if (loadingDiv) loadingDiv.style.cssText = 'display: none !important;';
    deleteCurrentPackage();
    let errorMsg = '❌ Erreur:\n\n' + error.message;
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMsg += '\n\nLe serveur local ne semble pas démarré.';
    }
    alert(errorMsg);
    modal.hide();
  }
}

// Returns { lId, pos } of the Longue card linked to a given Courte stableId (or zeroes)
function _findLinkedLongue(courtesStableId) {
  if (!courtesStableId) return { lId: 0, pos: 0 };
  const longueCards = [...document.querySelectorAll('#carteLonguesList [id^="carteLongue_"]')];
  for (let i = 0; i < longueCards.length; i++) {
    const lId = parseInt(longueCards[i].id.replace('carteLongue_', ''));
    if (parseInt(document.getElementById(`carteLongueFrontRef_${lId}`)?.value) === courtesStableId)
      return { lId, pos: i + 1 };
  }
  return { lId: 0, pos: 0 };
}

function _findLongueBackText(courtesStableId) {
  if (!courtesStableId) return '';
  let found = '';
  document.querySelectorAll('[id^="carteLongueFrontRef_"]').forEach(select => {
    if (parseInt(select.value) === courtesStableId)
      found = document.getElementById(`carteLongueBack_${select.id.replace('carteLongueFrontRef_', '')}`)?.value || '';
  });
  return found;
}

// ── Import ────────────────────────────────────────────────────
async function importCartes(event) {
  const file = event.target.files[0];
  if (!file) return;

  showImportOverlay();

  try {
    const zip = await JSZip.loadAsync(file);

    // Helper: read JSON from zip
    async function readJSON(path) {
      const f = zip.file(path);
      if (!f) return null;
      return JSON.parse(await f.async('string'));
    }

    // Helper: read audio blob from zip
    async function readAudio(path) {
      const f = zip.file(path);
      if (!f) return null;
      return await f.async('blob');
    }

    // Clear existing cards
    ['carteCourtesList', 'carteLonguesList', 'carteRevisionList'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    cartesCourtesIdCounter = 0;
    cartesLonguesIdCounter = 0;
    cartesRevisionIdCounter = 0;
    cartesAudioBlobs.expressions  = {};
    cartesAudioBlobs.longuesFront = {};
    cartesAudioBlobs.longuesDef   = {};
    currentCarteCardId.courtes = null;
    currentCarteCardId.longues = null;
    currentCarteCardId.revision = null;

    // ── Restore Title, Level, Theme & Durations ──
    const metaJSON = await readJSON('Ressources_FCs/S0/variables.json');
    if (metaJSON) {
      const titleEl = document.getElementById('cartesDeckTitle');
      const levelEl = document.getElementById('cartesDeckLevel');
      if (titleEl && metaJSON.Titre) titleEl.value = metaJSON.Titre;
      if (levelEl && metaJSON.Niveau) levelEl.value = metaJSON.Niveau;
      if (metaJSON.Theme) setCarteTheme(metaJSON.Theme);
      if (metaJSON.Durations) {
        const dC = document.getElementById('cartesDurationCourtes');
        const dL = document.getElementById('cartesDurationLongues');
        const dR = document.getElementById('cartesDurationRevision');
        if (dC && metaJSON.Durations.Courtes)  dC.value = metaJSON.Durations.Courtes;
        if (dL && metaJSON.Durations.Longues)  dL.value = metaJSON.Durations.Longues;
        if (dR && metaJSON.Durations.Revision) dR.value = metaJSON.Durations.Revision;
      }
    }

    // ── Import Courtes ──
    const courtesJSON = await readJSON('Ressources_FCs/Flashcards_Courtes/variables.json');
    if (courtesJSON) {
      let n = 1;
      while (courtesJSON[`Card${n}`]) {
        addCarteCourte();
        const id = cartesCourtesIdCounter;
        const card = courtesJSON[`Card${n}`];
        document.getElementById(`carteCourteConsigne_${id}`).value = card.Consigne || '';
        document.getElementById(`carteCourteFront_${id}`).value = card.Front_Text || '';
        document.getElementById(`carteCourteBack_${id}`).value = card.Back_Text || '';
        // Load expression audio
        if (card.Back_Audio) {
          const blob = await readAudio(card.Back_Audio);
          if (blob) {
            cartesAudioBlobs.expressions[id] = blob;
            refreshCarteAudioPreview('expressions', id);
          }
        }
        // Restore extra
        _importCarteExtra(`C${id}`, card.Extra);
        n++;
      }
    }

    // ── Import Longues ──
    const longuesJSON = await readJSON('Ressources_FCs/Flashcards_Longues/variables.json');
    if (longuesJSON) {
      // Build a map: expression audio path → courtesStableId
      const exprPathToId = {};
      document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]').forEach((card, idx) => {
        const sId = parseInt(card.id.replace('carteCourte_', ''));
        exprPathToId[`Ressources_FCs/Audios/Expressions/FC_${idx + 1}.mp3`] = sId;
      });

      let n = 1;
      while (longuesJSON[`Card${n}`]) {
        addCarteLongue();
        const id = cartesLonguesIdCounter;
        const card = longuesJSON[`Card${n}`];
        document.getElementById(`carteLongueConsigne_${id}`).value = card.Consigne || '';
        document.getElementById(`carteLongueBack_${id}`).value = card.Back_Text || '';
        // Restore Courte link (for Révision matching)
        const refId = card.Courte_Ref ? parseInt(card.Courte_Ref) : null;
        if (refId) {
          const select = document.getElementById(`carteLongueFrontRef_${id}`);
          if (select) { select.value = refId; updateCarteLongueFront(id); }
        }
        // Restore front text (may differ from Courte back text)
        if (card.Front_Text) {
          const frontEl = document.getElementById(`carteLongueFrontText_${id}`);
          if (frontEl) frontEl.value = card.Front_Text;
        }
        // Load face avant audio
        if (card.Front_Audio) {
          const blob = await readAudio(card.Front_Audio);
          if (blob) {
            cartesAudioBlobs.longuesFront[id] = blob;
            refreshCarteAudioPreview('longuesFront', id);
          }
        }
        // Load face arrière audio
        if (card.Back_Audio) {
          const blob = await readAudio(card.Back_Audio);
          if (blob) {
            cartesAudioBlobs.longuesDef[id] = blob;
            refreshCarteAudioPreview('longuesDef', id);
          }
        }
        _importCarteExtra(`L${id}`, card.Extra);
        n++;
      }
    }

    // ── Import Révision ──
    const revisionJSON = await readJSON('Ressources_FCs/Flashcards_Revision/variables.json');
    if (revisionJSON) {
      const exprPathToId = {};
      document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]').forEach((card, idx) => {
        const sId = parseInt(card.id.replace('carteCourte_', ''));
        exprPathToId[`Ressources_FCs/Audios/Expressions/FC_${idx + 1}.mp3`] = sId;
      });

      let n = 1;
      while (revisionJSON[`Matching${n}`]) {
        addCarteRevision();
        const id = cartesRevisionIdCounter;
        const m = revisionJSON[`Matching${n}`];
        document.getElementById(`carteRevisionConsigne_${id}`).value = m.Consigne || '';
        const ref1 = m.Paire_1?.Audio_Expression?.fichier ? exprPathToId[m.Paire_1.Audio_Expression.fichier] : null;
        const ref2 = m.Paire_2?.Audio_Expression?.fichier ? exprPathToId[m.Paire_2.Audio_Expression.fichier] : null;
        if (ref1) { document.getElementById(`carteRevisionPaire1_${id}`).value = ref1; }
        if (ref2) { document.getElementById(`carteRevisionPaire2_${id}`).value = ref2; }
        updateCarteRevisionInfo(id);
        n++;
      }
    }

    // Rebuild sidebar nav lists and show first card of each section
    const firstCardMap = {
      courtes:  document.querySelector('#carteCourtesList [id^="carteCourte_"]'),
      longues:  document.querySelector('#carteLonguesList [id^="carteLongue_"]'),
      revision: document.querySelector('#carteRevisionList [id^="carteRevision_"]')
    };
    ['courtes', 'longues', 'revision'].forEach(s => {
      rebuildCartesNavList(s);
      const first = firstCardMap[s];
      const firstId = first ? parseInt(first.id.replace(/[^0-9]/g, '')) : null;
      showCarteCard(s, firstId);
    });

    hideImportOverlay(true);
  } catch (e) {
    console.error('Import cartes error:', e);
    hideImportOverlay(false);
    alert('Erreur lors de l\'import : ' + e.message);
  }

  // Reset file input so same file can be re-imported
  event.target.value = '';
}

function _importCarteExtra(prefix, extra) {
  if (!extra || extra.Type === 'Aucune' || !extra.Type) return;
  const typeEl = document.getElementById(`carteExtraType_${prefix}`);
  if (!typeEl) return;
  typeEl.value = extra.Type;
  updateCarteExtraFields(prefix);
  if (extra.Type === 'Phrases' && Array.isArray(extra.Elements)) {
    extra.Elements.forEach((phrase, i) => {
      const el = document.getElementById(`carteExtraPhrase_${prefix}_${i + 1}`);
      if (el) el.value = phrase;
    });
  } else if (extra.Type === 'Expressions' && Array.isArray(extra.Elements)) {
    extra.Elements.forEach((item, i) => {
      const exprEl = document.getElementById(`carteExtraExpr_${prefix}_${i + 1}`);
      const exEl = document.getElementById(`carteExtraExemple_${prefix}_${i + 1}`);
      if (exprEl) exprEl.value = item.Expression || '';
      if (exEl) exEl.value = item.Exemple || '';
    });
  }
}

// ── Cartes Sidebar: Toggle section ────────────────────────────
function toggleCartesSection(section) {
  const header = document.getElementById(`cartesSideBtn_${section}`);
  const list = document.getElementById(`cartesNavList_${section}`);
  const addBtn = document.getElementById(`cartesAddBtn_${section}`);
  if (!header || !list) return;
  const isExpanded = header.classList.contains('expanded');
  if (isExpanded) {
    header.classList.remove('expanded');
    list.style.display = 'none';
    if (addBtn) addBtn.style.display = 'none';
  } else {
    header.classList.add('expanded');
    list.style.display = 'block';
    if (addBtn) addBtn.style.display = 'block';
  }
}

function autoExpandCartesSection(section) {
  const header = document.getElementById(`cartesSideBtn_${section}`);
  if (header && !header.classList.contains('expanded')) toggleCartesSection(section);
}

// ── Cartes Sidebar: Rebuild nav list ──────────────────────────
function rebuildCartesNavList(section) {
  const cfgMap = {
    courtes:  { listId: 'carteCourtesList',  prefix: 'carteCourte_',   label: 'Carte',    textFn: (id) => document.getElementById(`carteCourteFront_${id}`)?.value?.trim() || '' },
    longues:  { listId: 'carteLonguesList',  prefix: 'carteLongue_',   label: 'Carte',    textFn: (id) => document.getElementById(`carteLongueFrontText_${id}`)?.value?.trim() || '' },
    revision: { listId: 'carteRevisionList', prefix: 'carteRevision_', label: 'Matching', textFn: (id) => {
      const courtes = [...document.querySelectorAll('#carteCourtesList [id^="carteCourte_"]')];
      const posOf = (stableId) => {
        const idx = courtes.findIndex(c => parseInt(c.id.replace('carteCourte_', '')) === stableId);
        return idx === -1 ? '?' : idx + 1;
      };
      const ref1 = parseInt(document.getElementById(`carteRevisionPaire1_${id}`)?.value);
      const ref2 = parseInt(document.getElementById(`carteRevisionPaire2_${id}`)?.value);
      if (!ref1 && !ref2) return '';
      return `${ref1 ? posOf(ref1) : '?'} / ${ref2 ? posOf(ref2) : '?'}`;
    }}
  };
  const cfg = cfgMap[section];
  if (!cfg) return;
  const navList = document.getElementById(`cartesNavList_${section}`);
  if (!navList) return;
  const cards = [...document.querySelectorAll(`#${cfg.listId} [id^="${cfg.prefix}"]`)];
  navList.innerHTML = '';
  const activeSId = currentCarteCardId[section];
  cards.forEach((card, idx) => {
    const stableId = parseInt(card.id.replace(cfg.prefix, ''));
    const num = idx + 1;
    const snippet = cfg.textFn(stableId);
    const label = snippet ? snippet.substring(0, 25) + (snippet.length > 25 ? '\u2026' : '') : '';
    // Drop zone before this item
    navList.appendChild(_createCarteDropZone(section, idx));
    // The item
    const li = document.createElement('li');
    li.dataset.stableId = stableId;
    li.dataset.section = section;
    if (stableId === activeSId) li.classList.add('active');
    li.draggable = true;
    li.innerHTML =
      `<i class="bi bi-grip-vertical drag-handle"></i>` +
      `<span class="flex-grow-1" onclick="showCartesTab('${section}'); showCarteCard('${section}',${stableId});" style="cursor:pointer;">` +
        `<strong>${cfg.label} ${num}</strong>` +
        (label ? ` <span class="exercise-type">&ndash; ${label}</span>` : '') +
      `</span>`;
    li.addEventListener('dragstart', _carteDragStart);
    li.addEventListener('dragend', _carteDragEnd);
    navList.appendChild(li);
  });
  // Final drop zone after last item
  if (cards.length > 0) navList.appendChild(_createCarteDropZone(section, cards.length));
}

