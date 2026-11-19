"use client";

/**
 * Compatibility re-export: the sidebar's library hook now lives with the dedicated Subjects
 * panel (`subject-panel.tsx`). This path is kept because the graph view imports `useLibrary`
 * from here; no tree UI remains — subjects and topics are rendered by the panel.
 */
export { useLibrary } from "./subject-panel";
