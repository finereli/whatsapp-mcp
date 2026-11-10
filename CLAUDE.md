# Deploying the hosted instance

The hosted instance deploys with `wrangler.local.jsonc`, which git ignores. The copy in git is `secrets/wrangler.local.jsonc`, encrypted with git-crypt.

- Before deploying, from any machine or cloud session, unlock the repo and copy the config out: `cp secrets/wrangler.local.jsonc .`. A deploy with a stale config once dropped the signup limit and the alert bindings.
- Whenever you change the deploy config, copy it back into `secrets/` and commit. Otherwise the encrypted copy goes stale.
