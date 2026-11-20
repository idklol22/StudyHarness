/** Plugins use the documented per-server initialization hook. A plugin failure
 * must not prevent access to existing learning data or teaching/practice. */
export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { initializePlugins } = await import("./src/server/plugins.ts");
		try { await initializePlugins(); }
		catch (error) { console.error("[plugins] Initialization failed; plugin management will report the error:", error); }
		const { startCloudAgent } = await import("./src/server/cloud-agent/runner.ts");
		try { startCloudAgent(); }
		catch (error) { console.error("[cloud-agent] Startup failed; local learning is unaffected:", error); }
	}
}
