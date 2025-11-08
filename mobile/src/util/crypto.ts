import { Buffer } from 'buffer';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';

import type { DigitalNote, PublicKey, TransferEntry } from '../core/types';

const PRIVATE_KEY_KEY = 'dpc_wallet_privateKey';
const PUBLIC_KEY_KEY = 'dpc_wallet_publicKey';
const BANK_KEY_KEY = 'dpc_wallet_bankPublicKey';

export const saveKeyPair = async (publicKey: PublicKey, privateKey: Uint8Array) => {
  await SecureStore.setItemAsync(PUBLIC_KEY_KEY, publicKey);
  await SecureStore.setItemAsync(PRIVATE_KEY_KEY, Buffer.from(privateKey).toString('base64'));
};

export const saveBankPublicKey = async (publicKey: PublicKey) => {
  await SecureStore.setItemAsync(BANK_KEY_KEY, publicKey);
};

export const loadKeys = async () => {
  const [publicKey, privateKey, bankPublicKey] = await Promise.all([
    SecureStore.getItemAsync(PUBLIC_KEY_KEY),
    SecureStore.getItemAsync(PRIVATE_KEY_KEY),
    SecureStore.getItemAsync(BANK_KEY_KEY),
  ]);

  return {
    publicKey,
    privateKey,
    bankPublicKey,
  };
};

export const generateKeyPair = () => {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
    privateKey: keyPair.secretKey,
  };
};

export const signTransfer = (
  noteId: string,
  senderPrivateKeyBase64: string,
  senderPublicKey: PublicKey,
  recipientPublicKey: PublicKey,
): TransferEntry => {
  const message = Buffer.from(`Transfer:${noteId}:${recipientPublicKey}`);
  const privateKey = Buffer.from(senderPrivateKeyBase64, 'base64');
  const signature = nacl.sign.detached(message, privateKey);

  return {
    from: senderPublicKey,
    to: recipientPublicKey,
    signature: Buffer.from(signature).toString('base64'),
    timestamp: new Date().toISOString(),
  };
};

export const verifyBankSignature = (note: DigitalNote, bankPublicKey: PublicKey): boolean => {
  const transferable = {
    noteId: note.noteId,
    value: note.value,
    createdAt: note.createdAt,
    expiry: note.expiry,
    issuedTo: note.issuedTo,
  };

  const message = Buffer.from(JSON.stringify(transferable));
  const signature = Buffer.from(note.issuerSignature, 'base64');
  const bankKey = Buffer.from(bankPublicKey, 'base64');

  return nacl.sign.detached.verify(message, signature, bankKey);
};

export const verifyTransferChain = (note: DigitalNote): boolean => {
  let previousOwner: PublicKey = note.issuedTo;

  return note.transferChain.every((entry) => {
    const { from, to, signature } = entry;
    if (from !== previousOwner) {
      return false;
    }

    const fromKey = Buffer.from(from, 'base64');
    const message = Buffer.from(`Transfer:${note.noteId}:${to}`);
    const signatureBytes = Buffer.from(signature, 'base64');

    const signatureValid = nacl.sign.detached.verify(message, signatureBytes, fromKey);
    if (!signatureValid) {
      return false;
    }

    previousOwner = to;
    return true;
  });
};

export const getNoteOwner = (note: DigitalNote): PublicKey => {
  if (!note.transferChain.length) {
    return note.issuedTo;
  }

  return note.transferChain[note.transferChain.length - 1].to;
};
