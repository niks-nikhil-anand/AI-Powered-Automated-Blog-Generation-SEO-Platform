const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf8');

const extract = (key) => {
  const regex = new RegExp(`^${key}="?([^"\\n]*)"?$`, 'm');
  const match = envContent.match(regex);
  return match ? match[1].trim() : '';
};

// The private key spans multiple lines, we can extract it precisely
const privateKeyMatch = envContent.match(/GCP_PRIVATE_KEY="([^"]+)"/);
let privateKey = privateKeyMatch ? privateKeyMatch[1] : '';

// Replace literal string "\n" with actual newlines
privateKey = privateKey.replace(/\\n/g, '\n');

const creds = {
  type: extract('GCP_TYPE'),
  project_id: extract('GCP_PROJECT_ID'),
  private_key_id: extract('GCP_PRIVATE_KEY_ID'),
  private_key: privateKey,
  client_email: extract('GCP_CLIENT_EMAIL'),
  client_id: extract('GCP_CLIENT_ID'),
  auth_uri: extract('GCP_AUTH_URI'),
  token_uri: extract('GCP_TOKEN_URI'),
  auth_provider_x509_cert_url: extract('GCP_AUTH_PROVIDER_X509_CERT_URL'),
  client_x509_cert_url: extract('GCP_CLIENT_X509_CERT_URL'),
  universe_domain: extract('GCP_UNIVERSE_DOMAIN')
};

fs.writeFileSync('gcp-credentials.json', JSON.stringify(creds, null, 2));
console.log('Successfully wrote gcp-credentials.json');
