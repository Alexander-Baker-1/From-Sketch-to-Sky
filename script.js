// ============================================
// GLOBAL VARIABLES
// ============================================

let scene, camera, renderer, currentMesh, controls;
let cachedWorkingModel = null;


// ============================================
// THREE.JS SETUP - 3D GRAPHICS ENGINE
// ============================================

window.addEventListener('load', initThreeJS);

function initThreeJS() {
    console.log('🎨 Initializing Three.js...');

    const container = document.getElementById('viewer');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. SCENE
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    // 2. CAMERA
    camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(5, 5, 10);
    camera.lookAt(0, 0, 0);

    // 3. RENDERER
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    // 4. CONTROLS
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 5. LIGHTS
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    // 6. HELPERS
    scene.add(new THREE.GridHelper(20, 20, 0x888888, 0xcccccc));
    scene.add(new THREE.AxesHelper(5));

    // START LOOP + RESIZE HANDLER
    animate();
    window.addEventListener('resize', onWindowResize);

    console.log('✓ Three.js initialized successfully!');
}

function animate() {
    requestAnimationFrame(animate);

    if (currentMesh) {
        currentMesh.rotation.y += 0.005;
    }

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

function generateAircraftPart(params) {
    console.log('🛠️ Generating aircraft part:', params);

    if (currentMesh) scene.remove(currentMesh);

    const partType = (params.type || "unknown").toLowerCase();
    let geometry;

    // MATERIAL
    const materialColor =
        params.material?.includes('carbon') ? 0x222222 :
        params.material?.includes('titanium') ? 0xcccccc :
        params.material?.includes('aluminum') ? 0xaaaaaa :
        0x4488ff;

    const material = new THREE.MeshStandardMaterial({
        color: materialColor, metalness: 0.7, roughness: 0.3
    });

    // GEOMETRY
    if (partType.includes('wing')) geometry = createWing(params);
    else if (partType.includes('fuselage')) geometry = createFuselage(params);
    else if (partType.includes('stabilizer')) geometry = createStabilizer(params);
    else geometry = new THREE.BoxGeometry(3, 1, 6);

    // CENTER + POSITION ABOVE GRID
    geometry.computeBoundingBox();
    geometry.center();

    const box = geometry.boundingBox;
    const height = box.max.y - box.min.y;

    currentMesh = new THREE.Mesh(geometry, material);
    currentMesh.position.y = height / 2;
    scene.add(currentMesh);
    frameObject(currentMesh, camera, controls);

    // WIREFRAME
    const wireframe = new THREE.WireframeGeometry(geometry);
    const line = new THREE.LineSegments(wireframe);
    line.material.transparent = true;
    line.material.opacity = 0.15;
    currentMesh.add(line);

    console.log('✓ Aircraft part generated!');
}

function createWing(params) {
    const span = params.span || 10;
    const chord = params.chord || 2;
    const sweep = (params.sweep || 0) * Math.PI / 180;

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(chord, 0);
    shape.lineTo(chord * 0.9, chord * 0.1);
    shape.lineTo(chord * 0.1, chord * 0.1);
    shape.closePath();

    const extrudeSettings = {
        steps: 20,
        depth: span,
        bevelEnabled: true,
        bevelThickness: 0.1,
        bevelSize: 0.1,
        bevelSegments: 3
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.rotateZ(sweep);
    geometry.rotateX(Math.PI / 2);
    return geometry;
}

function createFuselage(params) {
    const length = params.length || 8;
    const diameter = params.diameter || 2;

    const geometry = new THREE.CylinderGeometry(
        diameter / 2,
        diameter / 2 * 0.8,
        length,
        32
    );
    geometry.rotateZ(Math.PI / 2);
    return geometry;
}

function createStabilizer(params) {
    const span = params.span || 4;
    const chord = 1.5;

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(chord, 0);
    shape.lineTo(chord * 0.8, chord * 0.15);
    shape.lineTo(chord * 0.2, chord * 0.15);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
        steps: 10,
        depth: span,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05
    });

    const type = params.type.toLowerCase();
    if (type.includes('vertical')) {
        geometry.rotateX(Math.PI / 2);
    } else {
        const sweep = (params.sweep || 0) * Math.PI / 180;
        geometry.rotateZ(sweep);
        geometry.rotateX(Math.PI / 2);
    }

    return geometry;
}


// ============================================
// CAMERA AUTO-FRAMING (ZOOM TO FIT)
// ============================================

