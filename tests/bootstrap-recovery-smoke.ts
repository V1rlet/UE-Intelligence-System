// A failed entry module must produce a static recovery surface, never a blank root.
import { BASE, launchBrowser, waitForSelector } from "./browser-smoke-lib.js";

const session = await launchBrowser("about:blank", { reducedMotion: true });
try {
	const { cdp } = session;
	await cdp.send("Network.enable");
	await cdp.send("Network.setBlockedURLs", { urls: ["*src/main.tsx*", "*/assets/main-*.js"] });
	await cdp.send("Page.navigate", { url: BASE });
	await waitForSelector(cdp, '#root > [role="alert"]');
	const recovery = await cdp.evaluate<{ text: string; button: boolean; rootChildren: number }>(`(() => ({
		text: document.querySelector('#root > [role="alert"]')?.textContent ?? '',
		button: Array.from(document.querySelectorAll('#root button')).some((node) => node.textContent.trim() === '重新载入界面'),
		rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
	}))()`);
	if (!recovery.text.includes("界面资源没有完成加载") || !recovery.button || recovery.rootChildren !== 1) {
		throw new Error(`入口模块失败后没有形成可恢复界面：${JSON.stringify(recovery)}`);
	}
	console.log("[bootstrap-recovery] 主入口故障时显示静态恢复界面，不产生白屏");
} finally {
	await session.close();
}
