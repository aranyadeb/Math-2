"use client";
/** Hands a selected PDF from the "new book" form to the import screen without re-selecting (same tab only). */
const pending = new Map<string, File>();
export const setPendingFile = (bookId: string, f: File) => pending.set(bookId, f);
export const takePendingFile = (bookId: string): File | null => pending.get(bookId) ?? null;
export const clearPendingFile = (bookId: string) => pending.delete(bookId);
