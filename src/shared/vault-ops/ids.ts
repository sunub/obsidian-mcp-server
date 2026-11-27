import { randomBytes } from "node:crypto";
import type { PlanOp } from "./types.js";

export function makeOpId(type: PlanOp["type"] | "rename", key: string): string {
	return `${type}:${key}`;
}

function timestampedId(): string {
	const stamp = new Date()
		.toISOString()
		.replace(/\.\d+Z$/, "")
		.replace(/[-:]/g, "")
		.replace("T", "-");
	const suffix = randomBytes(5).toString("hex");
	const random = Number.parseInt(suffix, 16)
		.toString(36)
		.padStart(6, "0")
		.slice(0, 6);
	return `${stamp}-${random}`;
}

export function shortOpId(planId: string, index: number): string {
	return `${planId.slice(-4)}-${index + 1}`;
}

export function newPlanId(): string {
	return timestampedId();
}

export function newRunId(): string {
	return timestampedId();
}

export function pathKey(path: string): string {
	return path.normalize("NFC").toLowerCase();
}
