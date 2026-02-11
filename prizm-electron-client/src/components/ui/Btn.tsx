import type { ReactNode } from "react";

interface BtnProps {
	variant?: "primary" | "secondary" | "danger" | "ghost";
	size?: "default" | "sm";
	type?: "button" | "submit";
	disabled?: boolean;
	onClick?: (e: React.MouseEvent) => void;
	children?: ReactNode;
}

export default function Btn({
	variant = "primary",
	size = "default",
	type = "button",
	disabled = false,
	onClick,
	children,
}: BtnProps) {
	return (
		<button
			type={type}
			disabled={disabled}
			className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""}`}
			onClick={onClick}
		>
			{children}
		</button>
	);
}
