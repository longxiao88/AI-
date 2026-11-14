// ===================== 【可调配置参数区，新项目直接改这里】 =====================
const CONFIG = {
    MAX_DPR: 2,             // 高分屏渲染倍率上限

    // 粒子生成：鼠标每移动一段距离就喷出一颗发光粒子，形成离散拖尾
    EMIT_DIST: 9,           // 鼠标移动超过该距离（px）才生成一颗粒子
    EMIT_PER_STEP: 2,       // 每次达到阈值时喷出的粒子数

    MAX_PARTICLES: 90,      // 粒子总数上限，防止快速晃动时堆积、拖慢渲染

    SIZE_MIN: 1.6,          // 粒子最小半径（px）
    SIZE_MAX: 4.5,          // 粒子最大半径（px）

    // 粒子运动：喷出时有初速度（向外飞散），随后上浮、淡出
    SPEED_MIN: 0.3,         // 初速度下限
    SPEED_MAX: 2.4,         // 初速度上限
    LIFT: 0.25,             // 上浮加速度（粒子缓缓向上漂，模拟水中磷光）
    DRAG: 0.94,             // 速度阻尼（越小散开越快停下）

    // 淡出：透明度衰减 + 半径轻微扩散
    DECAY: 0.028,           // 每帧透明度衰减
    GROWTH: 0.03,           // 每帧半径增长（光点晕开）

    // 光标下方恒亮光晕：极淡、暗示「这里有个光源」，不抢戏
    HALO_RADIUS: 26,        // 光晕半径
    HALO_ALPHA: 0.12,       // 光晕透明度

    // 蓝色调：深海蓝（与气泡/鱼群同源的冷色系）
    // glow=亮部内芯，body=主色，edge=边缘色
    COLORS: {
        dark: {
            glow: "168, 210, 255",
            body: "90, 170, 235",
            edge: "50, 120, 190",
            core: "255, 255, 255",   // 深底上用白色内芯，像发光
        },
        // 白天底板与卡片都是白的，白色内芯会直接消失，
        // 所以浅色主题的内芯改成深蓝，光点才在白面上读得出来。
        light: {
            glow: "120, 180, 240",
            body: "40, 120, 195",
            edge: "18, 78, 145",
            core: "30, 100, 170",
        },
    },
}
// ==============================================================================

/**
 * 发光粒子：一颗从鼠标位置喷出的小光点。
 * 有初速度向外飞散，随后上浮、半径晕开、透明度衰减至消失。
 */
class GlowParticle {
    constructor(x, y, palette) {
        this.x = x;
        this.y = y;
        this.r = CONFIG.SIZE_MIN + Math.random() * (CONFIG.SIZE_MAX - CONFIG.SIZE_MIN);

        const ang = Math.random() * Math.PI * 2;
        const spd = CONFIG.SPEED_MIN + Math.random() * (CONFIG.SPEED_MAX - CONFIG.SPEED_MIN);
        this.vx = Math.cos(ang) * spd;
        this.vy = Math.sin(ang) * spd;

        this.alpha = 0.7 + Math.random() * 0.3; // 初始透明度，带随机让拖尾有层次
        this.palette = palette;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vy -= CONFIG.LIFT * dt;   // 轻微上浮（负方向）
        this.vx *= CONFIG.DRAG;
        this.vy *= CONFIG.DRAG;
        this.r += CONFIG.GROWTH * dt;  // 光点晕开
        this.alpha -= CONFIG.DECAY * dt;
    }

    isDead() {
        return this.alpha <= 0;
    }

