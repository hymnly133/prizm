/**
 * ScopeSidebar - 工作区选择器（仅 scope 选择，无文件列表）
 */
import { Select } from "@lobehub/ui";

interface ScopeSidebarProps {
	scopes: string[];
	scopeDescriptions?: Record<string, { label: string; description: string }>;
	getScopeLabel?: (scopeId: string) => string;
	scopesLoading: boolean;
	currentScope: string;
	onSelect: (scope: string) => void;
}

export default function ScopeSidebar({
	scopes,
	getScopeLabel = (id) => id,
	scopesLoading,
	currentScope,
	onSelect,
}: ScopeSidebarProps) {
	const selectOptions = scopes.map((s) => ({
		value: s,
		label: getScopeLabel(s),
	}));

	return (
		<div className="scope-selector" aria-label="工作区">
			<Select
				value={currentScope}
				disabled={scopesLoading}
				options={selectOptions}
				onChange={(v) => onSelect(v as string)}
				style={{ minWidth: 140 }}
			/>
		</div>
	);
}
