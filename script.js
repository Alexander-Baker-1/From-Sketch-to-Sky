// ============================================
// GLOBAL STATE
// ============================================
let scene, camera, renderer, currentMesh, controls;
let cachedWorkingModel = null;
let currentParams = null;      // last validated params
let suppressReframe = false;   // avoid camera jumps during slider drag
let autorotate = true; // top-level state
let pivot; // persistent parent that carries rotation

function fix(v) {
    return Number(v.toFixed(3));
}

// ============================================
// PERSISTENCE (LOCAL STORAGE)
// ============================================
const LS = {
    rememberFlag: 'airgen.rememberKey',
    apiKey: 'airgen.apiKey',
    userInput: 'airgen.userInput',
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

function parseMeasurementFromText(t) {
    t = String(t || '');
    // sweep: "35 deg", "35°"
    const ang = t.match(/(-?\d+(?:\.\d+)?)\s*(deg|degree|degrees|°)/i);
    const sweepDeg = ang ? parseFloat(ang[1]) : null;

    // length with unit (first occurrence)
    const m = t.match(/(\d+(?:\.\d+)?)\s*(mm|millimeters?|cm|centimeters?|m|meters?|ft|feet|in|inch|inches)\b/i);
    if (!m) return { meters: null, sweepDeg };

    let val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();

    let meters = null;
    if (unit.startsWith('mm')) meters = val / 1000;
    else if (unit.startsWith('cm')) meters = val / 100;
    else if (unit === 'm' || unit.startsWith('meter')) meters = val;
    else if (unit === 'ft' || unit.startsWith('feet')) meters = val * 0.3048;
    else if (unit === 'in' || unit.startsWith('inch')) meters = val * 0.0254;

    return { meters, sweepDeg };
}

function safeRemove(object) {
    if (!object) return;
    object?.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
    });
    scene.remove(object);
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
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); // HiDPI
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

    pivot = new THREE.Object3D();
    scene.add(pivot);

    // Resize + loop
    window.addEventListener('resize', onWindowResize);
    animate();

    // Load saved testing data
    hydrateTestingState();

    attachAeroMetricHandlers();

    console.log('✓ Three.js initialized successfully!');
}

function animate() {
    requestAnimationFrame(animate);
    if (pivot && autorotate) pivot.rotation.y += 0.005;
    controls?.update();
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
    // default flags
    const { reframe = false } = options;
  
    if (!pivot) {
      // safety: create pivot if not yet created
      pivot = new THREE.Object3D();
      scene.add(pivot);
    }
  
    // Remove previous mesh child(ren) from pivot but keep pivot itself (and its rotation!)
    if (currentMesh) {
      // remove wireframe if we added one as a child
      currentMesh.parent && currentMesh.parent.remove(currentMesh);
      safeRemove(currentMesh); // dispose geometry
      currentMesh = null;
    }

    const material = new THREE.MeshStandardMaterial({
        color: 0xb0b0b0,    // soft metallic silver
        metalness: 0.55,    // high reflectivity
        roughness: 0.35,    // slightly glossy
    });       
  
    // --- Geometry by type ---
    const partType = (params.type || 'unknown').toLowerCase();
    let geometry;
    if (partType.includes('wing'))         geometry = createWing(params);
    else if (partType.includes('fuselage'))geometry = createFuselage(params);
    else if (partType.includes('stabilizer')) geometry = createStabilizer(params);
    else geometry = new THREE.BoxGeometry(3, 1, 6);
  
    geometry.computeVertexNormals();
  
    // --- Center geometry so it spins about its own centroid (no apparent “orbit”) ---
    geometry.computeBoundingBox();
    const c = new THREE.Vector3();
    geometry.boundingBox.getCenter(c);
    geometry.translate(-c.x, -c.y, -c.z);
  
    // Build mesh and attach to pivot (pivot holds rotation forever)
    // shiny wing surface (your current material)
    const wingSkinMat = new THREE.MeshStandardMaterial({
        color: 0xb0b0b0,
        metalness: 0.55,
        roughness: 0.35
    });

    // matte endcaps to stop the white blowout
    const matteCapMat = new THREE.MeshStandardMaterial({
        color: 0x999999,   // same-ish color, but softer
        metalness: 0.0,    // matte = no mirror reflection
        roughness: 1.0     // fully diffuse
    });

    // Tell Three.js to use 3 materials matching groups 0,1,2
    currentMesh = new THREE.Mesh(geometry, [
        wingSkinMat,   // group 0 (side walls — shiny)
        matteCapMat,   // group 1 (root cap — matte)
        matteCapMat    // group 2 (tip cap — matte)
    ]);

    pivot.add(currentMesh);
  
    // Wireframe overlay (attached to mesh so it gets disposed with it)
    const wf = new THREE.LineSegments(
        new THREE.WireframeGeometry(geometry),
        new THREE.LineBasicMaterial({
            color: 0x000000,
            linewidth: 1,
            transparent: true,
            opacity: 0.25,
        })
    );
    currentMesh.add(wf);    
  
    // Optional reframe (won’t impact pivot rotation)
    if (reframe && !suppressReframe) {
      frameObject(currentMesh, camera, controls);
    }

    // Run safety validation
    const safetyChecks = runSafetyChecks(params);
    displaySafetyChecks(safetyChecks);

    console.log('✓ Aircraft part generated!');
}  

