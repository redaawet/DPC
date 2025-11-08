import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DigitalNote } from '../core/types';

const NOTES_KEY = 'dpc:wallet:notes';

export const loadNotes = async (): Promise<DigitalNote[]> => {
  const raw = await AsyncStorage.getItem(NOTES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to parse notes from storage', error);
    return [];
  }
};

export const saveNotes = async (notes: DigitalNote[]): Promise<void> => {
  await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(notes));
};

export const clearNotes = async (): Promise<void> => {
  await AsyncStorage.removeItem(NOTES_KEY);
};
