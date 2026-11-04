import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Eye, RotateCw, Layers, ShieldCheck, ChevronUp, ChevronDown, Sparkles } from 'lucide-react';

export const ThreeSpatialLens: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [exploded, setExploded] = useState(0);
  const [laserActive, setLaserActive] = useState(true);
  const [scanSpeed, setScanSpeed] = useState(1);
  const [isCinemaMode, setIsCinemaMode] = useState(false);
  const [targetFocus, setTargetFocus] = useState<'overview' | 'optics' | 'sensor'>('overview');

  const explodedRef = useRef(0);
  const laserActiveRef = useRef(true);
  const scanSpeedRef = useRef(1);
  const targetFocusRef = useRef<'overview' | 'optics' | 'sensor'>('overview');

  explodedRef.current = exploded;
  laserActiveRef.current = laserActive;
  scanSpeedRef.current = scanSpeed;
  targetFocusRef.current = targetFocus;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Detect Software WebGL
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Setup Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || 500;
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    // 3. Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060913);
    scene.fog = new THREE.FogExp2(0x060913, 0.035);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(4, 3, 5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.05; // Prevent dipping beneath floor
    controls.minDistance = 2;
    controls.maxDistance = 12;

    // 4. Studio Environment Reflection via RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 5. Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x90c2ff, 0x181c2b, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
    keyLight.position.set(5, 7, 4);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
    rimLight.position.set(-4, 3, -4);
    scene.add(rimLight);

    // 6. Ground & Contact Shadow
    const groundGeo = new THREE.PlaneGeometry(30, 30);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0a0f1d,
      roughness: 0.85,
      metalness: 0.2,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = !isSoftwareGl;
    scene.add(ground);

    // Radial procedural contact shadow
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d')!;
    const grad = sCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
    grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 128, 128);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
      })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.005;
    scene.add(shadowPlane);

    // 7. Composite Procedural 3D Subject: Smart Lens Optical Scanner Assembly (8 Parts)
    const scannerAssembly = new THREE.Group();
    scannerAssembly.position.y = 0.2;

    // Part 1: Anodized Base Pedestal
    const baseGeo = new THREE.CylinderGeometry(0.9, 1.05, 0.35, 32);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.25,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 0.175;
    baseMesh.castShadow = !isSoftwareGl;
    scannerAssembly.add(baseMesh);

    // Part 2: Gimbal Yoke Pivot
    const yokeGroup = new THREE.Group();
    yokeGroup.position.y = 0.35;
    const yokePostGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.45, 24);
    const yokeMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.9,
      roughness: 0.2,
    });
    const yokePost = new THREE.Mesh(yokePostGeo, yokeMat);
    yokePost.position.y = 0.225;
    yokeGroup.add(yokePost);
    scannerAssembly.add(yokeGroup);

    // Part 3: Main Optical Gimbal Ring & Barrel
    const barrelGroup = new THREE.Group();
    barrelGroup.position.y = 0.95;

    const barrelGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.9, 32);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.7,
      roughness: 0.3,
    });
    const barrelMesh = new THREE.Mesh(barrelGeo, barrelMat);
    barrelMesh.castShadow = !isSoftwareGl;
    barrelGroup.add(barrelMesh);

    // Part 4: Gold Aperture Knurled Ring
    const ringGeo = new THREE.TorusGeometry(0.68, 0.06, 16, 48);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.95,
      roughness: 0.18,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 0.32;
    barrelGroup.add(ringMesh);

    // Part 5: Sapphire Front Lens Element
    const lensGeo = new THREE.SphereGeometry(0.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3);
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      metalness: 0.1,
      roughness: 0.05,
      transmission: isSoftwareGl ? 0 : 0.88,
      transparent: true,
      opacity: isSoftwareGl ? 0.45 : 0.9,
      ior: 1.55,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      depthWrite: false,
    });
    const lensMesh = new THREE.Mesh(lensGeo, lensMat);
    lensMesh.rotation.x = -Math.PI / 2;
    lensMesh.position.y = 0.35;
    barrelGroup.add(lensMesh);

    // Part 6: Laser Sensor Emitter
    const laserEmitterGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.15, 16);
    const laserEmitterMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 0.8,
      metalness: 0.6,
      roughness: 0.3,
    });
    const laserEmitter = new THREE.Mesh(laserEmitterGeo, laserEmitterMat);
    laserEmitter.position.set(0.48, 0.38, 0);
    barrelGroup.add(laserEmitter);

    // Part 7: Radial Aluminum Heat Sink Fins
    const finGroup = new THREE.Group();
    const finGeo = new THREE.BoxGeometry(0.08, 0.6, 0.25);
    const finMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.85,
      roughness: 0.35,
    });
    for (let f = 0; f < 8; f++) {
      const angle = (f / 8) * Math.PI * 2;
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.position.set(Math.cos(angle) * 0.72, 0, Math.sin(angle) * 0.72);
      fin.rotation.y = -angle;
      finGroup.add(fin);
    }
    barrelGroup.add(finGroup);

    scannerAssembly.add(barrelGroup);
    scene.add(scannerAssembly);

    // Part 8: Dynamic Spatial Scanning Ray Beams & Projection Target
    const scanRaysGroup = new THREE.Group();
    const rayGeo = new THREE.BufferGeometry();
    const rayPos = new Float32Array([
      0, 1.3, 0, -1.2, 0.02, 1.2,
      0, 1.3, 0, 1.2, 0.02, 1.2,
      0, 1.3, 0, 1.2, 0.02, -1.2,
      0, 1.3, 0, -1.2, 0.02, -1.2,
    ]);
    rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPos, 3));
    const rayMat = new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.6,
    });
    const rayLines = new THREE.LineSegments(rayGeo, rayMat);
    scanRaysGroup.add(rayLines);

    // Target OCR Reticle on Floor
    const reticleGeo = new THREE.RingGeometry(0.7, 0.74, 32);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
    reticleMesh.rotation.x = -Math.PI / 2;
    reticleMesh.position.y = 0.01;
    scanRaysGroup.add(reticleMesh);

    scene.add(scanRaysGroup);

    // 8. Animation & Damping Render Loop
    let animationFrameId = 0;
    let clock = new THREE.Clock();

    function renderLoop() {
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime() * scanSpeedRef.current;

      // Smooth exploded view damping
      const targetExplode = explodedRef.current;
      yokeGroup.position.y = THREE.MathUtils.damp(yokeGroup.position.y, 0.35 + targetExplode * 0.4, 6, delta);
      barrelGroup.position.y = THREE.MathUtils.damp(barrelGroup.position.y, 0.95 + targetExplode * 1.1, 6, delta);
      finGroup.position.x = THREE.MathUtils.damp(finGroup.position.x, targetExplode * 0.3, 6, delta);

      // Subtle turret gimbal sweep
      scannerAssembly.rotation.y = Math.sin(elapsed * 0.7) * 0.35;
      barrelGroup.rotation.x = Math.sin(elapsed * 1.1) * 0.15;

      // Laser & scan target rotation
      scanRaysGroup.visible = laserActiveRef.current;
      reticleMesh.rotation.z = elapsed * 1.5;

      // Smooth camera target based on focus mode
      if (targetFocusRef.current === 'optics') {
        controls.target.set(
          THREE.MathUtils.damp(controls.target.x, 0, 4, delta),
          THREE.MathUtils.damp(controls.target.y, barrelGroup.position.y + 0.3, 4, delta),
          THREE.MathUtils.damp(controls.target.z, 0, 4, delta)
        );
      } else if (targetFocusRef.current === 'sensor') {
        controls.target.set(
          THREE.MathUtils.damp(controls.target.x, 0.5, 4, delta),
          THREE.MathUtils.damp(controls.target.y, barrelGroup.position.y, 4, delta),
          THREE.MathUtils.damp(controls.target.z, 0, 4, delta)
        );
      } else {
        controls.target.set(
          THREE.MathUtils.damp(controls.target.x, 0, 4, delta),
          THREE.MathUtils.damp(controls.target.y, 0.9, 4, delta),
          THREE.MathUtils.damp(controls.target.z, 0, 4, delta)
        );
      }

      controls.update();
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(renderLoop);
    }

    animationFrameId = requestAnimationFrame(renderLoop);

    // 9. Resize Handling
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-[calc(100vh-3.5rem)] bg-slate-950 overflow-hidden select-none">
      {/* 3D Scene WebGL Container */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Top Spec Badge (Zero Center Viewport Occlusion) */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2.5 bg-slate-900/90 border border-slate-700/80 rounded-xl px-3 py-2 text-xs shadow-lg">
        <Eye className="w-4 h-4 text-cyan-400" />
        <div>
          <span className="font-semibold text-white block">3D Spatial Vision Reticle & Gimbal</span>
          <span className="text-[10px] text-slate-400">PBR Studio | ACES Filmic | Procedural Optics</span>
        </div>
      </div>

      {/* Collapsible Unified Bottom Control Dock (Pinned bottom-center per Three.js constitution) */}
      <div
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[94%] max-w-2xl bg-slate-900/95 border border-slate-700/90 rounded-2xl shadow-2xl transition-all duration-300 ${
          isCinemaMode ? 'translate-y-[calc(100%-2.5rem)]' : 'translate-y-0'
        }`}
      >
        {/* Toggle Collapse Bar */}
        <button
          onClick={() => setIsCinemaMode(!isCinemaMode)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white border-b border-slate-800 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            3D Spatial Lens Inspector
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            {isCinemaMode ? <><ChevronUp className="w-3.5 h-3.5" /> Show Controls</> : <><ChevronDown className="w-3.5 h-3.5" /> Hide Controls (Zen)</>}
          </span>
        </button>

        {/* Dock Controls Body */}
        {!isCinemaMode && (
          <div className="p-4 space-y-3.5 text-xs text-slate-200">
            {/* Exploded View Slider */}
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-400 font-medium">Exploded Assembly Decomposition</span>
                <span className="text-cyan-400 font-mono">{Math.round(exploded * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={exploded}
                onChange={(e) => setExploded(parseFloat(e.target.value))}
                className="w-full accent-cyan-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>

            {/* Quick Actions & Focus Presets */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400 mr-1">Focus:</span>
                {(['overview', 'optics', 'sensor'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setTargetFocus(mode)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] capitalize font-medium transition-colors ${
                      targetFocus === mode ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:text-white'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLaserActive(!laserActive)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                    laserActive ? 'bg-emerald-600/80 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  Laser Beam: {laserActive ? 'ON' : 'OFF'}
                </button>

                <button
                  onClick={() => setScanSpeed((s) => (s === 1 ? 2 : s === 2 ? 0.5 : 1))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                >
                  <RotateCw className="w-3 h-3 text-cyan-400" />
                  Speed: {scanSpeed}x
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
