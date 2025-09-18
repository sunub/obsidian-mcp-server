import { z } from 'zod';
import { responseTypeSchema } from "../params.js";
import { FrontMatterSchema } from '../../../utils/processor/types.js';
// import { metadataSchema } from '../params.js';

// 실제 응답 구조에 맞춘 스키마
const metadataSchema = FrontMatterSchema;

const documentStatsSchema = z.object({
  contentLength: z.number().describe('Total number of characters in the content'),
}).describe('Document statistics');

const documentSchema = z.object({
  filename: z.string().describe('The filename of the document'),
  fullPath: z.string().describe('The full path to the file in the vault'),
  metadata: metadataSchema,
  stats: documentStatsSchema
}).describe('Document information');

const vaultOverviewSchema = z.object({
  total_documents: z.number().describe('Total number of documents in the vault'),
  showing: z.number().describe('Number of documents being displayed'),
}).describe('Vault overview statistics');

const aiInstructionsSchema = z.object({
  purpose: z.string().describe('Purpose of the response'),
  usage: z.string().describe('How to use the response'),
  note: z.string().describe('Additional notes')
}).describe('AI instructions for using the response');

// 실제 listAllDocuments 응답 구조
export const listAllDocumentsDataSchema = z.object({
  vault_overview: vaultOverviewSchema,
  documents: z.array(documentSchema).describe('List of all documents in the vault'),
}).describe('Complete response data for listing all documents');

// list all documents response schema - 실제 MCP 응답 구조에 맞춤
export const listAllDocumentsResponseSchema = z.object({
  type: responseTypeSchema,
  text: listAllDocumentsDataSchema
}).describe('Response schema for listing all documents in the Obsidian vault');

export type ListAllDocumentsResponse = z.infer<typeof listAllDocumentsResponseSchema>;
export type ListAllDocumentsData = z.infer<typeof listAllDocumentsDataSchema>;
export type DocumentInfo = z.infer<typeof documentSchema>;
export type VaultOverview = z.infer<typeof vaultOverviewSchema>;
export type AIInstructions = z.infer<typeof aiInstructionsSchema>;
