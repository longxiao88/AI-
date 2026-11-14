// ===================== 【可调配置参数区，新项目直接改这里】 =====================
const CONFIG = {
    MAX_BUBBLE: 80,          // 最大同时气泡数量（bubble-new 款式分层：大/中/小）
    SPAWN_PROBABILITY: 0.15, // 每次帧循环生成概率：Math.random() < 该数值才生成
    MAX_DPR: 2,              // 高分屏渲染倍率上限（越大越清晰、越吃性能）
    // 气泡尺寸分层：大泡 / 中泡 / 小泡，仿 bubble-new.html 的 [16,40] / [6,16] / [1.5,5]
    SIZES: [
        { rMin: 16, rMax: 40, count: 8 },
        { rMin: 6,  rMax: 16, count: 18 },
        { rMin: 1.5, rMax: 5, count: 50 },
    ],
    // 点击爆破相关
    HIT_SCALE: 2,            // 命中判定：点击点与圆心距离 < 半径 * HIT_SCALE + HIT_MARGIN 即命中
    HIT_MARGIN: 12,          // 命中容差（像素），让"点到泡泡附近"也能破
    MIN_SPLIT_R: 2.6,        // 小于该半径的泡泡爆破后不再分裂，只冒水雾（避免无限爆炸）
    MAX_TOTAL: 260,          // 气泡总数上限，防止连点导致数量爆炸、拖慢渲染
    // 水雾特效参数（觉得雾太多/太浓就调这里）
    MIST: {
        COUNT_MIN: 6,        // 每次爆破水雾粒子数下限
        COUNT_MAX: 10,       // 每次爆破水雾粒子数上限
        ALPHA: 0.26,         // 水雾基础透明度
        ALPHA_SPREAD: 0.2,   // 透明度随机浮动范围
        GROWTH_MIN: 0.4,     // 扩散速度下限
        GROWTH_MAX: 1.5,     // 扩散速度上限
    },
    // 深浅色主题配色：径向渐变的 5 档停靠色（不含透明度，绘制时按气泡 alpha 叠加）
    // 高光点与描边统一用白色 / 亮边，随主题微调
    PALETTE: {
        dark: {
            hi:     "210, 230, 246",   // 高光内芯
            steel:  "128, 168, 186",   // 主色
            steelL: "160, 198, 214",   // 亮边
        },
        light: {
            hi:     "150, 200, 235",
            steel:  "90, 140, 170",
            steelL: "130, 180, 210",
        },
    },
}
// ==============================================================================

/**
 * 气泡类：径向渐变 + 描边 + 双高光的深海气泡，自下而上漂浮。
 * 沿用了 bubble-new.html 的绘制思路，但收敛进统一接口以便主题/动效联动。
 */
class Bubble {
    constructor(config, palette, view) {
        this.view = view;
        this.palette = palette;
        this.r = Math.random() * 10 + 3;   // 初始半径，仅作占位，会在 spawn 时被覆盖
        this.x = Math.random() * view.w;
        this.y = view.h + 20 + Math.random() * 40;
        this.speed = 0.25 + Math.random() * 0.7;
        this.phase = Math.random() * Math.PI * 2;
        this.phaseSpeed = 0.2 + Math.random() * 0.4;
        this.alpha = 0.4 + Math.random() * 0.4;
        this.vx = 0; // 水平速度（爆破分裂出的子泡泡使用，随时间衰减）
    }

    // 生成时按尺寸层设置实际半径
    setSize(rMin, rMax) {
        this.r = rMin + Math.random() * (rMax - rMin);
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y -= this.speed * dt;
        this.x += Math.sin(this.phase) * 0.4 * dt;
        this.phase += this.phaseSpeed * 0.02 * dt;
        if (this.vx) this.vx *= 0.97; // 水平散开速度逐渐衰减
    }

    // 判断是否已飘出屏幕，需要回收（含水平方向越界）
    isOff() {
        return this.y < -this.r * 2
            || this.x < -this.r * 4
            || this.x > this.view.w + this.r * 4;
    }

