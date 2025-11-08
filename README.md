# Chapter Four: Implementation of the Offline Cryptocurrency Prototype

## 4.1 Overview
This chapter presents the implementation of the Offline Digital Pocket Cash (DPC) prototype developed for this research. The purpose of the prototype is not to deliver a fully-fledged commercial application, but to demonstrate the feasibility of cash-like cryptocurrency transactions that function offline, peer-to-peer, and transitively using Bluetooth communication. The design is informed by practical models such as Nigeria’s eNaira and the BitChat framework, aligning with central bank guidelines for risk control and offline operability.

The implementation focuses on proving whether:

1. Digital notes can be securely issued and stored.
2. Notes can be transferred between users offline.
3. Transfers can remain secure without internet connectivity.
4. Offline transactions can later be synchronized with a central ledger.

## 4.2 Prototype Architecture
The prototype consists of three main components.

### 4.2.1 Mobile Wallet Application
The mobile application provides the user interface and offline wallet functionality. It performs:

- Keypair generation.
- Note storage and management.
- Bluetooth-based peer-to-peer transfers.
- Local enforcement of risk rules.
- Synchronization with the bank server.

The app uses:

- React Native (Expo) for cross-platform UI.
- AsyncStorage and SecureStore for secure local storage.
- `react-native-ble-plx` for BLE communication.

Although simplified, it captures the essential behavior of an offline CBDC wallet and enables secure transfer of digital notes without continuous internet connectivity.

### 4.2.2 Bank Simulator (Backend Server)
A lightweight Node.js server acts as the “central bank.” Its functions are to:

- Issue digital notes to user wallets.
- Sign note IDs and denominations using Ed25519.
- Accept deposited notes and verify their transfer chains.
- Prevent double-spending by marking notes as spent.

This backend is a simplified simulation of a central ledger, mimicking the issuance and redemption model used in eNaira. It is strictly a research-level implementation intended to validate the feasibility of the proposed approach rather than represent a production-ready CBDC system.

### 4.2.3 Offline Transfer Engine
The offline transfer engine, implemented within the mobile app, manages:

- Device discovery via BLE.
- Encrypted session establishment.
- Exchange of signed note payloads.
- Transfer-chain signature validation.
- Hop-limit and expiry verification.

Transfers are recorded as cryptographic signatures on a note's transfer chain, enforcing a transitive transfer model similar to BitChat. Each hop is validated against the immutable `issuedTo` origin recorded in the note payload, so tampering with intermediate owners causes verification to fail.

## 4.3 Digital Note Structure
Each note is represented as a JSON payload:

```json
{
  "noteId": "unique hash",
  "value": 50,
  "issuerSignature": "signature_by_bank",
  "createdAt": "timestamp",
  "expiry": "createdAt + 7 days",
  "issuedTo": "base64_public_key_of_initial_owner",
  "transferChain": [
    { "from": "...", "to": "...", "signature": "sig_by_sender" }
  ]
}
```

### 4.3.1 Risk Controls Implemented

- **Offline balance limit:** maximum of 1,000 units stored locally.
- **Hop-limit:** each note may be transferred a maximum of three times offline.
- **Expiry time:** each note expires seven days after issuance.

The mobile wallet now stores the initial owner (`issuedTo`) alongside each note, allowing peers to validate that every hop in the transfer chain links consecutively from the first recipient to the current holder. All risk controls are enforced locally by the mobile wallet to meet central bank recommendations for offline CBDC systems.

## 4.4 Implementation Steps

### 4.4.1 Step 1 — Wallet Setup
Upon installation:

1. The wallet generates a new Ed25519 keypair.
2. The public key is stored locally and optionally shared with the server.
3. Local secure storage is initialized using SecureStore.

_Pseudocode_

```javascript
const keypair = generateKeyPair();
storeSecurely("privateKey", keypair.private);
storeSecurely("publicKey", keypair.public);
```

### 4.4.2 Step 2 — Withdrawal (Online)
When the user requests offline digital cash:

