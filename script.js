// ============================================
// GLOBAL STATE
// ============================================
let scene, camera, renderer, currentMesh, controls;
let cachedWorkingModel = null;
let currentParams = null;      // last validated params
let suppressReframe = false;   // avoid camera jumps during slider drag

// ============================================
// PERSISTENCE (LOCAL STORAGE)
// ============================================
const LS = {
  rememberFlag: 'airgen.rememberKey',
  apiKey:       'airgen.apiKey',
  userInput:    'airgen.userInput',
  paramsByType: 'airgen.paramsByType' // { wing:{}, fuselage:{}, stabilizer:{} }
};

function loadJSON(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function removeKeys(...keys) {
  keys.forEach(k => localStorage.removeItem(k));
}
function coerce(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ============================================
// THREE.JS SETUP - 3D GRAPHICS ENGINE
// ============================================
window.addEventListener('load', initThreeJS);

function initThreeJS() {
  console.log('🎨 Initializing Three.js...');
  const container = document.getElementById('viewer');
  const width = container.clientWidth;
  const height = container.clientHeight;

  // 1) Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  // 2) Camera
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.set(5, 5, 10);
  camera.lookAt(0, 0, 0);

  // 3) Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  // 4) Controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // 5) Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  // 6) Helpers
  scene.add(new THREE.GridHelper(20, 20, 0x888888, 0xcccccc));
  scene.add(new THREE.AxesHelper(5));

  // Resize + loop
  window.addEventListener('resize', onWindowResize);
  animate();

  // Load saved testing data
  hydrateTestingState();

  console.log('✓ Three.js initialized successfully!');
}

function animate() {
  requestAnimationFrame(animate);
  if (currentMesh) currentMesh.rotation.y += 0.005;
  if (controls) controls.update();
  renderer.render(scene, camera);
}

function onWindowResize() {
  const container = document.getElementById('viewer');
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// ============================================
// 3D AIRCRAFT PART GENERATION
// ============================================
function generateAircraftPart(params, options = {}) {
  console.log('🛠️ Generating aircraft part:', params);

  if (currentMesh) scene.remove(currentMesh);

  const partType = (params.type || 'unknown').toLowerCase();
  let geometry;

  // Material
  const materialColor =
    params.material?.includes('carbon')   ? 0x222222 :
    params.material?.includes('titanium') ? 0xcccccc :
    params.material?.includes('aluminum') ? 0xaaaaaa :
                                            0x4488ff;

  const material = new THREE.MeshStandardMaterial({
    color: materialColor, metalness: 0.7, roughness: 0.3
  });

  // Geometry
  if (partType.includes('wing'))        geometry = createWing(params);
  else if (partType.includes('fuselage'))   geometry = createFuselage(params);
  else if (partType.includes('stabilizer')) geometry = createStabilizer(params);
  else                                      geometry = new THREE.BoxGeometry(3, 1, 6);

  geometry.computeBoundingBox();
  geometry.center();

  const box = geometry.boundingBox;
  const height = box.max.y - box.min.y;

  currentMesh = new THREE.Mesh(geometry, material);
  currentMesh.position.y = height / 2;
  scene.add(currentMesh);

  // Auto-frame unless suppressed
  const wantReframe = options.reframe === true && !suppressReframe;
  if (wantReframe) frameObject(currentMesh, camera, controls);

  // Wireframe overlay
  const wireframe = new THREE.WireframeGeometry(geometry);
  const line = new THREE.LineSegments(wireframe);
  line.material.transparent = true;
  line.material.opacity = 0.15;
  currentMesh.add(line);

  console.log('✓ Aircraft part generated!');
}

function createWing(params) {
  const span  = coerce(params.span, 10);
  const chord = coerce(params.chord, 2);
  const sweep = (coerce(params.sweep, 0)) * Math.PI / 180;

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(chord, 0);
  shape.lineTo(chord * 0.9, chord * 0.1);
  shape.lineTo(chord * 0.1, chord * 0.1);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    steps: 20, depth: span,
    bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3
  });
  geometry.rotateZ(sweep);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function createFuselage(params) {
  const length   = coerce(params.length, 8);
  const diameter = coerce(params.diameter, 2);

  const geometry = new THREE.CylinderGeometry(
    diameter / 2,          // top
    diameter / 2 * 0.8,    // bottom (tapered)
    length, 32
  );
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}

function createStabilizer(params) {
  const span  = coerce(params.span, 4);
  const chord = 1.5;

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(chord, 0);
  shape.lineTo(chord * 0.8, chord * 0.15);
  shape.lineTo(chord * 0.2, chord * 0.15);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    steps: 10, depth: span,
    bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05
  });

  const type = (params.type || '').toLowerCase();
  if (type.includes('vertical')) {
    geometry.rotateX(Math.PI / 2);
  } else {
    const sweep = (coerce(params.sweep, 0)) * Math.PI / 180;
    geometry.rotateZ(sweep);
    geometry.rotateX(Math.PI / 2);
  }
  return geometry;
}

