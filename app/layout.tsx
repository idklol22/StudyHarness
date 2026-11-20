import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Kalam } from "next/font/google";
import { connection } from "next/server";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { PluginsProvider } from "@/components/plugins";
import { ThemeScene } from "@/components/theme-scene";
import { effectiveTune } from "@/src/core";
import { readThemeBoot } from "@/src/server";

// IBM Plex Sans for the whole interface, prose and titles; Plex Mono only for code (owner 2026-11-19).
const ui = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });
const prose = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });
// Handwriting for the Study notes pages (components/study/notes-view.tsx).
const hand = Kalam({ subsets: ["latin"], weight: ["300", "400", "700"], variable: "--font-hand" });

export const metadata: Metadata = {
	title: "Learning Harness",
	description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	// The theme is server-rendered — its class AND its color variables —
	// so no first frame ever shows the wrong theme. connection(): the
	// record and the theme files are per-machine disk state — without it a
	// prerendered route (settings) would bake the BUILD machine's record.
	await connection();
	const { appearance, theme, vars } = readThemeBoot();
	const tune = effectiveTune(theme, appearance?.glassEffects);
	return (
		<html
			lang="en"
			className={`${theme.mode} ${ui.variable} ${prose.variable} ${hand.variable}`}
			style={vars as React.CSSProperties}
			data-theme={theme.id}
			data-scene={tune.scene}
			data-glass={tune.glass ? "1" : "0"}
			suppressHydrationWarning
		>
			<body className="min-h-dvh antialiased">
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<PluginsProvider>
					<AppearanceProvider initialAppearance={appearance} initialTheme={theme}>
						<ThemeScene />
						<SidebarProvider>
							<ActivityProvider>
								<AppShell>{children}</AppShell>
							</ActivityProvider>
						</SidebarProvider>
					</AppearanceProvider>
				</PluginsProvider>
			</ServerEventsProvider>
			{/* Auto-update banner (Wave C): fixed card, Electron-only pushes. */}
			<UpdateBanner />
		</body>
		</html>
	);
}
