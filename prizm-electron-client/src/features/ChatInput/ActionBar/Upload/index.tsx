import { ActionIcon, toast } from "@lobehub/ui";
import { Paperclip } from "lucide-react";
import { memo } from "react";

/** 文件上传占位：服务端待实现，点击提示 */
const Upload = memo(() => {
	return (
		<ActionIcon
			icon={Paperclip}
			title="文件上传（开发中）"
			size={{ blockSize: 36, size: 20 }}
			onClick={() => {
				toast.info('文件上传功能开发中，敬请期待')
			}}
		/>
	);
});

Upload.displayName = "Upload";

export default Upload;
