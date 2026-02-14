import { ActionIcon } from "@lobehub/ui";
import { Maximize2, Minimize2 } from "lucide-react";
import { memo } from "react";

import { useChatInputStore } from "../store";

const ExpandButton = memo(() => {
	const [expand, setExpand, editor] = useChatInputStore((s) => [
		s.expand,
		s.setExpand,
		s.editor,
	]);
	return (
		<ActionIcon
			className="show-on-hover"
			icon={expand ? Minimize2 : Maximize2}
			size={{ blockSize: 32, size: 16, strokeWidth: 2.3 }}
			title={expand ? "收起" : "展开"}
			style={{ zIndex: 10 }}
			onClick={() => {
				setExpand(!expand);
				editor?.focus();
			}}
		/>
	);
});

ExpandButton.displayName = "ExpandButton";

export default ExpandButton;
