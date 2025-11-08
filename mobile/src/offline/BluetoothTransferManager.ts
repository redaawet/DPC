import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';

const TRANSFER_SERVICE_UUID = '2b9c0f34-3cf6-4b34-8a9c-1fd369e46b02';
const TRANSFER_CHARACTERISTIC_UUID = '2b9c0f35-3cf6-4b34-8a9c-1fd369e46b02';

type PeerDiscoveredCallback = (peer: BluetoothPeer) => void;
type ScanErrorCallback = (reason: string) => void;
type IncomingPayloadCallback = (payload: string) => void;
type IncomingErrorCallback = (reason: string) => void;

type PeripheralModule = {
  setName?: (name: string) => Promise<void>;
  addService?: (
    uuid: string,
    advertise: boolean,
    characteristics: Array<{
      uuid: string;
      permissions: string[];
      properties: string[];
      value?: string;
    }>,
  ) => Promise<void>;
  removeAllServices?: () => Promise<void>;
  startAdvertising?: (options?: { name?: string; serviceUuids?: string[] }) => Promise<void>;
  stopAdvertising?: () => Promise<void>;
  onWrite?: (listener: (event: { value?: string }) => void) => { remove: () => void } | void;
};

let Peripheral: PeripheralModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Peripheral = require('react-native-ble-peripheral');
} catch (error) {
  Peripheral = null;
}

export interface BluetoothPeer {
  id: string;
  name: string;
  rssi: number | null;
}

export class BluetoothTransferManager {
  private manager: BleManager | null;

  private scanning = false;

  private connection: Device | null = null;

  private monitorSubscription: Subscription | null = null;

  private peripheralSubscription: { remove?: () => void } | null = null;

  private peripheralActive = false;

  constructor() {
    try {
      this.manager = new BleManager();
    } catch (error) {
      console.warn('Failed to initialize BLE manager', error);
      this.manager = null;
    }
  }

  isAvailable(): boolean {
    return this.manager != null;
  }

  supportsPeripheralMode(): boolean {
    return Boolean(Peripheral && Platform.OS === 'android');
  }

  async ensureAdapterEnabled(): Promise<boolean> {
    if (!this.manager) {
      return false;
    }

    const currentState = await this.manager.state();
    if (currentState === 'PoweredOn') {
      return true;
    }

    return new Promise((resolve) => {
      const subscription = this.manager!.onStateChange((state) => {
        if (state === 'PoweredOn') {
          subscription.remove();
          resolve(true);
        }
      }, true);
    });
  }

  startScanning(onPeer: PeerDiscoveredCallback, onError: ScanErrorCallback) {
    if (!this.manager) {
      onError('Bluetooth manager unavailable in this build');
      return;
    }

    if (this.scanning) {
      return;
    }

    this.scanning = true;
    this.manager.startDeviceScan([TRANSFER_SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        onError(error.message);
        this.stopScanning();
        return;
      }

      if (!device) {
        return;
      }

      onPeer({ id: device.id, name: device.name ?? 'Nearby wallet', rssi: device.rssi ?? null });
    });
  }

  stopScanning() {
    if (!this.manager || !this.scanning) {
      return;
    }

    this.manager.stopDeviceScan();
    this.scanning = false;
  }

  async connectToPeer(peerId: string): Promise<BluetoothPeer> {
    if (!this.manager) {
      throw new Error('Bluetooth manager unavailable');
    }

    const device = await this.manager.connectToDevice(peerId, { autoConnect: false });
    const discovered = await device.discoverAllServicesAndCharacteristics();
    this.connection = discovered;
    return {
      id: discovered.id,
      name: discovered.name ?? 'Connected wallet',
      rssi: discovered.rssi ?? null,
    };
  }

  async disconnectFromPeer(): Promise<void> {
    if (!this.manager || !this.connection) {
      return;
    }

    this.monitorSubscription?.remove?.();
    this.monitorSubscription = null;

    try {
      await this.manager.cancelDeviceConnection(this.connection.id);
    } finally {
      this.connection = null;
    }
  }

  async sendPayload(payload: string): Promise<void> {
    if (!this.connection) {
      throw new Error('No connected peer');
    }

    const encoded = Buffer.from(payload, 'utf8').toString('base64');
    await this.connection.writeCharacteristicWithResponseForService(
      TRANSFER_SERVICE_UUID,
      TRANSFER_CHARACTERISTIC_UUID,
      encoded,
    );
  }

  monitorIncoming(onPayload: IncomingPayloadCallback, onError: IncomingErrorCallback) {
    if (!this.connection) {
      throw new Error('No connected peer to monitor');
    }

    this.monitorSubscription?.remove?.();
    this.monitorSubscription = this.connection.monitorCharacteristicForService(
      TRANSFER_SERVICE_UUID,
      TRANSFER_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (error) {
          onError(error.message);
          return;
        }

        if (!characteristic?.value) {
          return;
        }

        try {
          const decoded = Buffer.from(characteristic.value, 'base64').toString('utf8');
          onPayload(decoded);
        } catch (decodeError: any) {
          onError(decodeError.message ?? 'Failed to decode payload');
        }
      },
    );
  }

  async enablePeripheralMode(onPayload: IncomingPayloadCallback): Promise<void> {
    if (!Peripheral || Platform.OS !== 'android') {
      throw new Error('Peripheral mode requires a custom Android build');
    }

    if (this.peripheralActive) {
      await this.disablePeripheralMode();
    }

    await Peripheral.removeAllServices?.();
    await Peripheral.setName?.('DPC Wallet');
    await Peripheral.addService?.(TRANSFER_SERVICE_UUID, true, [
      {
        uuid: TRANSFER_CHARACTERISTIC_UUID,
        permissions: ['read', 'write'],
        properties: ['read', 'write', 'writeWithoutResponse', 'notify'],
        value: '',
      },
    ]);

    if (typeof Peripheral.onWrite === 'function') {
      this.peripheralSubscription = Peripheral.onWrite((event) => {
        if (!event?.value) {
          return;
        }
        try {
          const decoded = Buffer.from(event.value, 'base64').toString('utf8');
          onPayload(decoded);
        } catch (error) {
          console.warn('Failed to decode inbound payload', error);
        }
      }) as { remove?: () => void } | null;
    }

    await Peripheral.startAdvertising?.({ name: 'DPC Wallet', serviceUuids: [TRANSFER_SERVICE_UUID] });
    this.peripheralActive = true;
  }

  async disablePeripheralMode(): Promise<void> {
    if (!Peripheral || !this.peripheralActive) {
      return;
    }

    try {
      await Peripheral.stopAdvertising?.();
    } finally {
      this.peripheralActive = false;
      this.peripheralSubscription?.remove?.();
      this.peripheralSubscription = null;
    }
  }

  dispose() {
    this.stopScanning();
    this.monitorSubscription?.remove?.();
    this.monitorSubscription = null;
    this.connection = null;
    this.disablePeripheralMode().catch(() => undefined);
    this.manager?.destroy();
    this.manager = null;
  }
}
