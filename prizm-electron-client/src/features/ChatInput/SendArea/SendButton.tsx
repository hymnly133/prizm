import { SendButton as Send } from "@lobehub/editor/react";
import { memo } from "react";

import { selectors, useChatInputStore } from "../store";

const SendButton = memo(() => {
	const { generating, disabled } = useChatInputStore(selectors.sendButtonProps);
	const shape = useChatInputStore((s) => s.sendButtonProps?.shape);
	const [send, handleStop] = useChatInputStore((s) => [
		s.handleSendButton,
		s.handleStop,
	]);

	return (
		<Send
			disabled={disabled}
			generating={generating}
			placement="topRight"
			shape={shape}
			trigger={["hover"]}
			onClick={() => send()}
			onStop={() => handleStop()}
		/>
	);
});

SendButton.displayName = "SendButton";

export default SendButton;
