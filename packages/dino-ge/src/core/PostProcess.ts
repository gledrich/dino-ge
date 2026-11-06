/** A GLSL float or vector uniform. */
export type PostProcessUniform = number | readonly [number, number]
  | readonly [number, number, number] | readonly [number, number, number, number];

type Uniforms = Readonly<Record<string, PostProcessUniform>>;

/** One full-screen fragment shader written in GLSL ES 3.00. */
export interface PostProcessShader {
  /** A complete fragment shader. Use v_uv, u_scene, u_resolution and u_time as needed. */
  readonly fragmentSource: string;
  readonly uniforms?: Uniforms;
}

export type PostProcessInstallResult = { ok: true } | {
  ok: false;
  reason: 'unavailable' | 'context-lost' | 'compile' | 'link' | 'uniform';
  message: string;
};

type InstallFailure = Extract<PostProcessInstallResult, { ok: false }>;

export type PostProcessStatus = 'disabled' | 'unavailable' | 'active' | 'context-lost'
  | 'source-security' | 'surface-size' | 'render-error';

const vertexSource = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const reservedNames = new Set(['u_scene', 'u_resolution', 'u_time']);

type Locations = Map<string, { location: WebGLUniformLocation; arity: number }>;

interface Pipeline {
  program: WebGLProgram;
  texture: WebGLTexture;
  vao: WebGLVertexArrayObject;
  uniforms: Locations;
  width: number;
  height: number;
}

interface GPU {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  maxWidth: number;
  maxHeight: number;
}

function snapshotUniforms(values: Uniforms): Map<string, PostProcessUniform> {
  const snapshot = new Map<string, PostProcessUniform>();
  for (const name of Object.keys(values)) {
    if (!/^[a-zA-Z_]\w*$/.test(name) || reservedNames.has(name)) {
      throw new TypeError(`Invalid post-process uniform name "${name}".`);
    }
    const value = values[name];
    if (typeof value === 'number' && Number.isFinite(value)) {
      snapshot.set(name, value);
    } else if (Array.isArray(value) && value.length >= 2 && value.length <= 4 &&
        Array.from(value).every(Number.isFinite)) {
      snapshot.set(name, Array.from(value) as [number, number] | [number, number, number] | [number, number, number, number]);
    } else {
      throw new TypeError(`Post-process uniform "${name}" needs a finite float or vector.`);
    }
  }
  return snapshot;
}

function validateArity(values: ReadonlyMap<string, PostProcessUniform>, locations: Locations): void {
  for (const [name, value] of values) {
    const active = locations.get(name);
    const arity = typeof value === 'number' ? 1 : value.length;
    if (active && active.arity !== arity) {
      throw new TypeError(`Post-process uniform "${name}" does not match its GLSL float or vector type.`);
    }
  }
}

function failure(reason: InstallFailure['reason'], message: string): InstallFailure {
  return { ok: false, reason, message };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | InstallFailure {
  const shader = gl.createShader(type);
  if (!shader) return failure('compile', 'WebGL could not allocate the shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const message = gl.getShaderInfoLog(shader) || 'WebGL could not compile the shader.';
  gl.deleteShader(shader);
  return failure('compile', message);
}

function link(gl: WebGL2RenderingContext, source: string): WebGLProgram | InstallFailure {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  if ('ok' in vertex) return vertex;
  const fragment = compile(gl, gl.FRAGMENT_SHADER, source);
  if ('ok' in fragment) {
    gl.deleteShader(vertex);
    return fragment;
  }

  const program = gl.createProgram();
  if (program) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!program) return failure('link', 'WebGL could not allocate the shader program.');
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  const message = gl.getProgramInfoLog(program) || 'WebGL could not link the shader program.';
  gl.deleteProgram(program);
  return failure('link', message);
}

function readUniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram): Locations {
  const reservedTypes = new Map([
    ['u_scene', gl.SAMPLER_2D], ['u_resolution', gl.FLOAT_VEC2], ['u_time', gl.FLOAT],
  ]);
  const sizes = new Map<number, number>([[gl.FLOAT, 1], [gl.FLOAT_VEC2, 2], [gl.FLOAT_VEC3, 3], [gl.FLOAT_VEC4, 4]]);
  const locations: Locations = new Map();
  const count: number = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index++) {
    const info = gl.getActiveUniform(program, index);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    const reserved = reservedTypes.get(name);
    const scalar = name === info.name && info.size === 1;
    if (reserved !== undefined && (!scalar || info.type !== reserved)) {
      throw new TypeError(`Post-process shader uses the wrong type for "${name}".`);
    }
    const location = gl.getUniformLocation(program, info.name);
    if (location) locations.set(name, { location, arity: scalar ? (sizes.get(info.type) ?? 0) : 0 });
  }
  return locations;
}

