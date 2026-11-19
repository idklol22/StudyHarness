/** The Study map served to the home view: the library, the chats' places and the idea graph's provenance, folded by core/study/map.ts. */
import { buildStudyMap, type StudyMap } from "../core/study/map.ts";
import { graphView } from "./graph.ts";
import { stores } from "./stores.ts";
import { study } from "./study-runtime.ts";

export function studyMapView(): StudyMap {
	const snapshot = graphView();
	return buildStudyMap({
		library: study.library(),
		chats: stores.chatStore.listChats().map((c) => ({ id: c.id, title: c.title, placement: c.placement })),
		graph: { propositions: snapshot.propositions, logicalEdges: snapshot.logicalEdges, nodeSessions: snapshot.nodeSessions, nodeScope: snapshot.nodeScope },
	});
}
