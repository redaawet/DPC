export type PublicKey = string; // base64-encoded

export interface TransferEntry {
  from: PublicKey;
  to: PublicKey;
  signature: string; // base64-encoded signature over `Transfer:<noteId>:<to>`
  timestamp: string;
}

export interface DigitalNote {
  noteId: string;
  value: number;
  issuerSignature: string;
  createdAt: string;
  expiry: string;
  transferChain: TransferEntry[];
}

export interface WalletState {
  publicKey: PublicKey | null;
  privateKey: string | null; // base64-encoded secret key
  bankPublicKey: PublicKey | null;
  notes: DigitalNote[];
}

export interface SyncResult {
  balanceBefore: number;
  balanceAfter: number;
  results: Array<{
    noteId: string | null;
    status: 'redeemed' | 'rejected';
    reason?: string;
  }>;
}
