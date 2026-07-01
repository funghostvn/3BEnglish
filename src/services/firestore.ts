import {
  collection,
  doc,
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

// Some legacy exam documents were created with addDoc() while still carrying
// their own `id` data field, so their real Firestore doc id ends up
// different from exam.id (addDoc assigns a random id, ignoring the field).
// updateDocById/deleteDocById would silently target a non-existent path for
// those. Try the direct (fast, common) path first, then fall back to
// resolving the real doc id with a targeted query — much cheaper than
// re-fetching the whole collection, and only hit for the rare mismatch case.
async function resolveExamDocId(examId: string): Promise<string> {
  const snap = await getDocs(query(collection(db, 'exams'), where('id', '==', examId)));
  if (snap.empty) {
    throw new Error(`Không tìm thấy đề thi với id "${examId}".`);
  }
  return snap.docs[0].id;
}

export async function updateExamById(examId: string, data: Partial<DocumentData>) {
  try {
    await updateDoc(doc(db, 'exams', examId), data);
  } catch (err) {
    const realId = await resolveExamDocId(examId);
    await updateDoc(doc(db, 'exams', realId), data);
  }
}

export async function deleteExamById(examId: string) {
  try {
    await deleteDoc(doc(db, 'exams', examId));
  } catch (err) {
    const realId = await resolveExamDocId(examId);
    await deleteDoc(doc(db, 'exams', realId));
  }
}
