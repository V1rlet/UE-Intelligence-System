(() => {
	const rootId = "root";
	let ready = false;
	let timer = 0;

	const showRecovery = (detail) => {
		const root = document.getElementById(rootId);
		if (ready || !root || root.childElementCount > 0) return;
		const panel = document.createElement("main");
		panel.setAttribute("role", "alert");
		panel.style.cssText = "box-sizing:border-box;max-width:620px;margin:12vh auto;padding:28px;border:1px solid #40506c;border-radius:12px;background:#151b29;color:#e7edf8;font:14px/1.6 system-ui,sans-serif";
		const title = document.createElement("h1");
		title.textContent = "GraphBrain 界面资源没有完成加载";
		title.style.cssText = "margin:0 0 10px;font-size:20px";
		const message = document.createElement("p");
		message.textContent = detail || "服务可能刚刚更新，已保存的代码图与标注不受影响。";
		const action = document.createElement("button");
		action.type = "button";
		action.textContent = "重新载入界面";
		action.style.cssText = "min-height:38px;padding:0 14px;border:1px solid #70c8dc;border-radius:7px;background:#203145;color:#e7edf8;cursor:pointer";
		action.addEventListener("click", () => window.location.reload());
		panel.append(title, message, action);
		root.replaceChildren(panel);
	};

	window.__graphBrainMarkReady = () => {
		const root = document.getElementById(rootId);
		if (!root?.childElementCount) return;
		ready = true;
		window.clearTimeout(timer);
	};
	window.addEventListener("vite:preloadError", (event) => {
		event.preventDefault();
		showRecovery("页面仍引用旧的构建模块，请重新载入以切换到当前版本。");
	});
	window.addEventListener("error", () => window.setTimeout(() => showRecovery(), 0));
	window.addEventListener("unhandledrejection", () => window.setTimeout(() => showRecovery(), 0));
	timer = window.setTimeout(() => showRecovery("界面启动超时，请确认本地服务仍在运行后重新载入。"), 8_000);
})();