1. The app sends a withdrawal request to the bank simulator.
2. The bank generates the `noteId` and expiry.
3. The bank signs the note payload.
4. The note is returned to the wallet.
5. The wallet stores the note locally.

This creates the starting point for offline circulation.

### 4.4.3 Step 3 — Offline Peer-to-Peer Transfer
Bluetooth is used to discover nearby wallets. The transfer flow is:

1. Sender selects a note.
2. Sender creates a transfer entry by signing `Transfer:<noteId>:<recipientPublicKey>`.
3. Sender increments the hop counter.
4. Sender sends the full note payload.
5. Receiver verifies:
   - Bank signature.
   - Transfer-chain signatures.
   - That each hop links consecutively from the original `issuedTo` wallet to the current recipient.
   - Hop limit.
   - Expiry.
   - Balance limit.

If verification succeeds, the note is added to the receiver's wallet and removed from the sender.

### 4.4.4 Step 4 — Synchronization (Online)
When internet connectivity is available:

1. Wallet uploads spent and received notes.
2. Server validates the full transfer chain.
3. Server redeems valid notes.
4. Bank updates user balances.
5. Double-spent or invalid notes are rejected.
6. Wallet receives status updates.

This final step mimics reconciliation in real CBDC systems.

## 4.5 Prototype User Interface
The user interface includes four main screens:

1. Home / Balance View.
2. My Notes (list of unspent notes).
3. Transfer via Bluetooth or QR.
4. Sync with Bank.

Screens are intentionally kept simple for clarity during demonstrations.

## 4.6 Testing and Evaluation
Testing evaluates the core research questions.

### 4.6.1 Functional Testing

- Verify offline creation, storage, and retrieval of notes.
- Verify Bluetooth discovery and transfer.
- Verify transfer-chain integrity.
- Reject expired notes.
- Reject notes over hop limit.
- Reject notes exceeding offline balance.

### 4.6.2 Security Testing

- Attempt signature tampering.
- Attempt replaying a previous transfer.
- Attempt to modify hop count.
- Attempt to alter the `issuedTo` field or reorder transfer-chain hops.
- Attempt to restore an old wallet state (rollback test).

### 4.6.3 Usability Testing

A small group of 2–4 users performs a workflow of withdraw → transfer → transfer → deposit. Observations focus on:

- Simplicity.
- Reliability.
- Delay.
- Error messages.

### 4.6.4 Performance Testing

Measurements include:

- Time to sign a transfer.
- Time to verify the transfer chain.
- Bluetooth transfer latency.

## 4.7 Summary
This chapter demonstrates the implementation of a functional offline digital cash prototype capable of:

- Secure note issuance.
- Offline storage.
- Offline Bluetooth transfer.
- Transitive ownership (hops).
- Expiry and risk-rule enforcement.
- Final online synchronization.

The prototype validates the core feasibility of cryptocurrency-based offline payments for automated pocket cash transactions, meeting the research objectives.


## Prototype Source Code

The repository now includes runnable source code for the Offline Digital Pocket Cash prototype:

- `backend/` – Node.js bank simulator that issues, redeems, and validates digital notes over simple REST endpoints.
- `mobile/` – Expo / React Native wallet that stores notes locally, performs offline risk checks, prepares Bluetooth transfer payloads, and synchronizes with the simulator.

### Running the Bank Simulator

```bash
cd backend
npm install
npm start
```

### Running the Mobile Wallet

```bash
cd mobile
npm install
npx expo start
```

Use the Expo client (Android/iOS simulator or physical device) to load the project. The app targets **Expo SDK 54**, so be sure to open it with an Expo Go release that matches SDK 54 (or build a local development client) to avoid compatibility errors. The wallet expects the bank simulator to be reachable at `http://localhost:4000`; update `mobile/src/core/constants.ts` if you run the bank on a different host.

### Creating a Downloadable Archive

To prepare a ZIP archive that can be distributed or downloaded, run the packaging script from the repository root:

```bash
./scripts/create-distribution.sh
```

The script produces `dist/offline-dpc-prototype.zip`, excluding development artifacts such as `node_modules/`, Expo caches, and the Git history so the archive remains lightweight.
