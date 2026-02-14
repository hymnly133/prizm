/**
 * AppHeader - 应用头部栏
 * 复刻 LobeHub 顶部栏结构：品牌 + 导航
 */
import type { PropsWithChildren, ReactNode } from "react";

interface AppHeaderProps extends PropsWithChildren {
	/** 品牌区域（Logo、标题等） */
	brand?: ReactNode;
	/** 导航区域（按钮组等） */
	nav?: ReactNode;
	/** 自定义高度 */
	height?: number;
}

export function AppHeader({
	children,
	brand,
	nav,
	height = 56,
}: AppHeaderProps) {
	const content = children ?? (
		<div className="app-header-inner">
			{brand && (
				<div
					className="app-brand"
					style={{ display: "flex", alignItems: "center", gap: 10 }}
				>
					{brand}
				</div>
			)}
			{nav && (
				<nav className="app-nav" style={{ display: "flex", gap: 4 }}>
					{nav}
				</nav>
			)}
		</div>
	);

	return (
		<header
			style={{
				height,
				flexShrink: 0,
				background: "var(--ant-color-bg-elevated)",
				borderBottom: "1px solid var(--ant-color-border)",
			}}
		>
			{content}
		</header>
	);
}
