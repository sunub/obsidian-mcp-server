import fs from "node:fs/promises";
import path from "node:path";
import type { Connection } from "@lancedb/lancedb";
import { connect, Index } from "@lancedb/lancedb";
import { debugLogger } from "@sunub/core";
import * as arrow from "apache-arrow";
import state from "@/config.js";

export const INDEX_VERSION = 5;

const VECTOR_DIM = 768;

export interface ChunkMetadata {
	id: string;
	filePath: string;
	fileName: string;
	chunkIndex: number;
	content: string;
	context?: string;
	metadata: {
		title: string;
		date: string;
		tags: string;
		summary: string;
		slug: string;
		category: string;
		completed: boolean;
	};
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

interface FileMetaRecord {
	filePath: string;
	mtime: string;
	[key: string]: unknown;
}

const VaultDocumentSchema = new arrow.Schema([
	new arrow.Field("id", new arrow.Utf8()),
	new arrow.Field("filePath", new arrow.Utf8()),
	new arrow.Field("fileName", new arrow.Utf8()),
	new arrow.Field("chunkIndex", new arrow.Int32()),
	new arrow.Field("content", new arrow.Utf8()),
	new arrow.Field("context", new arrow.Utf8(), true),
	new arrow.Field(
		"vector",
		new arrow.FixedSizeList(
			VECTOR_DIM,
			new arrow.Field("item", new arrow.Float32(), true),
		),
	),
	new arrow.Field(
		"metadata",
		new arrow.Struct([
			new arrow.Field("title", new arrow.Utf8()),
			new arrow.Field("date", new arrow.Utf8()),
			new arrow.Field("tags", new arrow.Utf8()),
			new arrow.Field("summary", new arrow.Utf8()),
			new arrow.Field("slug", new arrow.Utf8()),
			new arrow.Field("category", new arrow.Utf8()),
			new arrow.Field("completed", new arrow.Bool()),
		]),
	),
]);

export class VectorDB {
	private dbPath: string;
	private tableName = "obsidian_chunks";
	private metaTableName = "obsidian_meta";
	private fileMetaTableName = "obsidian_file_meta";
	private db: Connection | null = null;

	constructor() {
		if (!state.vaultPath) {
			throw new Error("Vault path is not configured in state.");
		}
		const vaultDotObsidian = path.join(state.vaultPath, ".obsidian");
		this.dbPath = path.join(vaultDotObsidian, "vector_cache");
	}

	private async ensureDir() {
		try {
			await fs.mkdir(this.dbPath, { recursive: true });
		} catch (error) {
			debugLogger.error("Error creating vector cache directory:", error);
		}
	}

	async connect() {
		await this.ensureDir();
		return await connect(this.dbPath);
	}

	private async getDb(): Promise<Connection> {
		if (!this.db) {
			this.db = await this.connect();
		}
		return this.db;
	}

	async getTable() {
		const db = await this.getDb();
		const tableNames = await db.tableNames();

		if (!tableNames.includes(this.tableName)) {
			return null;
		}
		return await db.openTable(this.tableName);
	}

	async checkAndMigrateIfNeeded(): Promise<boolean> {
		const db = await this.connect();
		const tableNames = await db.tableNames();
		const currentEmbedModel = state.llmEmbeddingModel;

		if (!tableNames.includes(this.metaTableName)) {
			const tablesToDrop = [this.tableName, this.fileMetaTableName];
			for (const t of tablesToDrop) {
				if (tableNames.includes(t)) {
					debugLogger.error(
						`[VectorDB] No meta table found but ${t} exists — dropping stale index.`,
					);
					await db.dropTable(t);
				}
			}
			await this.writeMetadata(db);
			this.db = null;
			return true;
		}

		const meta = await this.readMetadata(db);
		const storedVersion = Number.parseInt(
			(meta["index_version"] as string | undefined) ?? "0",
			10,
		);
		const storedModel = (meta["embed_model"] as string | undefined) ?? "";

		if (storedVersion !== INDEX_VERSION || storedModel !== currentEmbedModel) {
			debugLogger.error(
				`[VectorDB] Index version mismatch (stored: v${storedVersion}/${storedModel}, current: v${INDEX_VERSION}/${currentEmbedModel}) — rebuilding index.`,
			);
			const tablesToDrop = [
				this.tableName,
				this.metaTableName,
				this.fileMetaTableName,
			];
			for (const t of tablesToDrop) {
				if (tableNames.includes(t)) {
					await db.dropTable(t);
				}
			}
			await this.writeMetadata(db);
			this.db = null;
			return true;
		}

		debugLogger.info(
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
			{ key: "embed_model", value: state.llmEmbeddingModel },
		];
		await db.createTable(this.metaTableName, records, { mode: "overwrite" });
	}

