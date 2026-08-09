import type { SVGProps } from "react";

export type AppIconName =
	| "home"
	| "graph"
	| "api"
	| "history"
	| "command"
	| "keyboard"
	| "arrow"
	| "compass"
	| "sync"
	| "search"
	| "plan"
	| "review"
	| "library"
	| "report"
	| "spark"
	| "add"
	| "link"
	| "edit"
	| "trash"
	| "check"
	| "location"
	| "route"
	| "undo"
	| "redo"
	| "save"
	| "collapse"
	| "back"
	| "help"
	| "warning";

interface Props extends Omit<SVGProps<SVGSVGElement>, "name"> {
	name: AppIconName;
	size?: number;
}

/**
 * Graph Brain 的轻量线性图标集。
 *
 * 不依赖系统 Emoji，避免 Windows/Chrome 间字形、色彩与基线漂移；所有图标继承
 * currentColor，因此导航、领域态和危险态只由设计令牌控制。
 */
export default function AppIcon({ name, size = 18, ...props }: Props) {
	const common = {
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.7,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
	};

	return (
		<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...props}>
			{name === "home" ? (
				<>
					<path {...common} d="M4.2 12 12 4.2 19.8 12 12 19.8 4.2 12Z" />
					<circle {...common} cx="12" cy="12" r="2.4" />
					<path {...common} d="M12 2.7v1.5M21.3 12h-1.5M12 21.3v-1.5M2.7 12h1.5" />
				</>
			) : null}
			{name === "warning" ? (
				<>
					<path {...common} d="M12 3.2 21 19H3L12 3.2Z" />
					<path {...common} d="M12 8v5.2M12 16.6h.01" />
				</>
			) : null}
			{name === "graph" ? (
				<>
					<path {...common} d="m7.1 7.3 3.2 3.1M13.7 10.1l3-3M13.7 13.6l3.1 3M7.1 16.8l3.2-3.1" />
					<circle {...common} cx="5.3" cy="5.6" r="2.2" />
					<circle {...common} cx="12" cy="12" r="2.6" />
					<circle {...common} cx="18.7" cy="5.4" r="2.2" />
					<circle {...common} cx="18.7" cy="18.6" r="2.2" />
					<circle {...common} cx="5.3" cy="18.6" r="2.2" />
				</>
			) : null}
			{name === "api" ? (
				<>
					<path {...common} d="m8 5-4.5 7L8 19M16 5l4.5 7L16 19M14 3.5 10 20.5" />
				</>
			) : null}
			{name === "history" ? (
				<>
					<path {...common} d="M4.3 8.2A8.2 8.2 0 1 1 4 15.1M4.3 8.2V3.8M4.3 8.2h4.4" />
					<path {...common} d="M12 7.6v4.8l3.2 2" />
				</>
			) : null}
			{name === "command" ? (
				<>
					<path {...common} d="M9 7.2H6.7a2.7 2.7 0 1 1 2.7-2.7V19.5a2.7 2.7 0 1 1-2.7-2.7H17.3a2.7 2.7 0 1 1-2.7 2.7V4.5a2.7 2.7 0 1 1 2.7 2.7H9Z" />
			</>
			) : null}
			{name === "keyboard" ? (
				<>
					<rect {...common} x="3" y="6" width="18" height="12" rx="2.4" />
					<path {...common} d="M6.5 10h.01M10.2 10h.01M13.8 10h.01M17.5 10h.01M6.5 13.7h.01M10.2 13.7h7.3" />
				</>
			) : null}
			{name === "arrow" ? <path {...common} d="M5 12h14M14 7l5 5-5 5" /> : null}
			{name === "compass" ? (
				<>
					<circle {...common} cx="12" cy="12" r="8.5" />
					<path {...common} d="m15.7 8.3-2.1 5.3-5.3 2.1 2.1-5.3 5.3-2.1Z" />
				</>
			) : null}
			{name === "sync" ? (
				<>
					<path {...common} d="M19.4 8.2A8 8 0 0 0 6 5.5L4.2 7.3M4.6 15.8A8 8 0 0 0 18 18.5l1.8-1.8" />
					<path {...common} d="M4.2 3.8v3.5h3.5M19.8 20.2v-3.5h-3.5" />
				</>
			) : null}
			{name === "search" ? (
				<>
					<circle {...common} cx="10.5" cy="10.5" r="6.2" />
					<path {...common} d="m15.2 15.2 4.3 4.3" />
				</>
			) : null}
			{name === "plan" ? (
				<>
					<rect {...common} x="4" y="4" width="16" height="16" rx="2.4" />
					<path {...common} d="M8 9h8M8 13h5M8 17h3" />
					<path {...common} d="m15.3 16.8 1.3 1.3 2.7-3" />
				</>
			) : null}
			{name === "review" ? (
				<>
					<path {...common} d="M12 3.5 19 6v5.4c0 4.2-2.8 7.3-7 9.1-4.2-1.8-7-4.9-7-9.1V6l7-2.5Z" />
					<path {...common} d="m8.8 12 2 2 4.4-4.6" />
				</>
			) : null}
			{name === "library" ? (
				<>
					<path {...common} d="M4.5 5.2h4.2v13.6H4.5zM9.8 5.2H14v13.6H9.8zM15.1 4l4.1-1 3.3 13.2-4.1 1z" />
				</>
			) : null}
			{name === "report" ? (
				<>
					<path {...common} d="M6 3.5h9l3 3V20H6zM15 3.5V7h3" />
					<path {...common} d="M9 16v-3M12 16V9M15 16v-5" />
				</>
			) : null}
			{name === "spark" ? (
				<>
					<path {...common} d="M12 2.8c.5 4.7 2.5 6.7 7.2 7.2-4.7.5-6.7 2.5-7.2 7.2-.5-4.7-2.5-6.7-7.2-7.2C9.5 9.5 11.5 7.5 12 2.8Z" />
					<path {...common} d="M19 16.5c.2 2 1 2.8 3 3-2 .2-2.8 1-3 3-.2-2-1-2.8-3-3 2-.2 2.8-1 3-3Z" />
				</>
			) : null}
			{name === "add" ? (
				<>
					<circle {...common} cx="12" cy="12" r="8.5" />
					<path {...common} d="M12 8v8M8 12h8" />
				</>
			) : null}
			{name === "link" ? (
				<>
					<path {...common} d="m9.5 14.5-1.6 1.6a3.2 3.2 0 0 1-4.5-4.5l3.2-3.2a3.2 3.2 0 0 1 4.5 0" />
					<path {...common} d="m14.5 9.5 1.6-1.6a3.2 3.2 0 1 1 4.5 4.5l-3.2 3.2a3.2 3.2 0 0 1-4.5 0M8.5 15.5l7-7" />
				</>
			) : null}
			{name === "edit" ? (
				<>
					<path {...common} d="M13.8 5.2 18.8 10.2 9 20H4v-5L13.8 5.2Z" />
					<path {...common} d="m12.2 6.8 5 5M4 20h16" />
				</>
			) : null}
			{name === "trash" ? (
				<>
					<path {...common} d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
				</>
			) : null}
			{name === "check" ? (
				<>
					<circle {...common} cx="12" cy="12" r="8.5" />
					<path {...common} d="m8 12.2 2.6 2.6 5.7-6" />
				</>
			) : null}
			{name === "location" ? (
				<>
					<path {...common} d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" />
					<circle {...common} cx="12" cy="10" r="2.2" />
				</>
			) : null}
			{name === "route" ? (
				<>
					<circle {...common} cx="5" cy="17.5" r="2.2" />
					<circle {...common} cx="19" cy="6.5" r="2.2" />
					<path {...common} d="M7.2 17.5h2.3a2.8 2.8 0 0 0 2.8-2.8v-5.4a2.8 2.8 0 0 1 2.8-2.8h1.7" />
				</>
			) : null}
			{name === "undo" ? (
				<>
					<path {...common} d="M8.3 7.2H16a5 5 0 0 1 0 10h-5" />
					<path {...common} d="m8.3 3.8-4 3.4 4 3.4" />
				</>
			) : null}
			{name === "redo" ? (
				<>
					<path {...common} d="M15.7 7.2H8a5 5 0 0 0 0 10h5" />
					<path {...common} d="m15.7 3.8 4 3.4-4 3.4" />
				</>
			) : null}
			{name === "save" ? (
				<>
					<path {...common} d="M5 3.8h12.3L20 6.5v13.7H5z" />
					<path {...common} d="M8 3.8v5h8v-5M8.2 20.2v-7.4h7.6v7.4" />
				</>
			) : null}
			{name === "collapse" ? (
				<>
					<path {...common} d="M5 7h14M7.5 11.5 12 16l4.5-4.5" />
				</>
			) : null}
			{name === "back" ? (
				<>
					<path {...common} d="M20 12H5M10 7l-5 5 5 5" />
				</>
			) : null}
			{name === "help" ? (
				<>
					<circle {...common} cx="12" cy="12" r="8.5" />
					<path {...common} d="M9.6 9.2a2.6 2.6 0 1 1 3.4 2.5c-.8.3-1 .9-1 1.7M12 16.7h.01" />
				</>
			) : null}
		</svg>
	);
}
