declare module 'react-native-ble-peripheral' {
  export const setName: ((name: string) => Promise<void>) | undefined;
  export const addService:
    | ((
        uuid: string,
        advertise: boolean,
        characteristics: Array<{
          uuid: string;
          permissions: string[];
          properties: string[];
          value?: string;
        }>,
      ) => Promise<void>)
    | undefined;
  export const removeAllServices: (() => Promise<void>) | undefined;
  export const startAdvertising:
    | ((options?: { name?: string; serviceUuids?: string[] }) => Promise<void>)
    | undefined;
  export const stopAdvertising: (() => Promise<void>) | undefined;
  export const onWrite:
    | ((listener: (event: { value?: string }) => void) => { remove: () => void })
    | undefined;
}

declare module 'react-native-safe-area-context' {
  import * as React from 'react';
  import { ViewProps } from 'react-native';

  export const SafeAreaProvider: React.ComponentType<{ children?: React.ReactNode }>;
  export const SafeAreaView: React.ComponentType<ViewProps>;
  export function useSafeAreaInsets(): { top: number; right: number; bottom: number; left: number };
}