// ============================================
// CAMERA AUTO-FRAMING (ZOOM TO FIT)
// ============================================
function frameObject(mesh, camera, controls) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  controls.target.copy(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let distance = maxDim / Math.sin(fov / 2);
  distance *= 0.6;

  const newPos = center.clone().add(new THREE.Vector3(distance, distance, distance));

  // Use GSAP if available; otherwise set directly
  if (window.gsap && gsap.to) {
    gsap.to(camera.position, {
      x: newPos.x, y: newPos.y, z: newPos.z,
      duration: 0.8, ease: "power2.out",
      onUpdate: () => controls.update()
    });
  } else {
    camera.position.copy(newPos);
    controls.update();
  }
}

// ============================================
// PARAMETER VALIDATION + WARNINGS
// ============================================
function validateParams(params, userInput) {
  userInput = String(userInput || '');
  const warnings = [];

  // TYPE
  if (!params.type || typeof params.type !== 'string') {
    const guess = guessPartTypeFromText(userInput);
    if (guess) {
      warnings.push(`Type not detected from AI. Using inferred type: ${guess}.`);
      params.type = guess;
    } else {
      throw new Error('Invalid or missing part type. Please describe a wing, fuselage, or stabilizer.');
    }
  }
  params.type = params.type.toLowerCase();

  // SPAN
  if (params.span !== null && params.span !== undefined) {
    if (isNaN(params.span) || params.span <= 0) {
      warnings.push('Span must be a positive number. Using default 10m.');
      params.span = 10;
    }
    if (params.span > 100) {
      warnings.push('Span too large (>100m). Clamped to 100m.');
      params.span = 100;
    }
  }

  // CHORD
  if (params.chord !== null && params.chord !== undefined) {
    if (isNaN(params.chord) || params.chord <= 0) {
      warnings.push('Chord must be a positive number. Using default 2m.');
      params.chord = 2;
    }
  }

  // SWEEP
  if (params.sweep !== null && params.sweep !== undefined) {
    if (isNaN(params.sweep)) {
      warnings.push('Sweep must be a number. Using 0°.');
      params.sweep = 0;
    }
    if (params.sweep < 0 || params.sweep > 60) {
      warnings.push(`Sweep ${params.sweep}° out of range (0–60°). Clamped.`);
      params.sweep = Math.max(0, Math.min(params.sweep, 60));
    }
  }

  // LENGTH
  if (params.length !== null && params.length !== undefined) {
    if (isNaN(params.length) || params.length <= 0) {
      warnings.push('Length must be a positive number. Using default 8m.');
      params.length = 8;
    }
  }

  // DIAMETER
  if (params.diameter !== null && params.diameter !== undefined) {
    if (isNaN(params.diameter) || params.diameter <= 0) {
      warnings.push('Diameter must be a positive number. Using default 2m.');
      params.diameter = 2;
    }
  }

  return { params, warnings };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showWarningsAboveParams(warnings) {
  const slot = document.getElementById('warnSlot');
  if (!slot) return;

  if (!warnings || warnings.length === 0) {
    slot.innerHTML = '';
    return;
  }

  const list = warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
  slot.innerHTML = `
    <div class="warning">
      <strong>⚠️ Parameter adjustments</strong>
      <ul style="margin:6px 0 0 18px;">${list}</ul>
    </div>
  `;
}

// ============================================
// UNIVERSAL PARAM PANEL (sliders per type)
// ============================================
function buildParamPanel(params) {
  currentParams = { ...params };
  const panel = document.getElementById('paramPanel');
  const ctrl  = document.getElementById('paramControls');
  if (!panel || !ctrl) return;

  const type = (params.type || '').toLowerCase();
  const defsByType = {
    wing: [
      { key: 'span',     label: 'Span (m)',     min: 0.5, max: 100, step: 0.1, value: coerce(params.span, 10) },
      { key: 'chord',    label: 'Chord (m)',    min: 0.1, max: 10,  step: 0.1, value: coerce(params.chord, 2) },
      { key: 'sweep',    label: 'Sweep (°)',    min: 0,   max: 60,  step: 1,   value: coerce(params.sweep, 0) }
    ],
    fuselage: [
      { key: 'length',   label: 'Length (m)',   min: 0.5, max: 100, step: 0.1, value: coerce(params.length, 8) },
      { key: 'diameter', label: 'Diameter (m)', min: 0.1, max: 10,  step: 0.1, value: coerce(params.diameter, 2) }
    ],
    stabilizer: [
      { key: 'span',     label: 'Span (m)',     min: 0.5, max: 30,  step: 0.1, value: coerce(params.span, 4) },
      { key: 'sweep',    label: 'Sweep (°)',    min: 0,   max: 60,  step: 1,   value: coerce(params.sweep, 0) }
    ]
  };

  const defList =
    type.includes('wing')      ? defsByType.wing :
    type.includes('fuselage')  ? defsByType.fuselage :
                                 defsByType.stabilizer;

  ctrl.innerHTML = '';
  defList.forEach(def => ctrl.appendChild(makeSlider(def)));

  panel.classList.remove('hidden');
}

function makeSlider({ key, label, min, max, step, value }) {
  const wrap = document.createElement('div');
  wrap.className = 'slider-row';

  const id = `slider_${key}`;
  const header = document.createElement('label');
  header.setAttribute('for', id);
  header.innerHTML = `${label} <span id="${id}_val">${value}</span>`;

  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  input.addEventListener('input', () => {
    document.getElementById(`${id}_val`).textContent = input.value;
    currentParams[key] = parseFloat(input.value);
    suppressReframe = true;
    regenerateFromPanel(false);
  });

  input.addEventListener('change', () => {
    suppressReframe = false;
    regenerateFromPanel(true);
  });

  wrap.appendChild(header);
  wrap.appendChild(input);
  return wrap;
}

function regenerateFromPanel(allowReframe = false) {
  if (!currentParams) return;
  generateAircraftPart(currentParams, { reframe: allowReframe });
}

// ============================================
// NLP FALLBACK FOR TYPE DETECTION
// ============================================
function guessPartTypeFromText(userInput) {
  const text = String(userInput || '').toLowerCase();

  if (text.includes('wing') || text.includes('airfoil') || text.includes('delta') || text.includes('swept'))
    return 'wing';

  if (text.includes('fuselage') || text.includes('body') || text.includes('tube'))
    return 'fuselage';

  if (text.includes('stabilizer') || text.includes('tail') || text.includes('fin') || text.includes('rudder'))
    return 'stabilizer';

  return null;
}

// ============================================
// GEMINI API INTEGRATION
// ============================================
async function findWorkingModel(apiKey) {
  console.log('🔍 Auto-detecting working Gemini model...');
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
    if (!res.ok) throw new Error('Could not list models');
    const data = await res.json();
    for (const m of data.models || []) {
      if (m.supportedGenerationMethods?.includes('generateContent')) {
        return m.name.replace('models/', '');
      }
    }
  } catch {}
  const fallbacks = ['gemini-1.5-flash','gemini-1.5-pro','gemini-1.5-flash-latest','gemini-pro'];
  for (const model of fallbacks) {
    try {
      const test = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'test' }] }] }) }
      );
      if (test.ok) return model;
    } catch {}
  }
  throw new Error('No working Gemini model found.');
}