function makePipeline(gl: WebGL2RenderingContext, source: string,
  values: ReadonlyMap<string, PostProcessUniform>): Pipeline | InstallFailure {
  const program = link(gl, source);
  if ('ok' in program) return program;

  let uniforms: Locations;
  try {
    uniforms = readUniformLocations(gl, program);
    validateArity(values, uniforms);
  } catch (error) {
    gl.deleteProgram(program);
    return failure('uniform', messageOf(error));
  }

  const texture = gl.createTexture();
  const vao = gl.createVertexArray();
  if (!texture || !vao) {
    gl.deleteProgram(program);
    gl.deleteTexture(texture);
    gl.deleteVertexArray(vao);
    return failure('unavailable', 'WebGL could not allocate a post-process surface.');
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { program, texture, vao, uniforms, width: 0, height: 0 };
}

function present(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement): void {
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(image, 0, 0);
  } finally {
    ctx.restore();
  }
}

/** @internal Composites one optional GPU pass between the world and screen overlays. */
export default class PostProcess {
  private gpu?: GPU;
  private stage?: CanvasRenderingContext2D;
  private stageWorld?: object;
  private retrySecurityAt?: number;
  private presentedStage = false;
  private source?: string;
  private uniforms = new Map<string, PostProcessUniform>();
  private uniformLayout: Locations = new Map();
  private pipeline?: Pipeline;
  private state: PostProcessStatus = 'disabled';

  get status(): PostProcessStatus { return this.state; }

  setShader(shader: PostProcessShader | null): PostProcessInstallResult {
    if (shader === null) {
      this.clear();
      return { ok: true };
    }
    let uniforms: Map<string, PostProcessUniform>;
    try {
      uniforms = snapshotUniforms(shader.uniforms ?? {});
    } catch (error) {
      return failure('uniform', messageOf(error));
    }
    if (typeof shader.fragmentSource !== 'string' || !shader.fragmentSource.trim()) {
      return failure('compile', 'Post-processing needs a GLSL fragment shader.');
    }

    const gpu = this.gpu ?? this.createGPU();
    if (!gpu) {
      if (!this.source) this.state = 'unavailable';
      return failure('unavailable', 'A WebGL2 context could not be created.');
    }
    if (gpu.gl.isContextLost()) return failure('context-lost', 'The WebGL2 context is lost.');
    const pipeline = makePipeline(gpu.gl, shader.fragmentSource, uniforms);
    if (gpu.gl.isContextLost()) return failure('context-lost', 'The WebGL2 context is lost.');
    if ('ok' in pipeline) return pipeline;

    this.deletePipeline();
    this.pipeline = pipeline;
    this.uniformLayout = pipeline.uniforms;
    this.source = shader.fragmentSource;
    this.uniforms = uniforms;
    this.resetStage();
    this.state = 'active';
    return { ok: true };
  }

  setUniforms(values: Uniforms): void {
    if (!this.source) return;
    const snapshot = snapshotUniforms(values);
    validateArity(snapshot, this.uniformLayout);
    for (const [name, value] of snapshot) this.uniforms.set(name, value);
  }

  draw(target: CanvasRenderingContext2D, world: object, time: number,
    drawWorld: (ctx: CanvasRenderingContext2D) => void): void {
    const { gpu, pipeline } = this;
    if (!gpu || !pipeline) {
      this.drawDirect(target, drawWorld);
      return;
    }

    const { width, height } = target.canvas;
    if (gpu.gl.isContextLost()) {
      this.state = 'context-lost';
      this.drawDirect(target, drawWorld);
      return;
    }
    if (!width || !height || width > gpu.maxWidth || height > gpu.maxHeight) {
      this.state = 'surface-size';
      this.drawDirect(target, drawWorld);
      return;
    }

    if (this.stageWorld !== world) this.resetStage();
    this.stageWorld = world;
    const stage = this.stage ?? document.createElement('canvas').getContext('2d');
    if (!stage) {
      this.state = 'unavailable';
      this.drawDirect(target, drawWorld);
      return;
    }
    this.stage = stage;
    if (stage.canvas.width !== width || stage.canvas.height !== height) {
      stage.canvas.width = width;
      stage.canvas.height = height;
      this.retrySecurityAt = undefined;
    }
    if (this.retrySecurityAt !== undefined && time >= this.retrySecurityAt) {
      // Assigning the backing width again resets the origin-clean flag.
      stage.canvas.width = width;
      this.retrySecurityAt = undefined;
    }
    if (this.retrySecurityAt !== undefined) {
      this.state = 'source-security';
      this.drawDirect(target, drawWorld);
      return;
    }

    stage.clearRect(0, 0, width, height);
    drawWorld(stage);
    this.presentedStage = true;
    if (this.pipeline === pipeline) {
      try {
        if (this.render(gpu, pipeline, stage.canvas, time)) {
          present(target, gpu.canvas);
          this.state = 'active';
          return;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'SecurityError') {
          this.retrySecurityAt = time + 1;
          this.state = 'source-security';
        } else {
          this.state = gpu.gl.isContextLost() ? 'context-lost' : 'render-error';
        }
      }
    }
    present(target, stage.canvas);
  }

