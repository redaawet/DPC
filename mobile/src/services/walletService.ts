import { Buffer } from 'buffer';

import { BANK_BASE_URL, MAX_OFFLINE_BALANCE } from '../core/constants';
import type { DigitalNote, SyncResult, WalletState } from '../core/types';
import { loadNotes, saveNotes } from '../storage/noteStorage';
import { generateKeyPair, loadKeys, saveBankPublicKey, saveKeyPair } from '../util/crypto';

export const createInitialWalletState = async (): Promise<WalletState> => {
  const [keys, notes] = await Promise.all([loadKeys(), loadNotes()]);

  return {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    bankPublicKey: keys.bankPublicKey,
    notes,
  };
};

export const ensureKeyPair = async (): Promise<{ publicKey: string; privateKey: string }> => {
  const keys = await loadKeys();
  if (keys.publicKey && keys.privateKey) {
    return { publicKey: keys.publicKey, privateKey: keys.privateKey };
  }

  const { publicKey, privateKey } = generateKeyPair();
  await saveKeyPair(publicKey, privateKey);
  return { publicKey, privateKey: Buffer.from(privateKey).toString('base64') };
};

export const registerWallet = async (publicKey: string) => {
  const response = await fetch(`${BANK_BASE_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to register wallet');
  }

  return response.json();
};

export const fetchBankPublicKey = async (): Promise<string> => {
  const response = await fetch(`${BANK_BASE_URL}/bank/public-key`);
  if (!response.ok) {
    throw new Error('Failed to fetch bank public key');
  }

  const payload = await response.json();
  await saveBankPublicKey(payload.publicKey);
  return payload.publicKey;
};

export const withdrawNote = async (publicKey: string, amount: number): Promise<DigitalNote> => {
  if (amount <= 0 || amount > MAX_OFFLINE_BALANCE) {
    throw new Error('Amount must respect offline balance limits');
  }

  const response = await fetch(`${BANK_BASE_URL}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, amount }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Withdrawal failed');
  }

  const payload = await response.json();
  const notes = await loadNotes();
  const updatedNotes = [...notes, payload.note];
  await saveNotes(updatedNotes);
  await saveBankPublicKey(payload.bankPublicKey);
  return payload.note;
};

export const updateNotes = async (notes: DigitalNote[]): Promise<void> => {
  await saveNotes(notes);
};

export const syncNotes = async (publicKey: string, notes: DigitalNote[]): Promise<SyncResult> => {
  const response = await fetch(`${BANK_BASE_URL}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, submittedNotes: notes }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Sync failed');
  }

  const payload: SyncResult = await response.json();
  const unspent = notes.filter((note) => !payload.results.some((r) => r.noteId === note.noteId && r.status === 'redeemed'));
  await saveNotes(unspent);
  return payload;
};
