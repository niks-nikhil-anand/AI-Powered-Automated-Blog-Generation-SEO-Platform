const fs = require('fs');
const secrets = JSON.parse(fs.readFileSync('secrets-manager.json', 'utf8'));
const gcpCreds = JSON.parse(secrets.GCP_CREDENTIALS_JSON);
fs.writeFileSync('gcp-credentials.json', JSON.stringify(gcpCreds, null, 2));
console.log('Fixed gcp-credentials.json formatting');
