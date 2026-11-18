import { ScopePage } from "@/components/study/scope-page";

export const dynamic = "force-dynamic";

export default async function TopicRoute({ params }: { params: Promise<{ subjectId: string; topicId: string }> }) {
	const { subjectId, topicId } = await params;
	return <ScopePage subjectId={subjectId} topicId={topicId} />;
}
