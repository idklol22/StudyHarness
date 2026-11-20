"use client";

/**
 * THE SCENE (all-themes wave): the animated backdrop of scene themes (midnight
 * dust, smoke, nimbus clouds, uzumaki swirl), ported from LetCode's
 * particles.js / clouds.js / swirl.js / uzumaki.js. ONE fixed canvas behind
 * the app, drawn at a fraction of the window resolution, and a veil
 * (`--lh-scrim`) over it so text contrast holds over the brightest pixel
 * (tests/theme-contrast.test.ts pins that number).
 *
 * Cost control: ~20-30 fps, paused while the tab is hidden, a single still
 * frame under prefers-reduced-motion, on a low-end device, in battery saver
 * or when Settings > Background animation is off.
 */
import { useEffect, useRef } from "react";
import { useAppearance } from "@/components/settings/appearance";
import { effectiveTune, hexToRgb, type ThemeScene } from "@/src/core";

type Rgb = readonly [number, number, number];
type Painter = { frame: (t: number) => void; resize: (w: number, h: number) => void };

/** Pixel-art scenes render at 1/SCALE of the window. */
const SCALE: Record<ThemeScene, number> = { none: 1, dust: 1, smoke: 4, clouds: 6, swirl: 5 };

function rng(seed: number) {
	let s = seed >>> 0;
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Midnight / smoke: dust drifting upward, a few soft motes. */
function dustPainter(g: CanvasRenderingContext2D, ink: Rgb): Painter {
	let W = 1, H = 1;
	type P = { x: number; y: number; r: number; vx: number; vy: number; a: number; tw: number; ts: number; big: boolean };
	let ps: P[] = [];
	const mk = (anyY: boolean): P => {
		const big = Math.random() < 0.08;
		return {
			x: Math.random() * W, y: anyY ? Math.random() * H : H + 10,
			r: big ? 1.6 + Math.random() * 1.6 : 0.4 + Math.random(),
			vx: (Math.random() - 0.5) * 0.12, vy: -(0.05 + Math.random() * 0.22),
			a: big ? 0.05 + Math.random() * 0.07 : 0.15 + Math.random() * 0.4,
			tw: Math.random() * 6.28, ts: 0.01 + Math.random() * 0.04, big,
		};
	};
	const col = (a: number) => `rgba(${ink[0]},${ink[1]},${ink[2]},${a})`;
	return {
		resize(w, h) {
			W = w; H = h;
			ps = Array.from({ length: Math.round(Math.min(150, (w * h) / 11000)) }, () => mk(true));
		},
		frame(t) {
			g.clearRect(0, 0, W, H);
			const air = t / 4000;
			for (let i = 0; i < ps.length; i++) {
				const p = ps[i]!;
				p.x += p.vx + Math.sin(air + p.y * 0.004) * 0.06;
				p.y += p.vy; p.tw += p.ts;
				if (p.y < -10 || p.x < -10 || p.x > W + 10) { ps[i] = mk(false); continue; }
				const a = p.a * (0.55 + 0.45 * Math.sin(p.tw));
				if (p.big) {
					const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
					gr.addColorStop(0, col(a)); gr.addColorStop(1, col(0));
					g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r * 3, 0, 6.283); g.fill();
				} else { g.fillStyle = col(a); g.fillRect(p.x, p.y, p.r, p.r); }
			}
		},
	};
}

/** Smoke: a few big soft grey blobs drifting over each other (low-res, upscaled blurry). */
function smokePainter(g: CanvasRenderingContext2D, ink: Rgb): Painter {
	let W = 1, H = 1;
	const blobs = Array.from({ length: 7 }, (_, i) => ({ ph: i * 1.7, sp: 0.00004 + i * 0.000006, r: 0.28 + (i % 3) * 0.1, a: 0.1 + (i % 2) * 0.06 }));
	return {
		resize(w, h) { W = w; H = h; },
		frame(t) {
			g.clearRect(0, 0, W, H);
			for (const b of blobs) {
				const x = W * (0.5 + 0.42 * Math.sin(t * b.sp + b.ph)), y = H * (0.5 + 0.38 * Math.cos(t * b.sp * 0.8 + b.ph * 1.3));
				const r = Math.max(W, H) * b.r;
				const gr = g.createRadialGradient(x, y, 0, x, y, r);
				gr.addColorStop(0, `rgba(${ink[0]},${ink[1]},${ink[2]},${b.a})`); gr.addColorStop(1, `rgba(${ink[0]},${ink[1]},${ink[2]},0)`);
				g.fillStyle = gr; g.fillRect(0, 0, W, H);
			}
		},
	};
}

/** Nimbus: halftone clouds — value-noise fbm drifting sideways, quantised to 4 pixel-art levels. */
function cloudPainter(g: CanvasRenderingContext2D, ink: Rgb, bg: Rgb): Painter {
	let W = 1, H = 1, img: ImageData | null = null;
	const hash = (x: number, y: number) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
	const vnoise = (x: number, y: number) => {
		const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
		const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
		return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
	};
	const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
	return {
		resize(w, h) { W = Math.max(1, w); H = Math.max(1, h); img = g.createImageData(W, H); },
		frame(t) {
			if (!img) return;
			const d = img.data, drift = t / 9000;
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const nx = (x / W) * 4 + drift, ny = (y / H) * 2.4;
				const n = 0.55 * vnoise(nx, ny) + 0.3 * vnoise(nx * 2.1 + 5, ny * 2.1) + 0.15 * vnoise(nx * 4.3, ny * 4.3 + 9);
				const lvl = Math.max(0, (n - 0.5) * 3.2) + (BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.5) * 0.28;
				const k = lvl > 0.55 ? 0.55 : lvl > 0.3 ? 0.32 : lvl > 0.1 ? 0.14 : 0;
				const o = (y * W + x) * 4;
				d[o] = bg[0] + (ink[0] - bg[0]) * k; d[o + 1] = bg[1] + (ink[1] - bg[1]) * k; d[o + 2] = bg[2] + (ink[2] - bg[2]) * k; d[o + 3] = 255;
			}
			g.putImageData(img, 0, 0);
		},
	};
}

