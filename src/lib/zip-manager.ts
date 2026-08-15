import JSZip from 'jszip';
import type { AgentCustomData } from '../components/AgentGraphStudio';

export interface CommunicationChannel {
  id: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  protocol: 'RPC Synchrone' | 'Queue Asynchrone' | 'Événement Edge (Pub/Sub)';
  payloadType: string;
  triggerEvent: string;
  description: string;
  enabled: boolean;
}

export async function exportGraphToZip(
  agents: AgentCustomData[],
  channels: CommunicationChannel[]
): Promise<Blob> {
  const zip = new JSZip();

  // 1. Manifest
  const manifest = {
    generator: 'OmniVenture AI Agent Graph Engine',
    version: '4.0.0',
    exportedAt: new Date().toISOString(),
    totalAgents: agents.length,
    totalChannels: channels.length
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // 2. Global Topology and Channels
  zip.file('topology.json', JSON.stringify({ agents, channels }, null, 2));
  zip.file('channels.json', JSON.stringify(channels, null, 2));

  // 3. Agent Folders with Ame.md, Job.md and config.json
  const agentsFolder = zip.folder('agents');
  if (agentsFolder) {
    for (const agent of agents) {
      const folder = agentsFolder.folder(agent.id);
      if (folder) {
        // Ame.md
        folder.file('Ame.md', agent.ameMd || `# Ame.md — ${agent.role}\n\nIdentité`);
        // Job.md
        folder.file('Job.md', agent.jobMd || `# Job.md — ${agent.role}\n\nMissions`);
        // config.json
        const config = {
          id: agent.id,
          role: agent.role,
          tier: agent.tier,
          category: agent.category,
          modelId: agent.modelId,
          description: agent.description,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens
        };
        folder.file('config.json', JSON.stringify(config, null, 2));
      }
    }
  }

  // 4. Generate Zip Blob
  const blob = await zip.generateAsync({ type: 'blob' });
  return blob;
}

export function downloadBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importGraphFromZip(file: File): Promise<{
  agents: AgentCustomData[];
  channels: CommunicationChannel[];
  manifest?: any;
}> {
  const zip = await JSZip.loadAsync(file);

  // Method 1: Read topology.json if present
  const topologyFile = zip.file('topology.json');
  if (topologyFile) {
    try {
      const content = await topologyFile.async('string');
      const parsed = JSON.parse(content);
      if (parsed.agents && Array.isArray(parsed.agents)) {
        return {
          agents: parsed.agents,
          channels: parsed.channels || []
        };
      }
    } catch (err) {
      console.warn('Could not parse topology.json directly, falling back to folder traversal', err);
    }
  }

  // Method 2: Traverse agents/ folder
  const agents: AgentCustomData[] = [];
  const channels: CommunicationChannel[] = [];

  const channelsFile = zip.file('channels.json');
  if (channelsFile) {
    try {
      const content = await channelsFile.async('string');
      const parsedChannels = JSON.parse(content);
      if (Array.isArray(parsedChannels)) {
        channels.push(...parsedChannels);
      }
    } catch {}
  }

  const agentFolders = new Set<string>();
  zip.forEach((relativePath) => {
    const match = relativePath.match(/^agents\/([^/]+)\//);
    if (match && match[1]) {
      agentFolders.add(match[1]);
    }
  });

  for (const agentId of agentFolders) {
    const configFile = zip.file(`agents/${agentId}/config.json`);
    const ameFile = zip.file(`agents/${agentId}/Ame.md`);
    const jobFile = zip.file(`agents/${agentId}/Job.md`);

    let config: Partial<AgentCustomData> = { id: agentId };
    if (configFile) {
      try {
        config = JSON.parse(await configFile.async('string'));
      } catch {}
    }

    const ameMd = ameFile ? await ameFile.async('string') : '';
    const jobMd = jobFile ? await jobFile.async('string') : '';

    agents.push({
      id: config.id || agentId,
      role: config.role || `Agent ${agentId}`,
      tier: (config.tier as 1 | 2 | 3) || 2,
      category: config.category || 'engineering',
      modelId: config.modelId || 'google/gemini-2.5-flash',
      description: config.description || 'Agent importé depuis archive .zip',
      temperature: typeof config.temperature === 'number' ? config.temperature : 0.2,
      maxTokens: typeof config.maxTokens === 'number' ? config.maxTokens : 2048,
      ameMd: ameMd || `# Ame.md — ${config.role || agentId}`,
      jobMd: jobMd || `# Job.md — ${config.role || agentId}`
    });
  }

  if (agents.length === 0) {
    throw new Error('Le fichier .zip ne contient aucune configuration d\'agent valide.');
  }

  return { agents, channels };
}
