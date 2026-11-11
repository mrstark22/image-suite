import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RotateCcw, Box, Compass, Layers, Grid } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { DEFAULT_DEPTH } from '../../lib/document';
import styles from './DepthViewer3D.module.css';

interface DepthViewer3DProps {
  depthBuffer: ArrayBuffer | null;
  width: number;
  height: number;
}

const GRID_SIZE = 360; // 360x360 grid = 130,321 vertices for ultra-smooth silhouette curvature

export const DepthViewer3D: React.FC<DepthViewer3DProps> = ({
  depthBuffer,
  width,
  height,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const glRef = useRef<WebGLRenderingContext | WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformsRef = useRef<Record<string, WebGLUniformLocation>>({});
  const textureRef = useRef<WebGLTexture | null>(null);
  const isWebGL2Ref = useRef<boolean>(false);
  const triIndexBufferRef = useRef<WebGLBuffer | null>(null);
  const wireIndexBufferRef = useRef<WebGLBuffer | null>(null);
  const triCountRef = useRef<number>(0);
  const wireCountRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const needsRenderRef = useRef<boolean>(true);

  const depthConfig = useDocumentStore((s) => s.doc?.depth ?? DEFAULT_DEPTH);

  // Camera Orbit State
  const [camera, setCamera] = useState({
    azimuth: 45,    // degrees
    elevation: 35,  // degrees
    distance: 2.6,
    panX: 0,
    panY: 0,
  });

  const [showToolpaths, setShowToolpaths] = useState(false);
  const [wireframeMode, setWireframeMode] = useState(false);

  const isDraggingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Reset Camera View
  const handleResetCamera = useCallback(() => {
    needsRenderRef.current = true;
    setCamera({
      azimuth: 45,
      elevation: 35,
      distance: 2.6,
      panX: 0,
      panY: 0,
    });
  }, []);

  // Top-Down View
  const handleTopDownCamera = useCallback(() => {
    needsRenderRef.current = true;
    setCamera((prev) => ({
      ...prev,
      azimuth: 0,
      elevation: 89.9,
      panX: 0,
      panY: 0,
    }));
  }, []);

  // Initialize WebGL Scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Try WebGL2 first for float textures, fallback to WebGL1
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
    });

    if (gl) {
      isWebGL2Ref.current = true;
      gl.getExtension('OES_texture_float_linear');
      gl.getExtension('EXT_color_buffer_float');
    } else {
      gl = canvas.getContext('webgl', {
        antialias: true,
        alpha: false,
        depth: true,
      }) as WebGLRenderingContext | null;
      isWebGL2Ref.current = false;
      if (gl) {
        gl.getExtension('OES_texture_float');
        gl.getExtension('OES_texture_float_linear');
        gl.getExtension('OES_element_index_uint');
      }
    }

    if (!gl) {
      console.error('WebGL not supported');
      return;
    }
    glRef.current = gl;

    // Vertex Shader: High-Density GPU Grid Displacement
    const vsSource = `
      attribute vec3 a_position;
      attribute vec2 a_uv;

      uniform mat4 u_mvp;
      uniform sampler2D u_heightMap;
      uniform float u_depthScale;
      uniform vec2 u_meshScale;

      varying vec2 v_uv;
      varying vec3 v_worldPos;
      varying float v_height;

      void main() {
        v_uv = a_uv;
        float h = texture2D(u_heightMap, a_uv).r;
        v_height = h;

        // Displace Z based on heightmap with true aspect ratio
        vec3 pos = a_position;
        pos.x *= u_meshScale.x;
        pos.y *= u_meshScale.y;
        pos.z = (h - 0.5) * u_depthScale;
        v_worldPos = pos;

        gl_Position = u_mvp * vec4(pos, 1.0);
      }
    `;

    // Fragment Shader: Per-Pixel Normal Mapping + Cavity Ambient Occlusion
    const fsSource = `
      precision mediump float;

      varying vec2 v_uv;
      varying vec3 v_worldPos;
      varying float v_height;

      uniform sampler2D u_heightMap;
      uniform vec2 u_texelSize;
      uniform float u_normalScale;
      uniform vec3 u_lightDir;
      uniform int u_material;      // 0: Walnut, 1: Brass, 2: Slate, 3: Heatmap, 4: Grayscale
      uniform bool u_showToolpaths;

      vec3 getHeatmapColor(float t) {
        if (t < 0.25) {
          return mix(vec3(0.0, 0.1, 0.9), vec3(0.0, 0.8, 0.9), t / 0.25);
        } else if (t < 0.5) {
          return mix(vec3(0.0, 0.8, 0.9), vec3(0.1, 0.9, 0.2), (t - 0.25) / 0.25);
        } else if (t < 0.75) {
          return mix(vec3(0.1, 0.9, 0.2), vec3(0.95, 0.9, 0.1), (t - 0.5) / 0.25);
        } else {
          return mix(vec3(0.95, 0.9, 0.1), vec3(0.9, 0.1, 0.05), (t - 0.75) / 0.25);
        }
      }

      void main() {
        // High-resolution per-pixel surface normal from full heightmap texture
        float zL = texture2D(u_heightMap, v_uv - vec2(u_texelSize.x, 0.0)).r;
        float zR = texture2D(u_heightMap, v_uv + vec2(u_texelSize.x, 0.0)).r;
        float zU = texture2D(u_heightMap, v_uv - vec2(0.0, u_texelSize.y)).r;
        float zD = texture2D(u_heightMap, v_uv + vec2(0.0, u_texelSize.y)).r;

        float dzdx = (zR - zL) * u_normalScale;
        float dzdy = (zD - zU) * u_normalScale;

        vec3 N = normalize(vec3(-dzdx, -dzdy, 1.0));
        vec3 L = normalize(u_lightDir);
        vec3 V = vec3(0.0, 0.0, 1.0);
        vec3 H = normalize(L + V);

        float NdotL = max(dot(N, L), 0.0);
        float NdotH = max(dot(N, H), 0.0);
        float spec = pow(NdotH, 24.0);

        // Cavity Ambient Occlusion (darkens carved recesses and groove crevices)
        float aoStep = 2.5;
        float zC = texture2D(u_heightMap, v_uv).r;
        float z1 = texture2D(u_heightMap, v_uv + vec2(u_texelSize.x * aoStep, 0.0)).r;
        float z2 = texture2D(u_heightMap, v_uv - vec2(u_texelSize.x * aoStep, 0.0)).r;
        float z3 = texture2D(u_heightMap, v_uv + vec2(0.0, u_texelSize.y * aoStep)).r;
        float z4 = texture2D(u_heightMap, v_uv - vec2(0.0, u_texelSize.y * aoStep)).r;
        float avgSurround = (z1 + z2 + z3 + z4) * 0.25;
        float cavity = max(0.0, avgSurround - zC);
        float ao = 1.0 - clamp(cavity * 4.0, 0.0, 0.45);

        vec3 baseColor;
        float specularStrength = 0.25;

        if (u_material == 0) {
          // Walnut Hardwood: warm golden amber peaks & deep wood tone
          vec3 darkWood = vec3(0.47, 0.29, 0.16);
          vec3 lightWood = vec3(0.76, 0.51, 0.27);
          baseColor = mix(darkWood, lightWood, v_height);
          specularStrength = 0.25;
        } else if (u_material == 1) {
          // Brushed Brass
          baseColor = vec3(0.85, 0.72, 0.32);
          specularStrength = 0.65;
        } else if (u_material == 2) {
          // Ceramic Slate
          baseColor = vec3(0.36, 0.40, 0.45);
          specularStrength = 0.20;
        } else if (u_material == 3) {
          // Elevation Heatmap
          baseColor = getHeatmapColor(v_height);
          specularStrength = 0.15;
        } else {
          // Monochrome Grayscale
          baseColor = vec3(v_height * 0.78 + 0.16);
          specularStrength = 0.20;
        }

        // CNC Toolpath Simulation Lines
        if (u_showToolpaths) {
          float toolLine = sin(v_uv.y * 350.0);
          if (abs(toolLine) < 0.25) {
            baseColor *= 0.65;
          }
        }

        float ambient = 0.35;
        float totalLight = min(1.6, (ambient + NdotL * 0.75) * ao + spec * specularStrength);
        vec3 finalColor = baseColor * totalLight;
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    const createShader = (type: number, src: string) => {
      const shader = gl!.createShader(type)!;
      gl!.shaderSource(shader, src);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl!.getShaderInfoLog(shader));
        gl!.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }
    programRef.current = program;

    // Cache Uniform Locations
    uniformsRef.current = {
      u_mvp: gl.getUniformLocation(program, 'u_mvp')!,
      u_heightMap: gl.getUniformLocation(program, 'u_heightMap')!,
      u_depthScale: gl.getUniformLocation(program, 'u_depthScale')!,
      u_meshScale: gl.getUniformLocation(program, 'u_meshScale')!,
      u_texelSize: gl.getUniformLocation(program, 'u_texelSize')!,
      u_normalScale: gl.getUniformLocation(program, 'u_normalScale')!,
      u_lightDir: gl.getUniformLocation(program, 'u_lightDir')!,
      u_material: gl.getUniformLocation(program, 'u_material')!,
      u_showToolpaths: gl.getUniformLocation(program, 'u_showToolpaths')!,
    };

    // Create Displaced Mesh Grid (200x200 = 40,401 vertices, safe for Uint16)
    const vertices: number[] = [];
    const uvs: number[] = [];
    const triIndices: number[] = [];
    const wireIndices: number[] = [];

    for (let y = 0; y <= GRID_SIZE; y++) {
      const v = y / GRID_SIZE;
      const posY = (v - 0.5) * 2.0;
      for (let x = 0; x <= GRID_SIZE; x++) {
        const u = x / GRID_SIZE;
        const posX = (u - 0.5) * 2.0;
        vertices.push(posX, -posY, 0.0);
        uvs.push(u, v);
      }
    }

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const i0 = y * (GRID_SIZE + 1) + x;
        const i1 = i0 + 1;
        const i2 = (y + 1) * (GRID_SIZE + 1) + x;
        const i3 = i2 + 1;

        triIndices.push(i0, i2, i1);
        triIndices.push(i1, i2, i3);

        // Wireframe lines
        wireIndices.push(i0, i1);
        wireIndices.push(i0, i2);
        if (x === GRID_SIZE - 1) wireIndices.push(i1, i3);
        if (y === GRID_SIZE - 1) wireIndices.push(i2, i3);
      }
    }

    triCountRef.current = triIndices.length;
    wireCountRef.current = wireIndices.length;

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);

    const triBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(triIndices), gl.STATIC_DRAW);
    triIndexBufferRef.current = triBuffer;

    const wireBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(wireIndices), gl.STATIC_DRAW);
    wireIndexBufferRef.current = wireBuffer;

    gl.useProgram(program);

    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    const aUv = gl.getAttribLocation(program, 'a_uv');
    gl.enableVertexAttribArray(aUv);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    // Create Heightmap Texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    textureRef.current = texture;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  // Update Heightmap Texture when depth buffer changes
  useEffect(() => {
    const gl = glRef.current;
    const texture = textureRef.current;
    if (!gl || !texture || !depthBuffer || width === 0 || height === 0) return;

    needsRenderRef.current = true;

    const total = width * height;
    const is16Bit = depthBuffer.byteLength === total * 2;
    const isRgba = depthBuffer.byteLength === total * 4;

    const floatData = new Float32Array(total);

    if (is16Bit) {
      const depth16 = new Uint16Array(depthBuffer);
      for (let i = 0; i < total; i++) {
        floatData[i] = depth16[i] / 65535.0;
      }
    } else if (isRgba) {
      const rgba = new Uint8Array(depthBuffer);
      for (let i = 0; i < total; i++) {
        const pIdx = i * 4;
        const lum = 0.299 * rgba[pIdx] + 0.587 * rgba[pIdx + 1] + 0.114 * rgba[pIdx + 2];
        floatData[i] = lum / 255.0;
      }
    } else {
      const gray = new Uint8Array(depthBuffer);
      for (let i = 0; i < total; i++) {
        floatData[i] = (gray[i] || 0) / 255.0;
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    if (isWebGL2Ref.current) {
      const gl2 = gl as WebGL2RenderingContext;
      gl2.texImage2D(
        gl2.TEXTURE_2D,
        0,
        gl2.R32F,
        width,
        height,
        0,
        gl2.RED,
        gl2.FLOAT,
        floatData
      );
    } else {
      // WebGL 1 fallback: 8-bit luminance with UNPACK_ALIGNMENT = 1
      const gray8 = new Uint8Array(total);
      for (let i = 0; i < total; i++) {
        gray8[i] = Math.round(floatData[i] * 255.0);
      }
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        width,
        height,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        gray8
      );
    }
  }, [depthBuffer, width, height]);

  // Render Frame Loop with Cached Uniforms & Render-on-Demand
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const program = programRef.current;
    const u = uniformsRef.current;
    if (!canvas || !gl || !program) return;

    let isMounted = true;
    needsRenderRef.current = true;

    const render = () => {
      if (!isMounted) return;

      if (needsRenderRef.current) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(rect.width * dpr);
        const h = Math.round(rect.height * dpr);

        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.08, 0.10, 0.12, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(program);

        // Compute Perspective Projection & Camera Matrix
        const aspect = canvas.width / (canvas.height || 1);
        const imageAspect = width > 0 && height > 0 ? width / height : 1.0;
        const fov = (45 * Math.PI) / 180;
        const near = 0.1;
        const far = 100.0;

        const projMatrix = createPerspectiveMatrix(fov, aspect, near, far);
        const viewMatrix = createOrbitViewMatrix(
          camera.azimuth,
          camera.elevation,
          camera.distance,
          camera.panX,
          camera.panY
        );
        const mvp = multiplyMatrices(projMatrix, viewMatrix);

        if (u.u_mvp) gl.uniformMatrix4fv(u.u_mvp, false, new Float32Array(mvp));

        // Calculate Mesh Scale to preserve image aspect ratio within unit bounding box
        let meshScaleX = 1.0;
        let meshScaleY = 1.0;
        if (imageAspect >= 1.0) {
          meshScaleX = 1.0;
          meshScaleY = 1.0 / imageAspect;
        } else {
          meshScaleX = imageAspect;
          meshScaleY = 1.0;
        }

        if (u.u_meshScale) gl.uniform2f(u.u_meshScale, meshScaleX, meshScaleY);

        // Texel step: match exact 1-pixel spacing for full-resolution surface normal evaluation
        if (u.u_texelSize) gl.uniform2f(u.u_texelSize, 1.0 / (width || 512), 1.0 / (height || 512));
        if (u.u_normalScale) gl.uniform1f(u.u_normalScale, (depthConfig.depthScale || 3.0) * 12.0);
        if (u.u_depthScale) gl.uniform1f(u.u_depthScale, (depthConfig.depthScale || 3.0) * 0.08);

        // Directional Light
        const lightRad = ((depthConfig.lightAngle ?? 315) * Math.PI) / 180;
        const elevRad = ((depthConfig.lightElevation ?? 45) * Math.PI) / 180;
        const lx = Math.cos(lightRad) * Math.cos(elevRad);
        const ly = Math.sin(lightRad) * Math.cos(elevRad);
        const lz = Math.sin(elevRad);

        if (u.u_lightDir) gl.uniform3f(u.u_lightDir, lx, ly, lz);

        // Material Uniform
        const matCode =
          depthConfig.material === 'brass'
            ? 1
            : depthConfig.material === 'slate'
            ? 2
            : depthConfig.viewMode === 'heatmap'
            ? 3
            : depthConfig.material === 'grayscale'
            ? 4
            : 0; // Walnut default

        if (u.u_material) gl.uniform1i(u.u_material, matCode);
        if (u.u_showToolpaths) gl.uniform1i(u.u_showToolpaths, showToolpaths ? 1 : 0);

        // Draw Displaced High-Resolution Mesh
        if (wireframeMode) {
          if (wireIndexBufferRef.current) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireIndexBufferRef.current);
            gl.drawElements(gl.LINES, wireCountRef.current, gl.UNSIGNED_INT, 0);
          }
        } else {
          if (triIndexBufferRef.current) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIndexBufferRef.current);
            gl.drawElements(gl.TRIANGLES, triCountRef.current, gl.UNSIGNED_INT, 0);
          }
        }

        needsRenderRef.current = false;
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      isMounted = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [camera, depthConfig, width, height, showToolpaths, wireframeMode]);

  // Mouse Interaction Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      isDraggingRef.current = true;
    } else if (e.button === 2) {
      isPanningRef.current = true;
    }
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current && !isPanningRef.current) return;

    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    if (isDraggingRef.current) {
      needsRenderRef.current = true;
      setCamera((prev) => ({
        ...prev,
        azimuth: (prev.azimuth - dx * 0.4) % 360,
        elevation: Math.max(10, Math.min(88, prev.elevation + dy * 0.4)),
      }));
    } else if (isPanningRef.current) {
      needsRenderRef.current = true;
      setCamera((prev) => ({
        ...prev,
        panX: prev.panX + dx * 0.003 * prev.distance,
        panY: prev.panY - dy * 0.003 * prev.distance,
      }));
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    isPanningRef.current = false;
  };

  // Non-passive wheel event listener to avoid [Intervention] preventDefault browser errors
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      needsRenderRef.current = true;
      const zoomFactor = e.deltaY * 0.0015;
      setCamera((prev) => ({
        ...prev,
        distance: Math.max(0.8, Math.min(6.0, prev.distance * (1 + zoomFactor))),
      }));
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={styles.viewerContainer}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className={styles.webglCanvas} />

      {/* Floating HUD Controls */}
      <div className={styles.hudOverlay}>
        <div className={styles.hudBadge}>
          <Box size={14} />
          <span>3D Relief Mesh</span>
        </div>

        <div className={styles.hudActions}>
          <button
            className={`${styles.hudBtn} ${wireframeMode ? styles.hudBtnActive : ''}`}
            onClick={() => setWireframeMode((p) => !p)}
            title="Toggle 3D Surface Wireframe"
          >
            <Grid size={14} />
            <span>Wireframe</span>
          </button>

          <button
            className={`${styles.hudBtn} ${showToolpaths ? styles.hudBtnActive : ''}`}
            onClick={() => setShowToolpaths((p) => !p)}
            title="Toggle CNC Toolpath Simulation"
          >
            <Layers size={14} />
            <span>Toolpaths</span>
          </button>

          <button
            className={styles.hudBtn}
            onClick={handleTopDownCamera}
            title="Top-Down CNC Bed Perspective"
          >
            <Compass size={14} />
            <span>Top View</span>
          </button>

          <button
            className={styles.hudBtn}
            onClick={handleResetCamera}
            title="Reset 3D Orbit Camera"
          >
            <RotateCcw size={14} />
            <span>Reset View</span>
          </button>
        </div>
      </div>

      <div className={styles.hudHint}>
        Left-Click Drag: Orbit • Right-Click Drag: Pan • Scroll: Zoom
      </div>
    </div>
  );
};

// -------------------------------------------------------------------------
// Fast WebGL Matrix Math Helpers (No Heavy Dependencies)
// -------------------------------------------------------------------------

function createPerspectiveMatrix(fov: number, aspect: number, near: number, far: number): number[] {
  const f = 1.0 / Math.tan(fov / 2);
  const rangeInv = 1.0 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * rangeInv, -1,
    0, 0, near * far * rangeInv * 2, 0,
  ];
}

function createOrbitViewMatrix(
  azimuthDeg: number,
  elevationDeg: number,
  distance: number,
  panX: number,
  panY: number
): number[] {
  const azRad = (azimuthDeg * Math.PI) / 180;
  const elRad = (elevationDeg * Math.PI) / 180;

  const camX = distance * Math.cos(elRad) * Math.sin(azRad) + panX;
  const camY = -distance * Math.cos(elRad) * Math.cos(azRad) + panY;
  const camZ = distance * Math.sin(elRad);

  const target = [panX, panY, 0];
  const eye = [camX, camY, camZ];
  const up = [0, 0, 1];

  return createLookAtMatrix(eye, target, up);
}

function createLookAtMatrix(eye: number[], target: number[], up: number[]): number[] {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  const zLen = Math.hypot(zx, zy, zz) || 1.0;
  zx /= zLen; zy /= zLen; zz /= zLen;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xLen = Math.hypot(xx, xy, xz) || 1.0;
  xx /= xLen; xy /= xLen; xz /= xLen;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return [
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ];
}

function multiplyMatrices(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + j] * b[i * 4 + k];
      }
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

