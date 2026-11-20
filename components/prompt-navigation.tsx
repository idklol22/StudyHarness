"use client";

/**
 * PROMPT NAVIGATION (T20): the provider owns the active-prompt index derived
 * from the transcript scroller and exposes `jumpTo` (built on the existing
 * scrollSessionTarget helper). StickyPrompt is the pinned one-line row; T21's
 * rail consumes the same context. No persisted state, no scroller ref of our
 * own — sessionFindScopeRef is reused as the jump scope.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
} from "react";
import { ArrowUpIcon } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";
import { activePromptIndex, promptLabel, promptTickTop, promptTooltipTop, type PromptEntry } from "@/src/core";
import { scrollSessionTarget, type SessionScrollContext } from "@/components/session-navigation";

export interface PromptNavigationValue {
	entries: readonly PromptEntry[];
	activeIndex: number;
	/** Whether the pinned row should currently be shown (not just reserved). */
	visible: boolean;
	jumpTo: (index: number) => void;
}

const PromptNavigationContext = createContext<PromptNavigationValue | null>(null);

/** Shared by StickyPrompt and T21's PromptRail. */
export function usePromptNavigation(): PromptNavigationValue {
	const value = useContext(PromptNavigationContext);
	if (!value) throw new Error("usePromptNavigation must be used inside PromptNavigationProvider");
	return value;
}

export function PromptNavigationProvider({
	entries,
	scopeRef,
	children,
}: {
	entries: readonly PromptEntry[];
	scopeRef: RefObject<HTMLElement | null>;
	children: ReactNode;
}) {
	const { scrollRef, stopScroll } = useStickToBottomContext();
	const [activeIndex, setActiveIndex] = useState(-1);
	const [visible, setVisible] = useState(false);
	const frameRef = useRef(0);

	/** One passive-scroll rAF recomputes the active anchor against the
	 *  scroller's top + 4px. Detection NEVER calls stopScroll — that belongs
	 *  to the jump (and to hash/Session Find). */
	const recompute = useCallback(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		const viewportTop = scroller.getBoundingClientRect().top + 4;
		const tops: number[] = [];
		const indexes: number[] = [];
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i]!;
			if (!entry.id) continue; // missing id → no anchor → never active
			const anchor = document.getElementById(entry.anchorId);
			if (!anchor || !scroller.contains(anchor)) continue;
			tops.push(anchor.getBoundingClientRect().top);
			indexes.push(i);
		}
		const position = activePromptIndex(tops, viewportTop);
		const nextIndex = position < 0 ? -1 : indexes[position]!;
		const entry = nextIndex >= 0 ? entries[nextIndex] : undefined;
		const nextVisible = !!entry && entry.hasReply && !!entry.id && scroller.scrollTop > 8;
		setActiveIndex((previous) => (previous === nextIndex ? previous : nextIndex));
		setVisible((previous) => (previous === nextVisible ? previous : nextVisible));
	}, [entries, scrollRef]);

	/** Collapse bursts of scroll/resize events into a single frame. */
	const schedule = useCallback(() => {
		if (frameRef.current !== 0) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = 0;
			recompute();
		});
	}, [recompute]);

	useEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
		const column = scopeRef.current;
		if (observer && column) observer.observe(column);
		if (observer && scroller !== column) observer.observe(scroller);
		scroller.addEventListener("scroll", schedule, { passive: true });
		recompute();
		return () => {
			scroller.removeEventListener("scroll", schedule);
			observer?.disconnect();
			if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
			frameRef.current = 0;
		};
	}, [recompute, schedule, scopeRef, scrollRef]);

	const jumpTo = useCallback((index: number) => {
		const entry = entries[index];
		const scope = scopeRef.current;
		if (!entry || !entry.id || !scope) return;
		const anchor = document.getElementById(entry.anchorId);
		if (!anchor || !scope.contains(anchor)) return;
		const scroll: SessionScrollContext = { scrollRef, stopScroll };
		scrollSessionTarget(anchor, scope, scroll);
	}, [entries, scopeRef, scrollRef, stopScroll]);

	const value = useMemo<PromptNavigationValue>(
		() => ({ entries, activeIndex, visible, jumpTo }),
		[entries, activeIndex, visible, jumpTo]
	);

	return <PromptNavigationContext.Provider value={value}>{children}</PromptNavigationContext.Provider>;
}

