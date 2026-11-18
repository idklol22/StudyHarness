import { ScopePage } from "@/components/study/scope-page";

export const dynamic = "force-dynamic";

export default async function SubjectRoute({ params }: { params: Promise<{ subjectId: string }> }) {
	const { subjectId } = await params;
	return <ScopePage subjectId={subjectId} />;
}
