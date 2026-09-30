export const BUCKETS = {
  pages: "book-pages",
  crops: "question-crops",
  previews: "graph-previews",
} as const;

/** All object paths start with the owner's user id — enforced by storage RLS policies. */
export function pageImagePath(userId: string, bookId: string, pdfIndex: number, ext: string): string {
  return `${userId}/${bookId}/pages/${String(pdfIndex).padStart(5, "0")}.${ext}`;
}
export function pageThumbPath(userId: string, bookId: string, pdfIndex: number, ext: string): string {
  return `${userId}/${bookId}/thumbs/${String(pdfIndex).padStart(5, "0")}.${ext}`;
}
export function questionCropPath(userId: string, bookId: string, questionId: string): string {
  return `${userId}/${bookId}/${questionId}.webp`;
}
export function previewPath(userId: string, sessionId: string): string {
  return `${userId}/${sessionId}.svg`;
}
