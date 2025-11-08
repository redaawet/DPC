import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MAX_OFFLINE_BALANCE } from './src/core/constants';
import type { DigitalNote } from './src/core/types';
import { OfflineTransferEngine } from './src/offline/OfflineTransferEngine';
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

  const refreshNotes = async () => {
    await updateNotes(notes);
  };

  return {
    initializing,
    publicKey,
    privateKey,
    bankPublicKey,
    notes,
    setNotes,
    setBankPublicKey,
    refreshNotes,
  };
};

const App: React.FC = () => {
  const { initializing, publicKey, privateKey, bankPublicKey, notes, setNotes, setBankPublicKey } = useWallet();
  const [amount, setAmount] = useState('50');
  const [recipient, setRecipient] = useState('');
  const [importedNote, setImportedNote] = useState('');
  const [lastExportedNote, setLastExportedNote] = useState<string | null>(null);

  const balance = useMemo(() => {
    if (!publicKey) {
      return 0;
    }
    return notes
      .filter((note) => getNoteOwner(note) === publicKey)
      .reduce((total, note) => total + note.value, 0);
  }, [notes, publicKey]);

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

  const handleExportTransfer = () => {
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

    const remainingNotes = notes.filter((candidate) => candidate.noteId !== note.noteId);
    setNotes(remainingNotes);
    updateNotes(remainingNotes).catch((error) => console.warn('Failed to persist notes', error));

    const payload = JSON.stringify(updatedNote, null, 2);
    setLastExportedNote(payload);
    Alert.alert('Transfer prepared', 'Share the exported note payload with the recipient offline.');
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
      setNotes((current) => current.filter((note) => result.results.every((r) => r.noteId !== note.noteId || r.status !== 'redeemed')));
      Alert.alert('Sync complete', `Redeemed: ${result.results.filter((r) => r.status === 'redeemed').length}`);
    } catch (error: any) {
      Alert.alert('Sync failed', error.message);
    }
  };

  const renderNote = ({ item }: { item: DigitalNote }) => {
    const isOwned = publicKey ? getNoteOwner(item) === publicKey : false;
    return (
      <View style={[styles.noteCard, !isOwned && styles.noteNotOwned]}>
        <Text style={styles.noteTitle}>Note {item.noteId.slice(0, 8)}...</Text>
        <Text>Value: {item.value}</Text>
        <Text>Expires: {new Date(item.expiry).toLocaleString()}</Text>
        <Text>Hops: {item.transferChain.length}</Text>
        <Text>Status: {isOwned ? 'Owned' : 'Transferred'}</Text>
      </View>
    );
  };

  if (initializing) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.heading}>Initializing wallet...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>Offline DPC Wallet</Text>
        <Text style={styles.label}>Public key:</Text>
        <Text selectable style={styles.mono}>
          {publicKey ?? 'Not generated'}
        </Text>
        <Text style={styles.label}>Bank public key:</Text>
        <Text selectable style={styles.mono}>
          {bankPublicKey ?? 'Fetch after registering'}
        </Text>

        <TouchableOpacity style={styles.primaryButton} onPress={handleRegister}>
          <Text style={styles.primaryButtonText}>Register Wallet</Text>
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Balance</Text>
          <Text style={styles.balance}>Total: {balance}</Text>
          <Text style={styles.helper}>Offline limit: {MAX_OFFLINE_BALANCE}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Withdraw Note</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount"
            keyboardType="numeric"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleWithdraw}>
            <Text style={styles.primaryButtonText}>Withdraw</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prepare Transfer</Text>
          <TextInput
            style={styles.input}
            value={recipient}
            onChangeText={setRecipient}
            placeholder="Recipient public key"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleExportTransfer}>
            <Text style={styles.primaryButtonText}>Generate Transfer Payload</Text>
          </TouchableOpacity>
          {lastExportedNote ? (
            <View style={styles.exportContainer}>
              <Text style={styles.label}>Exported payload (share offline):</Text>
              <Text selectable style={styles.exportPayload}>
                {lastExportedNote}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Import Received Note</Text>
          <TextInput
            style={[styles.input, styles.multiLine]}
            value={importedNote}
            onChangeText={setImportedNote}
            placeholder="Paste note payload JSON"
            multiline
            numberOfLines={6}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleImportNote}>
            <Text style={styles.primaryButtonText}>Store Note</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Local Notes</Text>
          {notes.length === 0 ? (
            <Text style={styles.helper}>No notes stored locally.</Text>
          ) : (
            <FlatList
              data={notes}
              keyExtractor={(item) => item.noteId}
              renderItem={renderNote}
              scrollEnabled={false}
            />
          )}
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleSync}>
          <Text style={styles.primaryButtonText}>Sync with Bank</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 64,
    gap: 16,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  label: {
    fontWeight: '600',
  },
  mono: {
    fontFamily: 'Courier New',
    fontSize: 12,
    backgroundColor: '#fff',
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: '#1e5df8',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  balance: {
    fontSize: 16,
    fontWeight: '700',
  },
  helper: {
    color: '#666',
    fontSize: 12,
  },
  input: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 12,
  },
  multiLine: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  exportContainer: {
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 8,
  },
  exportPayload: {
    color: '#e0f2fe',
    fontFamily: 'Courier New',
    fontSize: 11,
  },
  noteCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  noteNotOwned: {
    opacity: 0.6,
  },
  noteTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
});

export default App;
