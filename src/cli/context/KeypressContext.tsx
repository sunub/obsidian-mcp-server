import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { useStdin } from "ink";
import { MultiMap } from "mnemonist";
import { nonKeyboardEventFilter, emitKeys } from "./KeypressContext.util.js";

export const BACKSLASH_ENTER_TIMEOUT = 5;
export const ESC_TIMEOUT = 50;
export const PASTE_TIMEOUT = 30_000;
export const FAST_RETURN_TIMEOUT = 30;
export enum KeypressPriority {
	Low = -100,
	Normal = 0,
	High = 100,
	Critical = 200,
}

export interface Key {
	name: string;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
	cmd: boolean; // Command/Windows/Super key
	insertable: boolean;
	sequence: string;
}

interface KeypressContextValue {
	subscribe: (
		handler: KeypressHandler,
		priority?: KeypressPriority | boolean,
	) => void;
	unsubscribe: (handler: KeypressHandler) => void;
}

export type KeypressHandler = (key: Key) => boolean | undefined;

/**
 * Buffers "/" keys to see if they are followed return.
 * Will flush the buffer if no data is received for DRAG_COMPLETION_TIMEOUT_MS
 * or when a null key is received.
 */
function bufferBackslashEnter(
	keypressHandler: KeypressHandler,
): KeypressHandler {
	const bufferer = (function* (): Generator<
		boolean | undefined,
		void,
		Key | null
	> {
		while (true) {
			const key = yield undefined;

			if (key == null) {
				continue;
			} else if (key.sequence !== "\\") {
				yield keypressHandler(key);
				continue;
			}

			const timeoutId = setTimeout(
				() => bufferer.next(null),
				BACKSLASH_ENTER_TIMEOUT,
			);
			const nextKey = yield true;
			clearTimeout(timeoutId);

			if (nextKey === null) {
				keypressHandler(key);
			} else if (nextKey.name === "enter") {
				keypressHandler({
					...nextKey,
					shift: true,
					sequence: "\r", // Corrected escaping for newline
				});
			} else {
				keypressHandler(key);
				keypressHandler(nextKey);
			}
		}
	})();

	bufferer.next(); // prime the generator so it starts listening.

	return (key: Key) => {
		return bufferer.next(key).value as boolean | undefined;
	};
}

/**
 * Buffers paste events between paste-start and paste-end sequences.
 * Will flush the buffer if no data is received for PASTE_TIMEOUT ms or
 * when a null key is received.
 */
function bufferPaste(keypressHandler: KeypressHandler): KeypressHandler {
	const bufferer = (function* (): Generator<
		boolean | undefined,
		void,
		Key | null
	> {
		while (true) {
			let key = yield undefined;

			if (key === null) {
				continue;
			} else if (key.name !== "paste-start") {
				yield keypressHandler(key);
				continue;
			}

			let buffer = "";
			while (true) {
				const timeoutId = setTimeout(() => bufferer.next(null), PASTE_TIMEOUT);
				key = yield true;
				clearTimeout(timeoutId);

				if (key === null) {
					// appEvents.emit(AppEvent.PasteTimeout);
					break;
				}

				if (key.name === "paste-end") {
					break;
				}
				buffer += key.sequence;
			}

			if (buffer.length > 0) {
				keypressHandler({
					name: "paste",
					shift: false,
					alt: false,
					ctrl: false,
					cmd: false,
					insertable: true,
					sequence: buffer,
				});
			}
		}
	})();
	bufferer.next(); // prime the generator so it starts listening.

	return (key: Key) => {
		return bufferer.next(key).value as boolean | undefined;
	};
}

/**
 * Turns raw data strings into keypress events sent to the provided handler.
 * Buffers escape sequences until a full sequence is received or
 * until a timeout occurs.
 */
function createDataListener(keypressHandler: KeypressHandler) {
	const parser = emitKeys(keypressHandler);
	parser.next(); // prime the generator so it starts listening.

	let timeoutId: NodeJS.Timeout;
	return (data: string) => {
		clearTimeout(timeoutId);
		for (const char of data) {
			parser.next(char);
		}
		if (data.length !== 0) {
			timeoutId = setTimeout(() => parser.next(""), ESC_TIMEOUT);
		}
	};
}

const KeypressContext = createContext<KeypressContextValue | undefined>(
	undefined,
);

export function KeypressProvider({ children }: { children: React.ReactNode }) {
	const { stdin, setRawMode } = useStdin();
	const subscribersToPriority = useRef<Map<KeypressHandler, number>>(
		new Map(),
	).current;

	const subscribers = useRef(
		new MultiMap<number, KeypressHandler>(Set),
	).current;
	const sortedPriorities = useRef<number[]>([]);

	const subscribe = useCallback(
		(
			handler: KeypressHandler,
			priority: KeypressPriority | boolean = KeypressPriority.Normal,
		) => {
			const p =
				typeof priority === "boolean"
					? priority
						? KeypressPriority.High
						: KeypressPriority.Normal
					: priority;

			subscribersToPriority.set(handler, p);
			const hadPriority = subscribers.has(p);
			subscribers.set(p, handler);

			if (!hadPriority) {
				// Cache sorted priorities only when a new priority level is added
				sortedPriorities.current = Array.from(subscribers.keys()).sort(
					(a, b) => b - a,
				);
			}
		},
		[subscribers, subscribersToPriority],
	);

	const unsubscribe = useCallback(
		(handler: KeypressHandler) => {
			const p = subscribersToPriority.get(handler);
			if (p !== undefined) {
				subscribers.remove(p, handler);
				subscribersToPriority.delete(handler);

				if (!subscribers.has(p)) {
					// Cache sorted priorities only when a priority level is completely removed
					sortedPriorities.current = Array.from(subscribers.keys()).sort(
						(a, b) => b - a,
					);
				}
			}
		},
		[subscribers, subscribersToPriority],
	);

	const broadcast = useCallback(
		(key: Key): boolean => {
			// Use cached sorted priorities to avoid sorting on every keypress
			for (const p of sortedPriorities.current) {
				const set = subscribers.get(p);
				if (!set) continue;

				// Within a priority level, use stack behavior (last subscribed is first to handle)
				const handlers = Array.from(set).reverse();
				for (const handler of handlers) {
					if (handler(key) === true) {
						return true;
					}
				}
			}
			return false;
		},
		[subscribers],
	);

	useEffect(() => {
		const wasRaw = stdin.isRaw;
		if (wasRaw === false) {
			setRawMode(true);
		}

		process.stdin.setEncoding("utf8");

		let processor = nonKeyboardEventFilter(broadcast);
		processor = bufferBackslashEnter(processor);
		processor = bufferPaste(processor);
		const dataListener = createDataListener(processor);

		stdin.on("data", dataListener);
		return () => {
			stdin.removeListener("data", dataListener);
			if (wasRaw === false) {
				setRawMode(false);
			}
		};
	}, [stdin, setRawMode, broadcast]);

	const contextValue = useMemo(
		() => ({ subscribe, unsubscribe }),
		[subscribe, unsubscribe],
	);

	return (
		<KeypressContext.Provider value={contextValue}>
			{children}
		</KeypressContext.Provider>
	);
}

export function useKeypressContext(): KeypressContextValue {
	const context = useContext(KeypressContext);
	if (!context) {
		throw new Error(
			"useKeypressContext must be used within a KeypressProvider",
		);
	}
	return context;
}