    draw(ctx) {
        const p = this.palette;
        // 柔和发光：内芯亮、外圈渐隐
        const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r * 2.6);
        g.addColorStop(0, `rgba(${p.glow},${Math.min(1, this.alpha)})`);
        g.addColorStop(0.35, `rgba(${p.body},${Math.min(1, this.alpha * 0.7)})`);
        g.addColorStop(1, `rgba(${p.edge},0)`);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // 实心内芯，增强「光点」质感（白底主题用深蓝内芯，否则看不见）
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.core}, ${Math.min(1, this.alpha * 0.9)})`;
        ctx.fill();
    }
}

/**
 * 初始化光标发光拖尾特效：鼠标移动时喷出蓝色发光粒子，形成离散、渐隐的拖尾，
 * 光标下方带一圈极淡的恒亮光晕。单独一个 canvas 层，只画拖尾，性能最好。
 * @param {HTMLCanvasElement} canvas DOM对象
 * @param {{ theme?: string, paused?: boolean }} [options]
 * @returns {{ setTheme: (theme?: string) => void, setPaused: (paused: boolean) => void, destroy: () => void }}
 */
export function initCursorGlow(canvas, options = {}) {
    const ctx = canvas.getContext('2d');
    const config = CONFIG;
    const view = { w: 0, h: 0 };

    let particles = [];
    let rafId = null;
    let paused = Boolean(options.paused);
    let destroyed = false;

    // 鼠标状态
    const mouse = { x: -9999, y: -9999, active: false, lastX: 0, lastY: 0 };

    const palette = { glow: "", body: "", edge: "" };
    function setTheme(theme) {
        Object.assign(palette, config.COLORS[theme === 'light' ? 'light' : 'dark']);
    }
    setTheme(options.theme);

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, config.MAX_DPR);
        view.w = canvas.clientWidth || window.innerWidth;
        view.h = canvas.clientHeight || window.innerHeight;
        canvas.width = Math.max(1, Math.round(view.w * dpr));
        canvas.height = Math.max(1, Math.round(view.h * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    function onPointerMove(e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        if (!mouse.active) {
            // 首次进入：初始化上一个位置，避免从 (0,0) 拉一条长拖尾
            mouse.lastX = e.clientX;
            mouse.lastY = e.clientY;
        }
        mouse.active = true;

        // 按移动距离喷粒子
        const dx = mouse.x - mouse.lastX;
        const dy = mouse.y - mouse.lastY;
        const dist = Math.hypot(dx, dy);
        if (dist >= config.EMIT_DIST) {
            mouse.lastX = mouse.x;
            mouse.lastY = mouse.y;
            for (let i = 0; i < config.EMIT_PER_STEP; i++) {
                // 在上一位置到当前位置之间随机取点，让拖尾更连贯
                const t = Math.random();
                const px = mouse.x - dx * t;
                const py = mouse.y - dy * t;
                spawn(px, py);
            }
        }
    }

    function onPointerLeave() {
        mouse.active = false;
    }

    function spawn(x, y) {
        if (particles.length >= config.MAX_PARTICLES) {
            particles.shift(); // 丢最老的，保持上限
        }
        particles.push(new GlowParticle(x, y, palette));
    }

    function clearAll() {
        particles = [];
        ctx.clearRect(0, 0, view.w, view.h);
    }

    let last = performance.now();
    function frame(now) {
        rafId = null;
        if (paused || destroyed) return;
        const dt = Math.min((now - last) / 16.67, 3);
        last = now;

        // 只清拖尾层
        ctx.clearRect(0, 0, view.w, view.h);

        // 光标下方恒亮光晕
        if (mouse.active) {
            const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, config.HALO_RADIUS);
            g.addColorStop(0, `rgba(${palette.glow},${config.HALO_ALPHA})`);
            g.addColorStop(1, `rgba(${palette.glow},0)`);
            ctx.beginPath();
            ctx.arc(mouse.x, mouse.y, config.HALO_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
        }

        // 更新绘制粒子
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.update(dt);
            if (p.isDead()) {
                particles.splice(i, 1);
                continue;
            }
            p.draw(ctx);
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

    function setPaused(next) {
        next = Boolean(next);
        if (next === paused) return;
        paused = next;
        if (paused) {
            stop();
            clearAll();
        } else {
            start();
        }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mouseleave', onPointerLeave);

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        stop();
        window.removeEventListener('resize', resize);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('mouseleave', onPointerLeave);
        particles = [];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    start();

    return { setTheme, setPaused, destroy };
}
