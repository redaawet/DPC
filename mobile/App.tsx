import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import type { DigitalNote } from './src/core/types';
import { OfflineTransferEngine } from './src/offline/OfflineTransferEngine';
import { useBluetoothTransfer } from './src/offline/useBluetoothTransfer';
import { StatusBar } from 'expo-status-bar';

import { MAX_OFFLINE_BALANCE } from './src/core/constants';
import type { DigitalNote } from './src/core/types';
import {
  createInitialWalletState,
  ensureKeyPair,
  fetchBankPublicKey,
  registerWallet,
  syncNotes,
  updateNotes,
  withdrawNote,
} from './src/services/walletService';
import { getNoteOwner } from './src/util/crypto';

const transferEngine = new OfflineTransferEngine();

const useWallet = () => {
  const [initializing, setInitializing] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [bankPublicKey, setBankPublicKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<DigitalNote[]>([]);

  useEffect(() => {
    const bootstrap = async () => {
      const state = await createInitialWalletState();
      if (state.publicKey && state.privateKey) {
        setPublicKey(state.publicKey);
        setPrivateKey(state.privateKey);
      } else {
        const keyPair = await ensureKeyPair();
        setPublicKey(keyPair.publicKey);
        setPrivateKey(keyPair.privateKey);
      }
      setBankPublicKey(state.bankPublicKey ?? null);
      setNotes(state.notes);
      setInitializing(false);
    };

    bootstrap().catch((error) => {
      console.error('Failed to initialize wallet', error);
      setInitializing(false);
    });
  }, []);

  return {
    initializing,
    publicKey,
    privateKey,
    bankPublicKey,
    notes,
    setNotes,
    setBankPublicKey,
  };
};

const OFFLINE_FEATURES = [
  { title: 'Balance', description: 'Keep funds ready for offline payments at any time.' },
  { title: 'Risk Rules', description: 'Hop limits, expiry, and caps enforced on-device.' },
  { title: 'Transaction Log', description: 'Track every offline payment with provenance data.' },
  { title: 'Authentication Data', description: 'Wallet identity and attestation bound to your device.' },
  { title: 'Anti-Replay Counters', description: 'Transfer-chain signatures prevent replay attacks.' },
  { title: 'Cryptographic Keys', description: 'Secure keys stored locally to sign each hop.' },
];

const App: React.FC = () => {
  const { initializing, publicKey, privateKey, bankPublicKey, notes, setNotes, setBankPublicKey } = useWallet();
  const [amount, setAmount] = useState('50');
  const [recipient, setRecipient] = useState('');
  const [importedNote, setImportedNote] = useState('');
  const [lastExportedNote, setLastExportedNote] = useState<string | null>(null);
  const {
    available: bluetoothAvailable,
    status: bluetoothStatus,
    peers,
    scanning,
    connectedPeer,
    peripheralEnabled,
    supportsPeripheral,
    incomingPayload,
    startScan,
    stopScan,
    connect,
    disconnect,
    enablePeripheral,
    disablePeripheral,
    send,
    clearIncoming,
  } = useBluetoothTransfer();

  const balance = useMemo(() => {
    if (!publicKey) {
      return 0;
    }
    return notes
      .filter((note) => getNoteOwner(note) === publicKey)
      .reduce((total, note) => total + note.value, 0);
  }, [notes, publicKey]);

  useEffect(() => {
    if (!incomingPayload) {
      return;
    }

    if (!publicKey || !bankPublicKey) {
      Alert.alert('Wallet not ready', 'Register the wallet before receiving notes.');
      clearIncoming();
      return;
    }

    try {
      const parsed: DigitalNote = JSON.parse(incomingPayload);
      if (notes.some((existing) => existing.noteId === parsed.noteId)) {
        Alert.alert('Duplicate note', 'This note already exists in your wallet.');
        clearIncoming();
        return;
      }

      const validation = transferEngine.validateIncomingNote(parsed, bankPublicKey, publicKey, balance);
      if (!validation.ok) {
        Alert.alert('Bluetooth note rejected', validation.reason ?? 'Unknown reason');
        clearIncoming();
        return;
      }

      const updatedNotes = [...notes, parsed];
      setNotes(updatedNotes);
      updateNotes(updatedNotes).catch((error) => console.warn('Failed to persist notes', error));
      Alert.alert('Note received', `Stored note ${parsed.noteId}`);
    } catch (error: any) {
      Alert.alert('Failed to read note', error.message);
    } finally {
      clearIncoming();
    }
  }, [incomingPayload, publicKey, bankPublicKey, notes, balance, clearIncoming, setNotes]);

  const handleRegister = async () => {
    if (!publicKey) {
      return;
    }

    try {
      await registerWallet(publicKey);
      const bankKey = await fetchBankPublicKey();
      setBankPublicKey(bankKey);
      Alert.alert('Wallet registered', 'Bank public key fetched and saved.');
    } catch (error: any) {
      Alert.alert('Registration failed', error.message);
    }
  };

  const handleWithdraw = async () => {
    if (!publicKey) {
      return;
    }

    try {
      const numericAmount = Number(amount);
      if (Number.isNaN(numericAmount)) {
        Alert.alert('Invalid amount', 'Enter a numeric value.');
        return;
      }
      const note = await withdrawNote(publicKey, numericAmount);
      setNotes((current) => [...current, note]);
      Alert.alert('Withdrawal successful', `Issued note ${note.noteId}`);
    } catch (error: any) {
      Alert.alert('Withdrawal failed', error.message);
    }
  };

  const handleExportTransfer = async () => {
    if (!publicKey || !privateKey) {
      Alert.alert('Missing keys', 'Generate or restore your keypair first.');
      return;
    }

    const ownedNotes = notes.filter((note) => getNoteOwner(note) === publicKey);
    const note = ownedNotes[0];
    if (!note) {
      Alert.alert('No notes available', 'Withdraw or receive a note before transferring.');
      return;
    }

    if (!recipient) {
      Alert.alert('Recipient required', 'Enter the recipient public key to transfer.');
      return;
    }

    const { updatedNote, validation } = transferEngine.buildTransferPayload(
      note,
      privateKey,
      publicKey,
      recipient,
      balance,
    );

    if (!validation.ok) {
      Alert.alert('Transfer rejected', validation.reason ?? 'Unknown error');
      return;
    }

    const payload = JSON.stringify(updatedNote, null, 2);
    if (connectedPeer) {
      try {
        await send(payload);
        const remainingNotes = notes.filter((candidate) => candidate.noteId !== note.noteId);
        setNotes(remainingNotes);
        updateNotes(remainingNotes).catch((error) => console.warn('Failed to persist notes', error));
        Alert.alert('Transfer sent', `Note ${note.noteId} delivered over Bluetooth.`);
        return;
      } catch (error: any) {
        Alert.alert('Bluetooth transfer failed', error.message ?? 'Unknown error');
        return;
      }
    }

    const remainingNotes = notes.filter((candidate) => candidate.noteId !== note.noteId);
    setNotes(remainingNotes);
    updateNotes(remainingNotes).catch((error) => console.warn('Failed to persist notes', error));

    setLastExportedNote(payload);
    Alert.alert(
      'Transfer prepared',
      'Share the exported note payload manually or connect to a wallet over Bluetooth to deliver it automatically.',
    );
  };

  const handleImportNote = () => {
    if (!publicKey || !bankPublicKey) {
      Alert.alert('Wallet not ready', 'Register the wallet and fetch the bank key first.');
      return;
    }

    try {
      const parsed: DigitalNote = JSON.parse(importedNote);
      if (notes.some((existing) => existing.noteId === parsed.noteId)) {
        Alert.alert('Duplicate note', 'This note already exists in your wallet.');
        return;
      }

      const validation = transferEngine.validateIncomingNote(parsed, bankPublicKey, publicKey, balance);
      if (!validation.ok) {
        Alert.alert('Note rejected', validation.reason ?? 'Unknown reason');
        return;
      }

      const updatedNotes = [...notes, parsed];
      setNotes(updatedNotes);
      updateNotes(updatedNotes).catch((error) => console.warn('Failed to persist notes', error));
      setImportedNote('');
      Alert.alert('Note received', `Stored note ${parsed.noteId}`);
    } catch (error: any) {
      Alert.alert('Import failed', error.message);
    }
  };

  const handleSync = async () => {
    if (!publicKey) {
      return;
    }

    try {
      const result = await syncNotes(publicKey, notes);
      setNotes((current) =>
        current.filter((note) => result.results.every((r) => r.noteId !== note.noteId || r.status !== 'redeemed')),
      );
      Alert.alert('Sync complete', `Redeemed: ${result.results.filter((r) => r.status === 'redeemed').length}`);
    } catch (error: any) {
      Alert.alert('Sync failed', error.message);
    }
  };

  if (initializing) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.centered}>
          <StatusBar style="light" />
          <Text style={styles.loadingText}>Loading wallet…</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const renderNoteCard = (note: DigitalNote) => {
    const isOwned = publicKey ? getNoteOwner(note) === publicKey : false;
    return (
      <View key={note.noteId} style={styles.noteCard}>
        <View style={styles.noteCardHeader}>
          <Text style={styles.noteValue}>{note.value}</Text>
          <Text style={[styles.noteBadge, isOwned ? styles.noteBadgeOwned : styles.noteBadgeReceived]}>
            {isOwned ? 'Owned' : 'Received'}
          </Text>
        </View>
        <Text style={styles.noteIdLabel}>Note ID</Text>
        <Text selectable style={styles.noteId}>
          {note.noteId}
        </Text>
        <Text style={styles.noteMeta}>Expires: {new Date(note.expiry).toLocaleString()}</Text>
        <Text style={styles.noteMeta}>Hops: {note.transferChain.length}</Text>
      </View>
    );
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>Offline Assets</Text>
            <Text style={styles.heroSubtitle}>Balance available offline: {balance}</Text>
            <View style={styles.featureGrid}>
              {OFFLINE_FEATURES.map((feature) => (
                <View key={feature.title} style={styles.featureCard}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureBody}>{feature.description}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Wallet Identity</Text>
            <Text style={styles.cardSubtitle}>Share your public key when pairing with the bank or peers.</Text>
            <Text selectable style={styles.mono}>
              {publicKey ?? 'Not generated'}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleRegister}>
              <Text style={styles.primaryButtonText}>Register Wallet</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Offline Withdrawal</Text>
            <Text style={styles.cardSubtitle}>Request new digital notes from the bank simulator.</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="Amount"
              placeholderTextColor="#8aa0b4"
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleWithdraw}>
              <Text style={styles.primaryButtonText}>Withdraw</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Bluetooth Transfers</Text>
              <Text style={styles.statusText}>{bluetoothStatus}</Text>
            </View>
            {bluetoothAvailable ? (
              <>
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.secondaryButton, scanning && styles.secondaryButtonActive]}
                    onPress={scanning ? stopScan : startScan}
                  >
                    <Text style={styles.secondaryButtonText}>{scanning ? 'Stop Scan' : 'Scan for Wallets'}</Text>
                  </TouchableOpacity>
                  {connectedPeer ? (
                    <TouchableOpacity style={styles.secondaryButton} onPress={disconnect}>
                      <Text style={styles.secondaryButtonText}>Disconnect</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.secondaryButton, peripheralEnabled && styles.secondaryButtonActive]}
                      onPress={peripheralEnabled ? disablePeripheral : enablePeripheral}
                      disabled={!supportsPeripheral}
                    >
                      <Text style={styles.secondaryButtonText}>
                        {peripheralEnabled ? 'Stop Hosting' : supportsPeripheral ? 'Host Receivable' : 'Needs custom build'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {connectedPeer ? (
                  <View style={styles.connectedPeer}>
                    <Text style={styles.connectedPeerTitle}>Connected Wallet</Text>
                    <Text style={styles.connectedPeerBody}>{connectedPeer.name}</Text>
                    <Text style={styles.connectedPeerBody}>Signal: {connectedPeer.rssi ?? 'n/a'} dBm</Text>
                  </View>
                ) : (
                  <View style={styles.peerList}>
                    {peers.length === 0 ? (
                      <Text style={styles.peerPlaceholder}>Start scanning to discover wallets advertising DPC transfers.</Text>
                    ) : (
                      peers.map((peer) => (
                        <TouchableOpacity key={peer.id} style={styles.peerCard} onPress={() => connect(peer.id)}>
                          <Text style={styles.peerName}>{peer.name}</Text>
                          <Text style={styles.peerMeta}>{peer.id}</Text>
                          <Text style={styles.peerMeta}>Signal: {peer.rssi ?? 'n/a'} dBm</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.peerPlaceholder}>
                Bluetooth modules require a custom Expo dev build with BLE permissions. Manual payload sharing remains available.
              </Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Transfer a Note</Text>
            <Text style={styles.cardSubtitle}>Select a note, enter the recipient key, then send via Bluetooth or share manually.</Text>
            <TextInput
              style={styles.input}
              value={recipient}
              onChangeText={setRecipient}
              placeholder="Recipient Public Key"
              placeholderTextColor="#8aa0b4"
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleExportTransfer}>
              <Text style={styles.primaryButtonText}>Send Note</Text>
            </TouchableOpacity>
            {lastExportedNote ? (
              <View style={styles.exportContainer}>
                <Text style={styles.exportTitle}>Last Prepared Payload</Text>
                <Text selectable style={styles.exportPayload}>
                  {lastExportedNote}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Import a Note</Text>
            <Text style={styles.cardSubtitle}>Paste a payload received offline or via Bluetooth fallback.</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={importedNote}
              onChangeText={setImportedNote}
              placeholder="Paste note payload"
              placeholderTextColor="#8aa0b4"
              multiline
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleImportNote}>
              <Text style={styles.primaryButtonText}>Import</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>My Notes</Text>
            <Text style={styles.cardSubtitle}>Tap a note to inspect its lifecycle and transfer history.</Text>
            {notes.length === 0 ? (
              <Text style={styles.peerPlaceholder}>No notes available. Withdraw or receive a note to begin.</Text>
            ) : (
              <View style={styles.noteGrid}>{notes.map((note) => renderNoteCard(note))}</View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Synchronize with Bank</Text>
            <Text style={styles.cardSubtitle}>Upload redeemed notes and refresh your offline balance record.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleSync}>
              <Text style={styles.primaryButtonText}>Sync Notes</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f1c2b',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f1c2b',
  },
  loadingText: {
    color: '#f0f6ff',
    fontSize: 18,
    fontWeight: '600',
  },
  heroCard: {
    backgroundColor: '#19324a',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
    gap: 12,
  },
  heroTitle: {
    color: '#f7b733',
    fontSize: 24,
    fontWeight: '700',
  },
  heroSubtitle: {
    color: '#f0f6ff',
    fontSize: 16,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  featureCard: {
    backgroundColor: '#244762',
    borderRadius: 12,
    padding: 12,
    width: '48%',
  },
  featureTitle: {
    color: '#f0f6ff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  featureBody: {
    color: '#c6d4e1',
    fontSize: 13,
  },
  card: {
    backgroundColor: '#14283a',
    borderRadius: 16,
    padding: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    color: '#f0f6ff',
    fontSize: 18,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#8aa0b4',
    fontSize: 14,
  },
  mono: {
    color: '#f0f6ff',
    fontFamily: 'Courier',
    fontSize: 12,
    backgroundColor: '#0f1c2b',
    padding: 12,
    borderRadius: 12,
  },
  primaryButton: {
    backgroundColor: '#f7b733',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#0f1c2b',
    fontWeight: '700',
    fontSize: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusText: {
    color: '#8aa0b4',
    fontSize: 12,
    textAlign: 'right',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2f4f69',
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#0f1c2b',
  },
  secondaryButtonActive: {
    borderColor: '#f7b733',
  },
  secondaryButtonText: {
    color: '#f0f6ff',
    fontSize: 14,
    fontWeight: '600',
  },
  connectedPeer: {
    backgroundColor: '#0f1c2b',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  connectedPeerTitle: {
    color: '#f7b733',
    fontSize: 16,
    fontWeight: '700',
  },
  connectedPeerBody: {
    color: '#c6d4e1',
    fontSize: 14,
  },
  peerList: {
    gap: 12,
  },
  peerPlaceholder: {
    color: '#8aa0b4',
    fontSize: 14,
  },
  peerCard: {
    backgroundColor: '#0f1c2b',
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  peerName: {
    color: '#f0f6ff',
    fontSize: 16,
    fontWeight: '600',
  },
  peerMeta: {
    color: '#8aa0b4',
    fontSize: 12,
  },
  input: {
    backgroundColor: '#0f1c2b',
    borderRadius: 12,
    padding: 12,
    color: '#f0f6ff',
    borderWidth: 1,
    borderColor: '#2f4f69',
  },
  multiline: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  exportContainer: {
    backgroundColor: '#0f1c2b',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  exportTitle: {
    color: '#f7b733',
    fontWeight: '600',
    fontSize: 14,
  },
  exportPayload: {
    color: '#c6d4e1',
    fontSize: 12,
    fontFamily: 'Courier',
  },
  noteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  noteCard: {
    width: '48%',
    backgroundColor: '#0f1c2b',
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  noteCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noteValue: {
    color: '#f0f6ff',
    fontSize: 22,
    fontWeight: '700',
  },
  noteBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
  },
  noteBadgeOwned: {
    backgroundColor: '#1d8348',
    color: '#f0f6ff',
  },
  noteBadgeReceived: {
    backgroundColor: '#b03a2e',
    color: '#f0f6ff',
  },
  noteIdLabel: {
    color: '#8aa0b4',
    fontSize: 12,
  },
  noteId: {
    color: '#c6d4e1',
    fontSize: 12,
    fontFamily: 'Courier',
  },
  noteMeta: {
    color: '#8aa0b4',
    fontSize: 12,
  },
});

export default App;
