import fs from "node:fs/promises";
import path from "node:path";
import { connect } from "@lancedb/lancedb";
import state from "../config.js";

/**
 * 인덱싱 스키마 버전.
 * 임베딩 로직(chunking, context generation, embedded text format)이 변경될 때마다
 * 이 값을 올려주면 서버 구동 시 자동으로 전체 재인덱싱이 트리거됩니다.
 */
export const INDEX_VERSION = 2;

export interface ChunkMetadata {
	filePath: string;
	fileName: string;
	chunkIndex: number;
	content: string;
	context?: string;
	[key: string]: unknown;
}

export interface VectorRecord extends ChunkMetadata {
	vector: number[];
}

interface MetaRecord {
	key: string;
	value: string;
	[key: string]: unknown;
}

export class VectorDB {
	private dbPath: string;
	private tableName = "obsidian_chunks";
	private metaTableName = "obsidian_meta";

	constructor() {
		const vaultDotObsidian = path.join(state.vaultPath, ".obsidian");
		this.dbPath = path.join(vaultDotObsidian, "vector_cache");
	}

	private async ensureDir() {
		try {
			await fs.mkdir(this.dbPath, { recursive: true });
		} catch (error) {
			console.error("Error creating vector cache directory:", error);
		}
	}

	async connect() {
		await this.ensureDir();
		return await connect(this.dbPath);
	}

	async getTable() {
		const db = await this.connect();
		const tableNames = await db.tableNames();

		if (!tableNames.includes(this.tableName)) {
			return null;
		}
		return await db.openTable(this.tableName);
	}

	/**
	 * 저장된 인덱스 버전과 임베딩 모델을 확인하여 재인덱싱이 필요한지 판단합니다.
	 * 버전 불일치 시 기존 chunks 테이블을 삭제하고 true를 반환합니다.
	 */
	async checkAndMigrateIfNeeded(): Promise<boolean> {
		const db = await this.connect();
		const tableNames = await db.tableNames();
		const currentEmbedModel = state.ollamaEmbedModel;

		// 메타 테이블이 없으면 → 최초 실행 또는 구버전 DB
		if (!tableNames.includes(this.metaTableName)) {
			// chunks 테이블이 존재하면 구버전이므로 삭제
			if (tableNames.includes(this.tableName)) {
				console.error(
					`[VectorDB] No meta table found but chunks exist — dropping stale index.`,
				);
				await db.dropTable(this.tableName);
			}
			await this.writeMetadata(db);
			return true;
		}

		// 메타 테이블에서 버전과 모델 읽기
		const meta = await this.readMetadata(db);
		const storedVersion = Number.parseInt(meta["index_version"] ?? "0", 10);
		const storedModel = meta["embed_model"] ?? "";

		if (storedVersion !== INDEX_VERSION || storedModel !== currentEmbedModel) {
			console.error(
				`[VectorDB] Index version mismatch (stored: v${storedVersion}/${storedModel}, current: v${INDEX_VERSION}/${currentEmbedModel}) — rebuilding index.`,
			);
			if (tableNames.includes(this.tableName)) {
				await db.dropTable(this.tableName);
			}
			// 메타 테이블도 갱신
			await db.dropTable(this.metaTableName);
			await this.writeMetadata(db);
			return true;
		}

		console.error(
			`[VectorDB] Index is up-to-date (v${INDEX_VERSION}, ${currentEmbedModel}).`,
		);
		return false;
	}

	private async readMetadata(
		db: Awaited<ReturnType<typeof connect>>,
	): Promise<Record<string, string>> {
		try {
			const table = await db.openTable(this.metaTableName);
			const rows = (await table.query().toArray()) as MetaRecord[];
			const result: Record<string, string> = {};
			for (const row of rows) {
				result[row.key] = row.value;
			}
			return result;
		} catch {
			return {};
		}
	}

	private async writeMetadata(
		db: Awaited<ReturnType<typeof connect>>,
	): Promise<void> {
		const records: MetaRecord[] = [
			{ key: "index_version", value: String(INDEX_VERSION) },
			{ key: "embed_model", value: state.ollamaEmbedModel },
		];
		await db.createTable(this.metaTableName, records, { mode: "overwrite" });
	}

	async upsertChunks(records: VectorRecord[]) {
		const db = await this.connect();
		const tableNames = await db.tableNames();

		if (!tableNames.includes(this.tableName)) {
			await db.createTable(this.tableName, records);
		} else {
			const table = await db.openTable(this.tableName);
			// 기존 파일 경로에 대한 데이터 삭제 후 삽입 (덮어쓰기 효과)
			const filePaths = Array.from(new Set(records.map((r) => r.filePath)));
			for (const filePath of filePaths) {
				await table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
			}
			await table.add(records);
		}
	}

	async deleteByFilePath(filePath: string) {
		const table = await this.getTable();
		if (table) {
			await table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
		}
	}

	async hasFile(filePath: string): Promise<boolean> {
		const table = await this.getTable();
		if (!table) return false;

		try {
			const count = await table.countRows(
				`filePath = '${filePath.replace(/'/g, "''")}'`,
			);
			return count > 0;
		} catch {
			return false;
		}
	}

	async search(queryVector: number[], limit = 5) {
		const table = await this.getTable();
		if (!table) return [];

		const results = await table
			.vectorSearch(queryVector)
			.limit(limit)
			.toArray();

		return results as (ChunkMetadata & { _distance: number })[];
	}
}

export const vectorDB = new VectorDB();
