import { render } from "ink";
import { AppContainer } from "./AppContainer.js";
import "dotenv/config";

async function start() {
	const { waitUntilExit } = render(<AppContainer />);
	await waitUntilExit();
}

start();
