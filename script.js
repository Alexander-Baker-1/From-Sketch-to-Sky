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

    const type = params.type.toLowerCase();
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
    if (type.includes('wing')) geometry = createWing(params);
    else if (type.includes('fuselage')) geometry = createFuselage(params);
    else if (type.includes('stabilizer')) geometry = createStabilizer(params);
    else geometry = new THREE.BoxGeometry(3, 1, 6);

    // CENTER + POSITION ABOVE GRID
    geometry.computeBoundingBox();
    geometry.center();

    const box = geometry.boundingBox;
    const height = box.max.y - box.min.y;

    currentMesh = new THREE.Mesh(geometry, material);
    currentMesh.position.y = height / 2;
    scene.add(currentMesh);

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

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Invalid JSON from model");

    return JSON.parse(match[0]);
}


// ============================================
// UI INTERACTIONS
// ============================================

document.getElementById('generateBtn').addEventListener('click', async function () {
    const userInput = document.getElementById('userInput').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const output = document.getElementById('output');

    if (!apiKey) return showOutputError("Please enter your API key!");
    if (!userInput) return showOutputError("Please describe an aircraft part!");

    output.innerHTML = '<p class="loading">🤖 Analyzing description...</p>';
    this.disabled = true;

    try {
        const params = await callGeminiAPI(apiKey, userInput);
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
    output.innerHTML = html;
}


// ============================================
// EXPORT HELPERS (SUCCESS + ERROR)
// ============================================

function showOutputError(msg) {
    const output = document.getElementById("output");
    output.innerHTML = `<p class="error">❌ ${msg}</p>`;
}

function showOutputSuccess(msg) {
    const output = document.getElementById("output");
    output.innerHTML = `<p class="success">✅ ${msg}</p>`;
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