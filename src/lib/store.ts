import type { Venture } from '../types';
import { readLocal, writeLocal } from './local';

const STORAGE_KEY_VENTURES = 'omniventure_projects_v2';
const STORAGE_KEY_ACTIVE_ID = 'omniventure_active_project_id_v2';

export const getStoredVentures = (): Venture[] => {
  if (typeof window === 'undefined') return [];
  try {
    const data = readLocal(STORAGE_KEY_VENTURES);
    if (!data) return [];
    return JSON.parse(data);
  } catch {
    return [];
  }
};

export const saveStoredVentures = (ventures: Venture[]) => {
  if (typeof window === 'undefined') return;
  try {
    writeLocal(STORAGE_KEY_VENTURES, JSON.stringify(ventures));
    window.dispatchEvent(new CustomEvent('ventures-updated'));
  } catch (e) {
    console.error('Error saving ventures:', e);
  }
};

export const getActiveProjectId = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const activeId = readLocal(STORAGE_KEY_ACTIVE_ID);
    if (activeId) return activeId;
    const ventures = getStoredVentures();
    const firstId = ventures[0]?.id || '';
    if (firstId) writeLocal(STORAGE_KEY_ACTIVE_ID, firstId);
    return firstId;
  } catch {
    return '';
  }
};

export const setActiveProjectId = (id: string) => {
  if (typeof window === 'undefined') return;
  try {
    writeLocal(STORAGE_KEY_ACTIVE_ID, id);
    window.dispatchEvent(new CustomEvent('active-project-changed', { detail: { id } }));
  } catch (e) {
    console.error('Error setting active project:', e);
  }
};