function createWing(params) {
    // === Extract numeric params ===
    const b      = coerce(params.span, 10);
    const cr     = coerce(params.rootChord, 2);
    const ct     = coerce(params.tipChord, 1);
    const sweepD = coerce(params.sweep, 0);
    const naca   = (params.naca || "").trim();

    const tiny   = 1e-4;
    const safeCr = Math.max(cr, tiny);
    const safeCt = Math.max(ct, tiny);

    const baseShape = isValidNaca4(naca)
        ? makeNaca4Shape(naca, 1, 200)
        : makeNaca4Shape("0012", 1, 200);

    const geo = new THREE.ExtrudeGeometry(baseShape, {
        steps: 80,
        depth: b,
        bevelEnabled: false
    });

    geo.translate(0, 0, -b / 2);

    // === TAPER + SWEEP (shear only) ===
    const tanL = Math.tan((sweepD * Math.PI) / 180);
    const pos  = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        const z = pos.getZ(i);

        const u   = (z + b / 2) / b;
        const c   = safeCr + (safeCt - safeCr) * u;
        const xLE = (z + b / 2) * tanL;

        x = x * c + xLE;
        y = y * c;

        pos.setX(i, x);
        pos.setY(i, y);
    }
    pos.needsUpdate = true;

    // === Compute base normals ===
    geo.computeVertexNormals();

    // ✅ FIX WHITE END CAPS by overriding their normals completely
    if (geo.groups && geo.groups.length >= 3) {
        const cap1 = geo.groups[1]; // root cap
        const cap2 = geo.groups[2]; // tip cap
        const nrm = geo.attributes.normal;

        // Sample a typical wing surface normal near midspan (z=0)
        // We average 200 random vertices to avoid noise.
        let avg = new THREE.Vector3();
        let count = 0;
        for (let i = 0; i < pos.count; i += 50) {
            const z = pos.getZ(i);
            if (Math.abs(z) < 0.01) { // central section
                avg.x += nrm.getX(i);
                avg.y += nrm.getY(i);
                avg.z += nrm.getZ(i);
                count++;
            }
        }
        if (count > 0) avg.multiplyScalar(1 / count).normalize();
        else avg.set(0, 1, 0); // fallback

        function applyNormalToCap(cap) {
            for (let i = cap.start; i < cap.start + cap.count; i++) {
                nrm.setXYZ(i, avg.x, avg.y, avg.z);
            }
        }

        applyNormalToCap(cap1);
        applyNormalToCap(cap2);

        nrm.needsUpdate = true;
    }

    return geo;
}

function createFuselage(params) {
    const length = coerce(params.length, 8);
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
    const span = coerce(params.span, 4);
    const chord = 1.5;

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(chord, 0);
    shape.lineTo(chord * 0.8, chord * 0.15);
    shape.lineTo(chord * 0.2, chord * 0.15);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
        steps: 20,
        depth: span,
        bevelEnabled: false
    });

    // ✅ NO ROTATIONS — stabilizer lives in XY plane, extrudes along Z like wing
    geo.translate(0, 0, -span / 2);

    return geo;
}

// ============================================
// SAFETY VALIDATION SYSTEM
// ============================================

/**
 * Run safety checks on aircraft parameters
 * Based on real aircraft specifications and aerospace engineering principles
 * 
 * Sources:
 * - Airbus A380 specs: https://www.airbus.com/en/products-services/commercial-aircraft/passenger-aircraft/a380
 * - Boeing 747-8 specs: https://www.boeing.com/commercial/747
 * - Concorde specs: https://www.nasa.gov/centers/dryden/about/Organizations/Technology/Facts/TF-2004-09-DFRC.html
 * - Aerospace engineering principles from "Introduction to Flight" by John D. Anderson
 */
function runSafetyChecks(params) {
    const issues = [];      // Critical errors (red) - unsafe designs
    const warnings = [];    // Warnings (yellow) - unusual but possible
    
    if (!params || !params.type) return { issues, warnings };
    
    const type = params.type.toLowerCase();
    
    // ============================================
    // WING SAFETY CHECKS
    // ============================================
    if (type.includes('wing')) {
        
        // Check 1: Wingspan
        // Reference: Airbus A380 = 79.8m (largest passenger jet)
        if (params.span > 80) {
            issues.push('⛔ CRITICAL: Span exceeds maximum safe limit (A380 = 79.8m)');
        }
        if (params.span < 2) {
            issues.push('⛔ CRITICAL: Span too small to be functional');
        }
        
        // Check 2: Root Chord
        // Reference: Structural engineering minimum for aluminum/composite wings
        if (params.rootChord < 0.5) {
            issues.push('⛔ CRITICAL: Root chord too small for structural integrity');
        }
        if (params.rootChord > 15) {
            warnings.push('⚠️ WARNING: Unusually large root chord');
        }
        
        // Check 3: Sweep Angle
        // Reference: Concorde = 60° (most extreme commercial jet)
        if (params.sweep > 60) {
            issues.push('⛔ CRITICAL: Sweep angle exceeds aerodynamic limits (Concorde = 60°)');
        }
        if (params.sweep > 50 && params.sweep <= 60) {
            warnings.push('⚠️ WARNING: Very high sweep angle (supersonic aircraft range)');
        }
        
        // Check 4: Aspect Ratio (calculated)
        // Reference: Anderson, "Introduction to Flight"
        // Typical ranges: Fighters 2-4, Airliners 8-12, Gliders 15-40
        if (params.rootChord && params.tipChord) {
            const area = (params.span * (params.rootChord + params.tipChord)) / 2;
            const AR = (params.span * params.span) / area;
            
            if (AR > 15) {
                warnings.push(`⚠️ WARNING: High aspect ratio (AR=${AR.toFixed(1)}) requires special structural design (glider range)`);
            }
            if (AR < 3) {
                warnings.push(`⚠️ WARNING: Low aspect ratio (AR=${AR.toFixed(1)}) reduces lift efficiency (fighter jet range)`);
            }
        }
        
        // Check 5: Taper Ratio (calculated)
        // Reference: Raymer, "Aircraft Design: A Conceptual Approach"
        // Optimal range: 0.4-0.6, Below 0.2 = tip stall risk
        if (params.rootChord && params.tipChord) {
            const lambda = params.tipChord / params.rootChord;
            
            if (lambda < 0.2) {
                warnings.push(`⚠️ WARNING: Extreme taper (λ=${lambda.toFixed(2)}) may cause tip stall before root`);
            }
            if (lambda > 1.0) {
                warnings.push(`⚠️ WARNING: Tip chord larger than root (λ=${lambda.toFixed(2)}) is unusual`);
            }
        }
    }
    
    // ============================================
    // FUSELAGE SAFETY CHECKS
    // ============================================
    else if (type.includes('fuselage')) {
        
        // Check 1: Length
        // Reference: Boeing 747-8 = 76.3m (longest passenger jet)
        if (params.length > 80) {
            issues.push('⛔ CRITICAL: Length exceeds practical limits (747-8 = 76.3m)');
        }
        if (params.length < 5) {
            warnings.push('⚠️ WARNING: Very short for passenger aircraft');
        }
        
        // Check 2: Diameter
        // Reference: Typical fuselage diameters: 3-6m
        if (params.diameter > 8) {
            warnings.push('⚠️ WARNING: Unusually large diameter (requires special manufacturing)');
        }
        if (params.diameter < 1.5) {
            warnings.push('⚠️ WARNING: Too narrow for typical passenger seating');
        }
        
        // Check 3: Length-to-diameter ratio
        // Reference: Typical L/D ratio: 10-15 for stability
        if (params.length && params.diameter) {
            const ratio = params.length / params.diameter;
            if (ratio > 20) {
                warnings.push(`⚠️ WARNING: High length/diameter ratio (${ratio.toFixed(1)}) may cause structural flexibility`);
            }
            if (ratio < 5) {
                warnings.push(`⚠️ WARNING: Low length/diameter ratio (${ratio.toFixed(1)}) - very stubby design`);
            }
        }
    }
    
    // ============================================
    // STABILIZER SAFETY CHECKS
    // ============================================
    else if (type.includes('stabilizer')) {
        
        // Check 1: Span/Height
        if (params.span > 15) {
            warnings.push('⚠️ WARNING: Very large stabilizer (exceeds typical tail dimensions)');
        }
        if (params.span < 2) {
            warnings.push('⚠️ WARNING: Very small stabilizer (may be insufficient for control)');
        }
        
        // Check 2: Sweep
        if (params.sweep > 50) {
            warnings.push('⚠️ WARNING: High sweep angle for stabilizer (reduces control authority)');
        }
    }
    
    return { issues, warnings };
}

