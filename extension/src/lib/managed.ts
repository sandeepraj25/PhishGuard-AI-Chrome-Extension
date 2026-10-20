/**
 * Enterprise policy (chrome.storage.managed, schema: public/managed_schema.json). Set by an admin
 * through Chrome Enterprise policy; users cannot change it. See docs/enterprise.md.
 */
export interface ManagedConfig {
  orgKey: string;
  apiBase: string;
  userLabel: string;
  reportActions: boolean;
}

export async function getManaged(): Promise<ManagedConfig | null> {
  try {
    const m = (await chrome.storage.managed.get(null)) as Partial<ManagedConfig>;
    if (!m.orgKey || !m.apiBase) return null;
    return {
      orgKey: m.orgKey,
      apiBase: m.apiBase,
      userLabel: m.userLabel ?? '',
      reportActions: m.reportActions ?? true,
    };
  } catch {
    return null; // not managed (or API unavailable in tests)
  }
}
