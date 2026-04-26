import { useCallback, useMemo, useRef, useState } from "react";
import type { HistoryItem } from "../types.js";

export enum MessageType {
	INFO = "info",
	ERROR = "error",
	WARNING = "warning",
	USER = "user",
	ABOUT = "about",
	HELP = "help",
	STATS = "stats",
	MODEL_STATS = "model_stats",
	TOOL_STATS = "tool_stats",
	QUIT = "quit",
	GEMINI = "gemini",
	COMPRESSION = "compression",
	EXTENSIONS_LIST = "extensions_list",
	TOOLS_LIST = "tools_list",
	SKILLS_LIST = "skills_list",
	AGENTS_LIST = "agents_list",
	MCP_STATUS = "mcp_status",
	CHAT_LIST = "chat_list",
	HINT = "hint",
}

type HistoryItemUpdater = (
	prevItem: HistoryItem,
) => Partial<Omit<HistoryItem, "id">>;

export function useHistoryManager(initialItems: HistoryItem[] = []) {
	const [history, setHistory] = useState<HistoryItem[]>(initialItems);
	const lastIdRef = useRef(
		initialItems.reduce((max, item) => Math.max(max, item.id), 0),
	);

	const getNextMessageId = useCallback((baseTimestamp: number): number => {
		const nextId = Math.max(baseTimestamp, lastIdRef.current + 1);
		lastIdRef.current = nextId;
		return nextId;
	}, []);

	const clearItems = useCallback(() => {
		setHistory([]);
		lastIdRef.current = 0;
	}, []);

	const addItem = useCallback(
		(itemData: Omit<HistoryItem, "id">, baseTimestamp: number = Date.now()) => {
			const id = getNextMessageId(baseTimestamp);
			const newItem: HistoryItem = { ...itemData, id } as HistoryItem;

			setHistory((prevHistory) => {
				if (prevHistory.length > 0) {
					const lastItem = prevHistory[prevHistory.length - 1];

					if (
						lastItem.type === "user" &&
						newItem.type === "user" &&
						lastItem.content === newItem.content
					) {
						return prevHistory;
					}
				}
				return [...prevHistory, newItem];
			});

			return id; // Return the ID
		},
		[getNextMessageId],
	);

	const updateItem = useCallback(
		(
			id: number,
			updates: Partial<Omit<HistoryItem, "id">> | HistoryItemUpdater,
		) => {
			setHistory((prevHistory) =>
				prevHistory.map((item) => {
					if (item.id === id) {
						const newUpdates =
							typeof updates === "function" ? updates(item) : updates;
						return { ...item, ...newUpdates } as HistoryItem;
					}
					return item;
				}),
			);
		},
		[],
	);

	const removeItem = useCallback((id: number) => {
		setHistory((prevHistory) => prevHistory.filter((item) => item.id !== id));
	}, []);

	const loadHistory = useCallback((newHistory: HistoryItem[]) => {
		setHistory(newHistory);
		const maxId = newHistory.reduce((max, item) => Math.max(max, item.id), 0);
		lastIdRef.current = Math.max(lastIdRef.current, maxId);
	}, []);

	return useMemo(
		() => ({
			history,
			addItem,
			updateItem,
			removeItem,
			clearItems,
			loadHistory,
		}),
		[history, addItem, updateItem, removeItem, clearItems, loadHistory],
	);
}
