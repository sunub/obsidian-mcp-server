import React from "react";

export const useStateAndRef = <
	T extends object | null | undefined | number | string | boolean,
>(
	initialValue: T,
) => {
	const [state, setState] = React.useState<T>(initialValue);
	const ref = React.useRef<T>(initialValue);

	const setStateInternal = React.useCallback<typeof setState>(
		(newStateOrCallback) => {
			let newValue: T;
			if (typeof newStateOrCallback === "function") {
				newValue = newStateOrCallback(ref.current);
			} else {
				newValue = newStateOrCallback;
			}
			setState(newValue);
			ref.current = newValue;
		},
		[],
	);

	return [state, ref, setStateInternal] as const;
};
