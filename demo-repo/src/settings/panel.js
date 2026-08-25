import { renderField } from './fields.js';

const SECTIONS = ['profile', 'notifications', 'billing', 'danger'];

export function renderSettingsPanel(state) {
  return SECTIONS.map((section) => ({
    id: section,
    title: section.charAt(0).toUpperCase() + section.slice(1),
    fields: (state[section] ?? []).map(renderField),
  }));
}

export function handleSettingsSubmit(state, patch) {
  return { ...state, ...patch, dirty: false };
}
