import { ActionIcon } from "@lobehub/ui";
import { Paperclip } from "lucide-react";
import { memo } from "react";

/** 文件上传占位：服务端待实现，点击提示 */
const Upload = memo(() => {
	return (
		<ActionIcon
			icon={Paperclip}
			title="文件上传（服务端待实现）"
			size={{ blockSize: 36, size: 20 }}
			onClick={() => {
				// TODO: 服务端实现后接入
				// eslint-disable-next-line no-console
				console.info(
					"[ChatInput] 文件上传：服务端待实现，参见 docs/CHATINPUT_SERVER_TODO.md"
				);
			}}
		/>
	);
});

Upload.displayName = "Upload";

export default Upload;
