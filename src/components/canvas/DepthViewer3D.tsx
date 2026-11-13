import React, { useEffect, useRef, useState, useCallback, useId } from 'react';
import { RotateCcw, Box, Compass } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { DEFAULT_DEPTH } from '../../lib/document';
import { ActivePointers, type PointerPair } from '../../lib/gestures';
import { DEFAULT_CAMERA, FOV_Y_DEG, cameraForKey, framingDistance, dollyBy, orbitBy, panBy, pinchCamera, type OrbitCamera } from '../../lib/orbit-camera';
import type { ReliefMaterial } from '../../types/depth';
import styles from './DepthViewer3D.module.css';

interface DepthViewer3DProps {
  /** The heightmap: `width * height` 16-bit heights, 0 deepest to 65535 the surface. */
  depthBuffer: ArrayBuffer | null;
  width: number;
  height: number;
  /** The relief's physical size, so it is drawn in true proportion to its depth. */
  sizeMm?: { widthMm: number; heightMm: number };
}

/** Grid vertices along each side of the mesh. */
const GRID_SIZE = 360;
/** Height of the light above the surface, degrees: low enough to model the relief. */
const LIGHT_ELEVATION_DEG = 35;
const MATERIAL_CODE: Record<ReliefMaterial, number> = { walnut: 0, brass: 1, slate: 2, grayscale: 3 };

const VS = `
attribute vec2 a_uv;
uniform mat4 u_mvp;
uniform sampler2D u_heightMap;
uniform vec2 u_meshHalf;     // half the mesh's width and height, world units
uniform float u_depth;       // world depth of the deepest point (view exaggeration included)
varying vec2 v_uv;
varying float v_height;
void main() {
  v_uv = a_uv;
  float h = texture2D(u_heightMap, a_uv).r;
  v_height = h;
  vec3 pos = vec3((a_uv.x * 2.0 - 1.0) * u_meshHalf.x, (1.0 - a_uv.y * 2.0) * u_meshHalf.y, (h - 1.0) * u_depth);
  gl_Position = u_mvp * vec4(pos, 1.0);
}`;

const FS = `
precision highp float;
varying vec2 v_uv;
varying float v_height;
uniform sampler2D u_heightMap;
uniform vec2 u_texel;        // one heightmap pixel, in uv
uniform vec2 u_texelWorld;   // one heightmap pixel, in world units
uniform float u_depth;
uniform vec3 u_lightDir;
uniform int u_material;
void main() {
  float zL = texture2D(u_heightMap, v_uv - vec2(u_texel.x, 0.0)).r;
  float zR = texture2D(u_heightMap, v_uv + vec2(u_texel.x, 0.0)).r;
  float zU = texture2D(u_heightMap, v_uv - vec2(0.0, u_texel.y)).r;
  float zD = texture2D(u_heightMap, v_uv + vec2(0.0, u_texel.y)).r;
  // World slopes: uv y runs down the image, world y up.
  float dzdx = (zR - zL) * u_depth / (2.0 * u_texelWorld.x);
  float dzdy = (zU - zD) * u_depth / (2.0 * u_texelWorld.y);
  vec3 N = normalize(vec3(-dzdx, -dzdy, 1.0));
  vec3 L = normalize(u_lightDir);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diffuse = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), 32.0);
  vec3 base;
  float specular;
  if (u_material == 0) {
    base = mix(vec3(0.36, 0.22, 0.12), vec3(0.74, 0.50, 0.28), 0.35 + 0.65 * v_height);
    specular = 0.15;
  } else if (u_material == 1) {
    base = vec3(0.82, 0.68, 0.32);
    specular = 0.6;
  } else if (u_material == 2) {
    base = vec3(0.34, 0.38, 0.43);
    specular = 0.2;
  } else {
    base = vec3(0.72);
    specular = 0.15;
  }
  vec3 color = base * (0.32 + 0.8 * diffuse) + vec3(spec * specular);
  gl_FragColor = vec4(color, 1.0);
}`;

