import { Flexbox } from "@lobehub/ui";
import { memo } from "react";

/** 占位符：从任何想法开始，Enter 发送 / Shift+Enter 换行 */
const Placeholder = memo(() => {
	return (
		<Flexbox horizontal align="center" as="span" gap={4} wrap="wrap">
			从任何想法开始，Enter 发送 / Shift+Enter 换行
		</Flexbox>
	);
});

Placeholder.displayName = "Placeholder";

export default Placeholder;
