import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../fixtures/messy-vault",
);
const EXPECTED_FILE = path.join(FIXTURE_DIR, "EXPECTED.md");
const SESSION_NOTE = "스터디/세션.md";

const created: string[] = [];

function isSessionNote(fixtureRelative: string): boolean {
	return fixtureRelative.normalize("NFC") === SESSION_NOTE;
}

export async function copyFixture(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "messy-vault-"));
	created.push(root);
	await fs.cp(FIXTURE_DIR, root, {
		recursive: true,
		filter: (source) => {
			if (source === EXPECTED_FILE) return false;
			return !isSessionNote(path.relative(FIXTURE_DIR, source));
		},
	});
	const sessionDir = path.dirname(SESSION_NOTE);
	const sessionName = (
		await fs.readdir(path.join(FIXTURE_DIR, sessionDir))
	).find((name) => name.normalize("NFC") === path.basename(SESSION_NOTE));
	if (!sessionName) throw new Error(`fixture note missing: ${SESSION_NOTE}`);
	await fs.copyFile(
		path.join(FIXTURE_DIR, sessionDir, sessionName),
		path.join(root, sessionDir, path.basename(SESSION_NOTE).normalize("NFD")),
	);
	return root;
}

export async function cleanupFixtures(): Promise<void> {
	const roots = created.splice(0);
	await Promise.all(
		roots.map((root) => fs.rm(root, { recursive: true, force: true })),
	);
}