/** Uzumaki: concentric rings winding into a dark centre, grainy (swirl.js). */
function swirlPainter(g: CanvasRenderingContext2D, ink: Rgb, bg: Rgb): Painter {
	let W = 1, H = 1, rad = new Float32Array(1), ang = new Float32Array(1), img: ImageData | null = null;
	const rnd = rng(7);
	const smooth = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
	return {
		resize(w, h) {
			W = Math.max(1, w); H = Math.max(1, h); img = g.createImageData(W, H);
			rad = new Float32Array(W * H); ang = new Float32Array(W * H);
			const R = Math.hypot(W, H) / 2, cx = W * 0.3, cy = H * 0.45;
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const dx = x - cx, dy = y - cy, i = y * W + x;
				rad[i] = Math.sqrt(dx * dx + dy * dy) / R; ang[i] = Math.atan2(dy, dx);
			}
		},
		frame(time) {
			if (!img) return;
			const d = img.data, t = time / 1000 * 0.5;
			for (let i = 0; i < W * H; i++) {
				const r = rad[i]!, a = ang[i]!;
				const warp = 0.55 * Math.sin(a * 3 + t * 0.6 + r * 9) * r + 0.25 * Math.sin(a * 5 - t * 0.9) * r * r;
				const p = Math.pow(r, 0.72) * 34 + t * 2.2 + warp * 3 + a;
				const k = smooth(0.05, 0.6, Math.sin(p)) * smooth(0.02, 0.26, r) * 0.9;
				const gr = (rnd() - 0.5) * 40, o = i * 4;
				d[o] = bg[0] + (ink[0] - bg[0]) * k + gr; d[o + 1] = bg[1] + (ink[1] - bg[1]) * k + gr; d[o + 2] = bg[2] + (ink[2] - bg[2]) * k + gr; d[o + 3] = 255;
			}
			g.putImageData(img, 0, 0);
		},
	};
}

/** Low-end device or a draining battery: draw one still frame instead. */
function lowPowerNow(): boolean {
	const nav = navigator as Navigator & { deviceMemory?: number };
	return (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
}

export function ThemeScene() {
	const { activeTheme, colors, appearance } = useAppearance();
	const tune = effectiveTune(activeTheme, appearance.glassEffects);
	const scene = tune.scene;
	const peak = tune.scenePeak;
	const animate = appearance.backgroundAnimation;
	const bgHex = colors.background;
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const cv = canvasRef.current;
		if (!cv || scene === "none") return;
		const g = cv.getContext("2d", { alpha: scene === "dust" || scene === "smoke" });
		if (!g) return;
		const ink = hexToRgb(peak) as Rgb, bg = hexToRgb(bgHex) as Rgb;
		const painter = scene === "dust" ? dustPainter(g, ink)
			: scene === "smoke" ? smokePainter(g, ink)
			: scene === "clouds" ? cloudPainter(g, ink, bg)
			: swirlPainter(g, ink, bg);
		const reduced = matchMedia("(prefers-reduced-motion: reduce)");
		let raf = 0, last = 0, lowBattery = false, disposed = false;
		const fpsGap = scene === "dust" || scene === "smoke" ? 33 : 80;
		const still = () => !animate || reduced.matches || lowBattery || lowPowerNow();
		const size = () => {
			const k = SCALE[scene];
			const w = Math.max(1, Math.ceil(window.innerWidth / k)), h = Math.max(1, Math.ceil(window.innerHeight / k));
			cv.width = w; cv.height = h; painter.resize(w, h);
			painter.frame(performance.now());
		};
		const loop = (now: number) => {
			raf = 0;
			if (disposed || document.hidden || still()) return;
			if (now - last >= fpsGap) { last = now; painter.frame(now); }
			raf = requestAnimationFrame(loop);
		};
		const run = () => { if (!raf && !document.hidden && !still()) raf = requestAnimationFrame(loop); };
		const onVisible = () => { if (!document.hidden) run(); };
		const onResize = () => { size(); run(); };
		const onMotion = () => { painter.frame(performance.now()); run(); };
		(navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number; addEventListener: (e: string, f: () => void) => void }> })
			.getBattery?.().then((b) => {
				const upd = () => { lowBattery = !b.charging && b.level <= 0.2; run(); };
				b.addEventListener("levelchange", upd); b.addEventListener("chargingchange", upd); upd();
			}).catch(() => {});
		size(); run();
		window.addEventListener("resize", onResize);
		document.addEventListener("visibilitychange", onVisible);
		reduced.addEventListener("change", onMotion);
		return () => {
			disposed = true;
			if (raf) cancelAnimationFrame(raf);
			window.removeEventListener("resize", onResize);
			document.removeEventListener("visibilitychange", onVisible);
			reduced.removeEventListener("change", onMotion);
		};
	}, [scene, peak, bgHex, animate]);

	if (scene === "none") return null;
	return (
		<div id="lh-scene" data-scene={scene} aria-hidden="true">
			<canvas ref={canvasRef} className={scene === "clouds" || scene === "swirl" ? "lh-scene-pixel" : undefined} />
			<div className="lh-scene-veil" />
		</div>
	);
}
