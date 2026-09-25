#!/bin/sh
set -eu

# The deployment supplies the GCP service-account fields as environment
# variables. Google auth requires a JSON file, so materialize one inside the
# container instead of bind-mounting a host path from GOOGLE_APPLICATION_CREDENTIALS.
if [ -n "${GCP_TYPE:-}" ] && [ -n "${GCP_PROJECT_ID:-}" ] && [ -n "${GCP_PRIVATE_KEY_ID:-}" ] && [ -n "${GCP_PRIVATE_KEY:-}" ] && [ -n "${GCP_CLIENT_EMAIL:-}" ] && [ -n "${GCP_CLIENT_ID:-}" ]; then
  export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-credentials.json
  node -e '
    const fs = require("fs");
    const value = (name) => process.env[name] || undefined;
    const account = {
      type: value("GCP_TYPE"),
      project_id: value("GCP_PROJECT_ID"),
      private_key_id: value("GCP_PRIVATE_KEY_ID"),
      private_key: value("GCP_PRIVATE_KEY").replace(/\\n/g, "\n"),
      client_email: value("GCP_CLIENT_EMAIL"),
      client_id: value("GCP_CLIENT_ID"),
      auth_uri: value("GCP_AUTH_URI"),
      token_uri: value("GCP_TOKEN_URI"),
      auth_provider_x509_cert_url: value("GCP_AUTH_PROVIDER_X509_CERT_URL"),
      client_x509_cert_url: value("GCP_CLIENT_X509_CERT_URL"),
      universe_domain: value("GCP_UNIVERSE_DOMAIN"),
    };
    fs.writeFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, JSON.stringify(account));
  '
fi

# Local .env files can contain a macOS host path in DATABASE_URL, e.g.
# sslrootcert=/Users/.../global-bundle.pem. Inside Docker the repo is copied
# to /app, so normalize that path before Prisma/pg opens the certificate.
if [ -n "${DATABASE_URL:-}" ] && [ -f "/app/global-bundle.pem" ]; then
  export DATABASE_URL="$(node -e '
    const url = process.env.DATABASE_URL;
    if (!url) process.exit(0);
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has("sslrootcert")) {
        parsed.searchParams.set("sslrootcert", "/app/global-bundle.pem");
      }
      process.stdout.write(parsed.toString());
    } catch {
      process.stdout.write(url);
    }
  ')"
fi

exec "$@"
