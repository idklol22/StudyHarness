"use client";

import { useRef, useState } from "react";
import type { ChatSettings } from "@/src/core";
import { prettyModel } from "@/components/usage-format";
import { useModelCatalog } from "@/components/model-picker";
import { MenuShell } from "@/components/menu-shell";
import { ModelMenuList } from "@/components/settings/model-menu";

/** The follow-up header's model picker. A pick applies to the NEXT ask in
 *  this thread only: existing answers keep their recorded model, and nothing
 *  is written to Settings or the thread until an ask actually uses it. */
export function SideThreadModelPicker({ model, onPick, disabled = false }: {
	model?: ChatSettings["model"];
	onPick: (next?: ChatSettings["model"]) => void;
	disabled?: boolean;
}) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const { catalog } = useModelCatalog();
	const models = catalog?.models;
	const close = () => {
		setOpen(false);
		triggerRef.current?.focus({ preventScroll: true });
	};
	const pick = (next?: ChatSettings["model"]) => {
		onPick(next);
		close();
	};
	return <>
		<button
			ref={triggerRef}
			type="button"
			data-testid="side-thread-model-picker"
			title="Follow-up model — applies to the next answer"
			aria-label="Follow-up model"
			aria-haspopup="menu"
			aria-expanded={open}
			aria-disabled={disabled}
			onClick={() => { if (disabled) return; setOpen((value) => !value); }}
			// The header owns dragging; a picker press must never start it.
			onPointerDown={(event) => { event.stopPropagation(); }}
			className="flex h-[22px] max-w-[120px] max-[479px]:max-w-16 items-center gap-1 rounded-md px-1.5 font-ui text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
		>
			<span className="truncate text-[11px]">{model ? prettyModel(model.id) : "Auto"}</span>
			<span aria-hidden="true" className="shrink-0 text-[10px]">▾</span>
		</button>
		{open && (
			<MenuShell
				anchorRef={triggerRef}
				testid="side-model-menu"
				preferredSide="down"
				menuClass="flex max-h-64 w-[20rem] max-w-[calc(100vw-16px)] flex-col rounded-xl border bg-card p-2 text-xs shadow-xl"
				onClose={() => { close(); return "closed"; }}
			>
				<button
					type="button"
					data-testid="side-model-auto"
					aria-current={model === undefined ? "true" : undefined}
					onClick={() => pick(undefined)}
					className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-card-foreground transition-colors hover:bg-muted"
				>
					<span>Auto (settings)</span>
					{!model && <span aria-hidden="true">✓</span>}
				</button>
				<ModelMenuList
					models={models}
					effectiveId={model?.id}
					effectiveProvider={model?.provider}
					onPick={(entry) => pick({ provider: entry.provider, id: entry.id })}
					footer={catalog && models?.length === 0
						? "No models — add a provider key in Keys"
						: "Applies to the next follow-up in this thread"}
				/>
			</MenuShell>
		)}
	</>;
}
