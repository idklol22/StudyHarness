/**
 * Browser attachments: a browser File has no local path, so the web build uploads picked or dropped
 * files to /api/uploads, which saves them in the app's data folder and returns their paths. Those
 * paths then enter the draft exactly like desktop attachments.
 */
export const UPLOADING_NOTICE = (n: number) => `Uploading ${n} file${n === 1 ? "" : "s"}…`;

/** Upload files and resolve their saved paths; rejects with a readable message. */
export async function uploadFilesForPaths(files: readonly File[], fetchImpl: typeof fetch = fetch): Promise<string[]> {
	if (!files.length) return [];
	const body = new FormData();
	for (const file of files) body.append("files", file, file.name);
	let response: Response;
	try { response = await fetchImpl("/api/uploads", { method: "POST", body }); }
	catch { throw new Error("Could not upload: the app server is not reachable."); }
	const data = await response.json().catch(() => ({})) as { paths?: unknown; error?: unknown };
	if (!response.ok || !Array.isArray(data.paths)) throw new Error(typeof data.error === "string" ? data.error : "Could not upload the files.");
	return data.paths.filter((p): p is string => typeof p === "string");
}