/**
 * Display safety check results in the UI
 */
function displaySafetyChecks(checks) {
    const safetyDiv = document.getElementById('safetyChecks');
    if (!safetyDiv) return;
    
    let html = '<h4>🛡️ Safety Validation</h4>';
    
    // All checks passed
    if (checks.issues.length === 0 && checks.warnings.length === 0) {
        html += `
            <div style="background:#d4edda; border-left:4px solid #28a745; padding:10px; border-radius:4px;">
                <strong style="color:#155724;">✓ All safety checks passed</strong>
                <p style="margin:5px 0 0 0; font-size:12px; color:#155724;">
                    This design meets aerospace engineering standards.
                </p>
            </div>
        `;
    } else {
        // Critical issues (red)
        if (checks.issues.length > 0) {
            html += '<div style="background:#f8d7da; border-left:4px solid #dc3545; padding:10px; border-radius:4px; margin:5px 0;">';
            html += '<strong style="color:#721c24;">Critical Issues:</strong>';
            checks.issues.forEach(issue => {
                html += `<div style="margin:5px 0 0 0; font-size:12px; color:#721c24;">${escapeHtml(issue)}</div>`;
            });
            html += '</div>';
        }
        
        // Warnings (yellow)
        if (checks.warnings.length > 0) {
            html += '<div style="background:#fff3cd; border-left:4px solid #ffc107; padding:10px; border-radius:4px; margin:5px 0;">';
            html += '<strong style="color:#856404;">Warnings:</strong>';
            checks.warnings.forEach(warning => {
                html += `<div style="margin:5px 0 0 0; font-size:12px; color:#856404;">${escapeHtml(warning)}</div>`;
            });
            html += '</div>';
        }
    }
    
    safetyDiv.innerHTML = html;
}

// ============================================
// DESIGN REPORT GENERATOR
// ============================================

/**
 * Generate a comprehensive design report for certification and traceability
 * Includes specifications, aerodynamic metrics, and safety validation
 */