/** Everything the view made on the GPU, released together. */
interface GpuScene {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  program: WebGLProgram;
  shaders: WebGLShader[];
  buffers: WebGLBuffer[];
  texture: WebGLTexture;
  indexCount: number;
  isWebGL2: boolean;
  /** True when 32-bit float textures can be filtered linearly. */
  floatLinear: boolean;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

/** Creates the scene on `canvas`, or returns the reason it cannot. */
function createScene(canvas: HTMLCanvasElement): GpuScene | string {
  const attrs = { antialias: true, alpha: false, depth: true };
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null;
  const isWebGL2 = gl !== null;
  if (!gl) {
    gl = canvas.getContext('webgl', attrs) as WebGLRenderingContext | null;
    if (gl && !gl.getExtension('OES_element_index_uint')) return 'This browser cannot draw the 3D view (WebGL without 32-bit indices).';
  }
  if (!gl) return 'This browser cannot draw the 3D view (no WebGL). The Heightmap view still shows the result.';
  const floatLinear = isWebGL2 && gl.getExtension('OES_texture_float_linear') !== null;

  const shaders: WebGLShader[] = [];
  const compile = (type: number, src: string): WebGLShader | null => {
    const shader = gl!.createShader(type);
    if (!shader) return null;
    shaders.push(shader);
    gl!.shaderSource(shader, src);
    gl!.compileShader(shader);
    return gl!.getShaderParameter(shader, gl!.COMPILE_STATUS) ? shader : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VS);
  const fs = compile(gl.FRAGMENT_SHADER, FS);
  const program = gl.createProgram();
  const fail = (why: string) => {
    shaders.forEach((s) => gl!.deleteShader(s));
    if (program) gl!.deleteProgram(program);
    gl!.getExtension('WEBGL_lose_context')?.loseContext();
    return why;
  };
  if (!vs || !fs || !program) return fail('The 3D view could not start its shaders.');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail('The 3D view could not start its shaders.');

  const uvs = new Float32Array((GRID_SIZE + 1) * (GRID_SIZE + 1) * 2);
  let k = 0;
  for (let y = 0; y <= GRID_SIZE; y++) {
    for (let x = 0; x <= GRID_SIZE; x++) {
      uvs[k++] = x / GRID_SIZE;
      uvs[k++] = y / GRID_SIZE;
    }
  }
  const indices = new Uint32Array(GRID_SIZE * GRID_SIZE * 6);
  k = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const i0 = y * (GRID_SIZE + 1) + x;
      const i2 = i0 + GRID_SIZE + 1;
      indices.set([i0, i2, i0 + 1, i0 + 1, i2, i2 + 1], k);
      k += 6;
    }
  }
  const uvBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  const indexBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.useProgram(program);
  const aUv = gl.getAttribLocation(program, 'a_uv');
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);

  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of ['u_mvp', 'u_heightMap', 'u_meshHalf', 'u_depth', 'u_texel', 'u_texelWorld', 'u_lightDir', 'u_material']) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return {
    gl,
    program,
    shaders,
    buffers: [uvBuffer, indexBuffer],
    texture,
    indexCount: indices.length,
    isWebGL2,
    floatLinear,
    uniforms,
  };
}

