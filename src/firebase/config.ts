import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  collection,
  query,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firestore with explicit firestoreDatabaseId (MANDATORY in AI Studio)
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Security Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection on boot as required by Firebase skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client appears offline. Check configuration.');
    }
  }
}
testConnection();

// Google Auth Providers
const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    if (user) {
      // Sync user profile in Firestore
      const userRef = doc(db, 'users', user.uid);
      await setDoc(
        userRef,
        {
          userId: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'User',
          photoURL: user.photoURL || '',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    return user;
  } catch (error) {
    console.error('Google Sign-In failed:', error);
    return null;
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

// User Firestore Storage Helpers
export async function saveLensScan(userId: string, scanData: {
  rawText: string;
  cleanedText: string;
  translatedText: string;
  targetLang: string;
  confidence: number;
  vlmSecondOpinion?: string;
}) {
  const scanId = 'scan_' + Date.now();
  const path = `users/${userId}/lens_scans/${scanId}`;
  try {
    await setDoc(doc(db, 'users', userId, 'lens_scans', scanId), {
      id: scanId,
      userId,
      rawText: scanData.rawText,
      cleanedText: scanData.cleanedText,
      translatedText: scanData.translatedText,
      targetLang: scanData.targetLang,
      confidence: scanData.confidence,
      vlmSecondOpinion: scanData.vlmSecondOpinion || '',
      createdAt: serverTimestamp(),
    });
    return scanId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveBenchmarkRun(userId: string, metrics: {
  cerReduction: number;
  werReduction: number;
  noiseReduction: number;
  avgLatencyMs: number;
  samplesCount: number;
}) {
  const benchmarkId = 'bm_' + Date.now();
  const path = `users/${userId}/benchmarks/${benchmarkId}`;
  try {
    await setDoc(doc(db, 'users', userId, 'benchmarks', benchmarkId), {
      id: benchmarkId,
      userId,
      cerReduction: metrics.cerReduction,
      werReduction: metrics.werReduction,
      noiseReduction: metrics.noiseReduction,
      avgLatencyMs: metrics.avgLatencyMs,
      samplesCount: metrics.samplesCount,
      createdAt: serverTimestamp(),
    });
    return benchmarkId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
