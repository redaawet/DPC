import { BleManager, Device } from 'react-native-ble-plx';

import { MAX_HOPS, MAX_OFFLINE_BALANCE } from '../core/constants';
import type { DigitalNote, PublicKey } from '../core/types';
import { getNoteOwner, signTransfer, verifyBankSignature, verifyTransferChain } from '../util/crypto';

export interface TransferSession {
  peerDevice: Device;
  peerPublicKey: PublicKey;
}

export interface TransferValidationResult {
  ok: boolean;
  reason?: string;
}

export class OfflineTransferEngine {
  private bleManager = new BleManager();

  async scanForPeers(onDeviceDiscovered: (device: Device) => void) {
    await this.bleManager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        console.warn('BLE scan error', error);
        return;
      }
      if (device) {
        onDeviceDiscovered(device);
      }
    });
  }

  stopScan() {
    this.bleManager.stopDeviceScan();
  }

  buildTransferPayload(
    note: DigitalNote,
    senderPrivateKey: string,
    senderPublicKey: PublicKey,
    recipientPublicKey: PublicKey,
    currentBalance: number,
  ): { updatedNote: DigitalNote; validation: TransferValidationResult } {
    if (getNoteOwner(note) !== senderPublicKey) {
      return { updatedNote: note, validation: { ok: false, reason: 'Sender is not the current note owner' } };
    }

    if (recipientPublicKey === senderPublicKey) {
      return { updatedNote: note, validation: { ok: false, reason: 'Cannot transfer to the same wallet' } };
    }

    if (note.transferChain.length >= MAX_HOPS) {
      return { updatedNote: note, validation: { ok: false, reason: 'Hop limit exceeded' } };
    }

    if (currentBalance < note.value) {
      return { updatedNote: note, validation: { ok: false, reason: 'Insufficient offline balance' } };
    }

    const expiryDate = new Date(note.expiry);
    if (Number.isNaN(expiryDate.getTime()) || expiryDate.getTime() < Date.now()) {
      return { updatedNote: note, validation: { ok: false, reason: 'Note has expired' } };
    }

    const transferEntry = signTransfer(note.noteId, senderPrivateKey, senderPublicKey, recipientPublicKey);
    const updatedNote: DigitalNote = {
      ...note,
      transferChain: [...note.transferChain, transferEntry],
    };

    return { updatedNote, validation: { ok: true } };
  }

  validateIncomingNote(
    note: DigitalNote,
    bankPublicKey: PublicKey,
    recipientPublicKey: PublicKey,
    recipientBalance: number,
  ): TransferValidationResult {
    if (!verifyBankSignature(note, bankPublicKey)) {
      return { ok: false, reason: 'Invalid issuer signature' };
    }

    if (!verifyTransferChain(note)) {
      return { ok: false, reason: 'Invalid transfer chain' };
    }

    const owner = getNoteOwner(note);
    if (owner !== recipientPublicKey) {
      return { ok: false, reason: 'Transfer chain does not end with recipient' };
    }

    if (note.transferChain.length > MAX_HOPS) {
      return { ok: false, reason: 'Hop limit exceeded' };
    }

    const expiryDate = new Date(note.expiry);
    if (expiryDate.getTime() < Date.now()) {
      return { ok: false, reason: 'Note has expired' };
    }

    if (recipientBalance + note.value > MAX_OFFLINE_BALANCE) {
      return { ok: false, reason: 'Offline balance limit exceeded' };
    }

    return { ok: true };
  }
}
