import { useCallback, useEffect, useRef, useState } from 'react';

import { BluetoothTransferManager, type BluetoothPeer } from './BluetoothTransferManager';

const manager = new BluetoothTransferManager();

export const useBluetoothTransfer = () => {
  const [available] = useState(manager.isAvailable());
  const [status, setStatus] = useState<string>(manager.isAvailable() ? 'Bluetooth idle' : 'Bluetooth unavailable');
  const [peers, setPeers] = useState<BluetoothPeer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectedPeer, setConnectedPeer] = useState<BluetoothPeer | null>(null);
  const [peripheralEnabled, setPeripheralEnabled] = useState(false);
  const [incomingPayload, setIncomingPayload] = useState<string | null>(null);

  const seenPeers = useRef(new Set<string>());

  useEffect(() => () => {
    manager.dispose();
  }, []);

  const startScan = useCallback(async () => {
    if (!manager.isAvailable()) {
      setStatus('Bluetooth unavailable in this build');
      return;
    }

    setPeers([]);
    seenPeers.current.clear();
    setScanning(true);
    setStatus('Scanning for nearby wallets…');
    await manager.ensureAdapterEnabled().catch(() => setStatus('Enable Bluetooth to start scanning.'));
    manager.startScanning(
      (peer) => {
        setPeers((current) => {
          if (seenPeers.current.has(peer.id)) {
            return current;
          }
          seenPeers.current.add(peer.id);
          return [...current, peer];
        });
      },
      (reason) => {
        setStatus(`Scan error: ${reason}`);
        setScanning(false);
      },
    );
  }, []);

  const stopScan = useCallback(() => {
    manager.stopScanning();
    setScanning(false);
    setStatus('Scan stopped');
  }, []);

  const connect = useCallback(async (peerId: string) => {
    setStatus('Connecting to wallet…');
    try {
      manager.stopScanning();
      setScanning(false);
      const peer = await manager.connectToPeer(peerId);
      setConnectedPeer(peer);
      setStatus(`Connected to ${peer.name}`);
      manager.monitorIncoming(
        (payload) => setIncomingPayload(payload),
        (error) => setStatus(`Transfer error: ${error}`),
      );
    } catch (error: any) {
      setStatus(error?.message ?? 'Connection failed');
    }
  }, []);

  const disconnect = useCallback(async () => {
    await manager.disconnectFromPeer();
    setConnectedPeer(null);
    setStatus('Disconnected');
  }, []);

  const enablePeripheral = useCallback(async () => {
    setStatus('Preparing to receive via Bluetooth…');
    try {
      await manager.enablePeripheralMode((payload) => setIncomingPayload(payload));
      setPeripheralEnabled(true);
      setStatus('Peripheral mode active');
    } catch (error: any) {
      setStatus(error?.message ?? 'Peripheral mode unavailable');
    }
  }, []);

  const disablePeripheral = useCallback(async () => {
    await manager.disablePeripheralMode();
    setPeripheralEnabled(false);
    setStatus('Peripheral mode stopped');
  }, []);

  const send = useCallback(async (payload: string) => {
    setStatus('Sending payload via Bluetooth…');
    try {
      await manager.sendPayload(payload);
      setStatus('Payload sent');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Bluetooth send failed');
      throw error;
    }
  }, []);

  const clearIncoming = useCallback(() => setIncomingPayload(null), []);

  return {
    available,
    status,
    peers,
    scanning,
    connectedPeer,
    peripheralEnabled,
    incomingPayload,
    startScan,
    stopScan,
    connect,
    disconnect,
    enablePeripheral,
    disablePeripheral,
    send,
    clearIncoming,
    supportsPeripheral: manager.supportsPeripheralMode(),
  };
};

export type UseBluetoothTransfer = ReturnType<typeof useBluetoothTransfer>;
