/**
 * SidebarLayout - 侧栏三区结构（Header / Body / Footer）
 * 复刻 LobeHub NavPanel SideBarLayout
 */
import React, { type PropsWithChildren, type ReactNode } from "react";

interface SidebarLayoutProps extends PropsWithChildren {
	/** 头部区域 */
	header?: ReactNode;
	/** 主体区域（可滚动） */
	body?: ReactNode;
	/** 底部区域 */
	footer?: ReactNode;
	/** 侧栏宽度 */
	width?: number | string;
	/** 自定义类名 */
	className?: string;
}

const sidebarStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	width: 240,
	flexShrink: 0,
	background: "var(--ant-color-bg-layout)",
	borderRight: "1px solid var(--ant-color-border)",
	overflow: "hidden",
	height: "100%",
};

export function SidebarLayout({
	header,
	body,
	footer,
	width = 240,
	className,
}: SidebarLayoutProps) {
	return (
		<div className={className} style={{ ...sidebarStyle, width }}>
			{header && (
				<div
					style={{
						flexShrink: 0,
						borderBottom: "1px solid var(--ant-color-border-secondary)",
					}}
				>
					{header}
				</div>
			)}
			{body && (
				<div
					style={{
						flex: 1,
						minHeight: 0,
						overflowY: "auto",
					}}
				>
					{body}
				</div>
			)}
			{footer && (
				<div
					style={{
						flexShrink: 0,
						borderTop: "1px solid var(--ant-color-border-secondary)",
					}}
				>
					{footer}
				</div>
			)}
		</div>
	);
}
