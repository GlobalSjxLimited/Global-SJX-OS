/**
 * First-run set-up for a REAL (production) database. The seed script wipes data and refuses production, so this is the safe alternative:
 * it creates the internal organisation and ONE super-admin, and nothing else. Safe to run again (it never overwrites or deletes).
 *
 *   BOOTSTRAP_ADMIN_EMAIL=joe@globalsjxltd.com BOOTSTRAP_ADMIN_NAME="Joe" BOOTSTRAP_ADMIN_PASSWORD='a-long-passphrase-1!' npm run bootstrap
 *
 * The admin is forced to choose a new password at first sign-in. Run it where MONGO_URI points at the production database.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';

async function main() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(); const name = (process.env.BOOTSTRAP_ADMIN_NAME || '').trim(); const pw = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2) { console.error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME.'); process.exit(1); }
  if (pw.length < 12 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) { console.error('BOOTSTRAP_ADMIN_PASSWORD must be 12+ characters with upper case, lower case and a digit.'); process.exit(1); }
  await connectDB();
  let org: any = await Organization.findOne({ isInternal: true });
  if (!org) { org = await Organization.create({ name: process.env.BOOTSTRAP_ORG_NAME || 'Global SJX Limited', slug: 'global-sjx', isInternal: true, plan: 'internal', industry: 'Information Technology', country: 'Nigeria', primaryColor: '#C22FD4' }); console.log('Created organisation:', org.name); }
  else console.log('Organisation already exists:', org.name);
  const exists = await User.findOne({ email });
  if (exists) console.log(`A user with ${email} already exists; nothing changed.`);
  else {
    await User.create({ organizationId: org._id, name, email, passwordHash: await bcrypt.hash(pw, 12), role: 'super_admin', jobTitle: 'ISMS Manager', department: 'Executive', dateJoined: new Date(), mustChangePassword: true });
    console.log(`Created super-admin ${email}. You will be asked to change the password at first sign-in.`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