function frameObject(mesh, camera, controls) {
    // Compute bounding box of the mesh
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Move OrbitControls target to the object's center
    controls.target.copy(center);

    // Largest dimension of the object
    const maxDim = Math.max(size.x, size.y, size.z);

    // Ideal distance based on object size + FOV
    const fov = camera.fov * (Math.PI / 180);
    let distance = maxDim / Math.sin(fov / 2);

    distance *= 0.6; // tighten a little so it looks good

    // New camera position (pull back along Z)
    const newPos = center.clone().add(new THREE.Vector3(distance, distance, distance));

    // Smooth transition instead of snapping
    gsap.to(camera.position, {
        x: newPos.x,
        y: newPos.y,
        z: newPos.z,
        duration: 0.8,
        ease: "power2.out"
    });

    // Must update controls afterward
    controls.update();
}


// ============================================
// PARAMETER VALIDATION
// ============================================

function validateParams(params, userInput) {
  userInput = String(userInput || "");
  const warnings = [];

  // TYPE
  if (!params.type || typeof params.type !== "string") {
    const guess = guessPartTypeFromText(userInput);
    if (guess) {
      warnings.push(`Type not detected from AI. Using inferred type: ${guess}.`);
      params.type = guess;
    } else {
      throw new Error("Invalid or missing part type. Please describe a wing, fuselage, or stabilizer.");
    }
  }
  params.type = params.type.toLowerCase();

  // SPAN
  if (params.span !== null && params.span !== undefined) {
    if (isNaN(params.span) || params.span <= 0) {
      warnings.push("Span must be a positive number. Using default 10m.");
      params.span = 10;
    }
    if (params.span > 100) {
      warnings.push("Span too large (>100m). Clamped to 100m.");
      params.span = 100;
    }
  }

  // CHORD
  if (params.chord !== null && params.chord !== undefined) {
    if (isNaN(params.chord) || params.chord <= 0) {
      warnings.push("Chord must be a positive number. Using default 2m.");
      params.chord = 2;
    }
  }

  // SWEEP
  if (params.sweep !== null && params.sweep !== undefined) {
    if (isNaN(params.sweep)) {
      warnings.push("Sweep must be a number. Using 0°.");
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
      warnings.push("Length must be a positive number. Using default 8m.");
      params.length = 8;
    }
  }

  // DIAMETER
  if (params.diameter !== null && params.diameter !== undefined) {
    if (isNaN(params.diameter) || params.diameter <= 0) {
      warnings.push("Diameter must be a positive number. Using default 2m.");
      params.diameter = 2;
    }
  }

  return { params, warnings };
}

function showWarningsAboveParams(warnings) {
  const slot = document.getElementById('warnSlot');
  if (!slot) return;
  if (!warnings || warnings.length === 0) { slot.innerHTML = ''; return; }

  // Prepend warnings block (does not clear parameters)
  slot.innerHTML = `
    <div class="params-box" style="background:#fff3cd;border:1px solid #ffe69c;margin-bottom:10px;">
      <div class="param-item"><strong>⚠️ Parameter adjustments:</strong></div>
      ${warnings.map(w => `<div class="param-item">${w}</div>`).join('')}
    </div>
  `;
}

function displayParameters(params) {
  const output = document.getElementById('output');
  // Append parameters (don’t wipe warnings)
  let html = '<h4 class="success">✓ Extracted Parameters:</h4>';
  html += '<div class="params-box">';
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && k !== '_raw')
      html += `<div class="param-item"><strong>${k}:</strong> ${v}</div>`;
  }
  html += '</div>';
  output.innerHTML += html;
}


// ============================================
// NLP FALLBACK FOR TYPE DETECTION
// ============================================

function guessPartTypeFromText(userInput) {
    const text = userInput.toLowerCase();

    if (text.includes("wing")) return "wing";
    if (text.includes("airfoil")) return "wing";
    if (text.includes("delta")) return "wing";
    if (text.includes("swept")) return "wing";

    if (text.includes("fuselage")) return "fuselage";
    if (text.includes("body")) return "fuselage";
    if (text.includes("tube")) return "fuselage";

    if (text.includes("stabilizer")) return "stabilizer";
    if (text.includes("tail")) return "stabilizer";
    if (text.includes("fin")) return "stabilizer";
    if (text.includes("rudder")) return "stabilizer";

    return null; // no clue
}


// ============================================
// GEMINI API INTEGRATION
// ============================================

async function findWorkingModel(apiKey) {
    console.log('🔍 Auto-detecting working Gemini model...');
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
        );
        if (!response.ok) throw new Error("Could not list models");

        const data = await response.json();
        for (const m of data.models || []) {
            if (m.supportedGenerationMethods?.includes('generateContent')) {
                return m.name.replace('models/', '');
            }
        }
    } catch {}

    // FALLBACKS
    const fallbacks = [
        'gemini-1.5-flash', 'gemini-1.5-pro',
        'gemini-1.5-flash-latest', 'gemini-pro'
    ];

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

    throw new Error("No working Gemini model found.");
}

