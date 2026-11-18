/**
 * POST /api/uploads: browser attachments are saved under <data>/uploads/<batch>/ and their paths
 * returned (a browser File has no local path). Runs against a temporary LH_DATA_DIR.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-uploads-"));
process.env.LH_DATA_DIR = dataDir;
const { POST, safeUploadName, MAX_UPLOAD_FILE_BYTES } = await import("../app/api/uploads/route.ts");

function request(files: File[]): Request {
	const body = new FormData();
	for (const f of files) body.append("files", f, f.name);
	return new Request("http://localhost/api/uploads", { method: "POST", body });
}

describe("uploads route", () => {
	it("saves files under the data folder and returns their paths; duplicate names get a suffix", async () => {
		const res = await POST(request([new File(["%PDF-1.4 a"], "lecture 3.pdf"), new File(["%PDF-1.4 b"], "lecture 3.pdf")]));
		assert.equal(res.status, 200);
		const { paths } = await res.json() as { paths: string[] };
		assert.equal(paths.length, 2);
		for (const p of paths) assert.ok(p.startsWith(path.join(dataDir, "uploads")), p);
		assert.deepEqual(paths.map((p) => path.basename(p)), ["lecture 3.pdf", "lecture 3 (2).pdf"]);
		assert.equal(fs.readFileSync(paths[0]!, "utf8"), "%PDF-1.4 a");
	});

	it("reduces names to one safe segment", () => {
		assert.equal(safeUploadName("../../etc/passwd"), "passwd");
		assert.equal(safeUploadName("C:\\Users\\x\\notes:v2?.pdf"), "notes_v2_.pdf");
		assert.equal(safeUploadName("..."), "upload");
		assert.ok(safeUploadName("a".repeat(300) + ".pdf").length <= 120);
	});

	it("refuses empty uploads and oversize files", async () => {
		assert.equal((await POST(new Request("http://localhost/api/uploads", { method: "POST", body: new FormData() }))).status, 400);
		const big = new File([new Uint8Array(MAX_UPLOAD_FILE_BYTES + 1)], "big.pdf");
		assert.equal((await POST(request([big]))).status, 413);
	});
});
