/**
 * SidebarContentLayout - 侧栏 + 内容区布局
 * 复刻 LobeHub DesktopHomeLayout
 */
import { Flexbox } from "@lobehub/ui";
import type { PropsWithChildren, ReactNode } from "react";

interface SidebarContentLayoutProps extends PropsWithChildren {
	/** 左侧侧栏 */
	sidebar: ReactNode;
	/** 主内容区 */
	children: ReactNode;
	/** 侧栏宽度 */
	sidebarWidth?: number | string;
	/** 是否使用深色模式内容区背景 */
	isDark?: boolean;
}

export function SidebarContentLayout({
	sidebar,
	children,
	sidebarWidth = 240,
	isDark = false,
}: SidebarContentLayoutProps) {
	const contentBg = isDark
		? {
				background: `linear-gradient(to bottom, var(--ant-color-bg-container), var(--ant-color-bg-container-secondary, var(--ant-color-bg-container))`,
		  }
		: {
				background:
					"var(--ant-color-bg-container-secondary, var(--ant-color-bg-container))",
		  };

	return (
		<Flexbox
			horizontal
			height="100%"
			width="100%"
			style={{
				position: "absolute",
				inset: 0,
			}}
		>
			<Flexbox
				style={{
					width: sidebarWidth,
					flexShrink: 0,
					background: "var(--ant-color-bg-layout)",
					borderRight: "1px solid var(--ant-color-border)",
					overflow: "hidden",
				}}
			>
				{sidebar}
			</Flexbox>
			<Flexbox
				flex={1}
				height="100%"
				style={{
					minWidth: 0,
					overflow: "hidden",
					...contentBg,
				}}
			>
				{children}
			</Flexbox>
		</Flexbox>
	);
}
