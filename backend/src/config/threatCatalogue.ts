/**
 * Threat catalogue used by the asset risk engine. Each entry says which kinds of asset a threat applies to, the usual
 * weakness behind it, how badly C / I / A are normally hit (1-5, 0 = not affected) and how likely it is before any
 * asset-specific adjustment. The engine moves these numbers up or down using the asset's own C-I-A rating, age, backup
 * and any live threat intelligence, and the ISMS manager can always change the result.
 */
export interface ThreatTpl {
  key: string;
  name: string;
  /** the weakness that lets this threat happen */
  vulnerability: string;
  /** asset categories (config key from models/Asset) this applies to */
  categories: string[];
  /** optional extra filter on title + sub-category + vendor + description (any match). Empty = every asset in the category */
  match?: RegExp;
  /** skip assets matching this */
  exclude?: RegExp;
  impact: { c: number; i: number; a: number };
  likelihood: number;
  nature: 'Internal' | 'External';
  /** Annex A references that treat it, shown in the SoA-alignment column */
  soa: string;
  /** controls normally expected, written into "Existing control" as a prompt for the owner to confirm */
  controls: string;
  treatment: 'Reduce Risk' | 'Transfer Risk' | 'Avoid Risk' | 'Accept Risk';
  /** words used to find live threat-intel items about this threat (category names or free words) */
  intel?: string[];
  /** true = more likely when the asset is past, or close to, end of life */
  ageSensitive?: boolean;
  /** true = only when the asset looks like it holds personal data */
  personalData?: boolean;
  /** true = confidentiality threat: likelihood +1 for Restricted assets */
  confidentialityThreat?: boolean;
  /** true = lowered when a backup schedule is recorded */
  backupSensitive?: boolean;
}

const T = (t: ThreatTpl): ThreatTpl => t;

