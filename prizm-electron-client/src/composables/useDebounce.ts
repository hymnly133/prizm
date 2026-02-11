/**
 * useDebounce - 防抖 composable
 * 参考 frontend-patterns 中的 Debounce Hook 模式
 */
import { ref, watch, type Ref } from "vue";

export function useDebounce<T>(value: Ref<T>, delay: number): Ref<T> {
	const debounced = ref(value.value) as Ref<T>;

	watch(
		value,
		(newVal) => {
			const timer = setTimeout(() => {
				debounced.value = newVal;
			}, delay);
			return () => clearTimeout(timer);
		},
		{ immediate: true }
	);

	return debounced;
}

/**
 * 创建防抖的 setter，用于输入框等场景
 */
export function useDebounceFn<T>(fn: (value: T) => void, delay: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;

	return (value: T) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			fn(value);
			timer = null;
		}, delay);
	};
}
