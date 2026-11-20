import {
	makeOpId,
	type Planner,
	type PlanOp,
} from "@shared/vault-ops/index.js";

function hasEmptyAncestor(path: string, emptyFolders: Set<string>): boolean {
	let index = path.lastIndexOf("/");
	while (index !== -1) {
		if (emptyFolders.has(path.slice(0, index))) return true;
		index = path.lastIndexOf("/", index - 1);
	}
	return false;
}

export const planEmptyFolders: Planner = async ({ snapshot }) => {
	const emptyFolders = new Set(snapshot.emptyFolders);
	const outermost = [...emptyFolders]
		.filter((path) => !hasEmptyAncestor(path, emptyFolders))
		.sort();

	const ops: PlanOp[] = outermost.map((path) =>
		path.includes("/")
			? {
					id: makeOpId("removeEmptyFolder", path),
					type: "removeEmptyFolder",
					path,
					tier: "bulk",
					reason: "비어 있는 폴더",
				}
			: {
					id: makeOpId("report", `empty-top:${path}`),
					type: "report",
					paths: [path],
					tier: "report",
					reason: "비어 있는 최상위 폴더",
				},
	);
	return { ops, needsTitle: [] };
};
