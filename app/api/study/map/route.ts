/** GET /api/study/map — subjects as hubs with their topics, chats and files, plus links between related subjects. */
import { studyMapView } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	return Response.json({ map: studyMapView() });
}