/** The pinned prompt row. The 36px row is reserved whenever any prompt has a
 *  reply; `visibility: hidden` (rather than unmounting) keeps prompt switches
 *  from shifting the transcript. */
export function StickyPrompt() {
	const { entries, activeIndex, visible, jumpTo } = usePromptNavigation();
	if (!entries.some((entry) => entry.hasReply)) return null;
	const entry = activeIndex >= 0 ? entries[activeIndex] : undefined;
	const text = entry ? promptLabel(entry.text) : "";
	return (
		<button
			type="button"
			aria-label={`Jump to your prompt: ${text}`}
			style={{ visibility: visible ? "visible" : "hidden" }}
			onClick={() => jumpTo(activeIndex)}
			className={cn(
				"sticky top-0 z-20 grid h-9 w-full shrink-0 grid-cols-[3ch_minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-background px-6 text-left",
				"max-sm:px-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			)}
		>
			<span className="font-medium uppercase text-muted-foreground text-xs">You</span>
			<span className="truncate font-ui text-xs text-foreground" title={text}>{text}</span>
			<ArrowUpIcon className="size-3.5 text-muted-foreground" />
		</button>
	);
}

/** T21: a slim right-edge rail with one tick per prompt. Pure consumer of the
 *  T20 context — no extraction, no scroller ref, no stopScroll — so it only
 *  mirrors `activeIndex` and delegates every jump to the provider's `jumpTo`. */
export function PromptRail() {
	const { entries, activeIndex, jumpTo } = usePromptNavigation();
	const tickRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const count = entries.length;
	if (count === 0) return null;

	/** Arrow/Home/End only move focus between ticks; Enter/Space jump via the
	 *  button's native activation (onClick), never here, so each key triggers a
	 *  single scrollSessionTarget jump. No wrap. */
	const onTickKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		let target = -1;
		switch (event.key) {
			case "ArrowUp":
				target = index - 1;
				break;
			case "ArrowDown":
				target = index + 1;
				break;
			case "Home":
				target = 0;
				break;
			case "End":
				target = count - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		if (target < 0 || target >= count) return;
		tickRefs.current[target]?.focus();
	};

	return (
		<div
			data-testid="prompt-rail"
			aria-label="Prompt navigation"
			role="group"
			className="pointer-events-auto absolute inset-y-3 right-1 z-20 hidden w-4 min-[900px]:flex items-center"
		>
			{entries.map((entry, i) => {
				const active = activeIndex === i;
				return (
					<div key={i} className="group/tick pointer-events-none absolute inset-0">
						<button
							ref={(node) => { tickRefs.current[i] = node; }}
							type="button"
							aria-label={`Prompt ${i + 1}: ${entry.text}`}
							aria-current={active ? "true" : undefined}
							title={entry.text}
							style={{ top: `${promptTickTop(i, count)}%` }}
							onClick={() => jumpTo(i)}
							onKeyDown={(event) => onTickKeyDown(event, i)}
							className={cn(
								"pointer-events-auto absolute right-0 flex h-3 w-4 -translate-y-1/2 items-center justify-center",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							)}
						>
							<span
								className={cn(
									"block h-0.5 w-2",
									active
										? "h-0.5 w-3 bg-foreground"
										: "bg-muted-foreground/50 group-hover/tick:bg-foreground group-focus-within/tick:bg-foreground"
								)}
							/>
						</button>
						<span
							style={{ top: `${promptTooltipTop(i, count)}%` }}
							className={cn(
								"pointer-events-none absolute right-6 z-30 invisible w-64 max-w-[min(16rem,calc(100vw-2rem))]",
								"border border-border bg-popover px-2 py-1 font-ui text-xs leading-snug text-popover-foreground",
								"line-clamp-2 whitespace-normal -translate-y-1/2",
								"group-hover/tick:visible group-focus-within/tick:visible"
							)}
						>
							{entry.text}
						</span>
					</div>
				);
			})}
		</div>
	);
}
