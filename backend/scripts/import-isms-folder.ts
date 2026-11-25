/**
 * Load the company's ISMS client folder into the database: registers, asset inventory, suppliers and policy documents.
 * Reads the folder only; never changes it. Idempotent (a second run adds nothing). Run it where MONGO_URI points at the target database.
 *
 *   npm run import:folder -- "/path/to/Global SJX ISO-27001 Client Folder" --dry-run     # shows what WOULD be created, writes nothing
 *   npm run import:folder -- "/path/to/Global SJX ISO-27001 Client Folder"               # loads registers, assets, suppliers, policies (as drafts)
 *   npm run import:folder -- "<folder>" --publish                                         # policies are imported as approved (use only if they truly are)
 *   npm run import:folder -- "<folder>" --only=assets,policies                            # registers,assets,vendors,policies
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { importWorkbook } from '../src/services/isms/records.service';
import { importAssets, importVendors, importPolicyDocx, importMaintenance, importThreatRegister } from '../src/services/import.service';

const args = process.argv.slice(2); const folder = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry-run'); const publish = args.includes('--publish');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (k: string) => !only.length || only.includes(k);
function walk(dir: string, out: string[] = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; }
const SKIP_XLSX = /archiev|archive|~\$|due diligence|infosec _ bc|performance evaluation|action item|gap assessment|roles tracker|remote workers|access right|measurement/i;
const POLICY_YES = /policy|procedure|manual|control of|requirements|statement|roles, responsibilities|context of|isms plan|disruption|readiness|classification|vulnerabilit|disposal|physical and environmental|network\s+security|web filtering|user endpoint|data masking|information deletion|information transfer|storage media|capacity|configuration management|data leakage|backup|information security reviews|information security in|supplier relationships|cloud services|legal, statutory|emergency preparedness|technical security|organi[sz]ation of/i;
const POLICY_NO = /form|agreement|offer|appointment|non-disclosure|nda|handbook|policy book|signed|certificate|training|exercise|calendar|checklist|untitled|copy of|report|minutes|audit plan|audit program|briefing|acknowledgement|incident report|pack\b|kick/i;

async function main() {
  if (!folder || !fs.existsSync(folder)) { console.error('Give the path of the client folder as the first argument.'); process.exit(1); }
  await connectDB();
  const org: any = await Organization.findOne({ isInternal: true }); if (!org) { console.error('No organisation found. Run "npm run bootstrap" first.'); process.exit(1); }
  const admin: any = await User.findOne({ organizationId: org._id, role: 'super_admin' }) || await User.findOne({ organizationId: org._id });
  const actor = { id: String(admin._id), name: admin.name, role: admin.role };
  const orgId = String(org._id); const all = walk(folder); console.log(`${dry ? '[DRY RUN] ' : ''}Target database: ${mongoose.connection.name} · ${all.length} files found\n`);

  if (want('registers')) {
    console.log('== Registers (ISMS Automation Hub)'); let total = 0;
    for (const f of all.filter((p) => /\.xlsx$/i.test(p) && !SKIP_XLSX.test(path.basename(p)) && !/asset register|contact list|maintenance schedule|threat intelligence register/i.test(path.basename(p)))) {
      try {
        if (dry) { console.log(`  would read ${path.basename(f)}`); continue; }
        const r = await importWorkbook(orgId, fs.readFileSync(f), actor); const c = r.sheets.reduce((n, s) => n + s.created, 0); total += c;
        console.log(`  ${path.basename(f)}: ${c} new${r.sheets.length ? ' (' + r.sheets.filter((s) => s.created).map((s) => `${s.register} ${s.created}`).join(', ') + ')' : ''}`);
      } catch (e: any) { console.log(`  ${path.basename(f)}: FAILED ${e.message}`); }
    }
    if (!dry) console.log(`  total new register records: ${total}\n`);
  }
  if (want('assets')) {
    console.log('== Assets');
    for (const f of all.filter((p) => /asset register\.xlsx$/i.test(p))) { const r = await importAssets(orgId, fs.readFileSync(f), actor, { dryRun: dry }); console.log(`  ${path.basename(f)}: ${r.created} ${dry ? 'would be created' : 'created'}, ${r.duplicates} already there, ${r.skipped} blank/skipped\n   ${r.notes.join(' | ')}${r.ignored.length ? `\n   ignored sheets: ${r.ignored.join(', ')}` : ''}`); }
  }
  if (want('registers')) {
    console.log('== Equipment maintenance and threat register');
    for (const f of all.filter((p) => /maintenance schedule and log\.xlsx$/i.test(p))) { const r = await importMaintenance(orgId, fs.readFileSync(f), actor, { dryRun: dry }); console.log(`  maintenance schedule: ${r.created} ${dry ? 'would be created' : 'created'}, ${r.duplicates} already there`); }
    for (const f of all.filter((p) => /threat intelligence register\.xlsx$/i.test(p))) { const r = await importThreatRegister(orgId, fs.readFileSync(f), actor, { dryRun: dry }); console.log(`  threat register -> Threat Intelligence module: ${r.created} ${dry ? 'would be created' : 'created'}, ${r.duplicates} already there`); }
  }
  if (want('vendors')) {
    console.log('== Suppliers');
    for (const f of all.filter((p) => /contact list.*\.xlsx$/i.test(p))) { const r = await importVendors(orgId, fs.readFileSync(f), actor, { dryRun: dry }); console.log(`  ${r.created} ${dry ? 'would be created' : 'created'}, ${r.duplicates} already there: ${r.samples.join(', ')}`); }
  }
  if (want('policies')) {
    console.log(`== Policies (${publish ? 'as APPROVED' : 'as drafts for you to review and approve'})`);
    const docs = all.filter((p) => /\.docx$/i.test(p) && /ISO Project/i.test(p) && !POLICY_NO.test(path.basename(p)) && POLICY_YES.test(path.basename(p)));
    const r = await importPolicyDocx(orgId, docs.map((p) => ({ name: path.basename(p), buffer: fs.readFileSync(p) })), actor, { dryRun: dry, publish });
    console.log(`  ${docs.length} candidate documents: ${r.created} ${dry ? 'would be created' : 'created'}, ${r.duplicates} duplicates, ${r.skipped} unreadable/too short\n   ${r.samples.join('\n   ')}`);
  }
  console.log(`\n${dry ? 'Dry run finished. Nothing was written.' : 'Done. Safe to run again: duplicates are skipped.'}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
