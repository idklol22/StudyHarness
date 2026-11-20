"use client";

/**
 * G1: the visible manual trigger. Shared by the Graph view toolbar and the
 * extraction-coverage popover so both run the same POST /api/graph/update
 * pass, show a spinner while it is in flight, and report "Updated 3 chats".
 * Disabled while running — the server's single-flight lock is the second
 * line of defence.
 */
import { useState } from "react";
import { Loader2Icon } from "lucide-react";

export function RefreshGraphButton({
	onUpdated,
	className = "",
}: {
	/** Caller refetches its snapshot once the pass has landed its merges. */
	onUpdated?: () => void;
	className?: string;
}): React.JSX.Element {
	const [running, setRunning] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const refresh = async () => {
		if (running) return;
		setRunning(true);
		setMessage(null);
		try {
			const res = await fetch("/api/graph/update", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			});
			const body = (await res.json().catch(() => ({}))) as { chatsProcessed?: unknown; error?: unknown };
			if (!res.ok) {
				setMessage(typeof body.error === "string" ? body.error : "Refresh failed.");
				return;
			}
			const count = typeof body.chatsProcessed === "number" ? body.chatsProcessed : 0;
			setMessage(`Updated ${count} chat${count === 1 ? "" : "s"}`);
			onUpdated?.();
		} catch {
			setMessage("Refresh failed.");
		} finally {
			setRunning(false);
		}
	};

	return (
		<div className={`flex flex-col items-end gap-1 ${className}`}>
			<button
				type="button"
				data-testid="refresh-graph"
				onClick={() => void refresh()}
				disabled={running}
				className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
			>
				{running && <Loader2Icon className="size-3 animate-spin" aria-hidden />}
				Refresh graph
			</button>
			{message !== null && (
				<span role="status" data-testid="graph-update-result" className="text-[11px] text-muted-foreground">
					{message}
				</span>
			)}
		</div>
	);
}
