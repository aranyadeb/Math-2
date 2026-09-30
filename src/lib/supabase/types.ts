import type { GraphDocument } from "../graph/schema";
import type { ParsedCommand } from "../commands/schema";

export interface BookRow {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  edition: string | null;
  subject: string | null;
  source_filename: string | null;
  source_size_bytes: number | null;
  pdf_page_count: number;
  ingestion_status: "pending" | "in_progress" | "paused" | "complete" | "failed";
  page_mapping_status: "pending" | "in_progress" | "needs_review" | "complete" | "failed";
  image_quality: "economy" | "balanced" | "high";
  uploaded_bytes: number;
  cover_path: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
}

export interface BookPageRow {
  id: string;
  user_id: string;
  book_id: string;
  pdf_page_index: number;
  page_label: string | null;
  chapter_label: string | null;
  chapter_title: string | null;
  section_label: string | null;
  section_title: string | null;
  storage_path: string;
  thumbnail_path: string | null;
  size_bytes: number | null;
  mapping_source: "ai_visual" | "sequence_inferred" | "manual" | "imported" | null;
  mapping_confidence: number | null;
  manually_verified: boolean;
  upload_status: "pending" | "uploaded" | "failed";
  width: number | null;
  height: number | null;
}

export interface BBox { x: number; y: number; width: number; height: number }

export interface QuestionCacheRow {
  id: string;
  book_id: string;
  book_page_id: string;
  exercise_label: string | null;
  question_label: string;
  bbox: BBox | null;
  question_text: string | null;
  question_image_path: string | null;
  continues_to_next_page: boolean;
  continuation_page_ids: string[] | null;
  continuation_bbox: BBox | null;
  confidence: number | null;
  manually_corrected: boolean;
}

export interface GraphSessionRow {
  id: string;
  user_id: string;
  book_id: string;
  book_page_id: string;
  question_cache_id: string | null;
  voice_query_id: string | null;
  page_label: string;
  question_label: string | null;
  exercise_label: string | null;
  original_user_query: string;
  transcript: string | null;
  model_used: string;
  fallback_reason: string | null;
  graph_document: GraphDocument;
  ai_explanation: string | null;
  ai_solution: string | null;
  question_summary: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string;
}

export interface GraphMessageRow {
  id: string;
  graph_session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  structured_payload: unknown;
  created_at: string;
}

export interface VoiceQueryRow {
  id: string;
  transcript: string;
  parsed_command: ParsedCommand | null;
}
