import { Flexbox } from "@lobehub/ui";
import { memo } from "react";

import { useChatInputStore } from "../store";
import ExpandButton from "./ExpandButton";
import SendButton from "./SendButton";

const SendArea = memo(() => {
	const allowExpand = useChatInputStore((s) => s.allowExpand);

	return (
		<Flexbox
			horizontal
			align="center"
			gap={6}
			style={{ flexGrow: 0, flexShrink: 0 }}
		>
			{allowExpand && <ExpandButton />}
			<SendButton />
		</Flexbox>
	);
});

SendArea.displayName = "SendArea";

export default SendArea;
