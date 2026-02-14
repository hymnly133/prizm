/**
 * MainLayout - 主布局（水平：侧栏 + 内容区）
 * 复刻 LobeHub DesktopMainLayout 主结构
 */
import { Flexbox } from "@lobehub/ui";
import type { PropsWithChildren } from "react";
import { LayoutContainer } from "./LayoutContainer";

interface MainLayoutProps extends PropsWithChildren {
	/** 左侧侧栏（NavPanel 等） */
	sidebar?: React.ReactNode;
	/** 主内容区是否使用 LayoutContainer 包裹 */
	useLayoutContainer?: boolean;
	/** 自定义高度（如扣除标题栏） */
	height?: string | number;
}

export function MainLayout({
	children,
	sidebar,
	useLayoutContainer = true,
	height = "100%",
}: MainLayoutProps) {
	return (
		<Flexbox
			horizontal
			width="100%"
			height={height}
			style={{
				position: "relative",
				minHeight: 0,
			}}
		>
			{sidebar}
			<Flexbox
				flex={1}
				height="100%"
				style={{
					minWidth: 0,
					minHeight: 0,
					overflow: "hidden",
				}}
			>
				{useLayoutContainer ? (
					<LayoutContainer>{children}</LayoutContainer>
				) : (
					children
				)}
			</Flexbox>
		</Flexbox>
	);
}
