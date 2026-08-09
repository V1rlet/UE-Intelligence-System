// cytoscape-fcose 2.2.0 不带类型声明；布局参数经 LayoutOptions 断言传入，
// 这里只声明扩展注册入口
declare module "cytoscape-fcose" {
	import type { Ext } from "cytoscape";
	const fcose: Ext;
	export default fcose;
}