    draw(ctx) {
        const r = this.r, x = this.x, y = this.y;
        const p = this.palette;

        // 主体：径向渐变，高光在左上
        const g = ctx.createRadialGradient(
            x - r * 0.35, y - r * 0.42, r * 0.08,
            x, y, r,
        );
        g.addColorStop(0,    `rgba(${p.hi},${0.3 * this.alpha})`);
        g.addColorStop(0.25, `rgba(${p.steelL},${0.12 * this.alpha})`);
        g.addColorStop(0.62, `rgba(${p.steel},${0.05 * this.alpha})`);
        g.addColorStop(0.88, `rgba(${p.steelL},${0.16 * this.alpha})`);
        g.addColorStop(1,    `rgba(${p.steelL},${0.22 * this.alpha})`);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // 描边
        ctx.strokeStyle = `rgba(${p.steelL},${0.4 * this.alpha})`;
        ctx.lineWidth = Math.max(0.7, r * 0.05);
        ctx.stroke();

        // 双高光点
        ctx.beginPath();
        ctx.arc(x - r * 0.34, y - r * 0.4, r * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, this.alpha * 1.3)})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x - r * 0.14, y - r * 0.52, r * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, this.alpha * 0.9)})`;
        ctx.fill();
    }
}

/**
 * 水雾粒子：泡泡爆破时弥散出的一团柔和雾气。
 * 缓慢扩散、略微上升、逐渐变淡消失，营造"爆破 + 水雾"的观感。
 */
class Mist {
    constructor(x, y, r, palette, core = false) {
        this.palette = palette;
        if (core) {
            // 核心闪光：一颗快速膨胀、快速消隐的亮斑
            this.x = x; this.y = y;
            this.r = r * 0.55;
            this.vx = 0; this.vy = 0;
            this.growth = r * 0.06;
            this.alpha = 0.9;
            this.decay = 0.05;
        } else {
            const ang = Math.random() * Math.PI * 2;
            const spd = 0.4 + Math.random() * 1.8;
            this.x = x; this.y = y;
            this.r = r * (0.12 + Math.random() * 0.34);
            this.vx = Math.cos(ang) * spd;
            this.vy = Math.sin(ang) * spd - 0.5;
            const cfg = CONFIG.MIST;
            this.growth = cfg.GROWTH_MIN + Math.random() * (cfg.GROWTH_MAX - cfg.GROWTH_MIN);
            this.alpha = cfg.ALPHA + Math.random() * cfg.ALPHA_SPREAD;
            this.decay = 0.012 + Math.random() * 0.022;
        }
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.r += this.growth * dt;
        this.alpha -= this.decay * dt;
    }

    isDead() {
        return this.alpha <= 0;
    }

    draw(ctx) {
        const p = this.palette;
        const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r);
        g.addColorStop(0,    `rgba(${p.hi},${this.alpha})`);
        g.addColorStop(0.45, `rgba(${p.steelL},${this.alpha * 0.55})`);
        g.addColorStop(1,    `rgba(${p.steelL},0)`);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
    }
}


/**
 * 初始化气泡背景特效（bubble-new 深海气泡款式）。
 * 支持点击气泡爆破：爆破时分裂出更多小气泡并弥散出水雾。
 * @param {HTMLCanvasElement} canvas DOM对象
 * @param {{ theme?: string, paused?: boolean }} [options]
 * @returns {{ setTheme: (theme?: string) => void, setPaused: (paused: boolean) => void, setSweep: (sweeping: boolean) => void, destroy: () => void }}
 */
export function initBubbleEffect(canvas, options = {}) {
    const ctx = canvas.getContext('2d');
    const config = CONFIG;
    const view = { w: 0, h: 0 }; // 逻辑尺寸（CSS 像素），绘制坐标统一使用这一套

    let bubbleList = [];
    let mists = []; // 水雾粒子
    let rafId = null; // 保存动画ID，用于停止requestAnimationFrame
    let paused = Boolean(options.paused);
    let destroyed = false;
    // 主题揭幕期间为 true：此时清空画面并停止生成气泡，
    // 让"新主题"快照拍到一张空画布（见 setSweep 的说明）
    let sweeping = false;

    // palette 保持同一个对象引用，只改内部值，这样已存在的气泡无需重建即可换色
    const palette = { hi: "", steel: "", steelL: "" };
    function setTheme(theme) {
        Object.assign(palette, config.PALETTE[theme === 'light' ? 'light' : 'dark']);
    }
    setTheme(options.theme);

    // 画布大小自适应：按设备像素比放大位图，再用 setTransform 把坐标折算回 CSS 像素
    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, config.MAX_DPR);
        view.w = canvas.clientWidth || window.innerWidth;
        view.h = canvas.clientHeight || window.innerHeight;
        canvas.width = Math.max(1, Math.round(view.w * dpr));
        canvas.height = Math.max(1, Math.round(view.h * dpr));
        // 赋值 width/height 会重置变换矩阵，必须在这之后重新设置
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    // 首屏预填充：按尺寸分层一次性生成一批，避免一开始画面空荡荡
    function spawnBatch() {
        for (const layer of config.SIZES) {
            for (let i = 0; i < layer.count; i++) {
                const b = new Bubble(config, palette, view);
                b.setSize(layer.rMin, layer.rMax);
                // 随机分布在整个屏幕高度，而非全挤在底部
                b.y = Math.random() * view.h;
                bubbleList.push(b);
            }
        }
    }
    spawnBatch();

    // 回收后复用：气泡飘出屏幕后，重新放回底部并换尺寸层
    function respawn(b) {
        b.y = view.h + 20 + Math.random() * 40;
        b.x = Math.random() * view.w;
        b.vx = 0;
        const layer = config.SIZES[Math.floor(Math.random() * config.SIZES.length)];
        b.setSize(layer.rMin, layer.rMax);
    }

    // ========= 点击爆破：分裂子泡泡 + 水雾 =========
    // 爆破后分裂出的子泡泡：从爆破点向四周飞散，随后自然上浮
    function spawnBurst(x, y, parentR) {
        if (bubbleList.length >= config.MAX_TOTAL) return; // 防数量爆炸
        let count;
        if (parentR > 12)      count = 5 + Math.floor(Math.random() * 4); // 5-8
        else if (parentR > 5)  count = 3 + Math.floor(Math.random() * 3); // 3-5
        else                   count = 2;                                  // 2
        for (let i = 0; i < count; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = 0.8 + Math.random() * 2.2;
            const nr  = Math.max(1.4, parentR * (0.22 + Math.random() * 0.33));
            const b = new Bubble(config, palette, view);
            b.setSize(nr, nr); // 固定半径
            b.x = x; b.y = y;
            b.speed = 0.35 + Math.random() * 0.8;
            b.alpha = 0.5 + Math.random() * 0.5;
            b.vx = Math.cos(ang) * spd;
            bubbleList.push(b);
        }
    }

    // 水雾：柔和弥散、缓慢上升、渐渐变淡消失
    function spawnMist(x, y, r) {
        const { COUNT_MIN, COUNT_MAX } = config.MIST;
        const count = COUNT_MIN + Math.floor(Math.random() * (COUNT_MAX - COUNT_MIN + 1));
        for (let i = 0; i < count; i++) {
            mists.push(new Mist(x, y, r, palette));
        }
        // 爆破核心闪光
        mists.push(new Mist(x, y, r, palette, true));
    }

    // 命中检测：点到泡泡附近即可命中，大泡泡、越近越优先
    function popAt(px, py) {
        let hit = null, bestScore = -Infinity;
        for (const b of bubbleList) {
            const d = Math.hypot(px - b.x, py - b.y);
            const limit = b.r * config.HIT_SCALE + config.HIT_MARGIN;
            if (d <= limit) {
                const score = b.r - d; // 越大越好：大泡泡优先、越近越优先
                if (score > bestScore) { bestScore = score; hit = b; }
            }
        }
        if (!hit) return;

        const idx = bubbleList.indexOf(hit);
        if (idx >= 0) bubbleList.splice(idx, 1);

        spawnMist(hit.x, hit.y, hit.r);
        // 足够大的泡泡才继续分裂，避免无限爆炸
        if (hit.r > config.MIN_SPLIT_R) spawnBurst(hit.x, hit.y, hit.r);
    }

    // 交互元素过滤：点按钮/输入框等 UI 时不应误触爆破
    function isInteractiveTarget(el) {
        if (!el || el.nodeType !== 1 || typeof el.closest !== 'function') return false;
        return !!el.closest(
            'button, a, input, textarea, select, label, [contenteditable], ' +
            '[role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="textbox"]',
        );
    }

    // 点击处理：背景画布是 pointer-events:none，事件会落到实际目标上，
    // 这里挂在 window 上统一捕获；命中泡泡则爆破，命中 UI 则不处理
    function handlePointerDown(e) {
        if (paused || destroyed) return;
        if (isInteractiveTarget(e.target)) return;
        const rect = canvas.getBoundingClientRect();
        popAt(e.clientX - rect.left, e.clientY - rect.top);
    }
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });


    // 动画主循环
    let last = performance.now();
    function frame(now) {
        rafId = null;
        if (paused || destroyed) return; // 暂停时保持当前画面，不再排下一帧
        const dt = Math.min((now - last) / 16.67, 3);
        last = now;
        ctx.clearRect(0, 0, view.w, view.h);

        // 随机补泡（揭幕期间不生成，否则新气泡会从分界线后方冒出来）
        if (!sweeping && bubbleList.length < config.MAX_BUBBLE && Math.random() < config.SPAWN_PROBABILITY) {
            const b = new Bubble(config, palette, view);
            const layer = config.SIZES[Math.floor(Math.random() * config.SIZES.length)];
            b.setSize(layer.rMin, layer.rMax);
            bubbleList.push(b);
        }

        // 更新绘制气泡
        for (let i = bubbleList.length - 1; i >= 0; i--) {
            const b = bubbleList[i];
            b.update(dt);
            b.draw(ctx);
            if (b.isOff()) {
                respawn(b);
            }
        }

        // 更新绘制水雾（画在气泡之上，营造爆破雾气）
        for (let i = mists.length - 1; i >= 0; i--) {
            const m = mists[i];
            m.update(dt);
            if (m.isDead()) { mists.splice(i, 1); continue; }
            m.draw(ctx);
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
    start();


    /** 清空画面：气泡与水雾一起收走，并立刻擦掉 canvas 上的残留像素 */
    function clearAll() {
        bubbleList = [];
        mists = [];
        ctx.clearRect(0, 0, view.w, view.h);
    }


    // 动效开关：关闭时连屏幕上的气泡一起清掉，重新打开时从底部重新生成
    function setPaused(next) {
        next = Boolean(next);
        if (next === paused) return;
        paused = next;
        if (paused) {
            stop();
            // 只停 rAF 会在屏幕上留下一帧静止的泡泡，看起来像动画卡死了，
            // 所以关闭动效时必须把这一帧也擦掉
            clearAll();
        } else {
            resize(); // 暂停期间窗口可能变过大小
            spawnBatch(); // 重新铺满一屏
            start();
        }
    }


    /**
     * 主题揭幕（自下而上推进的那条分界线）开始 / 结束。
     * 期间顺带停止生成，否则新气泡会在分界线后方又冒出来。
     */
    function setSweep(on) {
        on = Boolean(on);
        if (on === sweeping) return;
        sweeping = on;
        if (on) clearAll();
    }


    // ========= 销毁函数，页面/组件离开必须调用，防止内存泄漏 =========
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        stop();
        window.removeEventListener('resize', resize);
        window.removeEventListener('pointerdown', handlePointerDown);
        bubbleList = [];
        mists = [];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    return { setTheme, setPaused, setSweep, destroy };
}