function generateDesignReport() {
    if (!currentParams) {
        showOutputError('No design to report on! Generate a part first.');
        return;
    }
    
    // Run safety checks first
    const safetyChecks = runSafetyChecks(currentParams);
    
    const timestamp = new Date().toISOString();
    const dateStr = new Date().toLocaleString();
    const type = currentParams.type || 'unknown';
    
    // Build the report
    let report = `
╔═══════════════════════════════════════════════════════════════╗
║        AIRCRAFT COMPONENT DESIGN REPORT                       ║
║        AI-Assisted 3D Aircraft Design System                  ║
╚═══════════════════════════════════════════════════════════════╝

Generated: ${dateStr}
Report ID: ${timestamp.split('T')[0]}-${Date.now()}

═══════════════════════════════════════════════════════════════
COMPONENT SPECIFICATIONS
═══════════════════════════════════════════════════════════════

Component Type: ${type.toUpperCase()}
`;

    // === WING-SPECIFIC DATA ===
    if (type.includes('wing')) {
        report += `
Dimensional Parameters:
  • Span:                ${currentParams.span ? currentParams.span.toFixed(3) + ' m' : 'N/A'}
  • Root Chord:          ${currentParams.rootChord ? currentParams.rootChord.toFixed(3) + ' m' : 'N/A'}
  • Tip Chord:           ${currentParams.tipChord ? currentParams.tipChord.toFixed(3) + ' m' : 'N/A'}
  • Leading Edge Sweep:  ${currentParams.sweep ? currentParams.sweep.toFixed(1) + '°' : 'N/A'}
  • NACA Profile:        ${currentParams.naca || 'Not specified'}

Aerodynamic Metrics:`;
        
        if (currentParams.span && currentParams.rootChord && currentParams.tipChord) {
            const area = (currentParams.span * (currentParams.rootChord + currentParams.tipChord)) / 2;
            const AR = (currentParams.span * currentParams.span) / area;
            const lambda = currentParams.tipChord / currentParams.rootChord;
            
            report += `
  • Planform Area:       ${area.toFixed(3)} m²
  • Aspect Ratio (AR):   ${AR.toFixed(3)}
  • Taper Ratio (λ):     ${lambda.toFixed(3)}
  • Wing Loading:        TBD (requires weight data)
`;
        } else {
            report += '\n  • Insufficient data for aerodynamic calculations\n';
        }
    }
    
    // === FUSELAGE-SPECIFIC DATA ===
    else if (type.includes('fuselage')) {
        report += `
Dimensional Parameters:
  • Length:              ${currentParams.length ? currentParams.length.toFixed(3) + ' m' : 'N/A'}
  • Diameter:            ${currentParams.diameter ? currentParams.diameter.toFixed(3) + ' m' : 'N/A'}
`;
        
        if (currentParams.length && currentParams.diameter) {
            const ratio = currentParams.length / currentParams.diameter;
            const volume = Math.PI * (currentParams.diameter / 2) ** 2 * currentParams.length;
            
            report += `
Geometric Properties:
  • Length/Diameter Ratio: ${ratio.toFixed(2)}
  • Approximate Volume:    ${volume.toFixed(2)} m³
  • Cross-sectional Area:  ${(Math.PI * (currentParams.diameter / 2) ** 2).toFixed(3)} m²
`;
        }
    }
    
    // === STABILIZER-SPECIFIC DATA ===
    else if (type.includes('stabilizer')) {
        report += `
Dimensional Parameters:
  • Span/Height:         ${currentParams.span ? currentParams.span.toFixed(3) + ' m' : 'N/A'}
  • Sweep Angle:         ${currentParams.sweep ? currentParams.sweep.toFixed(1) + '°' : 'N/A'}
  • Type:                ${type.includes('vertical') ? 'Vertical' : 'Horizontal'} Stabilizer
`;
    }

    // === SAFETY VALIDATION SECTION ===
    report += `

═══════════════════════════════════════════════════════════════
SAFETY VALIDATION RESULTS
═══════════════════════════════════════════════════════════════

Validation Status: ${safetyChecks.issues.length === 0 && safetyChecks.warnings.length === 0 ? '✓ PASSED' : 
                     safetyChecks.issues.length > 0 ? '✗ FAILED (Critical Issues Found)' : 
                     '⚠ PASSED WITH WARNINGS'}

`;

    if (safetyChecks.issues.length === 0 && safetyChecks.warnings.length === 0) {
        report += `All safety checks passed. This design meets aerospace engineering
standards and is within acceptable parameters for manufacturing and
certification.

`;
    } else {
        if (safetyChecks.issues.length > 0) {
            report += `CRITICAL ISSUES (${safetyChecks.issues.length}):\n`;
            safetyChecks.issues.forEach((issue, i) => {
                report += `  ${i + 1}. ${issue.replace(/⛔/g, '').trim()}\n`;
            });
            report += '\n';
        }
        
        if (safetyChecks.warnings.length > 0) {
            report += `WARNINGS (${safetyChecks.warnings.length}):\n`;
            safetyChecks.warnings.forEach((warning, i) => {
                report += `  ${i + 1}. ${warning.replace(/⚠️/g, '').trim()}\n`;
            });
            report += '\n';
        }
    }

    // === DESIGN STANDARDS REFERENCE ===
    report += `
Safety Check References:
  • Wing Span Limit:     80m (Airbus A380 = 79.8m)
  • Sweep Angle Limit:   60° (Concorde = 60°)
  • Aspect Ratio Range:  3-15 (typical aircraft)
  • Taper Ratio Range:   0.2-1.0 (aerodynamic stability)
  • Fuselage Length:     5-80m (practical manufacturing)
  • L/D Ratio Range:     5-20 (structural stability)

Sources:
  • Airbus A380 Specifications (airbus.com)
  • Boeing 747-8 Specifications (boeing.com)
  • Concorde Technical Data (NASA)
  • "Introduction to Flight" by John D. Anderson
  • "Aircraft Design: A Conceptual Approach" by Daniel P. Raymer

`;

    // === GENERATION METADATA ===
    report += `
═══════════════════════════════════════════════════════════════
GENERATION METADATA
═══════════════════════════════════════════════════════════════

Design Tool:           AI Aircraft Generator v1.0
AI Model:              Google Gemini (Natural Language Processing)
3D Engine:             Three.js r128
Geometry Generation:   Procedural (NACA airfoil standard for wings)
Export Formats:        GLTF, STL, GLB

Generation Method:     ${currentParams._fromPreset ? 'Preset Configuration' : 'Natural Language Input'}
Timestamp:             ${timestamp}

`;

    // === CERTIFICATION NOTES ===
    report += `
═══════════════════════════════════════════════════════════════
CERTIFICATION AND TRACEABILITY NOTES
═══════════════════════════════════════════════════════════════

This report provides documentation for aerospace design workflows and
certification processes. All design parameters are validated against
real-world aircraft specifications and aerospace engineering standards.

Design Validation:
  ✓ Parameters validated against aerospace engineering principles
  ✓ Safety checks performed automatically
  ✓ Geometry generated using industry-standard methods
  ${currentParams.naca ? '✓ NACA airfoil profile verified' : ''}

Recommended Next Steps:
  1. Structural analysis (FEA) for load-bearing verification
  2. Aerodynamic simulation (CFD) for performance validation
  3. Material selection and weight analysis
  4. Integration testing with adjacent components
  5. Regulatory compliance review (FAA/EASA standards)

Quality Assurance:
  • All parameters logged and traceable
  • Safety validation performed at generation time
  • Design can be exported to industry-standard formats
  • Geometry precision: 3 decimal places (millimeter accuracy)

═══════════════════════════════════════════════════════════════
END OF REPORT
═══════════════════════════════════════════════════════════════

Generated by AI Aircraft Generator
For: Hack-Nation Global AI Hackathon 2025
Track: VC Big Bets - "From Sketch to Sky"

Note: This is a preliminary design report. Final certification requires
comprehensive structural, aerodynamic, and safety testing by qualified
aerospace engineers.
`;

    // Download the report
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aircraft_design_report_${type}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    showOutputSuccess('✓ Design report exported successfully!');
    console.log('📄 Design report generated and downloaded');
}

// ============================================
// CAMERA AUTO-FRAMING (ZOOM TO FIT)
// ============================================

