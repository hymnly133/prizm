/**
 * LayoutContainer - 主内容区双层容器
 * 复刻 LobeHub DesktopLayoutContainer：
 * - 外层：padding、背景
 * - 内层：border、圆角、背景
 */
import { Flexbox } from "@lobehub/ui";
import type { CSSProperties, PropsWithChildren } from "react";

interface LayoutContainerProps extends PropsWithChildren {
	/** 自定义外层 padding */
	padding?: number;
	/** 自定义内层圆角 */
	borderRadius?: string;
	/** 自定义内层边框颜色 */
	borderColor?: string;
	/** 自定义类名 */
	className?: string;
	style?: CSSProperties;
}

const outerStyles: CSSProperties = {
	position: "relative",
	overflow: "hidden",
	padding: 8,
	width: "100%",
	height: "100%",
};

const innerStyles = (vars: Record<string, string>): CSSProperties => ({
	position: "relative",
	overflow: "hidden",
	width: "100%",
	height: "100%",
	border: `1px solid ${
		vars["--container-border-color"] ?? "var(--ant-color-border)"
	}`,
	borderRadius: vars["--container-border-radius"] ?? "var(--ant-border-radius)",
	background: "var(--ant-color-bg-container)",
});

export function LayoutContainer({
	children,
	padding = 8,
	borderRadius,
	borderColor,
	className,
	style,
}: LayoutContainerProps) {
	const outerVars: Record<string, string> = {
		"--container-padding-left": `${padding}px`,
		"--container-padding-top": `${padding}px`,
	};
	const innerVars: Record<string, string> = {
		"--container-border-color": borderColor ?? "var(--ant-color-border)",
		"--container-border-radius": borderRadius ?? "var(--ant-border-radius)",
	};

	return (
		<Flexbox
			className={className}
			height="100%"
			style={{ ...outerStyles, padding, ...outerVars, ...style }}
			width="100%"
		>
			<Flexbox height="100%" style={innerStyles(innerVars)} width="100%">
				{children}
			</Flexbox>
		</Flexbox>
	);
}
