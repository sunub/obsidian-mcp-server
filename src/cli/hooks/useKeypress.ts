import {
	type Key,
	type KeypressHandler,
	type KeypressPriority,
	useKeypressContext,
} from "@cli/context/KeypressContext.js";
import { useEffect } from "react";

export type { Key };

export function useKeypress(
	onKeypress: KeypressHandler,
	{
		isActive,
		priority,
	}: { isActive: boolean; priority?: KeypressPriority | boolean },
) {
	const { subscribe, unsubscribe } = useKeypressContext();

	useEffect(() => {
		if (!isActive) {
			return;
		}

		subscribe(onKeypress, priority);
		return () => {
			unsubscribe(onKeypress);
		};
	}, [isActive, onKeypress, subscribe, unsubscribe, priority]);
}
