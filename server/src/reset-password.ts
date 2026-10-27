/**
 * Forgot your password? Sets a new one for the owner account (local / Docker installs).
 *   npm run reset-password
 * Every signed-in device is signed out, and two-step sign-in is turned off (in case the phone was lost too).
 */
import { createClient } from '@libsql/client';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hashPassword } from './auth';
import { migrate, one, run } from './db';
import { loadEnv, readConfig } from './config';

loadEnv();
const config = readConfig();
const db = createClient({ url: config.databaseUrl, authToken: config.databaseAuthToken });
await migrate(db);

const owner = await one<{ username: string }>(db, 'SELECT username FROM owner WHERE id = 1');
if (!owner) {
  console.log('There is no account yet. Start Hyperfocus and create it in the browser.');
  process.exit(0);
}
const rl = createInterface({ input: stdin, output: stdout });
const password = process.env.NEW_PASSWORD ?? (await rl.question(`New password for "${owner.username}" (at least 8 characters): `));
rl.close();
if (password.length < 8) {
  console.error('The password must be at least 8 characters.');
  process.exit(1);
}
await run(db, 'UPDATE owner SET password_hash = ?, session_version = session_version + 1, two_factor = NULL WHERE id = 1', [await hashPassword(password)]);
console.log('Password changed and two-step sign-in turned off. Sign in with the new password (you can turn two-step sign-in on again under Security).');