  private drawDirect(target: CanvasRenderingContext2D,
    drawWorld: (ctx: CanvasRenderingContext2D) => void): void {
    // Discard stale shader pixels behind transparent parts of the raw world.
    if (this.presentedStage || this.source) {
      target.clearRect(0, 0, target.canvas.width, target.canvas.height);
    }
    this.presentedStage = false;
    drawWorld(target);
  }

  dispose(): void {
    this.clear();
    const gpu = this.gpu;
    if (gpu) {
      gpu.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      gpu.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
      gpu.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.gpu = undefined;
  }

  private clear(): void {
    this.deletePipeline();
    this.source = undefined;
    this.uniforms.clear();
    this.uniformLayout.clear();
    this.resetStage();
    if (this.gpu) {
      this.gpu.canvas.width = 1;
      this.gpu.canvas.height = 1;
    }
    this.state = 'disabled';
  }

  private resetStage(): void {
    this.stage = undefined;
    this.stageWorld = undefined;
    this.retrySecurityAt = undefined;
  }

  private deletePipeline(): void {
    const gl = this.gpu?.gl;
    const pipeline = this.pipeline;
    if (gl && pipeline) {
      gl.useProgram(null);
      gl.deleteProgram(pipeline.program);
      gl.deleteTexture(pipeline.texture);
      gl.deleteVertexArray(pipeline.vao);
    }
    this.pipeline = undefined;
  }

  private createGPU(): GPU | undefined {
    const canvas = document.createElement('canvas');
    let gl: WebGL2RenderingContext | null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false,
      });
    } catch {
      return undefined;
    }
    if (!gl) return undefined;
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    return this.gpu = this.getGPULimits(canvas, gl);
  }

  private getGPULimits(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): GPU {
    const textureSize: number | null = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const viewportSize: Int32Array | null = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    return {
      canvas, gl,
      maxWidth: Math.min(textureSize ?? 0, viewportSize?.[0] ?? 0),
      maxHeight: Math.min(textureSize ?? 0, viewportSize?.[1] ?? 0),
    };
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.pipeline = undefined;
    if (this.source) this.state = 'context-lost';
  };

  private onContextRestored = (): void => {
    if (!this.gpu) return;
    this.gpu = this.getGPULimits(this.gpu.canvas, this.gpu.gl);
    if (!this.source) return;
    const pipeline = makePipeline(this.gpu.gl, this.source, this.uniforms);
    if ('ok' in pipeline) {
      this.state = 'render-error';
      return;
    }
    this.pipeline = pipeline;
    this.uniformLayout = pipeline.uniforms;
    this.resetStage();
    this.state = 'active';
  };

  private render(gpu: GPU, pipeline: Pipeline, source: HTMLCanvasElement, time: number): boolean {
    const { gl, canvas } = gpu;
    const { width, height } = source;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
      this.state = gl.isContextLost() ? 'context-lost' : 'surface-size';
      return false;
    }

    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pipeline.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (pipeline.width !== width || pipeline.height !== height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    gl.useProgram(pipeline.program);
    gl.bindVertexArray(pipeline.vao);
    gl.uniform1i(pipeline.uniforms.get('u_scene')?.location ?? null, 0);
    gl.uniform2f(pipeline.uniforms.get('u_resolution')?.location ?? null, width, height);
    gl.uniform1f(pipeline.uniforms.get('u_time')?.location ?? null, time);

    for (const [name, value] of this.uniforms) {
      const location = pipeline.uniforms.get(name)?.location;
      if (!location) continue;
      if (typeof value === 'number') gl.uniform1f(location, value);
      else if (value.length === 2) gl.uniform2f(location, ...value);
      else if (value.length === 3) gl.uniform3f(location, ...value);
      else gl.uniform4f(location, ...value);
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) {
      pipeline.width = 0;
      pipeline.height = 0;
      this.state = gl.isContextLost() ? 'context-lost' : 'render-error';
      return false;
    }
    pipeline.width = width;
    pipeline.height = height;
    return true;
  }
}
