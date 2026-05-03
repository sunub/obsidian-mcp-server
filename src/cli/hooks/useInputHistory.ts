import { cpLen } from "@cli/utils/textUtil.js";
import { useCallback, useRef, useState } from "react";
import { debugLogger } from "@/shared/index.js";

interface Logger {
	getPreviousUserMessages(): Promise<string[]>;
}

export interface UseInputHistoryStoreReturn {
	inputHistory: string[];
	addInput: (input: string) => void;
	initializeFromLogger: (logger: Logger | null) => Promise<void>;
}

interface UseInputHistoryProps {
	userMessages: readonly string[];
	onSubmit: (value: string) => void | Promise<void>;
	isActive: boolean;
	currentQuery: string; // Renamed from query to avoid confusion
	currentCursorOffset: number;
	onChange: (value: string, cursorPosition?: "start" | "end" | number) => void;
}

export interface UseInputHistoryReturn {
	handleSubmit: (value: string) => void | Promise<void>;
	navigateUp: () => boolean;
	navigateDown: () => boolean;
}

export function useInputHistory({
	userMessages,
	onSubmit,
	isActive,
	currentQuery,
	currentCursorOffset,
	onChange,
}: UseInputHistoryProps): UseInputHistoryReturn {
	const [historyIndex, setHistoryIndex] = useState<number>(-1);

	// previousHistoryIndexRef tracks the index we occupied *immediately before* the current historyIndex.
	// This allows us to detect when we are "returning" to a level we just left.
	const previousHistoryIndexRef = useRef<number | undefined>(undefined);

	// Cache stores text and cursor offset for each history index level.
	// Level -1 is the current unsubmitted prompt.
	const historyCacheRef = useRef<
		Record<number, { text: string; offset: number }>
	>({});

	const resetHistoryNav = useCallback(() => {
		setHistoryIndex(-1);
		previousHistoryIndexRef.current = undefined;
		historyCacheRef.current = {};
	}, []);

	const handleSubmit = useCallback(
		async (value: string) => {
			const trimmedValue = value.trim();
			if (trimmedValue) {
				await onSubmit(trimmedValue); // Parent handles clearing the query
			}
			resetHistoryNav();
		},
		[onSubmit, resetHistoryNav],
	);

	const navigateTo = useCallback(
		(nextIndex: number, defaultCursor: "start" | "end") => {
			const prevIndexBeforeMove = historyIndex;

			// 1. Save current state to cache before moving
			historyCacheRef.current[prevIndexBeforeMove] = {
				text: currentQuery,
				offset: currentCursorOffset,
			};

			// 2. Update index
			setHistoryIndex(nextIndex);

			// 3. Restore next state
			const saved = historyCacheRef.current[nextIndex];

			// We robustly restore the cursor position IF:
			// 1. We are returning to the compose prompt (-1)
			// 2. OR we are returning to the level we occupied *just before* the current one.
			// AND in both cases, the cursor was not at the very first or last character.
			const isReturningToPrevious =
				nextIndex === -1 || nextIndex === previousHistoryIndexRef.current;

			if (
				isReturningToPrevious &&
				saved &&
				saved.offset > 0 &&
				saved.offset < cpLen(saved.text)
			) {
				onChange(saved.text, saved.offset);
			} else if (nextIndex === -1) {
				onChange(saved ? saved.text : "", defaultCursor);
			} else {
				// For regular history browsing, use default cursor position.
				if (saved) {
					onChange(saved.text, defaultCursor);
				} else {
					const newValue = userMessages[userMessages.length - 1 - nextIndex];
					onChange(newValue, defaultCursor);
				}
			}

			// Record the level we just came from for the next navigation
			previousHistoryIndexRef.current = prevIndexBeforeMove;
		},
		[historyIndex, currentQuery, currentCursorOffset, userMessages, onChange],
	);

	const navigateUp = useCallback(() => {
		if (!isActive) return false;
		if (userMessages.length === 0) return false;

		if (historyIndex < userMessages.length - 1) {
			navigateTo(historyIndex + 1, "start");
			return true;
		}
		return false;
	}, [historyIndex, userMessages, isActive, navigateTo]);

	const navigateDown = useCallback(() => {
		if (!isActive) return false;
		if (historyIndex === -1) return false; // Not currently navigating history

		navigateTo(historyIndex - 1, "end");
		return true;
	}, [historyIndex, isActive, navigateTo]);

	return {
		handleSubmit,
		navigateUp,
		navigateDown,
	};
}

export function useInputHistoryStore(): UseInputHistoryStoreReturn {
	const [inputHistory, setInputHistory] = useState<string[]>([]);
	const [_pastSessionMessages, setPastSessionMessages] = useState<string[]>([]);
	const [_currentSessionMessages, setCurrentSessionMessages] = useState<
		string[]
	>([]);
	const [isInitialized, setIsInitialized] = useState(false);

	/**
	 * Recalculate the complete input history from past and current sessions.
	 * Applies the same deduplication logic as the previous implementation.
	 */
	const recalculateHistory = useCallback(
		(currentSession: string[], pastSession: string[]) => {
			// Combine current session (newest first) + past session (newest first)
			const combinedMessages = [...currentSession, ...pastSession];

			// Deduplicate consecutive identical messages (same algorithm as before)
			const deduplicatedMessages: string[] = [];
			if (combinedMessages.length > 0) {
				deduplicatedMessages.push(combinedMessages[0]); // Add the newest one unconditionally
				for (let i = 1; i < combinedMessages.length; i++) {
					if (combinedMessages[i] !== combinedMessages[i - 1]) {
						deduplicatedMessages.push(combinedMessages[i]);
					}
				}
			}

			// Reverse to oldest first for useInputHistory
			setInputHistory(deduplicatedMessages.reverse());
		},
		[],
	);

	/**
	 * Initialize input history from logger with past session data.
	 * Executed only once at app startup.
	 */
	const initializeFromLogger = useCallback(
		async (logger: Logger | null) => {
			if (isInitialized || !logger) return;

			try {
				const pastMessages = (await logger.getPreviousUserMessages()) || [];
				setPastSessionMessages(pastMessages); // Store as newest first
				recalculateHistory([], pastMessages);
				setIsInitialized(true);
			} catch (error) {
				// Start with empty history even if logger initialization fails
				debugLogger.warn(
					"Failed to initialize input history from logger:",
					error,
				);
				setPastSessionMessages([]);
				recalculateHistory([], []);
				setIsInitialized(true);
			}
		},
		[isInitialized, recalculateHistory],
	);

	/**
	 * Add new input to history.
	 * Recalculates the entire history with deduplication.
	 */
	const addInput = useCallback(
		(input: string) => {
			const trimmedInput = input.trim();
			if (!trimmedInput) return; // Filter empty/whitespace-only inputs

			setCurrentSessionMessages((prevCurrent) => {
				const newCurrentSession = [...prevCurrent, trimmedInput];

				setPastSessionMessages((prevPast) => {
					recalculateHistory(
						newCurrentSession
							.slice()
							.reverse(), // Convert to newest first
						prevPast,
					);
					return prevPast; // No change to past messages
				});

				return newCurrentSession;
			});
		},
		[recalculateHistory],
	);

	return {
		inputHistory,
		addInput,
		initializeFromLogger,
	};
}
