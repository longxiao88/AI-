// ===================== 【可调配置参数区，新项目直接改这里】 =====================
const CONFIG = {
    MAX_DPR: 2,             // 高分屏渲染倍率上限
    DENSITY: 52000,         // 每条鱼占用的屏幕面积（px²），决定鱼的数量
    COUNT_MIN: 20,          // 鱼数量下限
    COUNT_MAX: 42,          // 鱼数量上限

    SIZE_MIN: 18,           // 最小鱼长（px）
    SIZE_MAX: 36,           // 最大鱼长（px）

    MAX_SPEED: 4.6,         // 最大游速
    MIN_SPEED: 0.9,         // 最小游速（避免鱼停住）
    TURN_RATE: 0.16,        // 鱼头转向平滑系数（越小转向越慢、游动越丝滑）

    // 队列结构：把鱼群分成若干条「链」，每条链首尾相接、一个接一个地游
    CHAIN_COUNT: 5,         // 队列数量
    CHAIN_GAP: 62,          // 链内相邻鱼的期望间距（px）
    CHAIN_FOLLOW: 0.16,     // 跟随弹簧刚度（适中，既跟得紧又不振荡）
    CHAIN_ALIGN: 0.14,      // 速度对齐强度（阻尼）
    CHAIN_HEAD_GAP: 90,     // 各队列「队头」之间的分离距离

    // 动态透明度转换
    CHAIN_ALPHA_DECAY: 0.035, // 沿队列每往后一条，透明度衰减量（队头最实、队尾最虚）
    BREATH_SPEED: 4,        // 透明度呼吸角速度
    BREATH_DEPTH: 0.2,      // 透明度呼吸幅度（0~1，越大脉动越明显）

    // 鼠标吸引：队头跟随鼠标
    MOUSE_RADIUS: 160,      // 距离鼠标多远开始被吸引
    MOUSE_WEIGHT: 0.025,    // 鼠标引力权重
    MOUSE_CALM: 40,         // 距离鼠标多近开始减速（形成环绕而非叠在鼠标上）

    // 边界：软边界，靠近边缘就转弯游回
    MARGIN: 70,
    EDGE_TURN: 0.6,

    // 深浅色主题配色：每条队列一种鲜亮、鲜明的颜色（中等饱和，不刺眼）。
    // glow=鱼身亮部，body=鱼身主色，fin=鱼鳍/描边；数组下标对应队列编号（取模循环）。
    COLORS: {
        dark: [
            { glow: "168,210,240", body: "100,168,215", fin: "58,118,168" },  // 蓝
            { glow: "150,225,210", body: "68,185,174",  fin: "34,128,123" },  // 青绿
            { glow: "210,180,235", body: "164,120,204", fin: "114,80,154" },  // 紫
            { glow: "245,205,150", body: "224,164,90",  fin: "174,120,60" },  // 橙
            { glow: "245,180,205", body: "224,134,170", fin: "174,90,124" },  // 粉
        ],
        light: [
            { glow: "150,195,225", body: "70,130,180",  fin: "40,90,135" },
            { glow: "135,205,190", body: "50,155,145",  fin: "25,110,100" },
            { glow: "190,160,215", body: "135,95,175",  fin: "95,60,130" },
            { glow: "230,190,135", body: "200,140,70",  fin: "150,100,45" },
            { glow: "230,165,190", body: "200,115,150", fin: "150,75,110" },
        ],
    },
}
// ==============================================================================

/**
 * 鱼：一条带位置、速度、大小、半透明度的鱼，属于某条队列（链）。
 * 实际外观由 drawFish 绘制（胖锦鲤：圆润鱼身 + 分叉大尾 + 鱼鳍 + 眼睛）。
 */
class Fish {
    constructor(view, chain, pos) {
        this.x = Math.random() * view.w;
        this.y = Math.random() * view.h;
        const a = Math.random() * Math.PI * 2;
        const s = 0.5 + Math.random() * 1.5;
        this.vx = Math.cos(a) * s;
        this.vy = Math.sin(a) * s;
        this.size = CONFIG.SIZE_MIN + Math.random() * (CONFIG.SIZE_MAX - CONFIG.SIZE_MIN);
        // 半透明基础值：大鱼更实、小鱼更透，形成远近层次
        this.alpha = 0.45 + (this.size / CONFIG.SIZE_MAX) * 0.35;
        this.chain = chain;   // 属于哪条队列
        this.pos = pos;       // 队列内位置（0=队头）
        this.prevIndex = -1;  // 队列内前一条鱼的数组下标（队头为 -1）
        this.breath = Math.random() * Math.PI * 2; // 透明度呼吸相位
        this.wander = Math.random() * Math.PI * 2; // 队头漫游方向
        this.phase = Math.random() * Math.PI * 2;  // 尾巴摆动相位
        this.phaseSpeed = 2 + Math.random() * 2;  // 摆动更慢、更柔和
        this.heading = a; // 当前朝向（初始=速度方向，用于平滑转向、避免抽搐）
    }
}

