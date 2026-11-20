"use client";

import { useMemo } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { linkCitations } from "./citations";
import { useSidePanel } from "./side-panel";

/** Assistant prose whose "(file, p. N)" mentions of the subject's files become clickable panel chips. */
export function CitedText({ text }: { text: string }) {
	const materials = useSidePanel()?.materials;
	const linked = useMemo(() => (materials?.length ? linkCitations(text, materials) : text), [text, materials]);
	return <MessageResponse>{linked}</MessageResponse>;
}
