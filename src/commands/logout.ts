import { credentialsExist, deleteCredentials } from '../lib/credentials.js';
import { dim } from '../lib/output.js';

export async function logout(): Promise<void> {
  if (await credentialsExist()) {
    await deleteCredentials();
    console.log('Credentials removed.');
  } else {
    console.log(dim('Already logged out.'));
  }
}
