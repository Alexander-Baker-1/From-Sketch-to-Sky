// ============================================
// THREE.JS SETUP - 3D GRAPHICS ENGINE
// ============================================

let scene, camera, renderer, currentMesh;

// Initialize Three.js when page loads
window.addEventListener('load', initThreeJS);

function initThreeJS() {
    console.log('🎨 Initializing Three.js...');

    // Get the viewer container
    const container = document.getElementById('viewer');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. CREATE SCENE (the 3D world container)
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);  // Light gray

    // 2. CREATE CAMERA (your viewpoint into the 3D world)
    camera = new THREE.PerspectiveCamera(
        75,                    // Field of view (how wide you can see)
        width / height,        // Aspect ratio
        0.1,                   // Near clipping plane
        1000                   // Far clipping plane
    );
    camera.position.set(5, 5, 10);  // Position camera (x, y, z)
    camera.lookAt(0, 0, 0);         // Point at origin

    // 3. CREATE RENDERER (draws the 3D scene to the screen)
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    // 4. ADD LIGHTS (so we can see things)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);  // Soft overall light
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);  // Directional light
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    // 5. ADD HELPERS (visual guides)
    const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0xcccccc);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // 6. START ANIMATION LOOP
    animate();

    // 7. HANDLE WINDOW RESIZE
    window.addEventListener('resize', onWindowResize);

    console.log('✓ Three.js initialized successfully!');
}

// Animation loop - runs ~60 times per second
function animate() {
    requestAnimationFrame(animate);  // Call this function again next frame

    // Rotate the current mesh slowly
    if (currentMesh) {
        currentMesh.rotation.y += 0.005;  // Rotate around Y axis
    }

    // Render the scene from camera's perspective
    renderer.render(scene, camera);
}

// Handle window resizing
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

    // Remove old mesh if exists
    if (currentMesh) {
        scene.remove(currentMesh);
    }

    const partType = params.type.toLowerCase();
    let geometry, material;

    // Choose material color based on type
    const materialColor = params.material && params.material.includes('carbon') ? 0x222222 :
                         params.material && params.material.includes('titanium') ? 0xcccccc :
                         params.material && params.material.includes('aluminum') ? 0xaaaaaa :
                         0x4488ff;

    material = new THREE.MeshStandardMaterial({
        color: materialColor,
        metalness: 0.7,
        roughness: 0.3
    });

    // GENERATE GEOMETRY BASED ON PART TYPE

    if (partType.includes('wing')) {
        geometry = createWing(params);
    } else if (partType.includes('fuselage')) {
        geometry = createFuselage(params);
    } else if (partType.includes('stabilizer')) {
        geometry = createStabilizer(params);
    } else {
        // Default: Generic component
        geometry = new THREE.BoxGeometry(3, 1, 6);
    }

    // Create mesh and add to scene
    currentMesh = new THREE.Mesh(geometry, material);
    scene.add(currentMesh);

    // Add wireframe overlay for detail
    const wireframe = new THREE.WireframeGeometry(geometry);
    const line = new THREE.LineSegments(wireframe);
    line.material.color.setHex(0x000000);
    line.material.opacity = 0.15;
    line.material.transparent = true;
    currentMesh.add(line);

    console.log('✓ Aircraft part generated!');
}

// CREATE WING GEOMETRY
function createWing(params) {
    const span = params.span || 10;         // Wingspan in meters
    const chord = params.chord || 2;        // Chord length in meters
    const sweep = (params.sweep || 0) * Math.PI / 180;  // Convert degrees to radians

    // Create wing profile (airfoil shape)
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(chord, 0);
    shape.lineTo(chord * 0.9, chord * 0.1);
    shape.lineTo(chord * 0.1, chord * 0.1);
    shape.closePath();

    // Extrude to create 3D wing
    const extrudeSettings = {
        steps: 20,
        depth: span,
        bevelEnabled: true,
        bevelThickness: 0.1,
        bevelSize: 0.1,
        bevelSegments: 3
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.rotateZ(sweep);          // Apply sweep angle
    geometry.rotateX(Math.PI / 2);    // Orient correctly

    return geometry;
}

// CREATE FUSELAGE GEOMETRY
function createFuselage(params) {
    const length = params.length || 8;      // Length in meters
    const diameter = params.diameter || 2;   // Diameter in meters

    // Create cylinder with taper
    const geometry = new THREE.CylinderGeometry(
        diameter / 2,          // Top radius
        diameter / 2 * 0.8,    // Bottom radius (tapered)
        length,                // Height
        32                     // Segments
    );
    geometry.rotateZ(Math.PI / 2);  // Horizontal orientation

    return geometry;
}

// CREATE STABILIZER GEOMETRY
function createStabilizer(params) {
    const span = params.span || 4;
    const chord = 1.5;

    // Tail stabilizer shape
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(chord, 0);
    shape.lineTo(chord * 0.8, chord * 0.15);
    shape.lineTo(chord * 0.2, chord * 0.15);
    shape.closePath();

    const extrudeSettings = {
        steps: 10,
        depth: span,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // Vertical or horizontal based on description
    const partType = params.type.toLowerCase();
    if (partType.includes('vertical')) {
        geometry.rotateX(Math.PI / 2);
    } else {
        const sweep = (params.sweep || 0) * Math.PI / 180;
        geometry.rotateZ(sweep);
        geometry.rotateX(Math.PI / 2);
    }

    return geometry;
}

// ============================================
// GEMINI API INTEGRATION - AUTO-DETECT MODEL
// ============================================

// Cache for the working model (so we don't have to detect every time)
let cachedWorkingModel = null;

// Find a working Gemini model automatically
async function findWorkingModel(apiKey) {
    console.log('🔍 Auto-detecting working Gemini model...');
    
    // Try to list available models
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
        );
        
        if (!response.ok) {
            throw new Error('Could not list models');
        }
        
        const data = await response.json();
        
        // Find models that support generateContent
        if (data.models && data.models.length > 0) {
            for (const model of data.models) {
                const methods = model.supportedGenerationMethods || [];
                if (methods.includes('generateContent')) {
                    // Extract just the model name (e.g., "gemini-1.5-flash" from "models/gemini-1.5-flash")
                    const modelName = model.name.replace('models/', '');
                    console.log('✓ Found working model:', modelName);
                    return modelName;
                }
            }
        }
    } catch (error) {
        console.log('⚠️ Could not auto-detect, trying fallback models...');
    }
    
    // Fallback: try common models in order
    const fallbackModels = [
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-1.5-flash-latest',
        'gemini-pro'
    ];
    
    for (const model of fallbackModels) {
        try {
            console.log(`🧪 Testing ${model}...`);
            const testResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: 'test' }] }]
                    })
                }
            );
            
            if (testResponse.ok) {
                console.log(`✓ ${model} works!`);
                return model;
            }
        } catch (error) {
            console.log(`✗ ${model} failed`);
        }
    }
    
    throw new Error('No working Gemini model found. Please check your API key.');
}

