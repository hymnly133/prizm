import { ActionIcon } from "@lobehub/ui";
import { Eraser } from "lucide-react";
import { memo } from "react";

interface ClearProps {
	onClear?: () => void | Promise<void>;
}

/** 清空当前会话 */
const Clear = memo<ClearProps>(({ onClear }) => {
	if (!onClear) return null;

	return (
		<ActionIcon
			icon={Eraser}
			title="清空对话"
			size={{ blockSize: 36, size: 20 }}
			onClick={() => onClear()}
		/>
	);
});

Clear.displayName = "Clear";

export default Clear;
