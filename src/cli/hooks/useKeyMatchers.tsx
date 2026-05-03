import { defaultKeyMatchers, type KeyMatchers } from "@cli/key/keyMatchers.js";
import type React from "react";
import { createContext, useContext } from "react";

export const KeyMatchersContext =
	createContext<KeyMatchers>(defaultKeyMatchers);

export const KeyMatchersProvider = ({
	children,
	value,
}: {
	children: React.ReactNode;
	value: KeyMatchers;
}): React.JSX.Element => (
	<KeyMatchersContext.Provider value={value}>
		{children}
	</KeyMatchersContext.Provider>
);

export function useKeyMatchers(): KeyMatchers {
	return useContext(KeyMatchersContext);
}
