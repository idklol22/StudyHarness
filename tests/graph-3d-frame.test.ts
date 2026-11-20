/** Pure click-to-focus framing maths: bounding spheres, fill-based dolly distance, card offset. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FRAME_FILL, clusterBounds, frameDistance, screenPixelsToWorld } from "../components/graph-3d-layout.ts";

const close = (a: number, b: number, eps = 1e-9): void => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

describe("clusterBounds", () => {
	it("an empty cluster has no centre or extent", () => {
		assert.deepEqual(clusterBounds([]), { cx: 0, cy: 0, cz: 0, radius: 0 });
	});

	it("centres on the mean position and reaches the furthest node's surface", () => {
		assert.deepEqual(clusterBounds([{ x: 0, y: 0, z: 0, radius: 2 }, { x: 10, y: 0, z: 0, radius: 1 }]),
			{ cx: 5, cy: 0, cz: 0, radius: 7 });
	});

	it("works in 3D and ignores negative radii", () => {
		const b = clusterBounds([{ x: -3, y: 4, z: 0, radius: 1 }, { x: 3, y: -4, z: 12, radius: -5 }]);
		close(b.cx, 0); close(b.cy, 0); close(b.cz, 6);
		close(b.radius, Math.sqrt(61) + 1);
	});

	it("encloses every input sphere, including point nodes", () => {
		const nodes = [
			{ x: 10, y: -2, z: 3, radius: 4 }, { x: -8, y: 6, z: 1, radius: 2 },
			{ x: 0, y: 0, z: 9 }, { x: 1, y: 1, z: 1, radius: 3 },
		];
		const b = clusterBounds(nodes);
		for (const n of nodes) {
			assert.ok(Math.hypot(n.x - b.cx, n.y - b.cy, n.z - b.cz) + Math.max(0, n.radius ?? 0) <= b.radius + 1e-9);
		}
	});
});

describe("frameDistance", () => {
	it("is linear in the cluster radius", () => {
		close(frameDistance(200, 50, 0.7), 2 * frameDistance(100, 50, 0.7));
	});

	it("moves closer for a larger fill and for a wider field of view", () => {
		assert.ok(frameDistance(10, 50, FRAME_FILL.subject) < frameDistance(10, 50, FRAME_FILL.topic));
		assert.ok(frameDistance(10, 50, FRAME_FILL.topic) < frameDistance(10, 50, FRAME_FILL.idea));
		assert.ok(frameDistance(10, 60, 0.6) < frameDistance(10, 50, 0.6));
	});

	it("solves the sphere silhouette exactly", () => {
		const k = 0.6 * Math.tan((50 * Math.PI) / 360);
		close(frameDistance(12, 50, 0.6), 12 * Math.hypot(1, 1 / k));
	});

	it("projects a cluster diameter at the requested fraction of viewport height", () => {
		const radius = 12, fill = 0.5, dist = frameDistance(radius, 50, fill);
		const halfFov = (50 * Math.PI) / 360;
		const projectedRadius = radius / Math.sqrt(1 - (radius / dist) ** 2);
		close(projectedRadius / (dist * Math.tan(halfFov)), fill, 1e-12);
		assert.ok(dist > radius, "the camera stays outside the cluster");
	});

	it("returns 0 for degenerate input", () => {
		assert.equal(frameDistance(0, 50, 0.7), 0);
		assert.equal(frameDistance(10, 0, 0.7), 0);
		assert.equal(frameDistance(10, 50, -1), 0);
	});
});

describe("screenPixelsToWorld", () => {
	it("scales with pixels and distance, inversely with viewport height", () => {
		close(screenPixelsToWorld(190, 200, 50, 800), 2 * screenPixelsToWorld(190, 100, 50, 800));
		close(screenPixelsToWorld(190, 200, 50, 800), 2 * screenPixelsToWorld(95, 200, 50, 800));
		close(screenPixelsToWorld(190, 200, 50, 800), 0.5 * screenPixelsToWorld(190, 200, 50, 400));
		const expected = (190 * 2 * 200 * Math.tan((50 * Math.PI) / 360)) / 800;
		close(screenPixelsToWorld(190, 200, 50, 800), expected);
	});

	it("returns 0 for a viewport with no height", () => {
		assert.equal(screenPixelsToWorld(190, 200, 50, 0), 0);
	});
});
