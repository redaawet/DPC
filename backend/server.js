import cors from 'cors';
import express from 'express';
import nacl from 'tweetnacl';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const BANK_KEY_PAIR = nacl.sign.keyPair();
const BANK_PUBLIC_KEY = Buffer.from(BANK_KEY_PAIR.publicKey).toString('base64');

const MAX_OFFLINE_BALANCE = 1000;
const MAX_HOPS = 3;
const NOTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const registeredWallets = new Map();
const issuedNotes = new Map();
const spentNotes = new Set();

const serializeNoteForSigning = (note) => {
  const transferable = {
    noteId: note.noteId,
    value: note.value,
    createdAt: note.createdAt,
    expiry: note.expiry,
    issuedTo: note.issuedTo,
  };
  return Buffer.from(JSON.stringify(transferable));
};

const verifyBankSignature = (note) => {
  const message = serializeNoteForSigning(note);
  const signature = Buffer.from(note.issuerSignature, 'base64');
  return nacl.sign.detached.verify(message, signature, BANK_KEY_PAIR.publicKey);
};

const verifyTransferChain = (note, depositorPublicKey) => {
  if (!Array.isArray(note.transferChain)) {
    return { ok: false, reason: 'transferChain must be an array' };
  }

  if (note.transferChain.length > MAX_HOPS) {
    return { ok: false, reason: `hop limit exceeded (${note.transferChain.length}/${MAX_HOPS})` };
  }

  const issuanceRecord = issuedNotes.get(note.noteId);
  if (!issuanceRecord) {
    return { ok: false, reason: 'note was not issued by this bank' };
  }

  if (issuanceRecord.issuedTo !== note.issuedTo) {
    return { ok: false, reason: 'issuedTo does not match issuance record' };
  }

  let previousOwner = note.issuedTo;

  for (let index = 0; index < note.transferChain.length; index += 1) {
    const entry = note.transferChain[index];
    const { from, to, signature } = entry;
    if (!from || !to || !signature) {
      return { ok: false, reason: `transfer entry ${index} is missing properties` };
    }

    if (!registeredWallets.has(from) || !registeredWallets.has(to)) {
      return { ok: false, reason: `transfer entry ${index} references unregistered wallet` };
    }

    if (from !== previousOwner) {
      return { ok: false, reason: `transfer entry ${index} does not chain from previous owner` };
    }

    const transferMessage = Buffer.from(`Transfer:${note.noteId}:${to}`);
    const entrySignature = Buffer.from(signature, 'base64');
    const fromKey = Buffer.from(from, 'base64');

    if (!nacl.sign.detached.verify(transferMessage, entrySignature, fromKey)) {
      return { ok: false, reason: `signature validation failed for transfer entry ${index}` };
    }

    previousOwner = to;
  }

  if (previousOwner !== depositorPublicKey) {
    return { ok: false, reason: 'note is not owned by depositing wallet' };
  }

  return { ok: true };
};

const calculateOfflineBalance = (walletPublicKey) => {
  const ownedNotes = Array.from(issuedNotes.values()).filter((note) => {
    if (spentNotes.has(note.noteId)) {
      return false;
    }

    if (!note.transferChain.length) {
      return note.owner === walletPublicKey;
    }

    return note.transferChain[note.transferChain.length - 1].to === walletPublicKey;
  });

  return ownedNotes.reduce((total, note) => total + note.value, 0);
};

