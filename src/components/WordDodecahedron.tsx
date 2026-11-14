import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";

/**
 * 词汇星图 · 正十二面体
 *
 * 最初是一个独立的演示页面，这里重写成嵌入组件。
 * 结构：正十二面体 20 个顶点各挂一颗珠，30 条棱用六边形截面的管子做霓虹发光，
 * 珠子不定时随机爆闪（一次只亮 1~3 颗，避免满屏乱闪）。
 *
 * 相比原版做了四处必要改动，否则放进 SPA 会出问题：
 *   1. 尺寸取自容器而不是 window，原版的 camera.aspect / setSize 都绑在视口上；
 *   2. resize 用 ResizeObserver 监听容器，而不是 window.resize；
 *   3. 卸载时彻底释放 WebGL 上下文 —— 浏览器对同时存在的上下文有硬上限（约 16 个），
 *      不释放的话来回切几次页面就会黑屏；
 *   4. 滚出视野或标签页不可见时停止 rAF，不让它在后台空转吃 GPU。
 */

export function WordDodecahedron({
  className = "",
  focusToken = 0,
  anchorRef,
}: {
  className?: string;
  /** 每次数值变化，装置就转向一个随机顶点 —— 用来回应「搜出新结果」 */
  focusToken?: number;
  /**
   * 转向的那个顶点在屏幕上的位置，逐帧写进这个元素的 transform。
   * 由组件直接改 DOM 而不是走 React state：每秒 60 次重渲染会把整张结果列表
   * 一起拖慢，而这个定位只需要一次 style 赋值。
   */
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 用 ref 传给 rAF 循环：effect 只跑一次，不能靠闭包拿最新 props
  const focusRef = useRef(focusToken);
  focusRef.current = focusToken;

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    /* ---------- 场景 ---------- */
    const scene = new THREE.Scene();
    // 不设背景：画布保持透明，只留结构线与节点

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    /* 装置半径 2.0 + 相机 z=9.2，视觉高度约占面板的六成：
       它是页面里的一个装置，不是主角，所以留了上下各 70px 的呼吸区。 */
    /* 正面视图：相机与装置同高，完全不俯视。
       抬高相机会变成「俯视看一件东西」，压低到水平才是「正面看它」。 */
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    // z=6.2：画布 740×320 时装置约 285px 高，几乎撑满画布高度
    camera.position.set(0, 0, 6.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    /* ---------- 布局：把装置放到画面左侧 ----------
       用 setViewOffset 平移视锥，而不是移动物体或改 controls.target ——
       后两种做法都会让拖拽变成「物体绕着画面外的某个点公转」，手感会变。
       这里只挪镜头，3D 关系不变，拖拽仍然是绕着装置本身转。 */
    // 视线右移 21%：装置因此更贴近画面左侧，落在页面的左下角
    const SIDE_SHIFT = 0.21;
    let viewW = width;
    let viewH = height;
    function applyLayout(w: number, h: number) {
      viewW = w;
      viewH = h;
      camera.aspect = w / h;
      camera.setViewOffset(w, h, w * SIDE_SHIFT, 0, w, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    applyLayout(width, height);
    camera.updateMatrixWorld(); // 首次投影前先算好 matrixWorldInverse

    /* ---------- 正十二面体几何 ---------- */
    const dodecaGeo = new THREE.DodecahedronGeometry(2.0, 0);
    const pos = dodecaGeo.attributes.position;
    const vertexSet = new Map<string, THREE.Vector3>();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      if (!vertexSet.has(key)) vertexSet.set(key, new THREE.Vector3(x, y, z));
    }
    const vertices = Array.from(vertexSet.values()); // 20 个
    /* 每个顶点绕 Y 轴的方位角。「转向某个节点」就是让它的方位角对齐镜头：
       把 group 转 -azimuth，这个顶点就正对观众。 */
    const azimuths = vertices.map((v) => Math.atan2(v.x, v.z));

    /* ---------- 总容器：线框 + 节点放一起，统一旋转，结构稳定 ---------- */
    const nodeGroup = new THREE.Group();
    nodeGroup.rotation.y = Math.PI / 5; // 初始对称姿态，36°
    nodeGroup.position.y = 0;
    scene.add(nodeGroup);

    /* ---------- 结构线：30 条棱 ---------- */
    const edgeGeoRaw = new THREE.EdgesGeometry(dodecaGeo);

    function buildEdges(geo: THREE.BufferGeometry) {
      const p = geo.attributes.position;
      const segs: [THREE.Vector3, THREE.Vector3][] = [];
      for (let i = 0; i < p.count; i += 2) {
        segs.push([
          new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)),
          new THREE.Vector3(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)),
        ]);
      }
      return segs;
    }
    const edgeSegs = buildEdges(edgeGeoRaw);

    // 顶点 -> 相邻顶点 的邻接表（脉冲在节点间传递用）
    const vertexIndex = new Map<string, number>();
    vertices.forEach((v, i) =>
      vertexIndex.set(
        v
          .toArray()
          .map((x) => x.toFixed(4))
          .join(","),
        i,
      ),
    );
    const adj: number[][] = Array.from({ length: vertices.length }, () => []);
    edgeSegs.forEach(([a, b]) => {
      const key = (v: THREE.Vector3) =>
        v
          .toArray()
          .map((x) => x.toFixed(4))
          .join(",");
      const ia = vertexIndex.get(key(a));
      const ib = vertexIndex.get(key(b));
      if (ia !== undefined && ib !== undefined) {
        adj[ia].push(ib);
        adj[ib].push(ia);
      }
    });

    // 每条棱 → 一根六边形截面的细管；顶点带沿棱参数 aT 与独立随机种子
    function buildEdgeTubes(segs: [THREE.Vector3, THREE.Vector3][], RADIUS = 0.028, SIDES = 8) {
      const SEGS = 12;
      const positions: number[] = [];
      const normals: number[] = [];
      const aT: number[] = [];
      const aSeed: number[] = [];
      const indices: number[] = [];

      segs.forEach(([a, b], segIdx) => {
        const dir = new THREE.Vector3().subVectors(b, a).normalize();
        const ref = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
        const v = new THREE.Vector3().crossVectors(dir, u).normalize();
        const seed = Math.random();
        const base = segIdx * (SEGS + 1) * SIDES;

        for (let s = 0; s <= SEGS; s++) {
          const t = s / SEGS;
          const center = new THREE.Vector3().lerpVectors(a, b, t);
          for (let k = 0; k < SIDES; k++) {
            const ang = (k / SIDES) * Math.PI * 2;
            const nx = Math.cos(ang);
            const ny = Math.sin(ang);
            const p = center
              .clone()
              .addScaledVector(u, nx * RADIUS)
              .addScaledVector(v, ny * RADIUS);
            positions.push(p.x, p.y, p.z);
            const n = new THREE.Vector3().addScaledVector(u, nx).addScaledVector(v, ny).normalize();
            normals.push(n.x, n.y, n.z);
            aT.push(t);
            aSeed.push(seed);
          }
        }
        for (let s = 0; s < SEGS; s++) {
          for (let k = 0; k < SIDES; k++) {
            const k2 = (k + 1) % SIDES;
            const i0 = base + s * SIDES + k;
            const i1 = base + s * SIDES + k2;
            const i2 = base + (s + 1) * SIDES + k;
            const i3 = base + (s + 1) * SIDES + k2;
            indices.push(i0, i2, i1, i1, i2, i3);
          }
        }
      });

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
      geo.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(aT), 1));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(aSeed), 1));
      geo.setIndex(indices);
      return geo;
    }

    const wireGeo = buildEdgeTubes(edgeSegs, 0.017, 8);

    /* 配色取自背景视频 circuit-loop.webm：
       抽帧后统计高亮像素，线条主色 #a0d0e0 ~ #c0f0f0、核心高光 #d1fafe、平均 #96cada，
       是一套偏白的青。这里按「主线偏青、芯部偏白」铺开，保留发光层次，
       而不是整根线都用均值色 —— 均值含大量中间调，直接用会发灰。 */
    const wireUniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x7ccfe4) }, // 主发光：电路的青
      uBright: { value: new THREE.Color(0xd8f6ff) }, // 芯部：电路的核心高光
    };

    const wireMat = new THREE.ShaderMaterial({
      uniforms: wireUniforms,
      transparent: true,
      depthWrite: false,
      // 加色混合 + 正确的 alpha 累积：RGB 直接相加，Alpha 按 over 累积，
      // 这样既保留发光亮度，又不会在外缘留下不透明黑边。
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      vertexShader: `
        attribute float aT;
        attribute float aSeed;
        varying float vT;
        varying float vSeed;
        varying float vViewZ;
        varying vec3 vN;
        void main() {
          vT = aT;
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewZ = -mv.z;
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uBright;
        varying float vT;
        varying float vSeed;
        varying float vViewZ;
        varying vec3 vN;

        float hash(float n) {
          return fract(sin(n) * 43758.5453123);
        }

        void main() {
          // 整条棱均匀常亮，只做极小幅呼吸，不产生流动感
          float r1 = hash(vSeed * 12.9898);
          float breathe = 0.95 + 0.05 * sin(uTime * (0.4 + r1 * 0.3) + r1 * 6.2831853);

          // 管子正对镜头处略亮、轮廓处略暗 —— 只用来让线有体积
          float facing = clamp(abs(normalize(vN).z), 0.0, 1.0);
          float tube = 0.62 + 0.38 * pow(facing, 0.8);

          // 远近区分：近处亮、远处暗
          float depthFactor = 1.0 - smoothstep(4.2, 11.5, vViewZ) * 0.6;

          vec3 col = mix(uColor, uBright, 0.3 * pow(facing, 1.6));

          float lum = 0.62 * breathe * tube * depthFactor;
          gl_FragColor = vec4(col * lum, clamp(lum, 0.0, 1.0));
        }
      `,
    });

    const wireframe = new THREE.Mesh(wireGeo, wireMat);
    nodeGroup.add(wireframe);

    /* ---------- 线条外层柔和过渡 ----------
       管状几何体上，法线朝向相机的程度恰好等于「离轴的距离」：
       pow(nz, p) 得到一层沿半径方向柔和渐隐的光晕，不会出现硬边环。 */
    function addHaloLayer({
      radius,
      sides,
      color,
      strength,
      power,
    }: {
      radius: number;
      sides: number;
      color: number;
      strength: number;
      power: number;
    }) {
      const geo = buildEdgeTubes(edgeSegs, radius, sides);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uStrength: { value: strength },
          uPower: { value: power },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        vertexShader: `
          varying vec3 vN;
          varying float vViewZ;
          void main() {
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vViewZ = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uStrength;
          uniform float uPower;
          varying vec3 vN;
          varying float vViewZ;
          void main() {
            float nz = clamp(abs(normalize(vN).z), 0.0, 1.0);
            float fall = pow(nz, uPower);
            float depthFactor = 1.0 - smoothstep(4.2, 11.5, vViewZ) * 0.7;
            float a = clamp(uStrength * fall * depthFactor, 0.0, 1.0);
            gl_FragColor = vec4(uColor * a, a);
          }
        `,
      });
      const mesh = new THREE.Mesh(geo, mat);
      nodeGroup.add(mesh);
      return mesh;
    }

    // 内层：紧贴线条的浅色过渡；外层：更大范围的薄雾，让发光散开而不是硬切
    addHaloLayer({ radius: 0.052, sides: 12, color: 0x8fd6e8, strength: 0.55, power: 1.8 });
    addHaloLayer({ radius: 0.115, sides: 12, color: 0xbce8f5, strength: 0.2, power: 2.8 });

    /* ---------- 节点：小实心球，柔和高光塑体积，时不时爆一次光 ---------- */
    const NODE_BASE = new THREE.Color(0xa8dcf2);
    const NODE_HI = new THREE.Color(0xf4feff);
    const NODE_GLOW = new THREE.Color(0xd8f2ff);

    const ballGeo = new THREE.SphereGeometry(0.07, 24, 18);

    function makeBall() {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uBase: { value: NODE_BASE },
          uHi: { value: NODE_HI },
          uGlow: { value: NODE_GLOW },
          uFlash: { value: 0 },
        },
        vertexShader: `
          varying vec3 vN;
          varying float vViewZ;
          void main() {
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vViewZ = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform vec3 uBase;
          uniform vec3 uHi;
          uniform vec3 uGlow;
          uniform float uFlash;
          varying vec3 vN;
          varying float vViewZ;

          void main() {
            vec3 n = normalize(vN);
            vec3 L = normalize(vec3(-0.38, 0.52, 0.76));
            vec3 V = vec3(0.0, 0.0, 1.0);

            // 底色保持均匀，只叠加柔和高光，不做任何压暗
            float spec = pow(clamp(dot(n, normalize(L + V)), 0.0, 1.0), 20.0);
            vec3 col = uBase + uHi * spec * 0.9;

            col = mix(col, uGlow, clamp(uFlash, 0.0, 1.0) * 0.85);

            // 远处向「深蓝」过渡而不是乘系数 —— 直接压暗会把浅蓝压成灰
            float depth = 1.0 - smoothstep(4.2, 11.5, vViewZ) * 0.3;
            vec3 farCol = vec3(0.04, 0.38, 0.54);
            col = mix(farCol, col, depth);

            gl_FragColor = vec4(col, 1.0);
          }
        `,
      });
      return new THREE.Mesh(ballGeo, mat);
    }

    const glowTextures: THREE.Texture[] = [];

    // 节点自带的荧光雾：常态就有一层，闪光时扩散变亮
    function makeGlow() {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(40,150,255,0.32)");
      grad.addColorStop(0.2, "rgba(56,168,255,0.8)");
      grad.addColorStop(0.5, "rgba(0,110,235,0.34)");
      grad.addColorStop(0.8, "rgba(0,90,200,0.08)");
      grad.addColorStop(1, "rgba(0,90,200,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(canvas);
      glowTextures.push(tex);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.24, 0.24, 1);
      return sprite;
    }

    type Node = {
      index: number;
      ball: THREE.Mesh;
      glow: THREE.Sprite;
      pos: THREE.Vector3;
      pulseActive: number;
    };

    /* 被指向的顶点下标。转向时确定，之后一直保留：引线和入口都挂在它上面。 */
    let targetIndex: number | null = null;

    const nodes: Node[] = [];
    vertices.forEach((v, i) => {
      const ball = makeBall();
      ball.position.copy(v);
      nodeGroup.add(ball);

      const glow = makeGlow();
      glow.position.copy(v);
      nodeGroup.add(glow);

      nodes.push({ index: i, ball, glow, pos: v.clone(), pulseActive: 0 });
    });


    /* ---------- 交互：只动装置，不动相机 ----------
       这里不用 OrbitControls：它旋转的是相机，场景里任何固定物都会跟着
       产生透视变化。现在相机完全固定，拖拽只改装置自身的旋转，
       滚轮只改装置的缩放。 */
    let dragRotX = 0; // 垂直拖拽 → 绕 X 轴翻转
    let dragRotY = 0; // 水平拖拽 → 绕 Y 轴转动
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const el = renderer.domElement;
    el.style.cursor = "grab";
    el.style.touchAction = "pan-y"; // 竖直滑动留给页面滚动，横向拖拽才转装置

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      dragRotY += dx * 0.006;
      // 翻转限制在 ±52°，翻过头会看到装置"倒过来"，不像在观察一件展品
      dragRotX = Math.max(-0.9, Math.min(0.9, dragRotX + dy * 0.006));
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      el.style.cursor = "grab";
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* 指针已经释放 */
      }
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    /* ---------- 动画循环 ---------- */
    const clock = new THREE.Clock();
    let elapsed = 0;
    let nextFlashAt = 0.8 + Math.random() * 1.2;
    const _wp = new THREE.Vector3();

    function updateNodes(t: number, dt: number) {
      /* 被指向的那个节点改成持续呼吸，而不是随机爆闪 ——
         引线就落在它身上，它得是唯一有标记的那颗。 */
      if (targetIndex !== null && nodes[targetIndex]) {
        nodes[targetIndex].pulseActive = Math.max(
          nodes[targetIndex].pulseActive,
          0.72 + 0.26 * Math.sin(t * 2.6),
        );
      }

      // 到点触发：一次挑 1~3 颗，间隔与落点都随机
      if (t >= nextFlashAt) {
        const candidates = nodes.filter((n) => n.pulseActive < 0.12);
        const pool = candidates.length ? candidates : nodes;
        const count = Math.min(pool.length, 1 + Math.floor(Math.random() * 3));
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        for (let k = 0; k < count; k++) pool[k].pulseActive = 0.9 + Math.random() * 0.6;
        nextFlashAt = t + 0.2 + Math.random() * 0.5;
      }

      nodes.forEach((node) => {
        node.pulseActive = Math.max(0, node.pulseActive - dt * 1.3);
        const f = Math.min(node.pulseActive, 1.3);

        (node.ball.material as THREE.ShaderMaterial).uniforms.uFlash.value = Math.min(f * 1.1, 1.0);
        node.ball.scale.setScalar(1 + f * 0.2);

        node.ball.getWorldPosition(_wp);
        const dist = camera.position.distanceTo(_wp);
        const depthF = 1 - THREE.MathUtils.smoothstep(dist, 4.2, 11.5) * 0.5;

        const hs = 0.38 + 0.55 * f;
        node.glow.scale.set(hs, hs, 1);
        node.glow.material.opacity = Math.min(0.55 + 0.6 * f, 1.0) * depthF;
      });
    }

    /* ---------- 只在可见时渲染 ----------
       这一屏是持续动画的 WebGL，滚出视野或切到别的标签页就该停下来，
       否则会在后台白烧 GPU。 */
    let rafId = 0;
    let visible = true;
    let running = false;

    /* 自转与「转向某个节点」共用同一个角度变量：
       tween 在跑时角度由补间接管，跑完再从该角度继续慢转，
       否则会出现「刚转到节点又立刻被自转拽走」的撕裂感。 */
    let rotY = Math.PI / 5;
    let spinTween: { from: number; to: number; t0: number; dur: number } | null = null;
    let lastFocus = focusRef.current;

    /* 转向之后停在那个姿态：锚在节点上的入口不能跟着装置一起漂走，
       否则标签会自己爬出画布。重新搜索或拖拽都会重新计算。 */

    /* ---------- 节点锚点：把选中的顶点投影成屏幕坐标 ----------
       相机固定、装置在转，所以每帧都要重算 —— 但只写一行 transform，
       比 setState 触发 React 重渲染便宜几个数量级。 */
    const world = new THREE.Vector3();
    const inCam = new THREE.Vector3();
    let cardWidth = 160;
    let cardWidthAt = -1;
    const CAM_Z = 6.2; // 与上面 camera.position.z 一致
    const RAD = 2.0; // 与 DodecahedronGeometry 半径一致

    function placeAnchor(t: number) {
      const el = anchorRef?.current;
      if (!el) return;
      if (targetIndex === null) {
        el.style.opacity = "0";
        el.style.visibility = "hidden";
        return;
      }

      nodeGroup.updateMatrixWorld(true);
      world.copy(vertices[targetIndex]).applyMatrix4(nodeGroup.matrixWorld);
      inCam.copy(world).applyMatrix4(camera.matrixWorldInverse);

      // 顶点在背面时不该浮出标签：转向过程有一半时间它朝着另一边
      const depth = -inCam.z;
      const front = (CAM_Z + RAD - depth) / (2 * RAD); // 正对镜头 1，背面 0
      const alpha = Math.max(0, Math.min(1, (front - 0.45) / 0.3));

      const w = viewW;
      const h = viewH;
      world.project(camera); // setViewOffset 已经在投影矩阵里，这里不用再补偏移
      const px = (world.x * 0.5 + 0.5) * w;
      /* 入口是 translateY(-50%)，所以锚点落在 14..h-14 之间才不会探出画布：
         探出去就会压到上面的结果面板（overflow 是 visible）。 */
      const py = Math.min(h - 14, Math.max(14, (-world.y * 0.5 + 0.5) * h));

      /* 卡片不能压在本体上 —— 被指的那个节点会整颗被盖掉。
         所以卡片放到整个轮廓的右外侧，用一条引线连回节点：
         每帧遍历 20 个顶点取最大投影 x，比估一个固定偏移准。 */
      let right = px;
      for (const v of vertices) {
        world.copy(v).applyMatrix4(nodeGroup.matrixWorld).project(camera);
        const vx = (world.x * 0.5 + 0.5) * w;
        if (vx > right) right = vx;
      }
      // +28 是给轮廓外侧的辉光留的余量：只按顶点算，卡片会贴在光边上
      // 最少 44：节点正好落在轮廓最右边时，也要有一段看得见的引线
      let lead = Math.max(44, right - px + 28);

      /* 窄屏上节点靠右时，卡片会顶出画布被 overflow 切掉。
         所以先量它实际多宽（每 250ms 一次，避免每帧强制重排），
         再按「画布右缘还剩多少」把卡片往回收，收到贴边为止。 */
      if (t - cardWidthAt > 0.25) {
        cardWidth = el.firstElementChild ? el.firstElementChild.clientWidth || 160 : 160;
        cardWidthAt = t;
      }
      const room = viewW - 8 - px;
      lead = Math.min(lead, Math.max(18, room - cardWidth));
      el.style.setProperty("--lead", `${lead.toFixed(1)}px`);

      el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
      el.style.opacity = alpha.toFixed(3);
      el.style.visibility = alpha > 0.02 ? "visible" : "hidden";
      // 半透明时不给点：一颗几乎看不见的按钮压在画布上，只会误触
      el.style.setProperty("--hit", alpha > 0.5 ? "auto" : "none");
    }

    function frame() {
      rafId = requestAnimationFrame(frame);

      // getElapsedTime() 内部会消费一次 getDelta()，必须先取 delta 再累加时间，
      // 否则 dt 恒为 0，闪烁与衰减都会失效。
      const dt = Math.min(clock.getDelta(), 0.1);
      elapsed += dt;
      const t = elapsed;

      // 外部要求「转向一个节点」：随机挑一个，算出最近的正向等价角
      if (focusRef.current !== lastFocus) {
        lastFocus = focusRef.current;
        if (azimuths.length) {
          const i = Math.floor(Math.random() * azimuths.length);
          const want = -azimuths[i];
          // 至少再转 1.2 圈，避免只挪几度、看起来像抖动
          let to = want;
          while (to < rotY + Math.PI * 2.4) to += Math.PI * 2;
          spinTween = { from: rotY, to, t0: t, dur: 1.1 };
          targetIndex = i;
        }
      }

      if (spinTween) {
        const k = Math.min(1, (t - spinTween.t0) / spinTween.dur);
        // easeOutCubic：起手快、收尾缓，落点才稳
        const e = 1 - Math.pow(1 - k, 3);
        rotY = spinTween.from + (spinTween.to - spinTween.from) * e;
        if (k >= 1) {
          rotY = spinTween.to;
          spinTween = null;
        }
      } else if (targetIndex === null) {
        rotY += dt * 0.1;
      }

      // 自转（或转向）+ 用户拖拽叠加；翻转只在 X 轴
      nodeGroup.rotation.y = rotY + dragRotY;
      nodeGroup.rotation.x = dragRotX;

      placeAnchor(t);
      wireUniforms.uTime.value = t;
      updateNodes(t, dt);
      renderer.render(scene, camera);
    }

    function start() {
      if (running) return;
      running = true;
      clock.getDelta(); // 丢掉暂停期间累积的时长，避免恢复瞬间跳一大步
      rafId = requestAnimationFrame(frame);
    }
    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(rafId);
    }

    // 滚出视野就停
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !document.hidden) start();
        else stop();
      },
      { threshold: 0.1 },
    );
    io.observe(container);

    // 标签页切走也停
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // 跟随容器尺寸，而不是窗口
    const ro = new ResizeObserver(() => {
      applyLayout(container.clientWidth || 1, container.clientHeight || 1);
    });
    ro.observe(container);

    start();

    /* ---------- 卸载：把 WebGL 资源还回去 ---------- */
    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);

      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      glowTextures.forEach((t) => t.dispose());

      dodecaGeo.dispose();
      edgeGeoRaw.dispose();
      ballGeo.dispose();

      renderer.dispose();
      // 必须显式丢弃上下文：浏览器同时可用的 WebGL 上下文有硬上限，
      // 只 dispose 不丢弃的话，来回进出这个页面几次就会黑屏。
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={hostRef} className={`word-dodecahedron ${className}`} />;
}
