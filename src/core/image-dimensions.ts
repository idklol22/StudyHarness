/** Pure PNG/JPEG dimension reader for the image snapshot store. Only the
 *  headers are inspected; decoding/restoring is the image processor's job.
 *  Returns null for anything it cannot identify, never a guessed size. */
export function imageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
	const type = mimeType.toLowerCase();
	if (type === "image/png") {
		const signature = [137, 80, 78, 71, 13, 10, 26, 10];
		if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
		if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
		const width = readUint32(bytes, 16);
		const height = readUint32(bytes, 20);
		return width > 0 && height > 0 ? { width, height } : null;
	}
	if (type === "image/jpeg" || type === "image/jpg") {
		if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) { offset++; continue; }
			while (bytes[offset] === 0xff) offset++;
			const marker = bytes[offset++] ?? 0;
			if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
			if (marker === 0xd9 || marker === 0xda) return null;
			const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
			if (length < 7 || offset + length > bytes.length) return null;
			const sof = (marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker);
			if (sof) {
				const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
				const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
				return width > 0 && height > 0 ? { width, height } : null;
			}
			offset += length;
		}
	}
	return null;
}

function readUint32(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}
