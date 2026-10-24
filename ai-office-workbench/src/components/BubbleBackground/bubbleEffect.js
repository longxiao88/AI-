// ===================== 【可调配置参数区，新项目直接改这里】 =====================
const CONFIG = {
    MAX_BUBBLE: 40,          // 最大同时气泡数量
    SPAWN_PROBABILITY: 0.85, // 生成概率：Math.random()>该数值
    EXPLODE_MIN: 8,          // 爆炸最少碎片
    EXPLODE_ADD: 5,          // 爆炸额外随机碎片
    PARTICLE_SPEED: 6,       // 碎片飞散速度
    PARTICLE_FADE: 0.025,    // 碎片消失速度
    MAX_DPR: 2,              // 高分屏渲染倍率上限（越大越清晰、越吃性能）
    // 深浅色主题配色：bubble 为不含透明度的前缀，绘制时再拼上每个气泡自身的 opacity
    PALETTE: {
        dark: { bubble: "rgba(160,210,245,", particle: "rgba(173,216,240,0.4)" },
        light: { bubble: "rgba(120,176,214,", particle: "rgba(120,176,214,0.35)" },
    },
}
// ==============================================================================

/**
 * 气泡类：负责单个气泡数据、运动、绘制、点击检测
 */
class Bubble {
    constructor(config, palette, view) {
        this.view = view;
        this.palette = palette;
        this.radius = Math.random() * 12 + 3;
        this.initRadius = this.radius;
        this.maxScale = Math.random() * 1.3 + 1.5;
        this.x = Math.random() * view.w;
        this.y = view.h + this.radius;
        this.speedY = Math.random() * 0.5 + 0.25;
        this.opacity = Math.random() * 0.3 + 0.15;
    }

    update() {
        this.y -= this.speedY;
        const progress = 1 - (this.y / this.view.h);
        this.radius = this.initRadius * (1 + progress * (this.maxScale - 1));
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        // 颜色取自 palette 引用，切换主题时已存在的气泡也会立即换色
        ctx.fillStyle = `${this.palette.bubble}${this.opacity})`;
        ctx.fill();
    }

    // 判断鼠标是否点击到气泡
    isHit(mouseX, mouseY) {
        const dx = this.x - mouseX;
        const dy = this.y - mouseY;
        return Math.sqrt(dx * dx + dy * dy) < this.radius;
    }
}

/**
 * 爆炸碎片粒子类
 */
class Particle {
    constructor(x, y, radius, color, config) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.vx = (Math.random() - 0.5) * config.PARTICLE_SPEED;
        this.vy = (Math.random() - 0.5) * config.PARTICLE_SPEED;
        this.alpha = 1;
        this.fadeStep = config.PARTICLE_FADE;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.alpha -= this.fadeStep;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.restore();
    }
}


/**
 * 初始化气泡背景特效
 * @param {HTMLCanvasElement} canvas DOM对象
 * @param {{ theme?: string, paused?: boolean, interactive?: boolean }} [options]
 * @returns {{ setTheme: (theme?: string) => void, setPaused: (paused: boolean) => void, destroy: () => void }}
 */
export function initBubbleEffect(canvas, options = {}) {
    const ctx = canvas.getContext('2d');
    const config = CONFIG;
    const view = { w: 0, h: 0 }; // 逻辑尺寸（CSS 像素），绘制坐标统一使用这一套

    let bubbleList = [];
    let particleList = [];
    let rafId = null; // 保存动画ID，用于停止requestAnimationFrame
    let paused = Boolean(options.paused);
    let destroyed = false;

    // palette 保持同一个对象引用，只改内部值，这样已存在的气泡无需重建即可换色
    const palette = { bubble: "", particle: "" };
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


    // 点击爆破事件：绑定在 window 捕获阶段，
    // 这样画布可以设置 pointer-events:none 不阻挡页面 UI，点击气泡仍然会爆破
    function handleClick(e) {
        if (options.interactive === false) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        // 修复CSS拉伸画布的坐标偏移（换算到逻辑坐标系）
        const clickX = ((e.clientX - rect.left) / rect.width) * view.w;
        const clickY = ((e.clientY - rect.top) / rect.height) * view.h;

        for (let i = bubbleList.length - 1; i >= 0; i--) {
            const b = bubbleList[i];
            if (b.isHit(clickX, clickY)) {
                const explodeCount = Math.floor(Math.random() * config.EXPLODE_ADD) + config.EXPLODE_MIN;
                for (let j = 0; j < explodeCount; j++) {
                    particleList.push(new Particle(b.x, b.y, b.radius * 0.25, palette.particle, config));
                }
                bubbleList.splice(i, 1);
                break;
            }
        }
    }
    window.addEventListener('click', handleClick, true);


    // 动画主循环
    function frame() {
        rafId = null;
        if (paused || destroyed) return; // 暂停时保持当前画面，不再排下一帧
        ctx.clearRect(0, 0, view.w, view.h);

        // 随机生成气泡
        if (Math.random() > config.SPAWN_PROBABILITY && bubbleList.length < config.MAX_BUBBLE) {
            bubbleList.push(new Bubble(config, palette, view));
        }

        // 更新绘制气泡
        for (let i = bubbleList.length - 1; i >= 0; i--) {
            const b = bubbleList[i];
            b.update();
            b.draw(ctx);
            if (b.y < -b.radius) {
                bubbleList.splice(i, 1);
            }
        }

        // 更新绘制爆炸碎片
        for (let i = particleList.length - 1; i >= 0; i--) {
            const p = particleList[i];
            p.update();
            p.draw(ctx);
            if (p.alpha <= 0) {
                particleList.splice(i, 1);
            }
        }

        rafId = requestAnimationFrame(frame);
    }
    function start() {
        if (rafId !== null || paused || destroyed) return;
        rafId = requestAnimationFrame(frame);
    }
    function stop() {
        if (rafId === null) return;
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    start();


    // 动效开关：暂停时冻结画面并停掉 rAF，恢复时继续
    function setPaused(next) {
        next = Boolean(next);
        if (next === paused) return;
        paused = next;
        if (paused) stop();
        else {
            resize(); // 暂停期间窗口可能变过大小
            start();
        }
    }


    // ========= 销毁函数，页面/组件离开必须调用，防止内存泄漏 =========
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        stop();
        window.removeEventListener('resize', resize);
        window.removeEventListener('click', handleClick, true);
        bubbleList = [];
        particleList = [];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    return { setTheme, setPaused, destroy };
}
