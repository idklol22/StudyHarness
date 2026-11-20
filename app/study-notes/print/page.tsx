"use client";

/** Print view for exporting notes as a PDF: one note page per sheet, the browser's "Save as PDF" does the rest. */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PAGE_H, PAGE_W, type Notebook } from "@/src/core";
import { NotePageView, pageImageUrl } from "@/components/study/notes-view";

function Print() {
	const params = useSearchParams();
	const [book, setBook] = useState<Notebook | null>(null);
	const [error, setError] = useState("");
	useEffect(() => {
		void (async () => {
			try {
				const res = await fetch(`/api/study/notes?${params.toString()}`);
				const data = await res.json() as { notebook?: Notebook; error?: string };
				if (data.notebook) setBook(data.notebook); else setError(data.error ?? "Could not load the notes.");
			} catch { setError("Could not reach the app."); }
		})();
	}, [params]);
	useEffect(() => {
		if (!book?.pages.length) return;
		const images = Array.from(document.images);
		void Promise.all(images.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = () => r(null); })))).then(() => setTimeout(() => window.print(), 300));
	}, [book]);
	if (error) return <p role="alert" style={{ padding: 24 }}>{error}</p>;
	if (!book) return <p style={{ padding: 24 }}>Loading…</p>;
	return (
		<div style={{ background: "var(--lh-np-paper)" }}>
			<style>{`@page { size: ${PAGE_W}px ${PAGE_H}px; margin: 0 } html, body { background: var(--lh-np-paper); -webkit-print-color-adjust: exact; print-color-adjust: exact } @media print { body { margin: 0 } [data-testid="note-page"] { break-after: page } }`}</style>
			{book.pages.map((p, i) => <NotePageView key={p.id} page={p} number={i + 1} notebook={book} scale={1} tool="view" imageUrl={pageImageUrl} />)}
		</div>
	);
}

export default function Page() {
	return <Suspense fallback={null}><Print /></Suspense>;
}