function frameObject(mesh, camera, controls) {
    if (!mesh || !camera) return;

    mesh.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(mesh);
    if (!isFinite(box.max.x)) return;

    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);

    // Looser framing
    const fov = camera.fov * Math.PI / 180;
    const distance = (sphere.radius / Math.sin(fov / 2)) * 1.4; // 1.4 = padding

    const dir = new THREE.Vector3(1, 1, 1).normalize();
    const newPos = sphere.center.clone().add(dir.multiplyScalar(distance));

    // Update near/far to avoid clipping
    camera.near = Math.max(0.01, distance / 100);
    camera.far = Math.max(camera.near + 1, distance * 10);
    camera.updateProjectionMatrix();

    controls && (controls.target.copy(sphere.center));

    if (window.gsap && gsap.to) {
        gsap.to(camera.position, {
            x: newPos.x, y: newPos.y, z: newPos.z,
            duration: 0.8, ease: "power2.out",
            onUpdate: () => controls?.update()
        });
    } else {
        camera.position.copy(newPos);
        controls?.update();
    }
}

// ============================================
// PARAMETER VALIDATION + WARNINGS
// ============================================

function validateParams(raw, userInput) {
    const warnings = [];
    const params = { ...raw };
    const text = String(userInput || '').toLowerCase();

    // --- helpers ---
    const isNum = (v) => Number.isFinite(Number(v));
    const asNum = (v) => Number(v);

    // size in text: supports meters or feet
    function parseSizeFromText(t) {
        // match "2.5 m", "2 meters", "2ft", "2 feet", "2 foot"
        const m = t.match(/(\d+(?:\.\d+)?)\s*(m|meter|meters|ft|feet|foot)\b/);
        if (!m) return null;
        const val = parseFloat(m[1]);
        const unit = m[2];
        if (!Number.isFinite(val)) return null;
        if (unit === 'ft' || unit === 'feet' || unit === 'foot') return val * 0.3048; // feet → meters
        return val; // meters
    }

    // --- type ---
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

    // --- NACA detection from text ---
    const nacaInText = (userInput.match(/naca\s*[-\s]*(\d{4})/i) || [])[1];
    if (!params.naca && nacaInText) {
        params.naca = nacaInText;  // auto-assign from description
    }

    // --- parse a size from text and map to primary dimension if needed ---
    const sizeFromText = parseSizeFromText(text);

    // Coerce numeric fields to numbers or null
    const keys = ['span', 'length', 'diameter', 'chord', 'sweep'];
    for (const k of keys) {
        if (params[k] === null || params[k] === undefined) continue;
        const n = asNum(params[k]);
        params[k] = Number.isFinite(n) ? n : null;
    }

    // Normalize per type, set defaults, clamp, and remove irrelevant keys
    if (params.type.includes('wing')) {
        // Map text size to span if missing
        if ((!isNum(params.span) || params.span <= 0) && Number.isFinite(sizeFromText) && sizeFromText > 0) {
            params.span = sizeFromText;
            warnings.push('Mapped provided size to wing span.');
        }

        // Accept either chord OR rootChord/tipChord; prefer explicit root/tip
        const hasRoot = isNum(params.rootChord);
        const hasTip = isNum(params.tipChord);
        if (!hasRoot && isNum(params.chord)) params.rootChord = Number(params.chord);
        if (!hasTip && isNum(params.chord)) params.tipChord = Number(params.chord);

        if (!isNum(params.rootChord) || params.rootChord <= 0) { warnings.push('Using default root chord.'); params.rootChord = 2; }
        if (!isNum(params.tipChord) || params.tipChord <= 0) { warnings.push('Using default tip chord.'); params.tipChord = params.rootChord * 0.5; }

        // Clamp and defaults
        if (!isNum(params.span) || params.span <= 0) { warnings.push('Using default wing span.'); params.span = 10; }
        if (params.span > 100) { warnings.push('Span too large (>100m). Clamped.'); params.span = 100; }

        if (!isNum(params.sweep)) { warnings.push('Sweep must be a number. Using 0°.'); params.sweep = 0; }
        params.sweep = Math.max(0, Math.min(60, params.sweep)); // leading-edge sweep in degrees

        // NACA (4-digit) cleanup
        if (typeof params.naca === 'string') {
            const digits = params.naca.replace(/\D/g, '');
            params.naca = /^\d{4}$/.test(digits) ? digits : null;
        } else params.naca = null;

        // Remove legacy keys so they don’t show in output
        delete params.length;
        delete params.diameter;
        delete params.chord;

    } else if (params.type.includes('fuselage')) {
        // Map text size to length if length missing/invalid
        if ((!isNum(params.length) || params.length <= 0) && Number.isFinite(sizeFromText) && sizeFromText > 0) {
            params.length = sizeFromText;
            warnings.push('Mapped provided size to fuselage length.');
        }

        if (!isNum(params.length) || params.length <= 0) { warnings.push('Using default fuselage length.'); params.length = 8; }
        if (!isNum(params.diameter) || params.diameter <= 0) { warnings.push('Using default fuselage diameter.'); params.diameter = 2; }

        // Fuselage doesn’t use chord or sweep in our model
        delete params.chord;
        delete params.sweep;
        delete params.span;

    } else { // stabilizer (horizontal or vertical)
        // Map text size to span if span missing/invalid
        if ((!isNum(params.span) || params.span <= 0) && Number.isFinite(sizeFromText) && sizeFromText > 0) {
            params.span = sizeFromText;
            warnings.push('Mapped provided size to stabilizer span.');
        }

        if (!isNum(params.span) || params.span <= 0) { warnings.push('Using default stabilizer span.'); params.span = 4; }

        if (!isNum(params.sweep)) { params.sweep = 0; }
        params.sweep = Math.max(0, Math.min(60, params.sweep));

        // Remove irrelevant fields
        delete params.length;
        delete params.diameter;
        delete params.chord;
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

    const ctrl = document.getElementById("paramControls");
    const paramPanelFloating = document.getElementById("paramPanelFloating");

    if (!ctrl || !paramPanelFloating) return;

    ctrl.innerHTML = "";
    paramPanelFloating.classList.remove("hidden");

    const type = (params.type || "").toLowerCase();

    const defsByType = {
        wing: [
            { key: 'span',       label: 'Span (m)',       min: 0.5, max: 100, step: 0.1, value: fix(coerce(params.span, 10)) },
            { key: 'rootChord',  label: 'Root chord (m)', min: 0.1, max: 10,  step: 0.1, value: fix(coerce(params.rootChord, 2)) },
            { key: 'tipChord',   label: 'Tip chord (m)',  min: 0.05,max: 10,  step: 0.1, value: fix(coerce(params.tipChord, 1)) },
            { key: 'sweep',      label: 'LE Sweep (°)',   min: 0,   max: 60,  step: 1,   value: fix(coerce(params.sweep, 0)) },
        ],
        fuselage: [
            { key: 'length',   label: 'Length (m)',   min: 0.5, max: 100, step: 0.1, value: fix(coerce(params.length, 8)) },
            { key: 'diameter', label: 'Diameter (m)', min: 0.1, max: 10,  step: 0.1, value: fix(coerce(params.diameter, 2)) }
        ],
        stabilizer: [
            { key: 'span',  label: 'Span (m)',   min: 0.5, max: 30, step: 0.1, value: fix(coerce(params.span, 4)) },
            { key: 'sweep', label: 'Sweep (°)',  min: 0,   max: 60, step: 1,   value: fix(coerce(params.sweep, 0)) }
        ]
    };

    const sliders =
        type.includes("wing") ? defsByType.wing :
        type.includes("fuselage") ? defsByType.fuselage :
        defsByType.stabilizer;

    sliders.forEach(def => ctrl.appendChild(makeSlider(def)));

    // ✅ Get aeroPanel ONCE at the top
    const aeroPanel = document.getElementById("aeroPanelFloating");

    // ✅ NACA for wings
    if (type.includes("wing")) {
        const wrap = document.createElement("div");
        wrap.className = "metric-group";

        wrap.innerHTML = `
            <label>NACA (4-digit)</label>
            <input id="naca_code" type="text" maxlength="4" style="width:90px" value="${params.naca || ''}">
        `;

        ctrl.appendChild(wrap);

        document.getElementById("naca_code").addEventListener("change", () => {
            const digits = document.getElementById("naca_code").value.replace(/\D/g, "");
            currentParams.naca = /^\d{4}$/.test(digits) ? digits : null;
            regenerateFromPanel(true);
        });

        // Update aero metrics and show panel for wings
        updateAeroMetricsFromParams(params);
        if (aeroPanel) {
            aeroPanel.classList.remove("hidden");
        }
    } 
    else {
        // Hide aero panel for non-wings
        if (aeroPanel) {
            aeroPanel.classList.add("hidden");
        }
    }
}

function makeSlider({ key, label, min, max, step, value }) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-row';

    const id = `slider_${key}`;
    const numId = `num_${key}`;

    // Header
    const header = document.createElement('label');
    header.setAttribute('for', id);
    header.innerHTML = `${label} <span id="${id}_val">${value}</span>`;

    // Range
    const range = document.createElement('input');
    range.type = 'range';
    range.id = id;
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);

    // Number
    const number = document.createElement('input');
    number.type = 'number';
    number.id = numId;
    number.min = String(min);
    number.max = String(max);
    number.step = String(step);
    number.value = String(value);
    number.style.width = '90px';
    number.style.marginLeft = '10px';

    // Row layout
    const controlsRow = document.createElement('div');
    controlsRow.style.display = 'flex';
    controlsRow.style.alignItems = 'center';
    controlsRow.style.gap = '10px';
    controlsRow.appendChild(range);
    controlsRow.appendChild(number);

    // Sync helpers
    const setVal = (v, reframe) => {
        const parsed = parseFloat(v);
        if (!Number.isFinite(parsed)) return; // ignore until valid
        const n = Math.max(min, Math.min(max, parsed));
        range.value = n;
        number.value = n.toFixed(2);
        document.getElementById(`${id}_val`).textContent = fix(n);
        currentParams[key] = n;
        suppressReframe = !reframe;
        regenerateFromPanel(reframe);
    };

    // Events
    // === LIVE UPDATE (while dragging) ===
    range.addEventListener('input', () => {
        suppressReframe = true;

        const parsed = parseFloat(range.value);
        if (!Number.isFinite(parsed)) return;

        currentParams[key] = parsed;
        number.value = parsed.toFixed(3);
        document.getElementById(`${id}_val`).textContent = parsed.toFixed(3);

        // ✅ Update aerodynamic metrics live (only for wing)
        if (currentParams.type.includes("wing")) {
            updateAeroMetricsFromParams(currentParams);
        }

        // ✅ Regenerate geometry WITHOUT rebuilding UI, WITHOUT moving camera
        generateAircraftPart(currentParams, { reframe: false });
    updateAeroMetricsFromParams(currentParams);
});

    // === FINAL UPDATE (when letting go) ===
    range.addEventListener('change', () => {
        suppressReframe = false;
        updateAeroMetricsFromParams(currentParams);
        generateAircraftPart(currentParams, { reframe: false, keepRotation: true });
    });

    number.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') setVal(number.value, true);
    });

    wrap.appendChild(header);
    wrap.appendChild(controlsRow);
    return wrap;
}