async function callGeminiAPI(apiKey, userInput) {
    if (!cachedWorkingModel) {
        cachedWorkingModel = await findWorkingModel(apiKey);
    }

    const prompt = `Extract aircraft part parameters and return ONLY valid JSON...
Description: "${userInput}"
{ "type": "...", "span": ..., "length": ..., "diameter": ..., "chord": ..., "sweep": ..., "material": "..." }`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${cachedWorkingModel}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
    );

    if (!response.ok) {
        cachedWorkingModel = null;
        const err = await response.json();
        throw new Error(err.error?.message || "Gemini API error");
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;

    // Try to extract JSON
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
        // Fallback: create an "empty" safe param object
        return {
            type: null,
            span: null,
            length: null,
            diameter: null,
            chord: null,
            sweep: null,
            material: null,
            _raw: text   // keep original for debugging if needed
        };
    }

    let parsed;
    try {
        parsed = JSON.parse(match[0]);
    } catch {
        // still invalid? return safe fallback
        parsed = {
            type: null,
            span: null,
            length: null,
            diameter: null,
            chord: null,
            sweep: null,
            material: null,
            _raw: text
        };
    }

    return parsed;

}


// ============================================
// UI INTERACTIONS
// ============================================

document.getElementById('generateBtn').addEventListener('click', async function () {
  const userInput = document.getElementById('userInput').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const output = document.getElementById('output');
  const warnSlot = document.getElementById('warnSlot');

  if (!apiKey) return showOutputError("Please enter your API key!");
  if (!userInput) return showOutputError("Please describe an aircraft part!");

  // Reset only the warnings area; keep output appending behavior
  if (warnSlot) warnSlot.innerHTML = '';
  output.innerHTML = '<p class="loading">🤖 Analyzing description...</p>';

  this.disabled = true;
  try {
    let raw = await callGeminiAPI(apiKey, userInput);
    const { params, warnings } = validateParams(raw, userInput);

    showWarningsAboveParams(warnings);
    displayParameters(params);
    generateAircraftPart(params);

    output.innerHTML += '<p class="success" style="margin-top:10px;">✓ 3D model generated successfully!</p>';
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

function displayParameters(params) {
    const output = document.getElementById('output');

    let html = '<h4 class="success">✓ Extracted Parameters:</h4>';
    html += '<div class="params-box">';

    for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined)
            html += `<div class="param-item"><strong>${k}:</strong> ${v}</div>`;
    }

    html += '</div>';
    output.innerHTML += html;
}


// ============================================
// EXPORT HELPERS (SUCCESS + ERROR)
// ============================================

function showOutputError(msg) {
    const output = document.getElementById("output");
    output.innerHTML += `<p class="error">❌ ${msg}</p>`;
}

function showOutputSuccess(msg) {
    const output = document.getElementById("output");
    output.innerHTML += `<p class="success">✅ ${msg}</p>`;
}


// ============================================
// WARNINGS RENDERING (above parameters)
// ============================================

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function showWarningsAboveParams(warnings) {
  const slot = document.getElementById("warnSlot");
  if (!slot) return;

  if (!warnings || warnings.length === 0) {
    slot.innerHTML = "";
    return;
  }

  const list = warnings
    .map(w => `<li>${escapeHtml(w)}</li>`)
    .join("");

  slot.innerHTML = `
    <div class="warning">
      <strong>⚠️ Parameter adjustments</strong>
      <ul style="margin:6px 0 0 18px;">${list}</ul>
    </div>
  `;
}


// ============================================
// EXPORT DROPDOWN + EXPORTERS
// ============================================

// --- Dropdown Toggle ---
const dropdownBtn = document.getElementById("exportDropdownBtn");
const exportMenu = document.getElementById("exportMenu");

dropdownBtn.addEventListener("click", () => {
    exportMenu.style.display =
        exportMenu.style.display === "block" ? "none" : "block";
});

window.addEventListener("click", e => {
    if (!e.target.closest(".export-dropdown")) {
        exportMenu.style.display = "none";
    }
});

// --- GLTF Export ---
document.getElementById("exportGLTF").addEventListener("click", () => {
    exportMenu.style.display = "none";

    if (!currentMesh) return showOutputError("No model to export!");

    const exporter = new THREE.GLTFExporter();
    exporter.parse(currentMesh, gltf => {
        const blob = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "aircraft_part.gltf";
        a.click();
        URL.revokeObjectURL(url);

        showOutputSuccess("Model exported as GLTF successfully!");
    });
});

// --- STL Export ---
document.getElementById("exportSTL").addEventListener("click", () => {
    exportMenu.style.display = "none";

    if (!currentMesh) return showOutputError("No model to export!");

    const exporter = new THREE.STLExporter();
    const stl = exporter.parse(currentMesh);

    const blob = new Blob([stl], { type: 'application/vnd.ms-pki.stl' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "aircraft_part.stl";
    a.click();
    URL.revokeObjectURL(url);

    showOutputSuccess("Model exported as STL successfully!");
});