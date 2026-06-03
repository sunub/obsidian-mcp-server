export interface ApiErrorInfo {
	message: string;
	status: number;
}

export class ApiError extends Error {
	status: number;
	constructor(options: ApiErrorInfo) {
		super(options.message);
		this.status = options.status;
		this.name = "ApiError";
	}
}

export class ModelNotFoundError extends Error {
	code: number;
	constructor(message: string, code?: number) {
		super(message);
		this.name = "ModelNotFoundError";
		this.code = code ? code : 404;
	}
}

export function getErrorStatus(error: unknown): number | undefined {
	if (typeof error === "object" && error !== null) {
		if ("status" in error && typeof error.status === "number") {
			return error.status;
		}
		// Check for error.response.status (common in axios errors)
		if (
			"response" in error &&
			typeof (error as { response?: unknown }).response === "object" &&
			(error as { response?: unknown }).response !== null
		) {
			const response =
				// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
				(error as { response: { status?: unknown; headers?: unknown } })
					.response;
			if ("status" in response && typeof response.status === "number") {
				return response.status;
			}
		}
	}
	return undefined;
}

export function getNetworkErrorCode(error: unknown): string | undefined {
	const getCode = (obj: unknown): string | undefined => {
		if (typeof obj !== "object" || obj === null) {
			return undefined;
		}
		if ("code" in obj && typeof (obj as { code: unknown }).code === "string") {
			return (obj as { code: string }).code;
		}
		return undefined;
	};

	const directCode = getCode(error);
	if (directCode) {
		return directCode;
	}

	let current: unknown = error;
	const maxDepth = 5;
	for (let depth = 0; depth < maxDepth; depth++) {
		if (
			typeof current !== "object" ||
			current === null ||
			!("cause" in current)
		) {
			break;
		}
		current = (current as { cause: unknown }).cause;
		const code = getCode(current);
		if (code) {
			return code;
		}
	}

	return undefined;
}
