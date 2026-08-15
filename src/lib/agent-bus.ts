export interface RealAgentActivity {
  id: string;
  timestamp: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  actionSummary: string;
  bubbleText?: string;
  payloadSummary: string;
  costUsd: number;
  modelUsed?: string;
}

const STORAGE_KEY = 'omniventure_real_agent_logs_v1';

export function getRealAgentLogs(): RealAgentActivity[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveRealAgentLog(activity: Omit<RealAgentActivity, 'id' | 'timestamp'>): RealAgentActivity {
  const newEntry: RealAgentActivity = {
    ...activity,
    id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toLocaleTimeString()
  };

  try {
    const current = getRealAgentLogs();
    const updated = [newEntry, ...current.slice(0, 49)]; // keep 50 latest real events
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    
    // Broadcast CustomEvent in window
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('omniventure_real_agent_activity', { detail: newEntry }));
    }
  } catch (e) {
    console.warn('Could not save agent activity', e);
  }

  return newEntry;
}

export function clearRealAgentLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('omniventure_real_agent_activity_cleared'));
    }
  } catch {}
}
