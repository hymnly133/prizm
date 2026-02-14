/**
 * BottomNavBar - 底部 Tab 导航栏
 * 复刻 LobeHub 移动端 NavBar 样式
 */
import { Flexbox, Icon } from "@lobehub/ui";
import type { LucideIcon } from "lucide-react";
import { memo } from "react";

export interface NavBarItem {
	key: string;
	title: string;
	icon: LucideIcon;
	onClick: () => void;
}

interface BottomNavBarProps {
	items: NavBarItem[];
	activeKey: string;
	height?: number;
}

const NAV_BAR_HEIGHT = 56;

export const BottomNavBar = memo(function BottomNavBar({
	items,
	activeKey,
	height = NAV_BAR_HEIGHT,
}: BottomNavBarProps) {
	return (
		<Flexbox
			horizontal
			align="center"
			justify="space-around"
			style={{
				position: "fixed",
				zIndex: 100,
				bottom: 0,
				left: 0,
				right: 0,
				height,
				background: "var(--ant-color-bg-elevated)",
				borderTop: "1px solid var(--ant-color-border)",
				boxShadow: "0 -2px 8px rgba(0,0,0,0.06)",
			}}
		>
			{items.map((item) => {
				const isActive = activeKey === item.key;
				return (
					<button
						key={item.key}
						type="button"
						onClick={item.onClick}
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							gap: 4,
							padding: "8px 16px",
							background: "none",
							border: "none",
							cursor: "pointer",
							color: isActive
								? "var(--ant-color-primary)"
								: "var(--ant-color-text-secondary)",
							fontSize: 11,
						}}
					>
						<Icon
							icon={item.icon}
							size={22}
							style={
								isActive
									? {
											fill: "color-mix(in srgb, var(--ant-color-primary) 33%, transparent)",
									  }
									: undefined
							}
						/>
						<span>{item.title}</span>
					</button>
				);
			})}
		</Flexbox>
	);
});
