import type { TransientMessage } from "@cli/context/UIStateContext.js";
import { useCallback, useEffect, useRef, useState } from "react";

export const TRANSIENT_MESSAGE_DURATION_MS = 3000;

export function useTransientMessage(
	durationMs = TRANSIENT_MESSAGE_DURATION_MS,
) {
	const [transientMessage, setTransientMessage] =
		useState<TransientMessage | null>(null);
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);

	const clearTransientMessage = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
		setTransientMessage(null);
	}, []);

	const showTransientMessage = useCallback(
		(message: TransientMessage) => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}

			setTransientMessage(message);
			timeoutRef.current = setTimeout(() => {
				timeoutRef.current = null;
				setTransientMessage(null);
			}, durationMs);
		},
		[durationMs],
	);

	useEffect(
		() => () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		},
		[],
	);

	return {
		transientMessage,
		showTransientMessage,
		clearTransientMessage,
	};
}