async function callGeminiAPI(apiKey, userInput) {
    console.log('🤖 Calling Gemini API...');

    // Find working model if we haven't already
    if (!cachedWorkingModel) {
        cachedWorkingModel = await findWorkingModel(apiKey);
    }
    
    console.log('📡 Using model:', cachedWorkingModel);

    // Create prompt for AI
    const prompt = `Extract aircraft part parameters from this description and return ONLY valid JSON.

Description: "${userInput}"

Extract these parameters:
{
  "type": "wing/fuselage/stabilizer",
  "span": number in meters or null,
  "length": number in meters or null,
  "diameter": number in meters or null,
  "chord": number in meters or 2 (default for wings),
  "sweep": number in degrees or null,
  "material": "carbon/titanium/aluminum or null"
}

Return ONLY the JSON object, no other text.`;

    try {
        // Make API request to Gemini with auto-detected model
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/${cachedWorkingModel}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]
                })
            }
        );

        // Check if request was successful
        if (!response.ok) {
            const errorData = await response.json();
            // If model failed, clear cache and try again
            cachedWorkingModel = null;
            throw new Error(errorData.error?.message || 'API request failed');
        }

        // Parse response
        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;

        // Extract JSON from response (AI might wrap it in markdown)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const params = JSON.parse(jsonMatch[0]);
            console.log('✓ Parameters extracted:', params);
            return params;
        } else {
            throw new Error('Could not extract JSON from AI response');
        }

    } catch (error) {
        console.error('❌ Gemini API Error:', error);
        throw error;
    }
}

// ============================================
// UI INTERACTIONS
// ============================================

// Generate button click handler
document.getElementById('generateBtn').addEventListener('click', async function() {
    const userInput = document.getElementById('userInput').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const output = document.getElementById('output');
    const button = this;

    // Validate inputs
    if (!apiKey) {
        output.innerHTML = '<p class="error">⚠️ Please enter your API key!</p>';
        return;
    }

    if (!userInput) {
        output.innerHTML = '<p class="error">⚠️ Please describe an aircraft part!</p>';
        return;
    }

    // Disable button and show loading
    button.disabled = true;
    output.innerHTML = '<p class="loading">🤖 AI is analyzing your description...</p>';

    try {
        // Step 1: Get parameters from AI
        const params = await callGeminiAPI(apiKey, userInput);

        // Step 2: Display extracted parameters
        displayParameters(params);

        // Step 3: Generate 3D model
        generateAircraftPart(params);

        // Step 4: Show success message
        output.innerHTML += '<p class="success" style="margin-top:10px;">✓ 3D model generated successfully!</p>';

    } catch (error) {
        output.innerHTML = `<p class="error">❌ Error: ${error.message}</p>`;
        console.error('Generation failed:', error);
    } finally {
        button.disabled = false;
    }
});

// Example chip click handlers
document.querySelectorAll('.example-chip').forEach(chip => {
    chip.addEventListener('click', function() {
        document.getElementById('userInput').value = this.dataset.example;
    });
});

// Display extracted parameters in UI
function displayParameters(params) {
    const output = document.getElementById('output');

    let html = '<h4 class="success">✓ Extracted Parameters:</h4>';
    html += '<div class="params-box">';

    for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined) {
            html += `<div class="param-item"><strong>${key}:</strong> ${value}</div>`;
        }
    }

    html += '</div>';
    output.innerHTML = html;
}

// ============================================
// INITIALIZATION
// ============================================

console.log('🚀 Aircraft Generator Ready!');
console.log('📝 Enter a description and click Generate to create your aircraft part.');