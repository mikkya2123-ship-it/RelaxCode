/**
 * The optimized black-hole renderer: a ray-marched WebGL fragment shader with
 * approximate gravitational lensing. No external dependencies — one program,
 * one fullscreen triangle, one rAF loop.
 *
 * Transparent Electron windows on Windows are hostile to WebGL: contexts get
 * lost between hide/show cycles or simply never present frames. Two guards
 * live here:
 *  - `webglcontextlost` is prevented, and the program is rebuilt on restore;
 *  - `verify()` reads back real pixels, so the caller can detect a context
 *    that compiles fine but never draws, and fall back to Canvas2D.
 */

const VERTEX = `
attribute vec2 p;
void main() {
  gl_Position = vec4(p, 0.0, 1.0);
}
`

const FRAGMENT = `
precision highp float;
uniform vec2 res;
uniform float time;

float hash21(vec2 q) {
  return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 q) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - res) / min(res.x, res.y);

  // Camera: well above the disk plane and far enough that the whole scene
  // (disk + lensed halo) fits comfortably inside the frame.
  vec3 ro = vec3(0.0, 0.6, -5.4);
  vec3 f = normalize(-ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  vec3 up = cross(f, right);
  vec3 rd = normalize(uv.x * right + uv.y * up + 2.2 * f);

  vec3 pos = ro;
  vec3 prev = pos;
  vec3 col = vec3(0.0);
  float dt = 0.075;
  bool captured = false;

  for (int i = 0; i < 110; i++) {
    pos += rd * dt;
    // Gravity: bend the ray toward the center, stronger when closer.
    float r2 = dot(pos, pos);
    rd = normalize(rd - pos * (0.5 / r2) * dt);
    // The disk lives in the y=0 plane: emit where a step crosses it.
    if (prev.y * pos.y < 0.0) {
      float t = prev.y / (prev.y - pos.y);
      vec3 hit = mix(prev, pos, t);
      float hr = length(hit.xz);
      if (hr > 0.62 && hr < 2.3) {
        float ang = atan(hit.z, hit.x);
        float n = noise(vec2(hr * 6.0 - time * 0.7, ang * 3.0 + hr * 4.0));
        float n2 = noise(vec2(hr * 18.0 - time * 1.6, ang * 9.0));
        float emit = 0.35 + 0.75 * n + 0.5 * n2;
        float heat = clamp(1.0 - (hr - 0.62) / 1.7, 0.0, 1.0);
        // White-hot inside, amber outside.
        vec3 c = mix(vec3(1.0, 0.5, 0.14), vec3(1.0, 0.96, 0.88), pow(heat, 1.8));
        // Doppler beaming: the approaching side of the orbit burns brighter.
        float dop = 0.6 + 0.5 * sin(ang + 1.1);
        float fade = smoothstep(2.3, 0.95, hr);
        col += c * emit * dop * fade * 0.34;
      }
    }
    prev = pos;
    if (r2 < 0.06) { captured = true; break; }
  }

  if (!captured) {
    // Escaped rays: a sparse starfield on the sky, faintly lensed by using the
    // bent final direction as the lookup.
    vec2 sUV = rd.xz / (abs(rd.y) + 0.9);
    float s = hash21(floor(sUV * 190.0));
    float tw = 0.55 + 0.45 * sin(time * (1.0 + s * 4.0) + s * 40.0);
    col += vec3(0.75, 0.82, 1.0) * step(0.9965, s) * tw * 0.8;
  }

  // Soft filmic rolloff so the disk core stays white, not clipped.
  col = 1.0 - exp(-col * 1.25);
  gl_FragColor = vec4(col, 1.0);
}
`

export interface BlackHoleRenderer {
  /** Resolves once a frame has been presented: `true` if pixels are alive. */
  ready: Promise<boolean>
  dispose: () => void
}

export function createRenderer({ canvas }: { canvas: HTMLCanvasElement }): BlackHoleRenderer {
  const gl = canvas.getContext('webgl', {
    antialias: false,
    // `alpha: true` + premultiplied is what compositors of transparent
    // windows accept most reliably; we still write alpha = 1 everywhere.
    alpha: true,
    premultipliedAlpha: true
  })
  if (!gl) return { ready: Promise.resolve(false), dispose: () => {} }

  let lost = false
  let program: WebGLProgram | null = null
  let resLoc: WebGLUniformLocation | null = null
  let timeLoc: WebGLUniformLocation | null = null
  let resolveReady: ((ok: boolean) => void) | null = null
  let verified = false

  const setup = (): boolean => {
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl!.createShader(type)
      if (!shader) return null
      gl!.shaderSource(shader, source)
      gl!.compileShader(shader)
      return shader
    }
    const vs = compile(gl!.VERTEX_SHADER, VERTEX)
    const fs = compile(gl!.FRAGMENT_SHADER, FRAGMENT)
    program = gl!.createProgram()
    if (!vs || !fs || !program) return false
    gl!.attachShader(program, vs)
    gl!.attachShader(program, fs)
    gl!.linkProgram(program)
    if (!gl!.getProgramParameter(program, gl!.LINK_STATUS)) return false
    gl!.useProgram(program)
    gl!.bindBuffer(gl!.ARRAY_BUFFER, gl!.createBuffer())
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl!.STATIC_DRAW)
    const loc = gl!.getAttribLocation(program, 'p')
    gl!.enableVertexAttribArray(loc)
    gl!.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    resLoc = gl!.getUniformLocation(program, 'res')
    timeLoc = gl!.getUniformLocation(program, 'time')
    return true
  }

  if (!setup()) return { ready: Promise.resolve(false), dispose: () => {} }

  const onLost = (event: Event): void => {
    event.preventDefault()
    lost = true
  }
  const onRestored = (): void => {
    lost = false
    setup()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
    }
  }
  resize()

  /**
   * Reads back a handful of pixels where the disk and the ring must be bright.
   * A context that compiles but never presents (the transparent-window disease)
   * reads as all zeros here, and the caller falls back to Canvas2D.
   */
  const verify = (): boolean => {
    const w = canvas.width
    const h = canvas.height
    if (w === 0 || h === 0) return false
    const m = Math.min(w, h)
    const probes: Array<[number, number]> = [
      [w / 2, h / 2 - m * 0.18],
      [w / 2, h / 2 + m * 0.18],
      [w / 2 - m * 0.22, h / 2],
      [w / 2 + m * 0.22, h / 2],
      [w / 2, h / 2]
    ]
    const pixel = new Uint8Array(4)
    for (const [x, y] of probes) {
      gl.readPixels(Math.round(x), Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      if (pixel[0] > 12 || pixel[1] > 12 || pixel[2] > 12) return true
    }
    return false
  }

  let raf = 0
  let disposed = false
  const start = performance.now()
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve
  })
  const frame = (): void => {
    if (disposed) return
    if (!lost && program) {
      resize()
      gl.uniform2f(resLoc, canvas.width, canvas.height)
      gl.uniform1f(timeLoc, (performance.now() - start) / 1000)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!verified) {
        verified = true
        resolveReady?.(verify())
      }
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  return {
    ready,
    dispose: () => {
      disposed = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
  }
}