/** Deletes everything in `scene` and gives the context back to the browser (#48). */
function releaseScene(scene: GpuScene): void {
  const { gl } = scene;
  gl.deleteTexture(scene.texture);
  scene.buffers.forEach((b) => gl.deleteBuffer(b));
  scene.shaders.forEach((s) => {
    gl.detachShader(scene.program, s);
    gl.deleteShader(s);
  });
  gl.deleteProgram(scene.program);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/** Uploads the heightmap as a filterable texture (#48: R32F only where linear filtering of it is supported). */
function uploadHeights(scene: GpuScene, heights: Uint16Array, width: number, height: number): void {
  const { gl } = scene;
  gl.bindTexture(gl.TEXTURE_2D, scene.texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (scene.isWebGL2) {
    const gl2 = gl as WebGL2RenderingContext;
    const data = new Float32Array(heights.length);
    for (let i = 0; i < heights.length; i++) data[i] = heights[i] / 65535;
    // R16F is always filterable in WebGL 2; R32F needs OES_texture_float_linear.
    const format = scene.floatLinear ? gl2.R32F : gl2.R16F;
    gl2.texImage2D(gl2.TEXTURE_2D, 0, format, width, height, 0, gl2.RED, gl2.FLOAT, data);
  } else {
    const data = new Uint8Array(heights.length);
    for (let i = 0; i < heights.length; i++) data[i] = heights[i] >> 8;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
  }
}

/**
 * The relief as a 3D surface. It draws the heightmap it is given, the one the
 * export writes, in true proportion: the image's physical size across and
 * the maximum depth down, times the view-only exaggeration. It draws only
 * when something changes, and releases its GPU resources and context when it
 * closes (#48).
 */
export const DepthViewer3D: React.FC<DepthViewer3DProps> = ({ depthBuffer, width, height, sizeMm }) => {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GpuScene | null>(null);
  const frameRef = useRef<number | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const [glError, setGlError] = useState<string | null>(null);

  const depthConfig = useDocumentStore((s) => s.doc?.depth ?? DEFAULT_DEPTH);
  const { material, lightAngle, exaggeration, maxDepthMm } = depthConfig;

  const [camera, setCamera] = useState<OrbitCamera>(DEFAULT_CAMERA);
  // The camera as last moved with the keys: what screen readers are told. A
  // drag or pinch changes the camera on every frame, and announcing each one
  // would flood the reader, so pointer moves are not announced (review of #84).
  const [announcedCamera, setAnnouncedCamera] = useState<OrbitCamera>(DEFAULT_CAMERA);
  const [isFocused, setIsFocused] = useState(false);
  const keysHintId = useId();

  // The pointers down on the view and the gesture they make (#54). Pointer
  // capture keeps a drag going when it leaves the view, and ends it wherever
  // it is released.
  const pointersRef = useRef(new ActivePointers());
  const gestureRef = useRef<
    | { kind: 'orbit' | 'pan'; pointerId: number; x: number; y: number }
    | { kind: 'pinch'; start: PointerPair; camera: OrbitCamera }
    | null
  >(null);

  /** Draws once, at the next frame; repeated requests before it share it. */
  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      drawRef.current();
    });
  }, []);

  const handleResetCamera = useCallback(() => {
    setCamera(DEFAULT_CAMERA);
    setAnnouncedCamera(DEFAULT_CAMERA);
  }, []);

  const handleTopDownCamera = useCallback(() => {
    setCamera((prev) => ({ ...prev, azimuth: 0, elevation: 88, panX: 0, panY: 0 }));
  }, []);

  // The GPU scene lives exactly as long as the view. Each scene gets a canvas
  // of its own: a context once lost cannot be had again from the same canvas
  // (React mounts effects twice in development).
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.className = styles.webglCanvas;
    host.appendChild(canvas);
    canvasRef.current = canvas;
    const scene = createScene(canvas);
    if (typeof scene === 'string') {
      setGlError(scene);
      return () => {
        canvasRef.current = null;
        canvas.remove();
      };
    }
    sceneRef.current = scene;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => requestDraw());
    resize?.observe(canvas);
    return () => {
      resize?.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      sceneRef.current = null;
      canvasRef.current = null;
      releaseScene(scene);
      canvas.remove();
    };
  }, [requestDraw]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !depthBuffer || width === 0 || height === 0) return;
    if (depthBuffer.byteLength !== width * height * 2) return;
    uploadHeights(scene, new Uint16Array(depthBuffer), width, height);
    requestDraw();
  }, [depthBuffer, width, height, requestDraw]);

  // What one frame draws, with the current settings; redrawn when any changes.
  useEffect(() => {
    drawRef.current = () => {
      const scene = sceneRef.current;
      const canvas = canvasRef.current;
      if (!scene || !canvas || !depthBuffer) return;
      const { gl, uniforms: u } = scene;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      // #767676, the --canvas token: 18% grey, as around the 2D canvas.
      gl.clearColor(118 / 255, 118 / 255, 118 / 255, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(scene.program);

      // True proportions: the longest side spans 2 world units.
      const widthMm = sizeMm?.widthMm ?? width;
      const heightMm = sizeMm?.heightMm ?? height;
      const worldPerMm = 2 / Math.max(widthMm, heightMm);
      const half = { x: (widthMm * worldPerMm) / 2, y: (heightMm * worldPerMm) / 2 };
      const depthWorld = maxDepthMm * exaggeration * worldPerMm;

      // The camera's distance and pan are relative to the distance that frames the whole plate.
      const frame = framingDistance({ halfX: half.x, halfY: half.y, depth: depthWorld }, camera.elevation, w / h);
      const proj = perspective((FOV_Y_DEG * Math.PI) / 180, w / h, 0.05, 100 + frame * 4);
      const view = orbitView(camera.azimuth, camera.elevation, camera.distance * frame, camera.panX * frame, camera.panY * frame, -depthWorld / 2);
      gl.uniformMatrix4fv(u.u_mvp, false, new Float32Array(multiply(proj, view)));
      gl.uniform2f(u.u_meshHalf, half.x, half.y);
      gl.uniform1f(u.u_depth, depthWorld);
      gl.uniform2f(u.u_texel, 1 / width, 1 / height);
      gl.uniform2f(u.u_texelWorld, (half.x * 2) / width, (half.y * 2) / height);
      const az = (lightAngle * Math.PI) / 180;
      const el = (LIGHT_ELEVATION_DEG * Math.PI) / 180;
      gl.uniform3f(u.u_lightDir, Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el));
      gl.uniform1i(u.u_material, MATERIAL_CODE[material] ?? 0);
      gl.uniform1i(u.u_heightMap, 0);
      gl.drawElements(gl.TRIANGLES, scene.indexCount, gl.UNSIGNED_INT, 0);
    };
    requestDraw();
  }, [camera, material, lightAngle, exaggeration, maxDepthMm, sizeMm?.widthMm, sizeMm?.heightMm, width, height, depthBuffer, requestDraw]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // The HUD's buttons are inside the view; they are not drags.
    if ((e.target as Element).closest('button')) return;
    const pointers = pointersRef.current;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    pointers.down(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pair = pointers.pair();
    if (pair) {
      gestureRef.current = { kind: 'pinch', start: pair, camera };
    } else {
      const kind = e.pointerType === 'mouse' && e.button === 2 ? 'pan' : 'orbit';
      gestureRef.current = { kind, pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.move(e.pointerId, { x: e.clientX, y: e.clientY })) return;
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      const pair = pointersRef.current.pair();
      if (pair) setCamera(pinchCamera(gesture.camera, gesture.start, pair));
      return;
    }
    if (gesture.pointerId !== e.pointerId) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    setCamera((prev) => (gesture.kind === 'orbit' ? orbitBy(prev, dx, dy) : panBy(prev, dx, dy)));
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    pointers.up(e.pointerId);
    // Lifting one finger of a pinch carries on as an orbit with the other.
    const rest = gestureRef.current?.kind === 'pinch' ? pointers.first() : null;
    gestureRef.current = rest ? { kind: 'orbit', pointerId: rest.id, x: rest.at.x, y: rest.at.y } : null;
  };

  // Keys pressed on the view itself; the HUD's buttons keep theirs.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
    const next = cameraForKey(camera, e);
    if (!next) return;
    e.preventDefault();
    setCamera(next);
    setAnnouncedCamera(next);
  };

  // Non-passive, so the page does not scroll while the wheel zooms.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCamera((prev) => dollyBy(prev, 1 + e.deltaY * 0.0015));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      className={styles.viewerContainer}
      tabIndex={0}
      role="region"
      aria-label="3D relief view"
      aria-describedby={keysHintId}
      onKeyDown={handleKeyDown}
      onFocus={(e) => e.target === e.currentTarget && setIsFocused(true)}
      onBlur={(e) => e.target === e.currentTarget && setIsFocused(false)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={canvasHostRef} className={styles.webglCanvas} />
      {glError && <div className={styles.hudHint}>{glError}</div>}

      <div className={styles.hudOverlay}>
        <div className={styles.hudBadge}>
          <Box size={14} />
          <span>
            {sizeMm ? `${sizeMm.widthMm.toFixed(0)} × ${sizeMm.heightMm.toFixed(0)} mm, ` : ''}
            {maxDepthMm.toFixed(1)} mm deep{exaggeration !== 1 ? `, shown ${exaggeration}×` : ''}
          </span>
        </div>

        <div className={styles.hudActions}>
          <button className={styles.hudBtn} onClick={handleTopDownCamera} title="Look straight down">
            <Compass size={14} />
            <span>Top View</span>
          </button>
          <button className={styles.hudBtn} onClick={handleResetCamera} title="Reset the camera">
            <RotateCcw size={14} />
            <span>Reset View</span>
          </button>
        </div>
      </div>

      {/* With focus, the hint shows the keys; the camera is read out for screen readers. */}
      <span id={keysHintId} className={styles.visuallyHidden}>
        Arrow keys orbit, Shift for a larger step; plus and minus zoom.
      </span>
      <div className={styles.hudHint} aria-hidden="true">
        {isFocused
          ? 'Arrows: Orbit • Shift + Arrows: Larger Step • + / −: Zoom'
          : 'Drag: Orbit • Right-Drag or Two Fingers: Pan • Scroll or Pinch: Zoom'}
      </div>
      <div className={styles.visuallyHidden} role="status" aria-live="polite">
        {`Camera ${Math.round(((announcedCamera.azimuth % 360) + 360) % 360)}° around, ${Math.round(announcedCamera.elevation)}° above the surface, zoom ${Math.round(100 / announcedCamera.distance)}%`}
      </div>
    </div>
  );
};