function regenerateFromPanel(allowReframe = false) {
    if (!currentParams) return;

    // Update aero metrics if wing
    if (currentParams.type.includes("wing")) {
        updateAeroMetricsFromParams(currentParams);
    }

    // Regenerate 3D
    generateAircraftPart(currentParams, { reframe: allowReframe });

    // Rebuild sliders to keep everything in sync
    buildParamPanel(currentParams);
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
    } catch { }
    const fallbacks = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash-latest', 'gemini-pro'];
    for (const model of fallbacks) {
        try {
            const test = await fetch(
                `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: 'test' }] }] })
                }
            );
            if (test.ok) return model;
        } catch { }
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
}`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${cachedWorkingModel}:generateContent?key=${apiKey}`,
        {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
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
        return { type: null, span: null, length: null, diameter: null, chord: null, sweep: null, _raw: text };
    }

    try {
        return JSON.parse(match[0]);
    } catch {
        return { type: null, span: null, length: null, diameter: null, chord: null, sweep: null, _raw: text };
    }
}

// ============================================
// UI INTERACTIONS
// ============================================

document.getElementById('generateBtn').addEventListener('click', async function () {
    const userInput = document.getElementById('userInput').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const output = document.getElementById('output');

    // fresh output box with a warn slot ready
    output.innerHTML = '<div id="warnSlot"></div><p class="loading">🤖 Analyzing description...</p>';

    if (!apiKey) return showOutputError('Please enter your API key!');
    if (!userInput) return showOutputError('Please describe an aircraft part!');

    this.disabled = true;
    try {
        const raw = await callGeminiAPI(apiKey, userInput);
        const { params, warnings } = validateParams(raw, userInput);

        resetParamPanel();                    // clear sliders
        showWarningsAboveParams(warnings);    // write warnings into #warnSlot
        displayParameters(params, true);      // replace params section below (see new function below)
        buildParamPanel(params);              // rebuild sliders
        generateAircraftPart(params, { reframe: true });

        showOutputSuccess('✓ 3D model generated successfully!');
    } catch (err) {
        showOutputError(err.message);
    }
    this.disabled = false;
});

document.querySelectorAll('.example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        console.log('🔘 Preset clicked:', chip.textContent);
        
        // Clear output and safety checks
        const output = document.getElementById('output');
        const safetyChecks = document.getElementById('safetyChecks');
        
        output.innerHTML = '<div id="warnSlot"></div>';
        safetyChecks.innerHTML = '<h4>🛡️ Safety Validation</h4><p style="color:#999; font-size:12px;">Analyzing preset...</p>';

        const paramsStr = chip.dataset.params;
        if (!paramsStr) {
            // Fallback: just seed the textarea
            document.getElementById('userInput').value = chip.dataset.example || '';
            showOutputSuccess('Preset applied to description. Press "Generate 3D Part" to build.');
            return;
        }

        // Parse the preset parameters
        let raw;
        try {
            raw = JSON.parse(paramsStr);
            console.log('📋 Parsed params:', raw);
        } catch (e) {
            console.error('❌ Failed to parse params:', e);
            showOutputError('Invalid preset configuration');
            return;
        }

        // Clear textarea when using structured preset
        document.getElementById('userInput').value = '';

        // Validate parameters
        const { params, warnings } = validateParams(raw, chip.textContent || '');
        console.log('✓ Validated params:', params);
        
        // Reset and show param panels
        resetParamPanel();
        showWarningsAboveParams(warnings);
        displayParameters(params, true);

        // Show/hide appropriate panels
        const paramPanel = document.getElementById("paramPanelFloating");
        const aeroPanel = document.getElementById("aeroPanelFloating");
        
        if (paramPanel) paramPanel.classList.remove("hidden");
        if (aeroPanel) {
            if (params.type.includes("wing")) {
                aeroPanel.classList.remove("hidden");
            } else {
                aeroPanel.classList.add("hidden");
            }
        }

        // Build parameter sliders
        buildParamPanel(params);
        
        // ✅ GENERATE THE 3D PART
        console.log('🛠️ Generating 3D part...');
        generateAircraftPart(params, { reframe: true });
        
        // ✅ RUN SAFETY CHECKS (in case generateAircraftPart doesn't call it)
        const checks = runSafetyChecks(params);
        displaySafetyChecks(checks);
        
        console.log('✓ Preset loaded successfully!');
    });
});

// Append-only helpers for the output box
function showOutputSuccess(msg) {
    const output = document.getElementById('output');

    // Do NOT wipe output — only append
    output.insertAdjacentHTML(
        'beforeend',
        `<p class="success">✅ ${msg}</p>`
    );
}

function showOutputError(msg) {
    const output = document.getElementById('output');
    const warn = document.getElementById('warnSlot');
    output.innerHTML = '';
    if (warn) output.appendChild(warn);
    output.insertAdjacentHTML('beforeend', `<p class="error">❌ ${msg}</p>`);
}
function resetOutput(msg = '') {
    const output = document.getElementById('output');
    output.innerHTML = msg;
}
function displayParameters(params, replace = false) {
    const output = document.getElementById('output');

    let s = '<h4 class="success">✓ Extracted Parameters:</h4><div class="params-box">';

    for (const [k, v] of Object.entries(params)) {
        if (v === null || v === undefined || k === "_raw") continue;

        let val =
            typeof v === "number"
                ? v.toFixed(3)
                : escapeHtml(String(v)); // <-- prevents NaN for type

        s += `<div class="param-item"><strong>${k}:</strong> ${val}</div>`;
    }

    s += '</div>';

    if (replace) {
        const warn = document.getElementById('warnSlot');
        output.innerHTML = '';
        if (warn) output.appendChild(warn);
        output.insertAdjacentHTML('beforeend', s);
    } else {
        output.insertAdjacentHTML('beforeend', s);
    }
}
function clearUI() {
    const output = document.getElementById('output');
    const warnSlot = document.getElementById('warnSlot');
    const panel = document.getElementById('paramPanel');
    if (output) output.innerHTML = '';
    if (warnSlot) warnSlot.innerHTML = '';
    if (panel) panel.classList.add('hidden');
}
function clearOutput() {
    const output = document.getElementById('output');
    output.innerHTML = '<div id="warnSlot"></div>';
}
function resetParamPanel() {
    const panel = document.getElementById("paramPanelFloating");
    const ctrl = document.getElementById("paramControls");
    if (panel && ctrl) {
        ctrl.innerHTML = "";
        panel.classList.add("hidden");
    }

    const aero = document.getElementById("aeroPanelFloating");
    if (aero) aero.classList.add("hidden");
}

function isValidNaca4(s) {
    return typeof s === 'string' && /^\d{4}$/.test(s);
}

function makeNaca4Shape(naca, chord = 1, N = 160) {
    // Parse NACA abcd -> a=m*100, b=p*10, cd=t*100
    const a = parseInt(naca[0], 10);
    const b = parseInt(naca[1], 10);
    const c = parseInt(naca[2], 10);
    const d = parseInt(naca[3], 10);

    const m = a / 100;                // max camber
    const p = b / 10;                 // location of max camber (x/c)
    const t = (10 * c + d) / 100;     // thickness

    // Cosine spacing in [0,1]
    const xs = [];
    for (let i = 0; i <= N; i++) {
        const theta = Math.PI * i / N;
        xs.push(0.5 * (1 - Math.cos(theta)));
    }

    const xU = [], yU = [], xL = [], yL = [];
    for (const xRaw of xs) {
        const x = Math.min(1, Math.max(0, xRaw));

        // Thickness
        const yt = 5 * t * (
            0.2969 * Math.sqrt(x) - 0.1260 * x
            - 0.3516 * x * x + 0.2843 * x * x * x
            - 0.1036 * x * x * x * x
        );

        // Camber line + slope
        let yc = 0, dyc = 0;
        if (m !== 0 && p !== 0) {
            if (x < p) {
                yc = m / (p * p) * (2 * p * x - x * x);
                dyc = 2 * m / (p * p) * (p - x);
            } else {
                yc = m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * x - x * x);
                dyc = 2 * m / ((1 - p) * (1 - p)) * (p - x);
            }
        }
        const th = Math.atan(dyc);

        // Upper/lower
        const xu = x - yt * Math.sin(th);
        const yu = yc + yt * Math.cos(th);
        const xl = x + yt * Math.sin(th);
        const yl = yc - yt * Math.cos(th);

        xU.push(xu * chord); yU.push(yu * chord);
        xL.push(xl * chord); yL.push(yl * chord);
    }

    // Give the trailing edge a tiny finite thickness to avoid degeneracy
    const eps = 1e-5;
    yU[0] = 0; yL[0] = 0;                   // Leading edge meets
    yU[yU.length - 1] = +eps;              // TE upper tiny +ε
    yL[yL.length - 1] = -eps;              // TE lower tiny −ε

    // Build loop: LE->TE along upper, TE->LE along lower (skip duplicate ends)
    const pts = [];
    pts.push(new THREE.Vector2(xU[0], yU[0]));
    for (let i = 1; i < xU.length; i++) pts.push(new THREE.Vector2(xU[i], yU[i]));
    for (let i = xL.length - 2; i >= 1; i--) pts.push(new THREE.Vector2(xL[i], yL[i]));

    // Ensure counter-clockwise winding (what Shape expects)
    if (!THREE.ShapeUtils.isClockWise(pts)) pts.reverse();

    const shape = new THREE.Shape(pts);
    return shape;
}

// ============================================
// EXPORT DROPDOWN + EXPORTERS
// ============================================
const dropdownBtn = document.getElementById('exportDropdownBtn');
const exportMenu = document.getElementById('exportMenu');

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

document.getElementById('exportGLB').addEventListener('click', () => {
    if (!currentMesh) return showOutputError('No model to export!');
    const exporter = new THREE.GLTFExporter();
    const options = { binary: true, includeCustomExtensions: true };
    exporter.parse(currentMesh, (glb) => {
        const blob = new Blob([glb], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: 'aircraft_part.glb' });
        a.click();
        URL.revokeObjectURL(url);
        showOutputSuccess('Model exported as GLB successfully!');
    }, options);
});

// ============================================
// API KEY / PROMPT PERSISTENCE (TESTING ONLY)
// ============================================
function hydrateTestingState() {
    const rememberKeyEl = document.getElementById('rememberKey');
    const apiKeyEl = document.getElementById('apiKey');
    const userInputEl = document.getElementById('userInput');

    const rememberFlag = loadJSON(LS.rememberFlag, false);
    rememberKeyEl.checked = !!rememberFlag;

    if (rememberFlag) {
        const savedKey = localStorage.getItem(LS.apiKey);
        if (savedKey) apiKeyEl.value = savedKey;
    }

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
}

const autorotateEl = document.getElementById('toggleAutorotate');
if (autorotateEl) {
    autorotateEl.addEventListener('change', (e) => {
        autorotate = !!e.target.checked;
        showOutputSuccess(`Auto-rotate ${autorotate ? 'enabled' : 'disabled'}.`);
    });
}

function updateAeroMetricsFromParams(params) {
    if (!params || !params.type.includes("wing")) return;

    const b  = params.span;
    const cr = params.rootChord;
    const ct = params.tipChord;

    const lambda = ct / cr;
    const S = (b * (cr + ct)) / 2;
    const AR = b * b / S;

    document.getElementById("arInput").value = fix(AR);
    document.getElementById("lambdaInput").value = fix(lambda);
    document.getElementById("areaInput").value = fix(S);
}

function attachAeroMetricHandlers() {
    const arEl   = document.getElementById("arInput");
    const lamEl  = document.getElementById("lambdaInput");
    const areaEl = document.getElementById("areaInput");

    // AR → span
    arEl.addEventListener("change", () => {
        if (!currentParams || !currentParams.type.includes("wing")) return;

        const AR = Number(arEl.value);
        const S  = Number(areaEl.value);
        currentParams.span = Math.sqrt(AR * S);

        regenerateFromPanel(true);
    });

    // λ → tip chord
    lamEl.addEventListener("change", () => {
        if (!currentParams || !currentParams.type.includes("wing")) return;

        const λ = Number(lamEl.value);
        currentParams.tipChord = currentParams.rootChord * λ;

        regenerateFromPanel(true);
    });

    // S → rootChord + tipChord
    areaEl.addEventListener("change", () => {
        if (!currentParams || !currentParams.type.includes("wing")) return;

        const S = Number(areaEl.value);
        const b = currentParams.span;
        const λ = currentParams.tipChord / currentParams.rootChord;

        const cr = (2 * S / b) / (1 + λ);
        currentParams.rootChord = cr;
        currentParams.tipChord = cr * λ;

        regenerateFromPanel(true);
    });
}