async function callGeminiAPI(apiKey, userInput) {
  if (!cachedWorkingModel) cachedWorkingModel = await findWorkingModel(apiKey);
  const prompt =
`Extract aircraft part parameters and return ONLY valid JSON.
Description: "${userInput}"
{
  "type": "wing|fuselage|stabilizer",
  "span":   number|null,
  "length": number|null,
  "diameter": number|null,
  "chord":  number|null,
  "sweep":  number|null,
  "material": "carbon|titanium|aluminum|null"
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${cachedWorkingModel}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
  );

  if (!response.ok) {
    cachedWorkingModel = null;
    const err = await response.json();
    throw new Error(err.error?.message || 'Gemini API error');
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { type:null, span:null, length:null, diameter:null, chord:null, sweep:null, material:null, _raw:text };
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return { type:null, span:null, length:null, diameter:null, chord:null, sweep:null, material:null, _raw:text };
  }
}

// ============================================
// UI INTERACTIONS
// ============================================
document.getElementById('generateBtn').addEventListener('click', async function () {
  const userInput = document.getElementById('userInput').value.trim();
  const apiKey    = document.getElementById('apiKey').value.trim();
  const output    = document.getElementById('output');
  const warnSlot  = document.getElementById('warnSlot');

  if (!apiKey)   return showOutputError('Please enter your API key!');
  if (!userInput) return showOutputError('Please describe an aircraft part!');

  if (warnSlot) warnSlot.innerHTML = '';
  output.innerHTML = '<p class="loading">🤖 Analyzing description...</p>';

  // persist prompt for testing
  localStorage.setItem(LS.userInput, userInput);

  this.disabled = true;
  try {
    let raw = await callGeminiAPI(apiKey, userInput);
    const { params, warnings } = validateParams(raw, userInput);

    showWarningsAboveParams(warnings);
    displayParameters(params);
    buildParamPanel(params);
    generateAircraftPart(params, { reframe: true });

    output.innerHTML += '<p class="success" style="margin-top:10px;">✓ 3D model generated successfully!</p>';

    // remember params by detected type
    const t = (params.type || '').toLowerCase();
    if (t) {
      const map = loadJSON(LS.paramsByType, {});
      map[t] = params;
      saveJSON(LS.paramsByType, map);
    }
  } catch (err) {
    showOutputError(err.message);
  }
  this.disabled = false;
});

document.querySelectorAll('.example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.getElementById('userInput').value = chip.dataset.example;
  });
});

// Append-only helpers for the output box
function showOutputError(msg) {
  const output = document.getElementById('output');
  output.innerHTML += `<p class="error">❌ ${msg}</p>`;
}
function showOutputSuccess(msg) {
  const output = document.getElementById('output');
  output.innerHTML += `<p class="success">✅ ${msg}</p>`;
}
function displayParameters(params) {
  const output = document.getElementById('output');
  let html = '<h4 class="success">✓ Extracted Parameters:</h4>';
  html += '<div class="params-box">';
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && k !== '_raw') {
      html += `<div class="param-item"><strong>${k}:</strong> ${v}</div>`;
    }
  }
  html += '</div>';
  output.innerHTML += html;
}

// ============================================
// EXPORT DROPDOWN + EXPORTERS
// ============================================
const dropdownBtn = document.getElementById('exportDropdownBtn');
const exportMenu  = document.getElementById('exportMenu');

dropdownBtn.addEventListener('click', () => {
  exportMenu.style.display = exportMenu.style.display === 'block' ? 'none' : 'block';
});
window.addEventListener('click', (e) => {
  if (!e.target.closest('.export-dropdown')) exportMenu.style.display = 'none';
});

document.getElementById('exportGLTF').addEventListener('click', () => {
  exportMenu.style.display = 'none';
  if (!currentMesh) return showOutputError('No model to export!');
  const exporter = new THREE.GLTFExporter();
  exporter.parse(currentMesh, (gltf) => {
    const blob = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'aircraft_part.gltf'; a.click();
    URL.revokeObjectURL(url);
    showOutputSuccess('Model exported as GLTF successfully!');
  });
});

document.getElementById('exportSTL').addEventListener('click', () => {
  exportMenu.style.display = 'none';
  if (!currentMesh) return showOutputError('No model to export!');
  const exporter = new THREE.STLExporter();
  const stl = exporter.parse(currentMesh);
  const blob = new Blob([stl], { type: 'application/vnd.ms-pki.stl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'aircraft_part.stl'; a.click();
  URL.revokeObjectURL(url);
  showOutputSuccess('Model exported as STL successfully!');
});

// ============================================
// API KEY / PROMPT PERSISTENCE (TESTING ONLY)
// ============================================
function hydrateTestingState() {
  const rememberKeyEl = document.getElementById('rememberKey');
  const apiKeyEl      = document.getElementById('apiKey');
  const userInputEl   = document.getElementById('userInput');

  const rememberFlag  = loadJSON(LS.rememberFlag, false);
  rememberKeyEl.checked = !!rememberFlag;

  if (rememberFlag) {
    const savedKey = localStorage.getItem(LS.apiKey);
    if (savedKey) apiKeyEl.value = savedKey;
  }
  const savedPrompt = localStorage.getItem(LS.userInput);
  if (savedPrompt) userInputEl.value = savedPrompt;

  // listeners
  apiKeyEl.addEventListener('input', (e) => {
    const remember = rememberKeyEl.checked;
    if (remember) localStorage.setItem(LS.apiKey, e.target.value.trim());
  });
  rememberKeyEl.addEventListener('change', (e) => {
    const on = e.target.checked;
    saveJSON(LS.rememberFlag, on);
    if (!on) removeKeys(LS.apiKey);
    else {
      const v = apiKeyEl.value.trim();
      if (v) localStorage.setItem(LS.apiKey, v);
    }
  });
  userInputEl.addEventListener('input', (e) => {
    localStorage.setItem(LS.userInput, e.target.value);
  });

  const clearBtn = document.getElementById('clearSaved');
  clearBtn.addEventListener('click', () => {
    removeKeys(LS.rememberFlag, LS.apiKey, LS.userInput, LS.paramsByType);
    rememberKeyEl.checked = false;
    apiKeyEl.value = '';
    showOutputSuccess('Cleared saved testing data.');
  });
}