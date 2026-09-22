const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const lines = env.split('\n');
const obj = {};
for(const line of lines) {
  if(line.startsWith('GCP_')) {
    const [k, ...v] = line.split('=');
    let val = v.join('=');
    if(val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    obj[k] = val;
  }
}
const creds = {
  type: obj.GCP_TYPE,
  project_id: obj.GCP_PROJECT_ID,
  private_key_id: obj.GCP_PRIVATE_KEY_ID,
  private_key: obj.GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: obj.GCP_CLIENT_EMAIL,
  client_id: obj.GCP_CLIENT_ID,
  auth_uri: obj.GCP_AUTH_URI,
  token_uri: obj.GCP_TOKEN_URI,
  auth_provider_x509_cert_url: obj.GCP_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: obj.GCP_CLIENT_X509_CERT_URL,
  universe_domain: obj.GCP_UNIVERSE_DOMAIN
};
fs.writeFileSync('gcp-credentials.json', JSON.stringify(creds, null, 2));
console.log('Wrote gcp-credentials.json from individual fields');