/**
 * 初始化鱼群背景特效：鱼群一个接一个地跟随鼠标 + 透明渐变 + 动态透明度 + 发光尾坠。
 * 架构与 bubbleEffect.js 一致（主题/动效/揭幕/销毁），可放心并排使用。
 * @param {HTMLCanvasElement} canvas DOM对象
 * @param {{ theme?: string, paused?: boolean }} [options]
 * @returns {{ setTheme: (theme?: string) => void, setPaused: (paused: boolean) => void, setSweep: (sweeping: boolean) => void, destroy: () => void }}
 */
export function initFishEffect(canvas, options = {}) {
    const ctx = canvas.getContext('2d');
    const config = CONFIG;
    const view = { w: 0, h: 0 }; // 逻辑尺寸（CSS 像素）

    let fish = [];
    let rafId = null;
    let paused = Boolean(options.paused);
    let destroyed = false;
    let sweeping = false; // 主题揭幕期间为 true，暂停绘制与更新
    let time = 0; // 累计秒数，用于透明度呼吸

    // 配色引用，只改内部值，鱼无需重建即可换色
    // 当前主题的颜色数组（每条队列取一种，按队列编号取模循环）
    let paletteList = [];
    function setTheme(theme) {
        paletteList = config.COLORS[theme === 'light' ? 'light' : 'dark'];
    }
    setTheme(options.theme);

    // 鼠标位置（窗口坐标，与鱼的坐标空间一致）
    const mouse = { x: 0, y: 0, active: false };

    function idealCount() {
        return Math.round(
            Math.max(config.COUNT_MIN, Math.min(config.COUNT_MAX, (view.w * view.h) / config.DENSITY)),
        );
    }

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, config.MAX_DPR);
        view.w = canvas.clientWidth || window.innerWidth;
        view.h = canvas.clientHeight || window.innerHeight;
        canvas.width = Math.max(1, Math.round(view.w * dpr));
        canvas.height = Math.max(1, Math.round(view.h * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // 越界的鱼拉回屏幕内
        for (const f of fish) {
            if (f.x < 0 || f.x > view.w || f.y < 0 || f.y > view.h) {
                f.x = Math.random() * view.w;
                f.y = Math.random() * view.h;
            }
        }
    }
    resize();
    window.addEventListener('resize', resize);

    // 按「队列」生成鱼：分成若干条链，链内按 prevIndex 首尾相接
    function spawn(count) {
        const chainCount = Math.max(1, Math.min(config.CHAIN_COUNT, Math.floor(count / 6)));
        const perChain = Math.ceil(count / chainCount);
        let idx = 0;
        for (let c = 0; c < chainCount && idx < count; c++) {
            let prevIdx = -1;
            for (let p = 0; p < perChain && idx < count; p++) {
                const f = new Fish(view, c, p);
                f.prevIndex = prevIdx;
                fish.push(f);
                prevIdx = idx;
                idx++;
            }
        }
    }

    function onPointerMove(e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
    }
    function onMouseLeave() {
        mouse.active = false;
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mouseleave', onMouseLeave);

    // 链式跟随：队头追鼠标 + 队头间保持距离；其余鱼紧跟队列里前一条
    function updateFlock(dt) {
        const n = fish.length;

        for (let i = 0; i < n; i++) {
            const f = fish[i];

            if (f.pos === 0) {
                // ---- 队头 ----
                if (mouse.active) {
                    const dx = mouse.x - f.x;
                    const dy = mouse.y - f.y;
                    const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
                    if (d < config.MOUSE_RADIUS) {
                        f.vx += (dx / d) * config.MOUSE_WEIGHT * dt;
                        f.vy += (dy / d) * config.MOUSE_WEIGHT * dt;
                        if (d < config.MOUSE_CALM) { f.vx *= 0.96; f.vy *= 0.96; }
                    }
                } else {
                    // 鼠标离开时队头漫游，带动整条链（力度适中，避免太木或乱摆）
                    f.wander += (Math.random() - 0.5) * 0.24;
                    f.vx += Math.cos(f.wander) * 0.05 * dt;
                    f.vy += Math.sin(f.wander) * 0.05 * dt;
                }
                // 队头之间互相推开，避免几条队列叠在一起
                for (let j = 0; j < n; j++) {
                    const o = fish[j];
                    if (o === f || o.pos !== 0) continue;
                    const dx = f.x - o.x;
                    const dy = f.y - o.y;
                    const d = Math.hypot(dx, dy) || 0.001;
                    if (d < config.CHAIN_HEAD_GAP) {
                        f.vx += (dx / d) * 0.06 * dt;
                        f.vy += (dy / d) * 0.06 * dt;
                    }
                }
            } else {
                // ---- 跟随鱼：紧跟队列里前一条，保持间距 ----
                const prev = fish[f.prevIndex];
                if (prev) {
                    const dx = prev.x - f.x;
                    const dy = prev.y - f.y;
                    const d = Math.hypot(dx, dy) || 0.001;
                    const diff = d - config.CHAIN_GAP;
                    f.vx += (dx / d) * diff * config.CHAIN_FOLLOW * dt;
                    f.vy += (dy / d) * diff * config.CHAIN_FOLLOW * dt;
                    f.vx += (prev.vx - f.vx) * config.CHAIN_ALIGN * dt;
                    f.vy += (prev.vy - f.vy) * config.CHAIN_ALIGN * dt;
                }
            }

            // 软边界
            const { MARGIN, EDGE_TURN } = config;
            if (f.x < MARGIN) f.vx += EDGE_TURN * dt;
            if (f.x > view.w - MARGIN) f.vx -= EDGE_TURN * dt;
            if (f.y < MARGIN) f.vy += EDGE_TURN * dt;
            if (f.y > view.h - MARGIN) f.vy -= EDGE_TURN * dt;

            // 轻微全局阻尼：抑制来回振荡，让游动顺滑（同时保留加速力驱动，不会停）
            f.vx *= 0.99;
            f.vy *= 0.99;

            // 限速
            const sp = Math.hypot(f.vx, f.vy);
            if (sp > config.MAX_SPEED) { f.vx = (f.vx / sp) * config.MAX_SPEED; f.vy = (f.vy / sp) * config.MAX_SPEED; }
            else if (sp < config.MIN_SPEED && sp > 0.001) { f.vx = (f.vx / sp) * config.MIN_SPEED; f.vy = (f.vy / sp) * config.MIN_SPEED; }

            // 更新位置
            f.x += f.vx * dt;
            f.y += f.vy * dt;
            f.phase += f.phaseSpeed * 0.02 * dt;

            // 平滑转向：朝向逐步逼近速度方向，避免鱼头瞬间抽搐
            const target = Math.atan2(f.vy, f.vx);
            let diff = target - f.heading;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            f.heading += diff * config.TURN_RATE * dt;
        }
    }

    // 绘制一条鱼：胖锦鲤造型（圆润鱼身 + 分叉大尾 + 鱼鳍 + 眼睛），透明度沿队列动态渐变
    function drawFish(f) {
        const len = f.size;
        const angle = f.heading; // 用平滑后的朝向，避免鱼头抽搐
        const p = paletteList[f.chain % paletteList.length]; // 按队列取颜色（不同鱼群不同色）

        // 动态透明度：沿队列递减（队头实、队尾虚）+ 呼吸脉动
        const chainFade = Math.max(0.18, 1 - f.pos * config.CHAIN_ALPHA_DECAY);
        const breathe = (1 - config.BREATH_DEPTH) + config.BREATH_DEPTH * (0.5 + 0.5 * Math.sin(time * config.BREATH_SPEED + f.breath));
        const alpha = f.alpha * chainFade * breathe;

        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(angle);

        // 0) 微微发光：很淡的一圈光晕（用鱼自身的亮色，紧贴鱼身）
        const halo = ctx.createRadialGradient(0, 0, len * 0.2, 0, 0, len * 0.78);
        halo.addColorStop(0, `rgba(${p.glow},${0.2 * alpha})`);
        halo.addColorStop(1, `rgba(${p.glow},0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, len * 0.78, 0, Math.PI * 2);
        ctx.fill();

        // 1) 尾鳍（分叉大尾巴，随相位轻柔摆动）
        const wiggle = Math.sin(f.phase) * len * 0.03;
        ctx.fillStyle = `rgba(${p.fin},${0.85 * alpha})`;
        ctx.beginPath();
        ctx.moveTo(-len * 0.38, -len * 0.03);
        ctx.quadraticCurveTo(-len * 0.55, -len * 0.3, -len * 0.72, -len * 0.34 + wiggle);
        ctx.quadraticCurveTo(-len * 0.5, 0, -len * 0.72, len * 0.34 + wiggle);
        ctx.quadraticCurveTo(-len * 0.55, len * 0.3, -len * 0.38, len * 0.03);
        ctx.closePath();
        ctx.fill();

        // 2) 鱼身（胖锦鲤，圆润饱满，半透明渐变 + 描边）
        const body = ctx.createRadialGradient(len * 0.12, -len * 0.1, len * 0.05, 0, 0, len * 0.62);
        body.addColorStop(0, `rgba(${p.glow},${0.95 * alpha})`);
        body.addColorStop(0.55, `rgba(${p.body},${0.9 * alpha})`);
        body.addColorStop(1, `rgba(${p.fin},${0.6 * alpha})`);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(len * 0.45, 0); // 嘴尖
        ctx.bezierCurveTo(len * 0.3, -len * 0.22, len * 0.0, -len * 0.38, -len * 0.25, -len * 0.2);
        ctx.quadraticCurveTo(-len * 0.38, -len * 0.1, -len * 0.4, -len * 0.04);
        ctx.quadraticCurveTo(-len * 0.38, len * 0.04, -len * 0.4, len * 0.04);
        ctx.quadraticCurveTo(-len * 0.38, len * 0.1, -len * 0.25, len * 0.2);
        ctx.bezierCurveTo(len * 0.0, len * 0.38, len * 0.3, len * 0.22, len * 0.45, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgba(${p.fin},${0.5 * alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // 3) 背鳍
        ctx.fillStyle = `rgba(${p.fin},${0.75 * alpha})`;
        ctx.beginPath();
        ctx.moveTo(-len * 0.05, -len * 0.28);
        ctx.quadraticCurveTo(len * 0.1, -len * 0.42, len * 0.22, -len * 0.16);
        ctx.closePath();
        ctx.fill();

        // 4) 胸鳍（静止，不摆动，避免处处抽搐）
        ctx.fillStyle = `rgba(${p.fin},${0.7 * alpha})`;
        ctx.beginPath();
        ctx.moveTo(len * 0.05, len * 0.12);
        ctx.quadraticCurveTo(len * 0.18, len * 0.28, -len * 0.08, len * 0.22);
        ctx.closePath();
        ctx.fill();

        // 5) 眼睛
        ctx.fillStyle = `rgba(30, 40, 50, ${0.95 * alpha})`;
        ctx.beginPath();
        ctx.arc(len * 0.22, -len * 0.06, len * 0.05, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    let last = performance.now();
    function frame(now) {
        rafId = null;
        if (paused || destroyed) return;
        const dt = Math.min((now - last) / 16.67, 3);
        last = now;
        time += dt * 0.01667; // 累计真实秒数

        // 每帧干净清空，避免半透明残影累积污染背景；
        // 「发光尾坠 / 透明渐变」由每条鱼自带的光带与渐变承担，随鱼移动、不残留
        ctx.clearRect(0, 0, view.w, view.h);

        if (!sweeping) {
            updateFlock(dt);
            for (const f of fish) drawFish(f);
        }

        rafId = requestAnimationFrame(frame);
    }

    function start() {
        if (rafId !== null || paused || destroyed) return;
        last = performance.now();
        rafId = requestAnimationFrame(frame);
    }
    function stop() {
        if (rafId === null) return;
        cancelAnimationFrame(rafId);
        rafId = null;
    }

    function clearAll() {
        fish = [];
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, view.w, view.h);
    }

    function setPaused(next) {
        next = Boolean(next);
        if (next === paused) return;
        paused = next;
        if (paused) {
            stop();
            clearAll();
        } else {
            resize();
            spawn(idealCount());
            start();
        }
    }

    function setSweep(on) {
        on = Boolean(on);
        if (on === sweeping) return;
        sweeping = on;
        if (on) {
            clearAll();
        } else if (!paused) {
            spawn(idealCount());
        }
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        stop();
        window.removeEventListener('resize', resize);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('mouseleave', onMouseLeave);
        fish = [];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // 初始铺满一屏鱼
    spawn(idealCount());
    start();

    return { setTheme, setPaused, setSweep, destroy };
}
