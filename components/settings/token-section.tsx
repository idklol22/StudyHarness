"use client";
/**
 * Token diet (2026-11-20): the "Small tasks" group (follow-up model + OpenRouter for background work) and the
 * "Usage" group (what the app has spent, by task / model / day, background vs interactive, top calls).
 * Both mount inside the Agent section.
 */

import { useEffect, useState } from "react";
import { MenuShell } from "@/components/menu-shell";
import type { ModelCatalogEntry } from "@/src/core";
import type { AgentSettings, SmallTasksSettings } from "@/src/core";
import type { UsageReport, UsageTotals } from "@/src/core/usage";
import { prettyModel } from "@/components/usage-format";
import { SettingsGroup, SettingsMenuTrigger, SettingsRow, Toggle } from "./controls.tsx";
import { ModelMenuList } from "./model-menu";

/** Compose one smallTasks edit, carrying the rest of the agent section verbatim. Pure. */
export function composeSmallTasks(agent: AgentSettings | undefined, patch: Partial<SmallTasksSettings> & { openRouter?: SmallTasksSettings["openRouter"] }): AgentSettings {
	return { ...agent, smallTasks: { ...agent?.smallTasks, ...patch } };
}

export function SmallTasksGroup({ agent, catalog, onSectionChange }: {
	agent: AgentSettings | undefined;
	catalog: ModelCatalogEntry[] | undefined;
	onSectionChange: (next: AgentSettings) => boolean | Promise<boolean>;
}) {
	const [open, setOpen] = useState(false);
	const small = agent?.smallTasks;
	const followUp = small?.followUpModel ?? "cheap";
	const openRouterModels = (catalog ?? []).filter((m) => m.provider === "openrouter");
	const hasKey = openRouterModels.length > 0;
	const picked = small?.openRouter?.model;
	return (
		<SettingsGroup label="Small tasks" testid="group-small-tasks">
			<SettingsRow label="Follow-up questions model" hint="The side window for quick follow-ups" testid="follow-up-model-row">
				<div role="radiogroup" aria-label="Follow-up questions model" className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
					{(["cheap", "strong"] as const).map((m) => (
						<button
							key={m}
							type="button"
							role="radio"
							aria-checked={followUp === m}
							data-testid={`follow-up-model-${m}`}
							onClick={() => onSectionChange(composeSmallTasks(agent, { followUpModel: m }))}
							className={`h-8 rounded-md px-3 text-sm font-medium transition-colors ${followUp === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
						>{m === "cheap" ? "Cheap" : "Strong"}</button>
					))}
				</div>
			</SettingsRow>
			<SettingsRow
				label="Use OpenRouter for small/background tasks"
				hint={hasKey ? "Background helpers and follow-ups run on this OpenRouter model instead of the cheap slot" : "Add an OpenRouter key in Settings → Keys"}
				testid="small-tasks-openrouter-row"
				dimmed={!hasKey}
			>
				<span className="relative flex items-center gap-2">
					<SettingsMenuTrigger
						value={picked ? prettyModel(picked.id) : "Pick a model"}
						aria-label="OpenRouter small-task model"
						aria-expanded={open}
						data-testid="small-tasks-openrouter-model"
						disabled={!hasKey}
						onClick={() => setOpen(!open)}
						className="min-w-24"
					/>
					<Toggle
						label="Use OpenRouter for small/background tasks"
						checked={small?.openRouter?.enabled === true && hasKey}
						disabled={!hasKey}
						onChange={(enabled) => onSectionChange(composeSmallTasks(agent, { openRouter: { ...small?.openRouter, enabled } }))}
					/>
					{open && hasKey && (
						<MenuShell
							preferredSide="down"
							anchorTestid="small-tasks-openrouter-model"
							testid="small-tasks-openrouter-menu"
							onClose={() => { setOpen(false); return "closed"; }}
							menuClass="flex w-[22rem] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
						>
							<ModelMenuList
								models={openRouterModels}
								effectiveId={picked?.id}
								effectiveProvider="openrouter"
								onPick={(entry) => {
									setOpen(false);
									void onSectionChange(composeSmallTasks(agent, { openRouter: { ...small?.openRouter, model: { provider: "openrouter", id: entry.id } } }));
								}}
								footer="OpenRouter models only"
							/>
						</MenuShell>
					)}
				</span>
			</SettingsRow>
		</SettingsGroup>
	);
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const money = (n: number) => (n > 0 ? `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}` : "—");

function Table({ title, rows, testid }: { title: string; rows: Array<{ key: string } & UsageTotals>; testid: string }) {
	return (
		<div data-testid={testid} className="mb-3">
			<p className="mb-1 text-xs text-muted-foreground">{title}</p>
			<table className="w-full text-xs">
				<thead className="text-muted-foreground/70"><tr><th className="text-left font-normal">&nbsp;</th><th className="text-right font-normal">calls</th><th className="text-right font-normal">in</th><th className="text-right font-normal">out</th><th className="text-right font-normal">cached</th><th className="text-right font-normal">cost</th></tr></thead>
				<tbody>
					{rows.length === 0 && <tr><td colSpan={6} className="text-muted-foreground/70">Nothing yet</td></tr>}
					{rows.map((r) => (
						<tr key={r.key}><td className="max-w-40 truncate pr-2">{r.key}</td><td className="text-right">{r.calls}</td><td className="text-right">{fmt(r.input)}</td><td className="text-right">{fmt(r.output)}</td><td className="text-right">{fmt(r.cacheRead)}</td><td className="text-right">{money(r.costUsd)}</td></tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function UsageGroup() {
	const [days, setDays] = useState(7);
	const [report, setReport] = useState<UsageReport | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let live = true;
		fetch(`/api/usage?days=${days}`)
			.then((r) => r.json())
			.then((body: UsageReport) => { if (live) { if (body?.total) { setReport(body); setFailed(false); } else setFailed(true); } })
			.catch(() => { if (live) setFailed(true); });
		return () => { live = false; };
	}, [days]);
	return (
		<SettingsGroup label="Usage" testid="group-usage">
			<SettingsRow label="Token usage" hint={report ? `${report.total.calls} calls, ${fmt(report.total.input + report.total.output)} tokens, ${money(report.total.costUsd)}` : failed ? "Could not load usage" : "Loading…"} testid="usage-summary">
				<div role="radiogroup" aria-label="Usage period" className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
					{[1, 7, 30].map((d) => (
						<button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}
							className={`h-7 rounded-md px-2 text-xs font-medium transition-colors ${days === d ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{d === 1 ? "Today" : `${d} days`}</button>
					))}
				</div>
			</SettingsRow>
			{report && (
				<>
					<Table title="Interactive vs background" testid="usage-kind" rows={[{ key: "interactive", ...report.interactive }, { key: "background", ...report.background }]} />
					<Table title="By task" testid="usage-by-task" rows={report.byTask} />
					<Table title="By model" testid="usage-by-model" rows={report.byModel.map((r) => ({ ...r, key: prettyModel(r.key.split("/").slice(1).join("/") || r.key) }))} />
					<Table title="By day" testid="usage-by-day" rows={report.byDay.slice(0, 7)} />
					<div data-testid="usage-top-calls">
						<p className="mb-1 text-xs text-muted-foreground">Most expensive calls</p>
						<table className="w-full text-xs"><tbody>
							{report.topCalls.length === 0 && <tr><td className="text-muted-foreground/70">Nothing yet</td></tr>}
							{report.topCalls.map((c, i) => (
								<tr key={`${c.ts}-${i}`}>
									<td className="pr-2 text-muted-foreground/70">{new Date(c.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
									<td className="max-w-28 truncate pr-2">{c.task}{c.background ? " (bg)" : ""}</td>
									<td className="max-w-32 truncate pr-2">{prettyModel(c.model)}</td>
									<td className="text-right">{fmt(c.input + c.cacheRead + c.cacheWrite)} in / {fmt(c.output)} out</td>
									<td className="text-right">{money(c.costUsd ?? 0)}</td>
								</tr>
							))}
						</tbody></table>
					</div>
				</>
			)}
		</SettingsGroup>
	);
}
