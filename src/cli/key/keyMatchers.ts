import type { Key } from "@cli/hooks/useKeypress.js";
import type { KeyBindingConfig } from "@cli/key/keyBindings.js";
import { Command, defaultKeyBindingConfig } from "@cli/key/keyBindings.js";

function matchCommand(
	command: Command,
	key: Key,
	config: KeyBindingConfig = defaultKeyBindingConfig,
): boolean {
	const bindings = config.get(command);
	if (!bindings) return false;
	return bindings.some((binding) => binding.matches(key));
}

type KeyMatcher = (key: Key) => boolean;

export type KeyMatchers = {
	readonly [C in Command]: KeyMatcher;
};

export function createKeyMatchers(
	config: KeyBindingConfig = defaultKeyBindingConfig,
): KeyMatchers {
	const matchers = {} as { [C in Command]: KeyMatcher };

	for (const command of Object.values(Command)) {
		matchers[command] = (key: Key) => matchCommand(command, key, config);
	}

	return matchers as KeyMatchers;
}

export const defaultKeyMatchers: KeyMatchers = createKeyMatchers(
	defaultKeyBindingConfig,
);

export { Command };
