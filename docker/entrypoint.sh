#!/bin/sh
# wrangler dev reads secrets and vars from .dev.vars; copy the ones that are set from the environment.
set -e
if [ -z "${OWNER_PASSWORD-}" ] && [ "${OPEN_SIGNUP-}" != "true" ]; then
  echo "Neither OWNER_PASSWORD nor OPEN_SIGNUP=true is set in .env, so nobody can sign in." >&2
fi
: > .dev.vars
for k in OWNER_PASSWORD PIN OPEN_SIGNUP LOGIN_URL SIGNUP_LIMIT MAX_MESSAGES MAX_DB_MB NOTIFY_URL OPERATOR_NAME CONTACT_X TIMEZONE DEFAULT_COUNTRY_CODE; do
  eval "v=\${$k-}"
  [ -n "$v" ] && printf '%s=%s\n' "$k" "$v" >> .dev.vars
done
# --local-upstream makes the Worker see https://$PUBLIC_HOST as its origin, which the OAuth metadata is built from
exec npx wrangler dev --ip 0.0.0.0 --port 8787 --persist-to /data \
  --local-upstream "$PUBLIC_HOST" --upstream-protocol https --show-interactive-dev-session=false
