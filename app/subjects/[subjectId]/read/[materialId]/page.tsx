"use client";

/** The reader page: a static `read` segment wins over the sibling [topicId] route. */
import { use } from "react";
import { PdfReader } from "@/components/study/pdf-reader";

export default function ReadRoute({
	params,
	searchParams,
}: {
	params: Promise<{ subjectId: string; materialId: string }>;
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const { subjectId, materialId } = use(params);
	const query = use(searchParams);
	const raw = Array.isArray(query.page) ? query.page[0] : query.page;
	const page = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
	return <PdfReader subjectId={subjectId} materialId={materialId} startPage={page} />;
}