export const THREAT_CATALOGUE: ThreatTpl[] = [
  /* ---------------------------------------------------------------- hardware & devices */
  T({ key: 'hw-theft-loss', name: 'Theft or loss of device', vulnerability: 'Portable device without full-disk encryption, remote wipe or tracking', categories: ['hardware'], match: /laptop|phone|tablet|mobile|usb|token|ipad|notebook|macbook|handset|drive|disk/i, exclude: /server|rack|router|switch|firewall/i, impact: { c: 4, i: 2, a: 3 }, likelihood: 3, nature: 'External', soa: 'A.7.9, A.8.1, A.7.10', controls: 'Full-disk encryption, screen lock, remote wipe, asset return procedure', treatment: 'Reduce Risk', confidentialityThreat: true }),
  T({ key: 'hw-malware', name: 'Malware or ransomware infection', vulnerability: 'Endpoint without current anti-malware, patching or application control', categories: ['hardware'], match: /laptop|desktop|pc\b|workstation|server|notebook|macbook|computer/i, impact: { c: 4, i: 4, a: 4 }, likelihood: 3, nature: 'External', soa: 'A.8.7, A.8.8, A.8.19', controls: 'Endpoint protection, patching, restricted admin rights, user awareness', treatment: 'Reduce Risk', intel: ['ransomware', 'malware'], backupSensitive: true }),
  T({ key: 'hw-failure', name: 'Hardware failure or loss of availability', vulnerability: 'No spare, warranty or tested recovery for this device', categories: ['hardware'], impact: { c: 1, i: 2, a: 4 }, likelihood: 2, nature: 'Internal', soa: 'A.7.13, A.8.14, A.5.30', controls: 'Maintenance schedule, warranty, spares, backups', treatment: 'Reduce Risk', ageSensitive: true }),
  T({ key: 'hw-unpatched', name: 'Exploitation of unpatched operating system or firmware', vulnerability: 'Security updates not applied in the agreed time', categories: ['hardware'], match: /laptop|desktop|server|workstation|notebook|phone|mobile|tablet|macbook|computer/i, impact: { c: 4, i: 4, a: 3 }, likelihood: 3, nature: 'External', soa: 'A.8.8, A.8.9', controls: 'Patch management, vulnerability scanning, supported OS only', treatment: 'Reduce Risk', intel: ['vulnerability', 'zero_day'], ageSensitive: true }),
  T({ key: 'hw-insider-copy', name: 'Unauthorised copying of data to removable media', vulnerability: 'USB ports and personal cloud uploads not controlled', categories: ['hardware'], match: /laptop|desktop|workstation|usb|drive|notebook|computer/i, impact: { c: 4, i: 1, a: 1 }, likelihood: 2, nature: 'Internal', soa: 'A.8.12, A.7.10, A.5.10', controls: 'Data-leak prevention, USB policy, acceptable-use acknowledgement', treatment: 'Reduce Risk', confidentialityThreat: true }),
  T({ key: 'hw-server-compromise', name: 'Server compromise through remote access', vulnerability: 'Exposed management ports, shared or weak administrator credentials', categories: ['hardware', 'cloud'], match: /server|vps|vm\b|virtual machine|host/i, impact: { c: 5, i: 5, a: 4 }, likelihood: 3, nature: 'External', soa: 'A.8.2, A.8.5, A.8.20, A.8.15', controls: 'MFA, bastion/VPN, least privilege, log review', treatment: 'Reduce Risk', intel: ['vulnerability', 'ransomware', 'zero_day', 'apt'], confidentialityThreat: true }),

  /* ---------------------------------------------------------------- software & licences */
  T({ key: 'sw-vuln', name: 'Exploitation of a known software vulnerability', vulnerability: 'Version not tracked or not patched; vendor advisories not reviewed', categories: ['software'], impact: { c: 4, i: 4, a: 3 }, likelihood: 3, nature: 'External', soa: 'A.8.8, A.5.7, A.8.19', controls: 'Version inventory, threat-intelligence matching, patch SLA', treatment: 'Reduce Risk', intel: ['vulnerability', 'zero_day', 'web_application'], ageSensitive: true }),
  T({ key: 'sw-supply-chain', name: 'Compromised update or software supply chain', vulnerability: 'Software installed from unverified sources or with unreviewed dependencies', categories: ['software'], impact: { c: 4, i: 5, a: 3 }, likelihood: 2, nature: 'External', soa: 'A.5.21, A.8.19, A.8.30', controls: 'Approved-software list, signature checks, dependency scanning', treatment: 'Reduce Risk', intel: ['supply_chain'] }),
  T({ key: 'sw-licence', name: 'Licence non-compliance or lapse', vulnerability: 'Licence count and expiry not monitored', categories: ['software'], impact: { c: 1, i: 1, a: 3 }, likelihood: 2, nature: 'Internal', soa: 'A.5.32, A.5.9', controls: 'Licence register with expiry reminders', treatment: 'Reduce Risk' }),
  T({ key: 'sw-misconfig', name: 'Insecure configuration or default settings', vulnerability: 'No approved baseline or configuration review', categories: ['software'], impact: { c: 3, i: 3, a: 3 }, likelihood: 3, nature: 'Internal', soa: 'A.8.9, A.8.32', controls: 'Configuration baseline, change control', treatment: 'Reduce Risk' }),
  T({ key: 'sw-code-leak', name: 'Leak of source code or embedded secrets', vulnerability: 'Keys or credentials stored in repositories; broad repository access', categories: ['software'], match: /git|repo|source|code|application|api|platform|system|app\b/i, impact: { c: 5, i: 3, a: 2 }, likelihood: 2, nature: 'Internal', soa: 'A.8.4, A.8.28, A.5.17', controls: 'Secret scanning, least-privilege repository access, code review', treatment: 'Reduce Risk', confidentialityThreat: true }),

  /* ---------------------------------------------------------------- information & data */
  T({ key: 'inf-disclosure', name: 'Unauthorised disclosure of information', vulnerability: 'Access wider than needed; labelling and handling rules not followed', categories: ['information'], impact: { c: 5, i: 1, a: 1 }, likelihood: 3, nature: 'Internal', soa: 'A.5.12, A.5.13, A.5.15, A.8.3, A.5.14', controls: 'Classification and labelling, need-to-know access, transfer rules', treatment: 'Reduce Risk', confidentialityThreat: true }),
  T({ key: 'inf-loss', name: 'Loss or corruption of information', vulnerability: 'No tested backup or single copy only', categories: ['information'], impact: { c: 1, i: 5, a: 4 }, likelihood: 3, nature: 'Internal', soa: 'A.8.13, A.8.14, A.5.33', controls: 'Backups with tested restores (3-2-1), retention rules', treatment: 'Reduce Risk', backupSensitive: true }),
  T({ key: 'inf-ransomware', name: 'Encryption or destruction by ransomware', vulnerability: 'Reachable from compromised endpoints; backups not isolated', categories: ['information', 'cloud'], impact: { c: 3, i: 5, a: 5 }, likelihood: 3, nature: 'External', soa: 'A.8.7, A.8.13, A.8.8', controls: 'Offline or immutable backups, endpoint protection, access limits', treatment: 'Reduce Risk', intel: ['ransomware'], backupSensitive: true }),
  T({ key: 'inf-pii-breach', name: 'Personal-data breach (NDPA 2023)', vulnerability: 'Personal data held without minimisation, encryption or retention limit', categories: ['information', 'cloud', 'software'], impact: { c: 5, i: 3, a: 2 }, likelihood: 3, nature: 'External', soa: 'A.5.34, A.8.10, A.8.11, A.5.14', controls: 'ROPA entry, encryption, retention schedule, breach procedure (72-hour notice)', treatment: 'Reduce Risk', personalData: true, confidentialityThreat: true }),
  T({ key: 'inf-retention', name: 'Information kept longer than allowed', vulnerability: 'No retention rule or deletion routine for this information', categories: ['information'], impact: { c: 3, i: 1, a: 1 }, likelihood: 3, nature: 'Internal', soa: 'A.8.10, A.5.33, A.5.34', controls: 'Retention schedule, quarterly deletion sweep', treatment: 'Reduce Risk' }),
  T({ key: 'inf-insider', name: 'Misuse of information by an insider or leaver', vulnerability: 'Access not removed or reviewed promptly after role change or exit', categories: ['information', 'cloud', 'software'], impact: { c: 5, i: 3, a: 2 }, likelihood: 2, nature: 'Internal', soa: 'A.5.18, A.6.5, A.6.6, A.8.15', controls: 'Leaver checklist, access reviews, confidentiality agreements, logging', treatment: 'Reduce Risk', confidentialityThreat: true }),

  /* ---------------------------------------------------------------- cloud & hosted services */
  T({ key: 'cld-takeover', name: 'Account takeover of a cloud service', vulnerability: 'Password-only sign-in, shared accounts or unreviewed administrators', categories: ['cloud', 'software'], match: /cloud|saas|workspace|google|microsoft|365|zoho|github|cpanel|hosting|aws|azure|gcp|cloudflare|jumpcloud|nextcloud|email|mail|portal|online/i, impact: { c: 5, i: 4, a: 4 }, likelihood: 3, nature: 'External', soa: 'A.5.15, A.5.16, A.8.5, A.8.2, A.5.17', controls: 'MFA for all users, no shared accounts, admin review', treatment: 'Reduce Risk', intel: ['phishing', 'fraud'], confidentialityThreat: true }),
  T({ key: 'cld-misconfig', name: 'Data exposed through cloud misconfiguration', vulnerability: 'Public sharing, open storage or permissive roles not reviewed', categories: ['cloud'], impact: { c: 5, i: 3, a: 2 }, likelihood: 3, nature: 'Internal', soa: 'A.5.23, A.8.9, A.8.3', controls: 'Configuration review, sharing restrictions, provider security settings', treatment: 'Reduce Risk', confidentialityThreat: true }),
  T({ key: 'cld-outage', name: 'Provider outage or service withdrawal', vulnerability: 'Single provider without exit plan or tested workaround', categories: ['cloud', 'services'], impact: { c: 1, i: 2, a: 5 }, likelihood: 2, nature: 'External', soa: 'A.5.30, A.5.29, A.5.23, A.5.22', controls: 'SLA, exit plan, backups outside the provider', treatment: 'Reduce Risk' }),
  T({ key: 'cld-residency', name: 'Cross-border transfer without a recorded basis', vulnerability: 'Provider hosts data outside Nigeria and the NDPA transfer basis is not recorded', categories: ['cloud'], impact: { c: 4, i: 1, a: 1 }, likelihood: 2, nature: 'External', soa: 'A.5.34, A.5.23, A.5.31', controls: 'Record location and transfer basis in the ROPA', treatment: 'Reduce Risk', personalData: true }),

  /* ---------------------------------------------------------------- network & security infrastructure */
  T({ key: 'net-ddos', name: 'Denial-of-service attack', vulnerability: 'Internet-facing service without rate limiting or upstream protection', categories: ['network', 'cloud'], impact: { c: 1, i: 1, a: 4 }, likelihood: 2, nature: 'External', soa: 'A.8.20, A.8.14, A.8.6', controls: 'DDoS protection (CDN/WAF), capacity headroom', treatment: 'Reduce Risk', intel: ['ddos'] }),
  T({ key: 'net-unauth', name: 'Unauthorised access to the network', vulnerability: 'Weak Wi-Fi or router credentials; flat network; unmanaged devices', categories: ['network'], impact: { c: 4, i: 4, a: 3 }, likelihood: 3, nature: 'External', soa: 'A.8.20, A.8.21, A.8.22, A.5.15', controls: 'Strong Wi-Fi authentication, guest separation, device registration, MFA on admin', treatment: 'Reduce Risk', confidentialityThreat: true }),
  T({ key: 'net-firmware', name: 'Exploitation of network-device firmware', vulnerability: 'Router, firewall or switch firmware not updated; default credentials', categories: ['network'], impact: { c: 4, i: 4, a: 4 }, likelihood: 3, nature: 'External', soa: 'A.8.8, A.8.9, A.8.5', controls: 'Firmware update schedule, credential rotation, configuration backup', treatment: 'Reduce Risk', intel: ['vulnerability', 'zero_day'], ageSensitive: true }),
  T({ key: 'net-eavesdrop', name: 'Interception of traffic', vulnerability: 'Unencrypted or weakly encrypted wireless or remote links', categories: ['network'], impact: { c: 4, i: 3, a: 1 }, likelihood: 2, nature: 'External', soa: 'A.8.21, A.8.24, A.6.7', controls: 'WPA3/WPA2-Enterprise, VPN for remote work, TLS', treatment: 'Reduce Risk', confidentialityThreat: true }),
  T({ key: 'net-change-error', name: 'Outage caused by a faulty change', vulnerability: 'Network changes made without testing, approval or rollback', categories: ['network'], impact: { c: 1, i: 3, a: 4 }, likelihood: 2, nature: 'Internal', soa: 'A.8.32, A.8.9', controls: 'Change management, configuration backups', treatment: 'Reduce Risk' }),

  /* ---------------------------------------------------------------- services & suppliers */
  T({ key: 'svc-failure', name: 'Supplier failure or service interruption', vulnerability: 'Dependency on one supplier; SLA not monitored; no exit plan', categories: ['services'], impact: { c: 1, i: 2, a: 4 }, likelihood: 3, nature: 'External', soa: 'A.5.19, A.5.22, A.5.30', controls: 'Supplier review, SLA monitoring, alternative provider', treatment: 'Reduce Risk' }),
  T({ key: 'svc-breach', name: 'Breach at a supplier that holds our information', vulnerability: 'Supplier security and data-protection clauses not verified', categories: ['services'], impact: { c: 5, i: 3, a: 3 }, likelihood: 3, nature: 'External', soa: 'A.5.20, A.5.21, A.5.22, A.5.34', controls: 'Due-diligence questionnaire, contract clauses, periodic review', treatment: 'Reduce Risk', intel: ['supply_chain'], confidentialityThreat: true }),
  T({ key: 'svc-contract', name: 'Contract or certificate lapses unnoticed', vulnerability: 'Renewal dates not tracked', categories: ['services'], impact: { c: 1, i: 1, a: 3 }, likelihood: 2, nature: 'Internal', soa: 'A.5.31, A.5.20', controls: 'Legal and contract register with 90/60/30-day reminders', treatment: 'Reduce Risk' }),

  /* ---------------------------------------------------------------- facilities & physical */
  T({ key: 'fac-intrusion', name: 'Unauthorised physical entry', vulnerability: 'Doors, visitors and keys not controlled or logged', categories: ['facilities'], impact: { c: 4, i: 3, a: 4 }, likelihood: 2, nature: 'External', soa: 'A.7.1, A.7.2, A.7.3, A.7.4', controls: 'Access control, visitor log, CCTV, alarm', treatment: 'Reduce Risk' }),
  T({ key: 'fac-fire-flood', name: 'Fire, flood or other environmental damage', vulnerability: 'Detection, suppression or drainage missing or untested', categories: ['facilities'], impact: { c: 1, i: 3, a: 5 }, likelihood: 2, nature: 'External', soa: 'A.7.5, A.7.8, A.7.13', controls: 'Extinguishers, detectors, inspection and maintenance schedule', treatment: 'Reduce Risk', ageSensitive: true }),
  T({ key: 'fac-power', name: 'Power failure or unstable supply', vulnerability: 'No UPS or generator, or untested failover', categories: ['facilities'], impact: { c: 1, i: 2, a: 5 }, likelihood: 4, nature: 'External', soa: 'A.7.11, A.7.12, A.5.30', controls: 'UPS and generator with scheduled testing and fuel checks', treatment: 'Reduce Risk', ageSensitive: true }),
  T({ key: 'fac-tailgate', name: 'Tailgating or shoulder-surfing', vulnerability: 'Clear desk and screen rules not followed', categories: ['facilities'], impact: { c: 3, i: 1, a: 1 }, likelihood: 3, nature: 'Internal', soa: 'A.7.6, A.7.7, A.6.3', controls: 'Clear desk / clear screen policy, awareness', treatment: 'Reduce Risk', confidentialityThreat: true }),

  /* ---------------------------------------------------------------- people & knowledge */
  T({ key: 'ppl-key-person', name: 'Loss of a key person', vulnerability: 'Knowledge and responsibilities held by one person with no deputy', categories: ['people'], impact: { c: 1, i: 2, a: 4 }, likelihood: 3, nature: 'Internal', soa: 'A.5.2, A.5.3, A.6.5, A.5.37', controls: 'Named deputy, documented procedures, cross-training', treatment: 'Reduce Risk' }),
  T({ key: 'ppl-phishing', name: 'Social engineering or phishing', vulnerability: 'Awareness gaps; no habit of verifying unusual requests', categories: ['people'], impact: { c: 4, i: 3, a: 3 }, likelihood: 4, nature: 'External', soa: 'A.6.3, A.6.8, A.5.7', controls: 'Awareness training, phishing simulations, easy reporting', treatment: 'Reduce Risk', intel: ['phishing', 'fraud'], confidentialityThreat: true }),
  T({ key: 'ppl-insider', name: 'Malicious or careless insider', vulnerability: 'Screening, role clarity or monitoring gaps', categories: ['people'], impact: { c: 4, i: 4, a: 3 }, likelihood: 2, nature: 'Internal', soa: 'A.6.1, A.6.2, A.6.4, A.6.5, A.8.15', controls: 'Screening, terms of employment, disciplinary process, logging', treatment: 'Reduce Risk', confidentialityThreat: true }),
  T({ key: 'ppl-leaver', name: 'Access or assets kept after leaving', vulnerability: 'Leaver steps not completed on the last working day', categories: ['people'], impact: { c: 4, i: 3, a: 2 }, likelihood: 2, nature: 'Internal', soa: 'A.5.11, A.5.18, A.6.5', controls: 'Offboarding checklist, asset return, same-day access removal', treatment: 'Reduce Risk' }),
];

/** Words that suggest an asset holds personal data of people (employees, customers, learners ...). */
export const PERSONAL_DATA_WORDS = /personal|customer|client list|employee|staff record|hr\b|payroll|salary|kyc|bvn|nin\b|passport|medical|health|learner|student|candidate|cv\b|biometric|contact list|crm|identity|pii|ndpa/i;
