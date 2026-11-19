/**
 * LhMark — the app mark (Round 5, 2026-11-19): a new concentric "harness" pattern.
 * Three broken rings at different angles, woven around a single solid centre dot —
 * the learner held in a web of understanding. Inlined as JSX so it is recolorable
 * and crisp at any size: the outer broken ring is the quiet spiral gray, the inner
 * ring and the centre dot follow the strong line ink (white in dark, foreground in
 * light). 64×64 viewBox, no padding — sizing is the consumer's job.
 */
export function LhMark({ className = "" }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 64 64"
			className={className}
			style={{ fillRule: "evenodd", clipRule: "evenodd", strokeLinejoin: "round" }}
			aria-hidden="true"
		>
			{/* Outer broken ring — the harness spiral, woven with a gap at the lower right. */}
			<path
				d="M32 4A28 28 0 1 1 7.6 22.2L13.9 25.6A22 22 0 1 0 32 10Z"
				style={{ fill: "rgb(148,148,148)" }}
			/>
			{/* Inner ring — the understanding it holds. */}
			<path
				d="M32 16a16 16 0 1 0 0 32 16 16 0 1 0 0-32zm0 5a11 11 0 1 1 0 22 11 11 0 1 1 0-22z"
				style={{ fill: "var(--lh-line-strong)" }}
			/>
			{/* The centre — one idea, held. */}
			<circle cx="32" cy="32" r="4.5" style={{ fill: "var(--lh-line-strong)" }} />
		</svg>
	);
}