const redeemNotes = ({ publicKey, notes }) => {
  if (!registeredWallets.has(publicKey)) {
    return { results: notes.map((note) => ({ noteId: note.noteId ?? null, status: 'rejected', reason: 'wallet is not registered' })) };
  }

  const results = notes.map((submittedNote) => {
    if (!submittedNote || !submittedNote.noteId) {
      return { noteId: submittedNote?.noteId ?? null, status: 'rejected', reason: 'noteId missing' };
    }

    if (spentNotes.has(submittedNote.noteId)) {
      return { noteId: submittedNote.noteId, status: 'rejected', reason: 'note already spent' };
    }

    if (!verifyBankSignature(submittedNote)) {
      return { noteId: submittedNote.noteId, status: 'rejected', reason: 'invalid bank signature' };
    }

    const transferCheck = verifyTransferChain(submittedNote, publicKey);
    if (!transferCheck.ok) {
      return { noteId: submittedNote.noteId, status: 'rejected', reason: transferCheck.reason };
    }

    if (new Date(submittedNote.expiry).getTime() < Date.now()) {
      return { noteId: submittedNote.noteId, status: 'rejected', reason: 'note expired' };
    }

    spentNotes.add(submittedNote.noteId);
    issuedNotes.set(submittedNote.noteId, {
      ...submittedNote,
      owner: publicKey,
    });

    return { noteId: submittedNote.noteId, status: 'redeemed' };
  });

  return { results };
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/bank/public-key', (_req, res) => {
  res.json({ publicKey: BANK_PUBLIC_KEY });
});

app.post('/register', (req, res) => {
  const { publicKey, label } = req.body;
  if (!publicKey) {
    return res.status(400).json({ error: 'publicKey is required' });
  }

  if (registeredWallets.has(publicKey)) {
    return res.json({ publicKey, label: registeredWallets.get(publicKey).label });
  }

  registeredWallets.set(publicKey, {
    label: label || `Wallet-${registeredWallets.size + 1}`,
    createdAt: new Date().toISOString(),
  });

  return res.status(201).json({ publicKey, label: registeredWallets.get(publicKey).label });
});

app.post('/withdraw', (req, res) => {
  const { publicKey, amount } = req.body;

  if (!publicKey || typeof amount !== 'number') {
    return res.status(400).json({ error: 'publicKey and numeric amount are required' });
  }

  if (!registeredWallets.has(publicKey)) {
    return res.status(404).json({ error: 'wallet is not registered' });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: 'amount must be positive' });
  }

  if (amount > MAX_OFFLINE_BALANCE) {
    return res.status(400).json({ error: `amount exceeds offline balance limit (${MAX_OFFLINE_BALANCE})` });
  }

  const currentBalance = calculateOfflineBalance(publicKey);
  if (currentBalance + amount > MAX_OFFLINE_BALANCE) {
    return res.status(400).json({ error: 'offline balance limit would be exceeded' });
  }

  const note = {
    noteId: uuidv4(),
    value: amount,
    createdAt: new Date().toISOString(),
    expiry: new Date(Date.now() + NOTE_LIFETIME_MS).toISOString(),
    issuerSignature: '',
    issuedTo: publicKey,
    transferChain: [],
    owner: publicKey,
  };

  const signature = nacl.sign.detached(serializeNoteForSigning(note), BANK_KEY_PAIR.secretKey);
  note.issuerSignature = Buffer.from(signature).toString('base64');

  issuedNotes.set(note.noteId, note);

  return res.status(201).json({
    note: {
      noteId: note.noteId,
      value: note.value,
      createdAt: note.createdAt,
      expiry: note.expiry,
      issuerSignature: note.issuerSignature,
      issuedTo: note.issuedTo,
      transferChain: note.transferChain,
    },
    bankPublicKey: BANK_PUBLIC_KEY,
  });
});

app.post('/deposit', (req, res) => {
  const { publicKey, notes } = req.body;

  if (!publicKey || !Array.isArray(notes)) {
    return res.status(400).json({ error: 'publicKey and notes[] are required' });
  }

  if (!registeredWallets.has(publicKey)) {
    return res.status(404).json({ error: 'wallet is not registered' });
  }

  const result = redeemNotes({ publicKey, notes });
  return res.json(result);
});

app.post('/sync', (req, res) => {
  const { publicKey, submittedNotes } = req.body;

  if (!publicKey || !Array.isArray(submittedNotes)) {
    return res.status(400).json({ error: 'publicKey and submittedNotes[] are required' });
  }

  const balanceBefore = calculateOfflineBalance(publicKey);
  const depositResult = redeemNotes({ publicKey, notes: submittedNotes });
  const balanceAfter = calculateOfflineBalance(publicKey);

  return res.json({
    balanceBefore,
    balanceAfter,
    ...depositResult,
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Offline DPC bank simulator listening on port ${PORT}`);
});
