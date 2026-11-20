/** One captured screen frame, as a PNG data URL. Electron uses the narrow
 *  preload bridge; a plain browser uses the user-gestured display picker.
 *  Cropping happens in the shared overlay, not here. */
export function canCaptureScreen(): boolean {
	return typeof window !== "undefined" && (typeof window.lh?.captureScreen === "function"
		|| typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function");
}

export async function captureScreenFrame(): Promise<string> {
	if (typeof window !== "undefined" && typeof window.lh?.captureScreen === "function") {
		return window.lh.captureScreen();
	}
	const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
	if (!media || typeof media.getDisplayMedia !== "function") {
		throw new Error("Screen capture is not available here.");
	}
	// Must run inside the click gesture: the browser refuses a deferred prompt.
	const stream = await media.getDisplayMedia({ video: true });
	try {
		const track = stream.getVideoTracks()[0];
		if (!track) throw new Error("No screen frame was captured.");
		const video = document.createElement("video");
		video.srcObject = stream;
		video.muted = true;
		await video.play();
		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth || track.getSettings().width || window.innerWidth;
		canvas.height = video.videoHeight || track.getSettings().height || window.innerHeight;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas is unavailable in this browser.");
		context.drawImage(video, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/png");
	} finally {
		for (const item of stream.getTracks()) item.stop();
	}
}
