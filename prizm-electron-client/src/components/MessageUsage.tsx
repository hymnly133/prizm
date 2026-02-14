/**
 * 消息底部展示：模型名、token 使用量
 * 参照 lobehub Conversation/Messages/components/Extras/Usage
 * 助手消息始终显示此区域，无数据时显示占位
 */
import { Flexbox, Text } from "@lobehub/ui";
import { Coins } from "lucide-react";

interface MessageUsageType {
	totalTokens?: number;
	totalInputTokens?: number;
	totalOutputTokens?: number;
}

interface MessageUsageProps {
	model?: string;
	usage?: MessageUsageType;
}

function formatToken(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export function MessageUsage({ model, usage }: MessageUsageProps) {
	const hasModel = !!model?.trim();
	const hasUsage =
		!!usage?.totalTokens ||
		usage?.totalInputTokens != null ||
		usage?.totalOutputTokens != null;

	return (
		<Flexbox
			horizontal
			align="center"
			gap={8}
			style={{
				fontSize: 12,
				color: "var(--ant-color-text-tertiary)",
				marginTop: 8,
				minHeight: 20,
			}}
		>
			{hasModel ? (
				<Text type="secondary" fontSize={12}>
					{model}
				</Text>
			) : (
				<Text type="secondary" fontSize={12}>
					—
				</Text>
			)}
			<Flexbox horizontal align="center" gap={4}>
				<Coins size={12} />
				{hasUsage ? (
					usage.totalInputTokens != null && usage.totalOutputTokens != null ? (
						<span>
							{formatToken(usage.totalInputTokens)} in /{" "}
							{formatToken(usage.totalOutputTokens)} out
						</span>
					) : (
						<span>
							{formatToken(
								usage?.totalTokens ??
									(usage?.totalInputTokens ?? 0) +
										(usage?.totalOutputTokens ?? 0)
							)}{" "}
							tokens
						</span>
					)
				) : (
					<span>—</span>
				)}
			</Flexbox>
		</Flexbox>
	);
}
