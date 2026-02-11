/**
 * useDebounce - 防抖 Hook
 */
import { useState, useEffect } from "react";

export function useDebounce<T>(value: T, delay: number): T {
	const [debouncedValue, setDebouncedValue] = useState<T>(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedValue(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debouncedValue;
}

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