// -------------------------------------------------------------------------
// Matrix helpers (column-major, as WebGL takes them)
// -------------------------------------------------------------------------

function perspective(fov: number, aspect: number, near: number, far: number): number[] {
  const f = 1.0 / Math.tan(fov / 2);
  const rangeInv = 1.0 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (near + far) * rangeInv, -1, 0, 0, near * far * rangeInv * 2, 0];
}

function orbitView(azimuthDeg: number, elevationDeg: number, distance: number, panX: number, panY: number, targetZ: number): number[] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const eye = [
    distance * Math.cos(el) * Math.sin(az) + panX,
    -distance * Math.cos(el) * Math.cos(az) + panY,
    distance * Math.sin(el) + targetZ,
  ];
  return lookAt(eye, [panX, panY, targetZ], [0, 0, 1]);
}

function lookAt(eye: number[], target: number[], up: number[]): number[] {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  const zLen = Math.hypot(zx, zy, zz) || 1.0;
  zx /= zLen;
  zy /= zLen;
  zz /= zLen;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xLen = Math.hypot(xx, xy, xz) || 1.0;
  xx /= xLen;
  xy /= xLen;
  xz /= xLen;
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

function multiply(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + j] * b[i * 4 + k];
      out[i * 4 + j] = sum;
    }
  }
  return out;
}
