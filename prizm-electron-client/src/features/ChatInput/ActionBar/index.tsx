import { Flexbox } from "@lobehub/ui";
import { memo } from "react";

import type { ActionKeys } from "./config";
import Clear from "./Clear";
import Upload from "./Upload";
import ThinkingToggle from "./ThinkingToggle";
import ToolCompactToggle from "./ToolCompactToggle";
import SkillsToggle from "./SkillsToggle";

interface ActionBarProps {
	leftActions?: ActionKeys[];
	onClear?: () => void | Promise<void>;
}

const actionMap: Record<
	string,
	React.ComponentType<{ onClear?: () => void | Promise<void> }>
> = {
	fileUpload: Upload,
	clear: Clear,
	thinking: ThinkingToggle,
	toolCompact: ToolCompactToggle,
	skills: SkillsToggle,
};

const ActionBar = memo<ActionBarProps>(({ leftActions = [], onClear }) => {
	const flatActions = Array.isArray(leftActions)
		? (leftActions
				.flat()
				.filter((k) => typeof k === "string" && k !== "---") as string[])
		: [];

	return (
		<Flexbox horizontal align="center" gap={4}>
			{flatActions.map((key) => {
				const Comp = actionMap[key];
				if (!Comp) return null;
				return <Comp key={key} onClear={onClear} />;
			})}
		</Flexbox>
	);
});

ActionBar.displayName = "ActionBar";

export default ActionBar;
