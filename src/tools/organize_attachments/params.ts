import { z } from 'zod';
import { responseTypeSchema } from '../vault/params.js';

export const organizeAttachmentsParamsSchema = z.object({
  keyword: z.string().describe('A keyword to search for the markdown file within the vault.'),
  destination: z.string().optional().default('images').describe('The base folder to move attachments into. Defaults to "images".'),
  useTitleAsFolderName: z.boolean().optional().default(true).describe('If true, creates a subfolder named after the document title. Defaults to true.'),
  quiet: z.boolean().optional().default(false).describe('If true, returns a minimal success message.'),
}).describe('Parameters for organizing attachments of a markdown file');

export type OrganizeAttachmentsParams = z.infer<typeof organizeAttachmentsParamsSchema>;

export const OrganizeAttachmentsDetailSchema = z.object({
  document: z.string().describe('The path of the processed markdown document.'),
  status: z.enum(['skipped', 'completed', 'success']).describe('The status of the operation.'),
  message: z.string().optional().describe('A message providing additional information, especially if skipped.'),
  movedFiles: z.number().optional().describe('The number of files successfully moved. Present if status is "completed".'),
  targetDirectory: z.string().optional().describe('The directory where attachments were moved. Present if status is "completed".'),
  errors: z.array(z.object({
    imageName: z.string().describe('The name of the image that failed to move.'),
    reason: z.string().describe('The reason for the failure.'),
  })).optional().describe('List of errors encountered during the move operation. Present if any errors occurred.'),
}).describe('Result of organizing attachments for a single document');

export const OrganizeAttachmentsResultSchema = z.object({
  summary: z.string().describe('A summary message of the overall operation.'),
  details: z.array(OrganizeAttachmentsDetailSchema).describe('Array of results for each processed document.'),
});

export type OrganizeAttachmentsResult = z.infer<typeof OrganizeAttachmentsResultSchema>;