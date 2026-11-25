/**
 * Rehearsal: builds a throw-away "old" database with legacy-shaped data, runs dry-run → apply → re-apply (idempotency) → verify → rollback
 * against in-memory MongoDB and prints the result. Nothing real is touched.     npm run migrate:selftest
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function main() {
  // SELFTEST_MONGO_BASE=mongodb://127.0.0.1:27017/ lets you point this at any scratch MongoDB; otherwise an in-memory one is started.
  const mongo = process.env.SELFTEST_MONGO_BASE ? null : await MongoMemoryServer.create();
  const base = process.env.SELFTEST_MONGO_BASE || mongo!.getUri();
  const OLD = `${base}Global-SJX`, NEW = `${base}gsjx_new`;

  const oldConn = await mongoose.createConnection(OLD).asPromise();
  const o = (n: string, docs: any[]) => oldConn.db!.collection(n).insertMany(docs);
  const client1 = new mongoose.Types.ObjectId(), acct = new mongoose.Types.ObjectId(), user1 = new mongoose.Types.ObjectId(), emp1 = new mongoose.Types.ObjectId();
  await o('accounts', [{ _id: acct, accountName: 'Global SJX Limited', accountNumber: '0123456789', bankName: 'GTBank', status: 'active' }]);
  await o('clients', [{ _id: client1, name: 'FCMB <Ltd>', email: ['ap@fcmb.com', 'cfo@fcmb.com'], phone: ['0800111'], address: '1 Marina, Lagos', status: 'active', account: acct }]);
  await o('users', [{ _id: user1, firstname: 'Ada', lastname: 'Obi', email: 'ADA@globalsjxltd.com', role: 'backoffice', department: 'Back Office', password: '$2a$10$plaintextishere', position: 'Accountant' }]);
  await o('employees', [{ _id: emp1, firstname: 'Tunde', surname: 'Bello', email: 'tunde@globalsjxltd.com', position: 'IT Officer', department: 'IT', salary: 500000, password: 'abc123' }, { firstname: 'No', surname: 'Email' }]);
  await o('rates', [{ value: 1450, cbnratedate: '2026-08-01' }, { value: 1500, cbnratedate: '2026-09-01' }]);
  await o('vats', [{ value: 7.5, type: 'VAT', status: 'active' }, { value: 5, type: 'WHT', status: 'active' }]);
  await o('invoices', [
    { invoiceNo: 'INV10001', referenceNumber: 'REF99999', clientId: client1, userId: user1, status: 'paid', invoiceType: 'ACS_RBA', templateType: 'fcmb', currency: 'USD', rate: 1500, includeNairaAmount: true, taxOption: true, vat: 7.5, wht: 5, accountNumber: '0123456789',
      startDate: '2026-08-01', endDate: '2026-08-31', transactionDate: '2026-09-02', transactionDueDate: '2026-09-16', paymentDate: '2026-09-20', amountPaid: 8492.5, totalInvoiceFee_usd: 7900, totalInvoiceFeePlusVat_usd: 8492.5, wibmoAmount: 6000, gsjxAmount: 2492.5,
      service1: { transactions: [{ description: '3DS transactions', volume: 120000, unitfee_usd: 0.045, totalfee_usd: 5400 }] }, service2: { transactions: [{ description: 'Hosting', volume: 1, unitfee_usd: 2500, totalfee_usd: 2500 }] } },
    { invoiceNo: 'INV10002', clientId: new mongoose.Types.ObjectId(), companyName: 'Ghost Client Ltd', status: 'pending', invoiceType: 'CONSULTATION', currency: 'NGN', taxOption: false, totalInvoiceFee_usd: 100000, otherInvoiceServices: [{ servicename: 'Advisory', servicedescription: 'ISMS gap analysis', trans_Count: 2, unit_Fee: 50000, total_fee: 100000 }] },
    { invoiceNo: 'INV10003', clientId: client1, status: 'rejected', reasonForRejection: 'Wrong period', currency: 'GDP', rate: 1900, taxOption: true, vat: 7.5, totalInvoiceFeePlusVat_usd: 999, roles: [{ name: 'Engineer', count: 2, unit_fee: 400, total_fee: 800 }] },
  ]);
  await o('taxes', [{ taxId: 'TAX1', invoiceNo: 'INV10001', taxType: 'VAT', totalAmount: 7900, taxRate: 7.5, taxAmountDeducted: 592.5, status: 'unpaid' }]);
  await o('whts', [{ whtId: 'WHT1', invoiceNo: 'INV10001', totalTransactionAmount: 7900, whtRate: 5, whtAmount: 395, status: 'unpaid', sourceType: 'invoice' }]);
  await o('expenses', [{ amount: 20000, category: 'Fuel for generator', date: '2026-09-05', description: 'Diesel', image: PNG, enableWHT: true, whtRate: 5, vatRate: 7.5, companyName: 'Total Energies', amountDue: 20500, createdBy: user1, status: 'created' }, { amount: 5000, category: 'Stuff', image: 'data:text/html;base64,PHNjcmlwdD4=', createdBy: user1 }]);
  await o('assets', [{ name: 'MacBook Pro 14', category: 'Laptop', serialNumber: 'C02XYZ', status: 'active' }]);
  await o('auditlogs', [{ action: 'LOGIN', userName: 'Ada', ipAddress: '1.2.3.4', password: 'leak' }]);
  await o('sessions', [{ sid: 'x' }]);
  await oldConn.close();

  // new DB: one organisation + super admin
  await mongoose.connect(NEW);
  const org = await Organization.create({ name: 'Global SJX Limited', slug: 'gsjx' } as any);
  await User.create({ organizationId: org._id, name: 'Joe', email: 'joe@globalsjxltd.com', passwordHash: 'x', role: 'super_admin' });
  await mongoose.disconnect();

  const run = (...args: string[]) => {
    console.log(`\n══════ migrate-legacy ${args.join(' ')} ══════`);
    const r = spawnSync('npx', ['ts-node', '--transpile-only', path.resolve(__dirname, 'migrate-legacy.ts'), ...args], { env: { ...process.env, OLD_MONGO_URI: OLD, MONGO_URI: NEW, DATA_ENCRYPTION_KEY: 'a'.repeat(64), APP_ENV: 'development', JWT_SECRET: 'x'.repeat(40) }, stdio: 'inherit' });
    if (r.status !== 0) process.exitCode = 1;
  };
  run('inspect'); run('dry-run', '--create-missing-clients'); run('apply', '--confirm-backup', '--create-missing-clients', '--batch', 'selftest1'); run('apply', '--confirm-backup', '--create-missing-clients', '--batch', 'selftest2'); run('verify'); run('rollback', '--batch', 'selftest1');
  await mongo?.stop();
}
main().catch((e) => { console.error(e); process.exit(1); });
