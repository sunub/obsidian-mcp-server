import fs from "node:fs/promises";
import path from "node:path";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import ora, { type Ora } from "ora";
import { DirectoryWalker } from "./DirectoryWalker.js";
import { llmClient } from "./LLMClient.js";
import { parse as parseMatter } from "./processor/MatterParser.js";
import { Semaphore } from "./semaphore.js";
import { type VectorRecord, vectorDB } from "./VectorDB.js";
import { encodingForModel } from "js-tiktoken";

export class RAGIndexer {
  private splitter: RecursiveCharacterTextSplitter;
  private llmSemaphore: Semaphore;
  private ioSemaphore: Semaphore;
  private spinner: Ora | null = null;
  private totalFiles = 0;
  private processedFiles = 0;
  private enc = encodingForModel("gpt-3.5-turbo");

  constructor() {
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
      lengthFunction: (text: string) => {
        return this.enc.encode(text).length;
      },
    });

    this.llmSemaphore = new Semaphore(3);
    this.ioSemaphore = new Semaphore(10);
  }

  public setSpinner(total: number) {
    this.totalFiles = total;
    this.processedFiles = 0;
    this.spinner = ora({
      text: `Initializing RAG indexing (0/${total})...`,
      stream: process.stderr,
    }).start();
  }

  private updateProgress(filePath: string) {
    this.processedFiles++;
    if (this.spinner) {
      this.spinner.text = `[${this.processedFiles}/${this.totalFiles}] Indexing: ${path.basename(filePath)}`;
    }
    if (this.processedFiles >= this.totalFiles && this.spinner) {
      this.spinner.succeed(`Successfully indexed ${this.totalFiles} files.`);
      this.spinner = null;
    }
  }

  private async buildFileRecords(
    filePath: string,
    content?: string,
  ): Promise<{ records: VectorRecord[]; mtime: string }> {
    const fileStat = await fs.stat(filePath);
    const fileContent = content ?? (await fs.readFile(filePath, "utf-8"));
    const { frontmatter, content: body } = parseMatter(
      filePath,
      fileStat.birthtime.toISOString(),
      fileContent,
    );
    const fileName = path.basename(filePath);
    const safeSummary = frontmatter.summary
      ? frontmatter.summary.slice(0, 80)
      : "";

    const chunks = await this.splitter.splitText(body);
    const records: VectorRecord[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      await this.llmSemaphore.acquire();
      try {
        const metadataPrefix = [
          frontmatter.title || fileName,
          frontmatter.tags?.length
            ? `Tags: ${frontmatter.tags.slice(0, 3).join(", ")}`
            : "",
          safeSummary,
        ]
          .filter(Boolean)
          .join("\n");

        const context = await llmClient.generateContext(body, chunk);
        const textToEmbed = [metadataPrefix, context, chunk]
          .filter(Boolean)
          .join("\n\n");
        const vector = await llmClient.generateEmbedding(
          `search_document: ${textToEmbed}`,
        );

        records.push({
          id: `${filePath}_chunk_${i}`,
          filePath,
          fileName,
          chunkIndex: i,
          content: chunk,
          context,
          vector,
          metadata: {
            title: frontmatter.title || fileName,
            date:
              frontmatter.date instanceof Date
                ? frontmatter.date.toISOString()
                : frontmatter.date || fileStat.birthtime.toISOString(),
            tags: frontmatter.tags?.join(", ") ?? "",
            summary: frontmatter.summary || "",
            slug: frontmatter.slug || "",
            category: frontmatter.category || "any",
            completed: frontmatter.completed ?? false,
          },
        });
      } finally {
        this.llmSemaphore.release();
      }
    }

    return { records, mtime: fileStat.mtime.toISOString() };
  }

  async processFile(filePath: string, content?: string): Promise<void> {
    try {
      const { records, mtime } = await this.buildFileRecords(filePath, content);
      if (records.length > 0) {
        await vectorDB.upsertChunks(records);
        await vectorDB.updateFileMeta(filePath, mtime);
      }
    } catch (error) {
      console.error(`\nError processing file for RAG: ${filePath}`, error);
    } finally {
      this.updateProgress(filePath);
    }
  }

  async processFileInMemory(
    filePath: string,
    content?: string,
  ): Promise<{ records: VectorRecord[]; mtime: string } | null> {
    try {
      return await this.buildFileRecords(filePath, content);
    } catch (error) {
      console.error(`\nError processing file for RAG: ${filePath}`, error);
      return null;
    } finally {
      this.updateProgress(filePath);
    }
  }

  async indexAll(vaultPath: string): Promise<void> {
    const walker = new DirectoryWalker();
    const filePaths = await walker.walk(vaultPath, this.ioSemaphore);
    const markdownFiles = filePaths.filter(
      (f) => f.endsWith(".md") || f.endsWith(".mdx"),
    );

    this.setSpinner(markdownFiles.length);

    const allRecords: VectorRecord[] = [];
    const allMeta: { filePath: string; mtime: string }[] = [];

    for (const filePath of markdownFiles) {
      const result = await this.processFileInMemory(filePath);
      if (result && result.records.length > 0) {
        allRecords.push(...result.records);
        allMeta.push({ filePath, mtime: result.mtime });
      }
    }

    if (allRecords.length > 0) {
      await vectorDB.upsertChunks(allRecords);
      await vectorDB.updateFileMetaBatch(allMeta);
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    await vectorDB.deleteByFilePath(filePath);
  }
}

export const ragIndexer = new RAGIndexer();
