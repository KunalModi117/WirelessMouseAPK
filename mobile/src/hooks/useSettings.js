import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS } from '../utils/constants';
import { safeParseSettings, safeSaveSettings } from '../services/storage';

export function useSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    safeParseSettings().then((loaded) => {
      if (loaded) {
        setSettings(loaded);
        setDraftSettings(loaded);
      }
    });
  }, []);

  const openSettings = () => {
    setDraftSettings(settings);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    setSettings(draftSettings);
    safeSaveSettings(draftSettings);
    setSettingsOpen(false);
  };

  return {
    settings,
    setSettings,
    draftSettings,
    setDraftSettings,
    settingsOpen,
    setSettingsOpen,
    openSettings,
    saveSettings
  };
}
