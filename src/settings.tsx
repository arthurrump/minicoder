import { createContext, useContext, createSignal, type ParentComponent } from 'solid-js';
import type { UserSettings } from './models/settings';

const SETTINGS_KEY = 'minicoder-settings';

interface SettingsContextValue {
  settings: () => UserSettings;
  setUserId: (userId: string) => void;
}

const SettingsContext = createContext<SettingsContextValue>();

function loadSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored) as UserSettings;
    }
  } catch (err) {
    console.warn('Failed to load settings from localStorage:', err);
  }
  return { userId: '' };
}

function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to save settings to localStorage:', err);
  }
}

export const SettingsProvider: ParentComponent = (props) => {
  const [settings, setSettings] = createSignal<UserSettings>(loadSettings());

  const setUserId = (userId: string) => {
    setSettings(prev => {
      const newSettings = { ...prev, userId };
      saveSettings(newSettings);
      return newSettings;
    });
  };

  return (
    <SettingsContext.Provider value={{ settings, setUserId }}>
      {props.children}
    </SettingsContext.Provider>
  );
};

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
