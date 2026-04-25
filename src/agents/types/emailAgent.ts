import type { SimpleEmail } from '../../backend/services/emailService';

export type EmailCategory =
  | 'work'
  | 'personal'
  | 'shopping'
  | 'marketing'
  | 'spam'
  | 'other';

export interface EmailAnalysisInput {
  userId: string;
  email: SimpleEmail;
}

export interface EmailClassificationResult {
  category: EmailCategory;
  confidence: number;
  reasoning: string;
  toolsUsed: string[];
  executionSteps: string[];
  model: string;
}

export interface EmailImportanceResult {
  score: number;
  reasoning: string;
}

export interface EmailSummaryResult {
  summary: string;
}

export interface EmailAgentResult {
  classification: EmailClassificationResult;
  importance: EmailImportanceResult;
  summary: EmailSummaryResult;
}