	async createVectorIndex() {
		const table = await this.getTable();
		if (!table) {
			return;
		}

		const rowCount = await table.countRows();
		if (rowCount < 256) {
			console.error(
				`[VectorDB] Skipping index creation: only ${rowCount} rows (need 256+)`,
			);
			return;
		}

		const numPartitions = Math.max(2, Math.floor(Math.sqrt(rowCount)));
		await table.createIndex("vector", {
			config: Index.ivfPq({
				numPartitions,
				numSubVectors: 96,
				distanceType: "cosine",
			}),
		});

		debugLogger.info(
			`[VectorDB] Created vector index with ${numPartitions} partitions for ${rowCount} rows.`,
		);
	}

	async upsertChunks(records: VectorRecord[]) {
		if (!this.db) {
			this.db = await this.connect();
		}
		const tableNames = await this.db.tableNames();

		if (!tableNames.includes(this.tableName)) {
			try {
				await this.db.createEmptyTable(this.tableName, VaultDocumentSchema, {
					existOk: true,
				});
			} catch (err) {
				// 이미 생성된 경우 무시
				debugLogger.debug(`[VectorDB] Table ${this.tableName} already exists or creation failed:`, err);
			}
		}

		const table = await this.db.openTable(this.tableName);
		const filePaths = Array.from(new Set(records.map((r) => r.filePath)));

		const inClause = filePaths
			.map((fp) => `'${fp.replace(/'/g, "''")}'`)
			.join(", ");
		await table.delete(`filePath IN (${inClause})`);
		await table.add(records);
	}

	async updateFileMeta(filePath: string, mtime: string) {
		if (!this.db) {
			this.db = await this.connect();
		}
		const tableNames = await this.db.tableNames();

		if (!tableNames.includes(this.fileMetaTableName)) {
			try {
				await this.db.createTable(this.fileMetaTableName, [{ filePath, mtime }], {
					existOk: true,
				});
				return;
			} catch (err) {
				debugLogger.debug(`[VectorDB] Table ${this.fileMetaTableName} already exists:`, err);
			}
		}

		const table = await this.db.openTable(this.fileMetaTableName);
		await table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
		await table.add([{ filePath, mtime }]);
	}

	async updateFileMetaBatch(entries: { filePath: string; mtime: string }[]) {
		if (entries.length === 0) return;
		if (!this.db) {
			this.db = await this.connect();
		}
		const tableNames = await this.db.tableNames();

		if (!tableNames.includes(this.fileMetaTableName)) {
			try {
				await this.db.createTable(this.fileMetaTableName, entries, {
					existOk: true,
				});
				return;
			} catch (err) {
				debugLogger.debug(`[VectorDB] Table ${this.fileMetaTableName} already exists:`, err);
			}
		}

		const table = await this.db.openTable(this.fileMetaTableName);
		const inClause = entries
			.map((e) => `'${e.filePath.replace(/'/g, "''")}'`)
			.join(", ");
		await table.delete(`filePath IN (${inClause})`);
		await table.add(entries);
	}

	async getFileMtime(filePath: string): Promise<string | null> {
		if (!this.db) {
			this.db = await this.connect();
		}
		const tableNames = await this.db.tableNames();
		if (!tableNames.includes(this.fileMetaTableName)) return null;

		const table = await this.db.openTable(this.fileMetaTableName);
		const rows = (await table
			.query()
			.where(`filePath = '${filePath.replace(/'/g, "''")}'`)
			.toArray()) as FileMetaRecord[];

		return rows.length > 0 ? rows[0].mtime : null;
	}

	async deleteByFilePath(filePath: string) {
		const table = await this.getTable();
		if (table) {
			await table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
		}
		if (!this.db) {
			this.db = await this.connect();
		}
		if ((await this.db.tableNames()).includes(this.fileMetaTableName)) {
			const fileMetaTable = await this.db.openTable(this.fileMetaTableName);
			await fileMetaTable.delete(
				`filePath = '${filePath.replace(/'/g, "''")}'`,
			);
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
			.distanceType("cosine")
			.nprobes(20)
			.refineFactor(1)
			.limit(limit)
			.toArray();

		return results as (ChunkMetadata & {
			_distance: number;
			vector: number[];
		})[];
	}
}

export const vectorDB = new VectorDB();
