import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { UISettings } from '../types';
import { 
  Box, 
  Rotate3d, 
  Sliders, 
  Eye, 
  Layers, 
  Zap, 
  Cpu, 
  Activity,
  Maximize2,
  Upload,
  FileCheck,
  RotateCcw,
  Sun,
  Palette,
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface ModelViewerTabProps {
  settings: UISettings;
  onUpdateSettings: (updater: (prev: UISettings) => UISettings) => void;
}

interface UploadedModelData {
  name: string;
  sizeStr: string;
  format: string;
  object: THREE.Object3D;
  verticesCount: number;
  trianglesCount: number;
}

export const ModelViewerTab: React.FC<ModelViewerTabProps> = ({
  settings,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Model Source
  const [modelChoice, setModelChoice] = useState<'preset' | 'uploaded'>('preset');
  const [presetType, setPresetType] = useState<'cyber' | 'sphere' | 'torus'>('cyber');
  const [uploadedModel, setUploadedModel] = useState<UploadedModelData | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false);

  // DLSS 3D Settings
  const [dlssScale, setDlssScale] = useState<number>(0.67); // 50%, 67%, 77%, 100% (DLAA)
  const [enableRayReconstruction, setEnableRayReconstruction] = useState<boolean>(true);
  const [enableNeuralDetail, setEnableNeuralDetail] = useState<boolean>(true);
  const [enableWireframe, setEnableWireframe] = useState<boolean>(false);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [fps, setFps] = useState<number>(144);

  // PBR Material Customization
  const [metallic, setMetallic] = useState<number>(0.85);
  const [roughness, setRoughness] = useState<number>(0.2);
  const [materialColor, setMaterialColor] = useState<string>('#94a3b8');
  const [lightingPreset, setLightingPreset] = useState<'cyber' | 'studio' | 'daylight'>('cyber');

  // Stats
  const [stats, setStats] = useState({ vertices: 0, triangles: 0 });

  // Camera reset trigger
  const [cameraResetCounter, setCameraResetCounter] = useState<number>(0);

  // Helper to count vertices and triangles in an Object3D
  const computeModelStats = (obj: THREE.Object3D) => {
    let vertices = 0;
    let triangles = 0;
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const geom = mesh.geometry;
        if (geom) {
          const position = geom.attributes.position;
          if (position) vertices += position.count;
          if (geom.index) {
            triangles += geom.index.count / 3;
          } else if (position) {
            triangles += position.count / 3;
          }
        }
      }
    });
    return { vertices: Math.round(vertices), triangles: Math.round(triangles) };
  };

  // Handle custom 3D model file upload (.glb, .gltf, .obj, .stl)
  const handleModelFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setIsLoadingModel(true);

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const sizeStr = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

    const reader = new FileReader();

    const normalizeAndSetModel = (loadedObject: THREE.Object3D, format: string) => {
      // Calculate bounding box and scale to fit standard view
      const box = new THREE.Box3().setFromObject(loadedObject);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const scaleFactor = 2.6 / maxDim;
        loadedObject.scale.setScalar(scaleFactor);
        // Center the model at origin
        loadedObject.position.sub(center.clone().multiplyScalar(scaleFactor));
      }

      // Apply default standard PBR materials if meshes lack materials
      loadedObject.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          m.castShadow = true;
          m.receiveShadow = true;
          if (!m.material) {
            m.material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(materialColor),
              metalness: metallic,
              roughness: roughness,
            });
          }
        }
      });

      const { vertices, triangles } = computeModelStats(loadedObject);

      setUploadedModel({
        name: file.name,
        sizeStr,
        format: format.toUpperCase(),
        object: loadedObject,
        verticesCount: vertices,
        trianglesCount: triangles,
      });

      setModelChoice('uploaded');
      setIsLoadingModel(false);
      setCameraResetCounter(c => c + 1);
    };

    if (ext === 'glb' || ext === 'gltf') {
      reader.onload = async (evt) => {
        let dracoLoader: DRACOLoader | null = null;
        try {
          const arrayBuffer = evt.target?.result as ArrayBuffer;
          const loader = new GLTFLoader();

          // Configure Meshopt compression decoder
          if (MeshoptDecoder) {
            await MeshoptDecoder.ready;
            loader.setMeshoptDecoder(MeshoptDecoder);
          }

          // Configure DRACO compression decoder
          dracoLoader = new DRACOLoader();
          dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
          loader.setDRACOLoader(dracoLoader);

          loader.parse(
            arrayBuffer,
            '',
            (gltf) => {
              if (dracoLoader) dracoLoader.dispose();
              normalizeAndSetModel(gltf.scene, ext);
            },
            (err) => {
              if (dracoLoader) dracoLoader.dispose();
              console.error('Failed to parse GLTF/GLB', err);
              const errMsg = err instanceof Error ? err.message : String(err);
              setUploadError(`Failed to parse GLTF/GLB: ${errMsg}`);
              setIsLoadingModel(false);
            }
          );
        } catch (err) {
          if (dracoLoader) dracoLoader.dispose();
          console.error(err);
          const errMsg = err instanceof Error ? err.message : String(err);
          setUploadError(`Error reading GLTF/GLB file: ${errMsg}`);
          setIsLoadingModel(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (ext === 'obj') {
      reader.onload = (evt) => {
        try {
          const text = evt.target?.result as string;
          const loader = new OBJLoader();
          const obj = loader.parse(text);
          normalizeAndSetModel(obj, 'OBJ');
        } catch (err) {
          console.error(err);
          setUploadError('Failed to parse Wavefront OBJ file.');
          setIsLoadingModel(false);
        }
      };
      reader.readAsText(file);
    } else if (ext === 'stl') {
      reader.onload = (evt) => {
        try {
          const buffer = evt.target?.result as ArrayBuffer;
          const loader = new STLLoader();
          const geometry = loader.parse(buffer);
          geometry.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(materialColor),
            metalness: metallic,
            roughness: roughness,
          });
          const mesh = new THREE.Mesh(geometry, mat);
          const group = new THREE.Group();
          group.add(mesh);
          normalizeAndSetModel(group, 'STL');
        } catch (err) {
          console.error(err);
          setUploadError('Failed to parse STL file.');
          setIsLoadingModel(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      setUploadError(`Unsupported format .${ext}. Please upload a .glb, .gltf, .obj, or .stl file.`);
      setIsLoadingModel(false);
    }
  };

  // Main 3D WebGL Rendering Scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 1.2, 4.2);

    const renderer = new THREE.WebGLRenderer({ 
      antialias: dlssScale === 1.0, 
      powerPreference: 'high-performance',
      alpha: false 
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = enableRayReconstruction ? 1.35 : 1.1;

    container.replaceChildren(renderer.domElement);

    // Dynamic Lighting based on lightingPreset
    const ambientLight = new THREE.AmbientLight(0xffffff, lightingPreset === 'cyber' ? 0.6 : 0.85);
    scene.add(ambientLight);

    let keyLight: THREE.DirectionalLight;
    let rimLight: THREE.DirectionalLight;

    if (lightingPreset === 'cyber') {
      keyLight = new THREE.DirectionalLight(0x76b900, 3.2); // NVIDIA Green
      keyLight.position.set(5, 5, 5);
      rimLight = new THREE.DirectionalLight(0x00d8ff, 2.5); // Cyan
      rimLight.position.set(-5, 3, -5);
      const pointLight = new THREE.PointLight(0xff0055, 2.0, 12);
      pointLight.position.set(0, -2, 2);
      scene.add(pointLight);
    } else if (lightingPreset === 'studio') {
      keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
      keyLight.position.set(4, 6, 4);
      rimLight = new THREE.DirectionalLight(0x94a3b8, 1.5);
      rimLight.position.set(-4, 2, -4);
    } else {
      keyLight = new THREE.DirectionalLight(0xfff4e6, 3.5); // Warm sun
      keyLight.position.set(6, 8, 3);
      rimLight = new THREE.DirectionalLight(0x60a5fa, 1.8); // Sky blue
      rimLight.position.set(-6, 2, -3);
    }

    scene.add(keyLight);
    scene.add(rimLight);

    // Floor Grid
    const gridHelper = new THREE.GridHelper(10, 20, 0x76b900, 0x1e293b);
    gridHelper.position.y = -1.3;
    scene.add(gridHelper);

    // Active Model Container
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    if (modelChoice === 'uploaded' && uploadedModel) {
      // Clone user-uploaded object
      const cloned = uploadedModel.object.clone();
      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          if (m.material) {
            const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
            if (mat) {
              mat.wireframe = enableWireframe;
              if (mat.isMeshStandardMaterial) {
                mat.metalness = metallic;
                mat.roughness = roughness;
              }
            }
          }
        }
      });
      modelGroup.add(cloned);
      setStats({
        vertices: uploadedModel.verticesCount,
        triangles: uploadedModel.trianglesCount,
      });
    } else {
      // Built-in Geometries
      let geometry: THREE.BufferGeometry;
      if (presetType === 'cyber') {
        geometry = new THREE.IcosahedronGeometry(1.25, 3);
      } else if (presetType === 'sphere') {
        geometry = new THREE.SphereGeometry(1.2, 64, 64);
      } else {
        geometry = new THREE.TorusKnotGeometry(0.85, 0.3, 128, 32);
      }

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(materialColor),
        metalness: metallic,
        roughness: roughness,
        wireframe: enableWireframe,
      });

      const mesh = new THREE.Mesh(geometry, material);
      modelGroup.add(mesh);

      const pos = geometry.attributes.position;
      const count = pos ? pos.count : 0;
      setStats({
        vertices: count,
        triangles: geometry.index ? geometry.index.count / 3 : count / 3,
      });
    }

    // Interactive Drag / Orbit Interaction
    let isDragging = false;
    let isRightDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        isRightDragging = true;
      } else {
        isDragging = true;
      }
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      if (isDragging) {
        modelGroup.rotation.y += deltaX * 0.009;
        modelGroup.rotation.x += deltaY * 0.009;
      } else if (isRightDragging) {
        camera.position.x -= deltaX * 0.005;
        camera.position.y += deltaY * 0.005;
      }

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging = false;
      isRightDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.position.z = Math.max(1.8, Math.min(9.0, camera.position.z + e.deltaY * 0.003));
    };

    const domEl = renderer.domElement;
    domEl.addEventListener('mousedown', onMouseDown);
    domEl.addEventListener('wheel', onWheel, { passive: false });
    domEl.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // Animation Loop
    let animationId: number;
    let lastFrameTime = performance.now();
    let frameCount = 0;

    const animate = (now: number) => {
      frameCount++;
      if (now - lastFrameTime >= 1000) {
        setFps(Math.round(frameCount));
        frameCount = 0;
        lastFrameTime = now;
      }

      if (autoRotate && !isDragging && !isRightDragging) {
        modelGroup.rotation.y += 0.007;
      }

      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
      domEl.removeEventListener('mousedown', onMouseDown);
      domEl.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      resizeObserver.disconnect();
      renderer.dispose();
    };
  }, [
    modelChoice, 
    presetType, 
    uploadedModel, 
    dlssScale, 
    enableRayReconstruction, 
    enableWireframe, 
    autoRotate, 
    metallic, 
    roughness, 
    materialColor, 
    lightingPreset,
    cameraResetCounter
  ]);

  const internalWidth = Math.round(1920 * dlssScale);
  const internalHeight = Math.round(1080 * dlssScale);

  return (
    <div className="space-y-3">
      {/* Combined Unified Layout: Viewport on Left, Unified Control Panel on Right */}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* Left: 3D Canvas Stage (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="rounded-lg bg-slate-900/90 border border-slate-800 overflow-hidden shadow-lg">
            {/* 3D Viewport Header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-slate-800 text-xs font-mono">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-300 font-bold flex items-center gap-1">
                  <Activity className="w-3 h-3 text-[#76b900]" />
                  <span>{fps} FPS</span>
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">
                  Render: <span className="text-emerald-400">{internalWidth}x{internalHeight}</span> &rarr; 4K
                </span>
              </div>
              <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-[#76b900] text-[9px] font-bold font-mono">
                {dlssScale === 1.0 ? 'DLAA' : `${Math.round(1 / (dlssScale * dlssScale) * 10) / 10}x Speedup`}
              </span>
            </div>

            {/* Three.js Interactive WebGL Stage */}
            <div className="relative aspect-video w-full bg-[#0a0e17] overflow-hidden cursor-grab active:cursor-grabbing select-none group">
              <div ref={containerRef} className="w-full h-full" />

              {/* DLSS Overlay Indicator HUD */}
              <div className="absolute top-2 left-2 pointer-events-none px-2 py-1 rounded bg-black/80 backdrop-blur border border-slate-800 text-[10px] font-mono space-y-0.5 shadow-md">
                <div className="flex items-center gap-1 text-[#76b900] font-bold">
                  <Zap className="w-3 h-3" />
                  <span>DLSS 5 RECONSTRUCTION</span>
                </div>
                <div className="text-slate-400">
                  Model: <span className="text-slate-200">{modelChoice === 'uploaded' ? uploadedModel?.name : presetType}</span>
                </div>
                <div className="text-slate-400">
                  Ray Recon: <span className={enableRayReconstruction ? 'text-emerald-400' : 'text-slate-400'}>{enableRayReconstruction ? 'ON (CNN Denoiser)' : 'OFF'}</span>
                </div>
              </div>

              {/* Navigation Hints Badge */}
              <div className="absolute bottom-2 right-2 pointer-events-none px-2 py-0.5 rounded bg-slate-900/90 backdrop-blur border border-slate-800 text-[9px] text-slate-400 font-mono">
                Drag: Rotate &middot; Right Drag: Pan &middot; Scroll: Zoom
              </div>
            </div>

            {/* Viewport Action Controls */}
            <div className="p-2 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setAutoRotate(!autoRotate)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition border ${
                    autoRotate
                      ? 'bg-emerald-500/20 text-[#76b900] border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <Rotate3d className="w-3 h-3" />
                  <span>Orbit: {autoRotate ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  onClick={() => setEnableWireframe(!enableWireframe)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition border ${
                    enableWireframe
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span>Wireframe</span>
                </button>

                <button
                  onClick={() => setCameraResetCounter(c => c + 1)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition"
                  title="Recenter Camera"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Recenter</span>
                </button>
              </div>

              <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                <span>Vertices: <strong className="text-slate-200">{stats.vertices.toLocaleString()}</strong></span>
                <span className="text-slate-600">|</span>
                <span>Faces: <strong className="text-slate-200">{stats.triangles.toLocaleString()}</strong></span>
              </div>
            </div>

            {/* Integrated Model Statistics & Telemetry Strip */}
            <div className="p-2 bg-slate-950/90 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs font-mono">
              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Source Format</span>
                <span className="text-[#76b900] font-bold text-[11px] truncate block">
                  {modelChoice === 'uploaded' ? uploadedModel?.format : 'PROCEDURAL'}
                </span>
                <span className="text-[9px] text-slate-500 block mt-0.5">
                  {modelChoice === 'uploaded' ? uploadedModel?.sizeStr : 'In-Memory'}
                </span>
              </div>

              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Shader Pipeline</span>
                <span className="text-emerald-400 font-bold text-[11px] block">PBR / DLSS 5</span>
                <span className="text-[9px] text-slate-500 block mt-0.5">Direct3D 12 Hook</span>
              </div>

              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">DLSS Scaling</span>
                <span className="text-slate-200 font-bold text-[11px] block">
                  {dlssScale === 1.0 ? '1.0x (DLAA)' : `${Math.round(1/dlssScale * 100) / 100}x`}
                </span>
                <span className="text-[9px] text-slate-500 block mt-0.5">Spatial + Temporal</span>
              </div>

              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Ray Reconstruction</span>
                <span className="text-slate-200 font-bold text-[11px] block">
                  {enableRayReconstruction ? 'Tensor Cores' : 'Bypassed'}
                </span>
                <span className="text-[9px] text-emerald-400 block mt-0.5">3.5 Denoising</span>
              </div>
            </div>
          </div>
        </div>


        {/* Right: Unified 3D Model & DLSS Control Panel (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-3 shadow-lg">
            {/* Header: Title, Pipeline badge & Upload Action */}
            <div className="pb-2.5 border-b border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#76b900] shrink-0">
                    <Box className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-slate-100">3D Model &amp; DLSS 5</h2>
                    <span className="text-[9px] font-mono text-[#76b900] font-semibold">
                      DIRECT3D / VULKAN PIPELINE
                    </span>
                  </div>
                </div>

                <label className="cursor-pointer flex items-center justify-center gap-1 px-2.5 py-1 rounded bg-[#76b900] hover:bg-lime-400 text-black text-[11px] font-bold transition shadow-sm shrink-0">
                  <Upload className="w-3 h-3" />
                  <span>Upload 3D Mesh</span>
                  <input
                    type="file"
                    accept=".glb,.gltf,.obj,.stl"
                    onChange={handleModelFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Model Source Selector */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400">Geometry / Model:</span>
                  {isLoadingModel && (
                    <span className="text-[10px] font-mono text-[#76b900] animate-pulse">
                      Loading Mesh...
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  {uploadedModel && (
                    <button
                      onClick={() => setModelChoice('uploaded')}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition border ${
                        modelChoice === 'uploaded'
                          ? 'bg-[#76b900] text-black font-bold border-[#76b900] shadow-sm'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      <FileCheck className="w-3 h-3" />
                      <span className="truncate max-w-[120px]">{uploadedModel.name}</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setModelChoice('preset');
                      setPresetType('cyber');
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition border ${
                      modelChoice === 'preset' && presetType === 'cyber'
                        ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    Cyber Crystal
                  </button>

                  <button
                    onClick={() => {
                      setModelChoice('preset');
                      setPresetType('torus');
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition border ${
                      modelChoice === 'preset' && presetType === 'torus'
                        ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    Torus Knot
                  </button>

                  <button
                    onClick={() => {
                      setModelChoice('preset');
                      setPresetType('sphere');
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition border ${
                      modelChoice === 'preset' && presetType === 'sphere'
                        ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    Orb Mesh
                  </button>
                </div>

                {uploadError && (
                  <p className="text-[10px] text-red-400 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{uploadError}</span>
                  </p>
                )}
              </div>
            </div>

            {/* DLSS 3D Pipeline Overlay Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#76b900]" />
                <h3 className="text-xs font-bold text-slate-200">DLSS 3D Pipeline Overlay</h3>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-[#76b900] font-bold">
                Real-Time
              </span>
            </div>

            {/* DLSS Resolution Scaling */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-semibold text-slate-300">
                  DLSS Resolution Scale Mode
                </label>
                <span className="text-[10px] font-mono text-[#76b900] font-bold">
                  {dlssScale === 1.0 ? 'DLAA (100%)' : `${Math.round(dlssScale * 100)}% Scale`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[
                  { label: 'Ultra Perf', val: 0.5 },
                  { label: 'Balanced', val: 0.67 },
                  { label: 'Quality', val: 0.77 },
                  { label: 'DLAA', val: 1.0 },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => setDlssScale(item.val)}
                    className={`py-1 rounded text-xs font-semibold transition border ${
                      dlssScale === item.val
                        ? 'bg-[#76b900] text-black border-[#76b900] font-bold shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* DLSS 3.5 Ray Reconstruction & Neural Detail Toggle */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-200 font-medium">Ray Reconstruction</span>
                  <p className="text-[9px] text-slate-400">Replaces hand-tuned denoisers for reflections</p>
                </div>
                <button
                  onClick={() => setEnableRayReconstruction(!enableRayReconstruction)}
                  className={`w-8 h-4 rounded-full transition flex items-center px-0.5 ${
                    enableRayReconstruction ? 'bg-[#76b900]' : 'bg-slate-800'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full bg-black transition transform ${
                    enableRayReconstruction ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-200 font-medium">Neural Detail Synthesis</span>
                  <p className="text-[9px] text-slate-400">Transformer-based micro-surface generator</p>
                </div>
                <button
                  onClick={() => setEnableNeuralDetail(!enableNeuralDetail)}
                  className={`w-8 h-4 rounded-full transition flex items-center px-0.5 ${
                    enableNeuralDetail ? 'bg-[#76b900]' : 'bg-slate-800'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full bg-black transition transform ${
                    enableNeuralDetail ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>

            {/* Lighting Studio Presets */}
            <div className="pt-2 border-t border-slate-800">
              <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1">
                <Sun className="w-3 h-3 text-[#76b900]" />
                <span>Lighting Environment</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'cyber', label: 'Cyber Neon' },
                  { id: 'studio', label: 'Clean Studio' },
                  { id: 'daylight', label: 'Daylight HDR' },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setLightingPreset(preset.id as any)}
                    className={`py-1 rounded text-xs font-medium transition border ${
                      lightingPreset === preset.id
                        ? 'bg-emerald-500/20 text-[#76b900] border-emerald-500/40 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* PBR Material Tuning */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <h4 className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                <Palette className="w-3 h-3 text-[#76b900]" />
                <span>PBR Surface Shading</span>
              </h4>

              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300">Metallic</span>
                  <span className="font-mono text-[#76b900] font-semibold">{metallic.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={metallic}
                  onChange={(e) => setMetallic(parseFloat(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300">Roughness</span>
                  <span className="font-mono text-[#76b900] font-semibold">{roughness.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={roughness}
                  onChange={(e) => setRoughness(parseFloat(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
