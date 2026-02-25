import type { LanguageMode, TaskInfo } from './types';

export type Language = 'de' | 'en';

const messages = {
  de: {
    appTitle: 'Event Pipeline Lab',
    appSubtitle: 'Interaktive Demo für Event-Driven Data Pipelines',
    loginTitle: 'Anmeldung',
    username: 'Benutzername',
    pin: 'PIN',
    login: 'Einloggen',
    logout: 'Abmelden',
    loginHint: 'Demo: admin/admin123 oder epld01..epld12 / 1234',
    roleAdmin: 'Admin',
    roleStudent: 'Studierende',
    wsConnected: 'WebSocket verbunden',
    wsConnecting: 'WebSocket verbindet...',
    wsDisconnected: 'WebSocket getrennt',
    language: 'Sprache',
    useDefaultLanguage: 'Standardmodus',
    defaultMode: 'Backend-Standard',
    loading: 'Lade Daten...',
    currentTask: 'Aktive Aufgabe',
    capabilities: 'Fähigkeiten',
    displayName: 'Anzeigename',
    save: 'Speichern',
    groupConfig: 'Gruppenkonfiguration',
    revision: 'Revision',
    updatedBy: 'Geändert von',
    groupPresence: 'Gruppenpräsenz',
    liveFeed: 'Live Event Feed',
    pause: 'Pause',
    resume: 'Fortsetzen',
    clear: 'Leeren',
    topicFilter: 'Topic/Event Filter',
    category: 'Kategorie',
    device: 'Gerät',
    includeInternal: 'Interne Events zeigen',
    noEvents: 'Keine Events vorhanden',
    commands: 'Gerätebefehle',
    devices: 'Geräteübersicht',
    groups: 'Gruppenübersicht',
    tasks: 'Aufgabensteuerung',
    settings: 'Einstellungen',
    activate: 'Aktivieren',
    online: 'Online',
    offline: 'Offline',
    lastSeen: 'Zuletzt gesehen',
    rssi: 'RSSI',
    commandGreenOn: 'Grün AN',
    commandGreenOff: 'Grün AUS',
    commandOrangeOn: 'Orange AN',
    commandOrangeOff: 'Orange AUS',
    commandCounterReset: 'Counter Reset',
    refresh: 'Aktualisieren',
    saveSettings: 'Einstellung speichern',
    defaultLanguageMode: 'Standard-Sprachmodus',
    modeDe: 'Deutsch',
    modeEn: 'Englisch',
    modeBrowser: 'Browser (EN Fallback)',
    ownDeviceOnly: 'Nur eigenes EPLD steuerbar',
    feedLimited: 'Frontend speichert maximal die letzten 200 Events',
    errorPrefix: 'Fehler',
    taskUpdated: 'Aufgabe wurde aktualisiert',
    settingsUpdated: 'Einstellungen gespeichert',
    configSaved: 'Gruppenkonfiguration gespeichert',
    displayNameSaved: 'Anzeigename aktualisiert'
  },
  en: {
    appTitle: 'Event Pipeline Lab',
    appSubtitle: 'Interactive event-driven data pipeline demo',
    loginTitle: 'Login',
    username: 'Username',
    pin: 'PIN',
    login: 'Sign in',
    logout: 'Sign out',
    loginHint: 'Demo: admin/admin123 or epld01..epld12 / 1234',
    roleAdmin: 'Admin',
    roleStudent: 'Student',
    wsConnected: 'WebSocket connected',
    wsConnecting: 'WebSocket connecting...',
    wsDisconnected: 'WebSocket disconnected',
    language: 'Language',
    useDefaultLanguage: 'Default mode',
    defaultMode: 'Backend default',
    loading: 'Loading data...',
    currentTask: 'Active task',
    capabilities: 'Capabilities',
    displayName: 'Display name',
    save: 'Save',
    groupConfig: 'Group configuration',
    revision: 'Revision',
    updatedBy: 'Updated by',
    groupPresence: 'Group presence',
    liveFeed: 'Live event feed',
    pause: 'Pause',
    resume: 'Resume',
    clear: 'Clear',
    topicFilter: 'Topic/event filter',
    category: 'Category',
    device: 'Device',
    includeInternal: 'Show internal events',
    noEvents: 'No events available',
    commands: 'Device commands',
    devices: 'Device overview',
    groups: 'Group overview',
    tasks: 'Task control',
    settings: 'Settings',
    activate: 'Activate',
    online: 'Online',
    offline: 'Offline',
    lastSeen: 'Last seen',
    rssi: 'RSSI',
    commandGreenOn: 'Green ON',
    commandGreenOff: 'Green OFF',
    commandOrangeOn: 'Orange ON',
    commandOrangeOff: 'Orange OFF',
    commandCounterReset: 'Counter reset',
    refresh: 'Refresh',
    saveSettings: 'Save setting',
    defaultLanguageMode: 'Default language mode',
    modeDe: 'German',
    modeEn: 'English',
    modeBrowser: 'Browser (EN fallback)',
    ownDeviceOnly: 'Only own EPLD can be controlled',
    feedLimited: 'Frontend keeps a maximum of the latest 200 events',
    errorPrefix: 'Error',
    taskUpdated: 'Task updated',
    settingsUpdated: 'Settings saved',
    configSaved: 'Group configuration saved',
    displayNameSaved: 'Display name updated'
  }
} as const;

export type I18nKey = keyof (typeof messages)['en'];

export function tr(language: Language, key: I18nKey): string {
  return messages[language][key];
}

export function taskTitle(task: TaskInfo, language: Language): string {
  return language === 'de' ? task.titleDe : task.titleEn;
}

export function taskDescription(task: TaskInfo, language: Language): string {
  return language === 'de' ? task.descriptionDe : task.descriptionEn;
}

export function resolveLanguageFromMode(mode: LanguageMode, browserLanguage?: string): Language {
  if (mode === 'DE') {
    return 'de';
  }
  if (mode === 'EN') {
    return 'en';
  }

  const normalized = (browserLanguage ?? '').toLowerCase();
  if (normalized.startsWith('de')) {
    return 'de';
  }
  return 'en';
}
