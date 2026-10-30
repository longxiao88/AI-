// ===================== 【可调配置参数区，新项目直接改这里】 =====================
const CONFIG = {
    MAX_DPR: 2,             // 高分屏渲染倍率上限
    DENSITY: 52000,         // 每条鱼占用的屏幕面积（px²），决定鱼的数量
    COUNT_MIN: 20,          // 鱼数量下限
    COUNT_MAX: 42,          // 鱼数量上限

    SIZE_MIN: 18,           // 最小鱼长（px）
    SIZE_MAX: 36,           // 最大鱼长（px）

    MAX_SPEED: 2.4,         // 最大游速
    MIN_SPEED: 0.35,        // 最小游速（避免鱼停住）
    TURN_RATE: 0.1,         // 鱼头转向平滑系数（越小转向越慢、游动越丝滑）

    // 鱼群结构：同色的鱼是一个独立鱼群，各有自己的头鱼
    CHAIN_COUNT: 5,         // 队列数量
    CHAIN_GAP: 52,          // 相邻鱼的期望间距（px）
    CHAIN_FOLLOW: 0.09,     // 跟随弹簧刚度（适中，既跟得紧又不振荡）
    CHAIN_ALIGN: 0.08,      // 速度对齐强度（阻尼）

    // ---- 牵引行为（动态头鱼 + 跟随树）----
    LEADER_PULL: 0.06,      // 头鱼朝鼠标的引力
    LEADER_HYST: 1.3,       // 换头鱼滞回：新候选要比现头鱼近 30% 才换，避免来回跳
    IDLE_DELAY: 1200,       // 鼠标静止多久算停下（毫秒）
    CATCH_RADIUS: 210,      // 鱼群平均离鼠标多近算「追上了」
    SEPARATE: 30,           // 鱼与鱼之间的最小距离
    LINK_EVERY: 5,          // 每几帧重算一次前驱关系
    LINK_MAX: 95,           // 前驱最远距离：超过就直接跟头鱼，避免拉成一条长龙
    CATCH_NEAR: 150,        // 判定「追上」：这个半径内的鱼要占多数

    // 动态透明度
    CHAIN_ALPHA_DECAY: 0.035, // 离目标越远透明度越低（头鱼最实、外围渐虚）
    BREATH_SPEED: 4,        // 透明度呼吸角速度
    BREATH_DEPTH: 0.2,      // 透明度呼吸幅度（0~1，越大脉动越明显）

    // 出屏与重入：不拦鱼群，任其游出；跑掉一半就从屏幕边缘重新游进来
    OUTSIDE_PAD: 140,       // 超出屏幕多少像素才算「游出去」
    RESCUE_WHEN_INSIDE: 0.55, // 屏幕内的鱼少于这个比例时，才把外面的鱼送回来

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
    constructor(view, chain) {
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
        this.breath = Math.random() * Math.PI * 2; // 透明度呼吸相位
        this.wander = Math.random() * Math.PI * 2; // 头鱼漫游方向
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

    // 全局状态：鼠标最后一次真正移动的时间、帧计数、当前被牵引的是哪一群
    const flock = { lastMoveAt: 0, frame: 0, activeChain: -1 };

    // 每个颜色一个独立鱼群：各有自己的头鱼、自己的牵引状态
    const groups = new Map();

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
        for (const f of fish) {
            if (f.x < 0 || f.x > view.w || f.y < 0 || f.y > view.h) {
                f.x = Math.random() * view.w;
                f.y = Math.random() * view.h;
            }
        }
    }
    resize();
    window.addEventListener('resize', resize);

    /** 生成鱼并按颜色分群：同色的鱼是一个鱼群，群内有自己的队形 */
    function spawn(count) {
        for (let i = 0; i < count; i++) {
            const f = new Fish(view, i % config.CHAIN_COUNT);
            f.prev = null;
            f.depth = 0;
            fish.push(f);
        }
        rebuildGroups();
    }

    function rebuildGroups() {
        groups.clear();
        for (const f of fish) {
            if (!groups.has(f.chain)) {
                groups.set(f.chain, { chain: f.chain, members: [], leader: null, pull: false });
            }
            groups.get(f.chain).members.push(f);
        }
        for (const g of groups.values()) {
            g.leader = g.members[0] || null;
            g.pull = false;
        }
    }

    /** 群内选头鱼：离鼠标最近的那条。带滞回，避免两条距离接近时来回跳 */
    function pickLeader(g) {
        const members = g.members;
        if (!members.length) return null;
        let best = members[0];
        let bestD = Infinity;
        for (const f of members) {
            const d = Math.hypot(mouse.x - f.x, mouse.y - f.y);
            if (d < bestD) { bestD = d; best = f; }
        }
        const cur = g.leader;
        if (cur && members.includes(cur)) {
            const curD = Math.hypot(mouse.x - cur.x, mouse.y - cur.y);
            if (curD <= bestD * config.LEADER_HYST) return cur;
        }
        return best;
    }

    /** 群内重算前驱：每条鱼跟「同群中比自己更靠近目标、且离自己最近」的同伴 */
    function relinkGroup(g) {
        const leader = g.leader;
        if (!leader) return;
        // 有牵引时朝鼠标排布，空闲时朝本群头鱼排布
        const tx = g.pull ? mouse.x : leader.x;
        const ty = g.pull ? mouse.y : leader.y;

        for (const f of g.members) {
            f._d = Math.hypot(tx - f.x, ty - f.y);
        }

        for (const f of g.members) {
            if (f === leader) {
                f.prev = null;
                f.depth = 0;
                continue;
            }
            let best = leader;
            let bestD = Infinity;
            for (const o of g.members) {
                if (o === f) continue;
                if (o._d >= f._d - 1) continue; // 只跟比自己更靠近目标的
                const d = Math.hypot(o.x - f.x, o.y - f.y);
                if (d < bestD) { bestD = d; best = o; }
            }
            if (bestD > config.LINK_MAX) best = leader; // 免得串成长龙
            f.prev = best;
            f.depth = Math.min(7, Math.floor(f._d / 95));
        }
    }

    /** 挑出「该被鼠标牵引」的那一群：头鱼离鼠标最近的群，带滞回避免频繁换群 */
    function pickActiveGroup() {
        let best = null;
        let bestD = Infinity;
        for (const g of groups.values()) {
            if (!g.leader) continue;
            const d = Math.hypot(mouse.x - g.leader.x, mouse.y - g.leader.y);
            if (d < bestD) { bestD = d; best = g; }
        }
        if (!best) return null;
        const cur = groups.get(flock.activeChain);
        if (cur && cur.leader) {
            const curD = Math.hypot(mouse.x - cur.leader.x, mouse.y - cur.leader.y);
            if (curD <= bestD * config.LEADER_HYST) return cur;
        }
        return best;
    }

    function onPointerMove(e) {
        const moved = Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y);
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
        if (moved > 1.5) {
            flock.lastMoveAt = performance.now();
            // 鼠标动了：重新挑一群来牵引，其余群继续自己游
            const g = pickActiveGroup();
            if (g) {
                for (const other of groups.values()) other.pull = false;
                g.pull = true;
                flock.activeChain = g.chain;
            }
        }
    }
    function onMouseLeave() {
        mouse.active = false;
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mouseleave', onMouseLeave);

    function isOutside(f, pad) {
        return f.x < -pad || f.x > view.w + pad || f.y < -pad || f.y > view.h + pad;
    }

    /**
     * 把游出屏幕的鱼从边缘送回来。
     * 只动「已经看不见的鱼」——屏幕内正在游的一条都不碰，否则会出现整片鱼瞬间消失。
     */
    function rescueOutside() {
        const pad = config.OUTSIDE_PAD;
        const out = fish.filter((f) => isOutside(f, pad));
        if (!out.length) return;

        const inside = fish.length - out.length;
        // 屏幕里还够热闹就先不管，让鱼自然地游出去一阵
        if (inside >= fish.length * config.RESCUE_WHEN_INSIDE) return;

        const side = Math.floor(Math.random() * 4);
        for (const f of out) {
            const depth = 60 + Math.random() * 160;
            if (side === 0) {
                f.x = -depth; f.y = Math.random() * view.h; f.vx = 1; f.vy = 0;
            } else if (side === 1) {
                f.x = view.w + depth; f.y = Math.random() * view.h; f.vx = -1; f.vy = 0;
            } else if (side === 2) {
                f.x = Math.random() * view.w; f.y = -depth; f.vx = 0; f.vy = 1;
            } else {
                f.x = Math.random() * view.w; f.y = view.h + depth; f.vx = 0; f.vy = -1;
            }
            const sp = 0.7 + Math.random() * 0.9;
            f.vx = f.vx * sp + (Math.random() - 0.5) * 0.5;
            f.vy = f.vy * sp + (Math.random() - 0.5) * 0.5;
            f.heading = Math.atan2(f.vy, f.vx);
            f.prev = null;
            f.depth = 0;
        }

        // 各群头鱼换回「还在屏幕里、离画面中心最近」的那条，免得整群继续朝画框外游
        for (const g of groups.values()) {
            const alive = g.members.filter((f) => !isOutside(f, pad));
            if (!alive.length) {
                g.leader = g.members[0];
            } else {
                let best = alive[0];
                let bestD = Infinity;
                for (const f of alive) {
                    const d = Math.hypot(f.x - view.w / 2, f.y - view.h / 2);
                    if (d < bestD) { bestD = d; best = f; }
                }
                g.leader = best;
            }
            g.pull = false;
        }
        flock.activeChain = -1;
    }

    // 每帧：各群各自判定状态 → 选头鱼 → 更新每条鱼
    function updateFlock(dt) {
        const n = fish.length;
        if (!n) return;
        flock.frame++;

        // ---- 0. 鱼群游出画面：不拦；只剩不到一半在屏幕里时，把外面的鱼从边缘送回来 ----
        rescueOutside();

        const idleMs = performance.now() - flock.lastMoveAt;

        // ---- 1. 各群判断是否已经追上鼠标，追上了就散开 ----
        for (const g of groups.values()) {
            if (!g.pull) continue;
            if (idleMs < config.IDLE_DELAY) continue;
            let near = 0;
            for (const f of g.members) {
                if (Math.hypot(mouse.x - f.x, mouse.y - f.y) < config.CATCH_NEAR) near++;
            }
            if (near >= g.members.length * 0.6) {
                g.pull = false;
                if (flock.activeChain === g.chain) flock.activeChain = -1;
            }
        }

        // ---- 2. 牵引中的群重新选头鱼；空闲群头鱼保持不变 ----
        for (const g of groups.values()) {
            if (g.pull) g.leader = pickLeader(g);
            else if (!g.leader || !g.members.includes(g.leader)) g.leader = g.members[0];
        }

        // ---- 3. 定期重算群内前驱 ----
        if (flock.frame % config.LINK_EVERY === 0) {
            for (const g of groups.values()) relinkGroup(g);
        }

        const damp = Math.pow(0.99, dt);

        for (let i = 0; i < n; i++) {
            const f = fish[i];
            const g = groups.get(f.chain);
            const leader = g ? g.leader : null;

            if (leader && f === leader) {
                // ---- 头鱼：被牵引时追鼠标，否则带自己那群游荡 ----
                if (g.pull) {
                    const dx = mouse.x - f.x;
                    const dy = mouse.y - f.y;
                    const d = Math.hypot(dx, dy) || 0.001;
                    f.vx += (dx / d) * config.LEADER_PULL * dt;
                    f.vy += (dy / d) * config.LEADER_PULL * dt;
                } else {
                    f.wander += (Math.random() - 0.5) * 0.12 * dt;
                    f.vx += Math.cos(f.wander) * 0.03 * dt;
                    f.vy += Math.sin(f.wander) * 0.03 * dt;
                }
            } else if (f.prev) {
                // ---- 普通鱼：跟本群的前驱，保持间距并对齐速度 ----
                const p = f.prev;
                const dx = p.x - f.x;
                const dy = p.y - f.y;
                const d = Math.hypot(dx, dy) || 0.001;
                const diff = d - config.CHAIN_GAP;
                f.vx += (dx / d) * diff * config.CHAIN_FOLLOW * dt;
                f.vy += (dy / d) * diff * config.CHAIN_FOLLOW * dt;
                f.vx += (p.vx - f.vx) * config.CHAIN_ALIGN * dt;
                f.vy += (p.vy - f.vy) * config.CHAIN_ALIGN * dt;
            }

            // ---- 彼此分离：跨群也生效，避免不同颜色的鱼叠在一起 ----
            for (let j = 0; j < n; j++) {
                if (j === i) continue;
                const o = fish[j];
                const ox = f.x - o.x;
                const oy = f.y - o.y;
                const d2 = ox * ox + oy * oy;
                const R = config.SEPARATE;
                if (d2 < R * R && d2 > 0.01) {
                    const d = Math.sqrt(d2);
                    const push = (1 - d / R) * 0.6;
                    f.vx += (ox / d) * push * dt;
                    f.vy += (oy / d) * push * dt;
                }
            }

            f.vx *= damp;
            f.vy *= damp;

            const sp = Math.hypot(f.vx, f.vy);
            if (sp > config.MAX_SPEED) {
                f.vx = (f.vx / sp) * config.MAX_SPEED;
                f.vy = (f.vy / sp) * config.MAX_SPEED;
            } else if (sp < config.MIN_SPEED && sp > 0.001) {
                f.vx = (f.vx / sp) * config.MIN_SPEED;
                f.vy = (f.vy / sp) * config.MIN_SPEED;
            }

            f.x += f.vx * dt;
            f.y += f.vy * dt;
            f.phase += f.phaseSpeed * 0.02 * dt;

            const target = Math.atan2(f.vy, f.vx);
            let diffA = target - f.heading;
            while (diffA > Math.PI) diffA -= Math.PI * 2;
            while (diffA < -Math.PI) diffA += Math.PI * 2;
            f.heading += diffA * config.TURN_RATE * dt;
        }
    }

    // 绘制一条鱼：胖锦鲤造型（圆润鱼身 + 分叉大尾 + 鱼鳍 + 眼睛），透明度沿队列动态渐变
    function drawFish(f) {
        const len = f.size;
        const angle = f.heading; // 用平滑后的朝向，避免鱼头抽搐
        const p = paletteList[f.chain % paletteList.length]; // 按队列取颜色（不同鱼群不同色）

        // 动态透明度：按离目标远近递减（头鱼实、外围虚）+ 呼吸脉动
        const chainFade = Math.max(0.18, 1 - (f.depth || 0) * config.CHAIN_ALPHA_DECAY);
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
