import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  deleteDoc,
  where,
  type QueryConstraint,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';

// Fetches a collection (optionally scoped with where()/orderBy() constraints)
// and returns each document merged with its Firestore doc id.
// Prefer passing constraints (e.g. where('userId','==',uid)) over fetching
// the whole collection and filtering client-side.
export async function fetchCollection<T extends DocumentData>(
  collectionName: string,
  ...constraints: QueryConstraint[]
): Promise<(T & { id: string })[]> {
  const colRef = collection(db, collectionName);
  const q = constraints.length ? query(colRef, ...constraints) : colRef;
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as T) }));
}

// Updates a document directly by its known Firestore doc id.
// Use this instead of re-fetching the whole collection to find a doc by id.
export function updateDocById(collectionName: string, id: string, data: Partial<DocumentData>) {
  return updateDoc(doc(db, collectionName, id), data);
}

export function deleteDocById(collectionName: string, id: string) {
  return deleteDoc(doc(db, collectionName, id));
}

// A handful of legacy exam documents were historically created with addDoc()
// while still carrying their own `id` data field, so their real Firestore
// doc id ended up different from exam.id (addDoc assigns a random id,
// ignoring the field). These have since been migrated so doc id === data.id
// everywhere, but this fallback stays as defense-in-depth in case a future
// import path regresses. Resolves the real doc id with a targeted query —
// much cheaper than re-fetching the whole collection.
async function resolveExamDocId(examId: string): Promise<string> {
  const snap = await getDocs(query(collection(db, 'exams'), where('id', '==', examId)));
  if (snap.empty) {
    throw new Error(`Không tìm thấy đề thi với id "${examId}".`);
  }
  return snap.docs[0].id;
}

// Checks existence first rather than trying the direct path and reacting to
// a thrown error: deleteDoc() resolves successfully (no throw) even when the
// target document doesn't exist, so a try/catch around it would silently
// no-op for a mismatched id instead of ever reaching the fallback.
export async function updateExamById(examId: string, data: Partial<DocumentData>) {
  const directRef = doc(db, 'exams', examId);
  const directSnap = await getDoc(directRef);
  if (directSnap.exists()) {
    await updateDoc(directRef, data);
    return;
  }
  const realId = await resolveExamDocId(examId);
  await updateDoc(doc(db, 'exams', realId), data);
}

export async function deleteExamById(examId: string) {
  const directRef = doc(db, 'exams', examId);
  const directSnap = await getDoc(directRef);
  if (directSnap.exists()) {
    await deleteDoc(directRef);
    return;
  }
  const realId = await resolveExamDocId(examId);
  await deleteDoc(doc(db, 'exams', realId));
}
