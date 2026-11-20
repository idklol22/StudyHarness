/** The chat side panel's open items: a pure reducer plus sessionStorage (de)serialisation. */
export type PanelKind = "pdf" | "note" | "figure" | "files";
export interface PanelItem {
	kind: PanelKind;
	/** materialId for pdf/note, snapshotId for figure, "files" for the picker. */
	id: string;
	title: string;
	subjectId?: string;
	page?: number;
	/** Bumped on every open so a re-open at a new page scrolls an already-open reader. */
	nonce?: number;
	caption?: string;
	/** Figures: the lecture file the crop came from (for "Open page"). */
	materialId?: string;
}
export interface PanelState { items: PanelItem[]; activeKey: string | null }
export type PanelAction =
	| { type: "open"; item: PanelItem }
	| { type: "close"; key: string }
	| { type: "focus"; key: string }
	| { type: "clear" };

export const emptyPanel: PanelState = { items: [], activeKey: null };
export const itemKey = (item: Pick<PanelItem, "kind" | "id">) => `${item.kind}:${item.id}`;

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
	switch (action.type) {
		case "open": {
			const key = itemKey(action.item);
			const existing = state.items.find((i) => itemKey(i) === key);
			if (!existing) return { items: [...state.items, { ...action.item, nonce: 1 }], activeKey: key };
			const merged = { ...existing, ...action.item, page: action.item.page ?? existing.page, nonce: (existing.nonce ?? 0) + 1 };
			return { items: state.items.map((i) => itemKey(i) === key ? merged : i), activeKey: key };
		}
		case "close": {
			const index = state.items.findIndex((i) => itemKey(i) === action.key);
			if (index < 0) return state;
			const items = state.items.filter((_, n) => n !== index);
			if (state.activeKey !== action.key) return { items, activeKey: state.activeKey };
			const next = items[Math.min(index, items.length - 1)];
			return { items, activeKey: next ? itemKey(next) : null };
		}
		case "focus":
			return state.items.some((i) => itemKey(i) === action.key) && state.activeKey !== action.key ? { ...state, activeKey: action.key } : state;
		case "clear":
			return emptyPanel;
	}
}

const storageKey = (chatId: string) => `lh.panel.items.${chatId}`;
export const serializePanel = (state: PanelState): string => JSON.stringify(state);
export function parsePanel(raw: string | null | undefined): PanelState {
	try {
		const v = JSON.parse(raw ?? "") as Partial<PanelState>;
		const items = (Array.isArray(v.items) ? v.items : []).filter((i): i is PanelItem =>
			!!i && ["pdf", "note", "figure", "files"].includes(i.kind) && typeof i.id === "string" && typeof i.title === "string");
		const last = items[items.length - 1];
		const activeKey = typeof v.activeKey === "string" && items.some((i) => itemKey(i) === v.activeKey) ? v.activeKey : last ? itemKey(last) : null;
		return { items, activeKey };
	} catch { return emptyPanel; }
}
export function loadPanel(chatId: string): PanelState {
	try { return parsePanel(window.sessionStorage.getItem(storageKey(chatId))); } catch { return emptyPanel; }
}
export function savePanel(chatId: string, state: PanelState): void {
	try {
		if (state.items.length) window.sessionStorage.setItem(storageKey(chatId), serializePanel(state));
		else window.sessionStorage.removeItem(storageKey(chatId));
	} catch { /* best effort */ }
}

export const PANEL_WIDTH_KEY = "lh.panel.width";
/** The panel's share of the chat surface, kept so chat stays >= minChat px and the panel >= minPanel px. */
export function clampPanelFraction(f: number, total: number, minChat = 420, minPanel = 320): number {
	if (!Number.isFinite(f)) return 0.5;
	const t = Math.max(total, 1);
	const lo = Math.min(0.8, minPanel / t);
	const hi = Math.max(lo, 1 - minChat / t);
	return Math.min(hi, Math.max(lo, f));
}
