# Deploying RhemaPod to Azure (dev, test, production)

Replaces the Render setup (`DEPLOYMENT-RENDER.md`), which keeps running untouched until
you cut over (§9). Everything Azure-side is code in `infra/azure/`. Two scripts and one
workflow drive it:

- `infra/azure/deploy.sh` creates and updates the Azure resources. You run it from your laptop.
- `infra/azure/setup-github-oidc.sh` lets GitHub deploy without a stored password. You run it once per platform.
- `.github/workflows/deploy-azure.yml` builds, migrates and rolls out on every push. It stays off until you
  set `AZURE_DEPLOY_ENABLED`.

**Dev and test come first.** Every production step in this guide is marked *(production, later)*. Skip
those for now. Production needs nothing from them, and §11 is the checklist for adding it later. Pushes
to `prod` do nothing until `AZURE_PROD_DEPLOY_ENABLED` is set.

## 0. What gets created

| Branch | Environment | Runs as | Hostnames (after §6) | Lives in |
|---|---|---|---|---|
| `dev` | dev | `ENVIRONMENT=development`, `DEBUG=true` | `api-dev.` / `admin-dev.rhemapod.com` | `rg-rhemapod-nonprod` |
| `uat` | test | `ENVIRONMENT=staging` | `api-test.` / `admin-test.rhemapod.com` | `rg-rhemapod-nonprod` |
| `prod` | production | `ENVIRONMENT=production` | `api.` / `admin.` / `open.rhemapod.com` | `rg-rhemapod-prod` |

Test runs as `staging` because the app reserves `ENVIRONMENT=test` for the pytest suite. `staging`
gets the internet-facing checks without production's hard requirement for Cloudflare Stream and the
Glacier archive.

| Resource | nonprod (dev + test) | prod |
|---|---|---|
| Container Apps environment (VNet, Consumption) | shared, scales to zero | own |
| API (`rhemapod-<env>-api`) | 0–1 replicas, 0.5 vCPU / 1 GiB | 1–3 replicas |
| Admin portal (`rhemapod-<env>-admin`) | 0–1 replicas | 0–1 replicas |
| Migration job (`rhemapod-<env>-migrate`) | run by the workflow on each deploy | same |
| Scheduled jobs (DEPLOYMENT.md §5) | hourly sweeps + daily retention | + captions and pushes every 5 min |
| PostgreSQL 17 flexible server | one Burstable B1ms: `rhemapod_dev`, `rhemapod_test` | own B1ms, 30-day backups |
| Redis | one container, dev = db 0, test = db 1 | Azure Managed Redis B0 |
| Key Vault | one per environment + one per platform | same |
| Share site (Static Web Apps, Free) | none | `open.rhemapod.com` |
| Container registry (ACR Basic) | shared by all, in `rg-rhemapod-shared` | same |

Media never passes through Azure. Uploads go from the portal straight to Cloudflare R2, and
playback comes from R2 or Cloudflare Stream. Email stays on Resend, and sign-in stays on
Google and Apple. Azure only replaces what Render ran: compute, Postgres, Redis and the static site.

**Differences from Render worth knowing:**
- **Migrations run once per deploy** in the migrate job, before the apps update. Preflight
  runs at every replica start (`scripts/container-start.sh`). A failing preflight leaves the
  previous revision serving.
- **The in-process schedulers are off.** Scheduled jobs run the same CLIs, even while the API is scaled to zero.
- **Dev and test cold-start.** After about 5 idle minutes they scale to zero, and the next request
  waits roughly 10–30 s. The Redis container never sleeps. If it restarts, everyone on dev/test is signed out.
- **Redis is private.** It's reachable only inside the Container Apps network, not from the internet.

## 1. Decide before you start

1. **Subscription for dev/test.** Production can go in a second subscription later (§11). One subscription
   also works.
2. **Region.** The default is `germanywestcentral`, which matches Render's Frankfurt. Override it with `AZURE_LOCATION`
   before the first deploy, because a region can't be changed later. The share site's region is set separately
   (`staticSiteLocation`, default `westeurope`).
3. **Budget emails.** Pick who gets the cost alerts (§10).
4. **Where today's Render data goes.** See §9.

## 2. One-time setup

Install the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), `jq` and `openssl`. Then:

```bash
az login
az bicep upgrade                      # the parameter files need Bicep ≥ 0.25
az account set --subscription "<dev/test subscription>"

# Register the resource providers once per subscription.
for p in Microsoft.App Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.Cache \
         Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.Network Microsoft.Web \
         Microsoft.ManagedIdentity Microsoft.Consumption; do
  az provider register --namespace "$p"
done

export AZURE_ACR_NAME=rhemapod<something>   # globally unique, lowercase letters/digits
export BUDGET_ALERT_EMAILS=you@example.com  # comma-separated
infra/azure/deploy.sh shared                # creates the registry in rg-rhemapod-shared
```

*(Production, later)* If production is in another subscription, also export `AZURE_ACR_SUBSCRIPTION_ID=<subscription that
holds the registry>` whenever you work on production.

## 3. Outside Azure, per environment

| | dev | test | production |
|---|---|---|---|
| R2 buckets | existing `sermon-raw-dev` / `sermon-media-dev` | new `sermon-raw-staging` / `sermon-media-staging` + their own R2 token | new `sermon-raw` / `sermon-media` + their own token |
| R2 CORS `AllowedOrigins` on **both** buckets (videos upload to raw, images to media) | add `https://admin-dev.rhemapod.com` | `https://admin-test.rhemapod.com` | `https://admin.rhemapod.com` |
| Resend | existing key | own key recommended | own key |
| Cloudflare Stream, Workers AI, Glacier archive | stubs | stubs | **required** (DEPLOYMENT.md §12) |
| Apple `.p8`, Google OAuth | same as today | same | same, or a separate Apple key (DEPLOYMENT.md §14) |
| Sentry | optional DSN | optional | backend DSN in `params/prod.bicepparam` (`SENTRY_DSN`) |

The CORS rule shape is in DEPLOYMENT-RENDER.md §1. Before you add a custom domain, use the
admin app's default `https://rhemapod-<env>-admin.<…>.azurecontainerapps.io` origin.
`deploy.sh` prints it. Logins only work on the hostname in `PORTAL_ORIGIN`, so finish §6
before signing in.

*(Production, later)* Fill in the four `<…>` placeholders in `infra/azure/params/prod.bicepparam`
(`CF_ACCOUNT_ID`, `CF_STREAM_CUSTOMER_SUBDOMAIN`, `ARCHIVE_STORE_BUCKET`, `ARCHIVE_STORE_REGION`). Point
the Stream webhook at `https://api.rhemapod.com/api/v1/media/stream/webhook` once §6 is done.

## 4. Secrets

Each environment has its own vault, `kv-rp-<env>-app-xxxxxx`. `deploy.sh` prints its name. Secret
names are the env var names in lowercase with dashes. Generated for you: `database-url`, `redis-url`,
`secret-key` (fresh per environment, never shared with local dev). Set the rest yourself:

```bash
KV=kv-rp-dev-app-xxxxxx
az keyvault secret set --vault-name $KV --name object-store-endpoint-url --value 'https://<account>.r2.cloudflarestorage.com'
az keyvault secret set --vault-name $KV --name object-store-access-key-id --value '<r2 key id>'
az keyvault secret set --vault-name $KV --name object-store-secret-access-key --value '<r2 secret>'
az keyvault secret set --vault-name $KV --name smtp-password --value '<resend api key>'
az keyvault secret set --vault-name $KV --name resend-api-key --value '<resend api key>'
az keyvault secret set --vault-name $KV --name google-oauth-client-secret --value '<secret>'
az keyvault secret set --vault-name $KV --name apple-private-key --file AuthKey_F8JN4PAKLB.p8
```

*(Production, later)* Also set `cf-stream-api-token`, `cf-stream-webhook-secret`,
`cf-stream-signing-key-id`, `cf-stream-signing-key-pem` (`--file`), `archive-store-access-key-id` and
`archive-store-secret-access-key`. The dev values are the same ones as in your `.env.render`.

The full list per environment is `apiSecretNames` in `infra/azure/params/<env>.bicepparam` (shared
names in `infra/azure/settings.bicep`). `deploy.sh app` lists whatever is still missing.

**Changing a secret later:** set the new value, then restart the app, for example
`az containerapp revision restart`. Or run any deploy. Container Apps reads Key Vault when a replica starts.

## 5. First deployment of an environment

Shown for dev. Test is the same with `test`, on the same platform. Step 1 and step 4 run once for both.

```bash
# 1. Platform: network, Container Apps environment, Postgres, Redis, budget.
infra/azure/deploy.sh platform nonprod        # ~10 min the first time

# 2. Environment, first pass: identity + Key Vault only (no image yet).
infra/azure/deploy.sh app dev                 # prints the vault name and the missing secrets

# 3. Fill in the secrets (§4).

# 4. Let GitHub deploy (once per platform).
infra/azure/setup-github-oidc.sh nonprod      # prints the gh variable commands to run
```

In GitHub, go to **Settings → Environments** and create `dev` and `test`. Set the printed variables on
each one, and limit `test` to the `uat` branch. Then set the switch:

```bash
gh variable set AZURE_DEPLOY_ENABLED --body true
```

5. **Build the first images.** Actions → *Deploy to Azure* → *Run workflow* on `dev`, environment `dev`.
   It builds and pushes, then reports that the apps don't exist yet, along with the commit SHA.
6. **Create the apps:** `infra/azure/deploy.sh app dev --image-tag <that sha>`. It prints the default hosts.
7. **Run the first migration:** push any commit to `dev`, or re-run the workflow. It runs the migrate job,
   then rolls out. From then on, every push deploys.
8. `curl https://<api default host>/health/ready` should report the database and Redis `ok`.

## 6. Custom domains

Container Apps validates each domain with two DNS records. `deploy.sh platform` prints
`customDomainVerificationId`.

| Record | Type | Value |
|---|---|---|
| `api-dev.rhemapod.com` | CNAME | the API's default host |
| `asuid.api-dev.rhemapod.com` | TXT | `customDomainVerificationId` |
| `admin-dev.rhemapod.com` | CNAME | the admin app's default host |
| `asuid.admin-dev.rhemapod.com` | TXT | same id |

On Cloudflare, keep these **DNS only** (grey cloud) so the managed certificate can validate. Then, in
`infra/azure/params/dev.bicepparam`:

1. Set `customDomainStage = 'added'`, then run `deploy.sh app dev`. This attaches the hostnames.
2. Set `customDomainStage = 'bound'`, then run `deploy.sh app dev`. This issues the managed certificates and binds them.
   Certificate issuance can take up to 20 minutes.

Commit each change. The stage lives in the file so a later deploy never detaches a domain.

**Share site *(production, later)*:** CNAME `open.rhemapod.com` → the `shareSiteDefaultHost` output. Then set
`bindShareDomain = true` and redeploy. Run the validation checks in DEPLOYMENT-RENDER.md §10
against it, especially that both `.well-known` files return `200` with `Content-Type: application/json`
(`open_site/staticwebapp.config.json` sets that). Do this before any native app build.

## 7. Seed and verify

Postgres only accepts Azure traffic. To run one-off scripts from your laptop, open your IP
temporarily:

```bash
az postgres flexible-server firewall-rule create -g rg-rhemapod-nonprod -n <server> \
  --rule-name laptop --start-ip-address <your ip> --end-ip-address <your ip>
export DATABASE_URL="$(az keyvault secret show --vault-name <env vault> -n database-url --query value -o tsv)"
uv run python -m app.scripts.create_admin --email <your email>
uv run python -m app.scripts.seed_verses
az postgres flexible-server firewall-rule delete -g rg-rhemapod-nonprod -n <server> --rule-name laptop --yes
```

Then check:

1. Sign in on the admin hostname.
2. **Real client IPs.** Your login's audit row should show your public IP. `TRUSTED_PROXIES` is set to
   the Container Apps subnet (`10.40.0.0/23` nonprod, `10.50.0.0/23` prod), where the ingress proxies
   run. A `10.40.x.x` address in the audit log means it isn't covering them. Tell me and I'll adjust it.
3. Upload a short sermon. This exercises R2 CORS and the presigned PUT.
4. Wait for the next hour mark. Then check Azure portal → `rhemapod-dev-sweep-uploads` → Execution history for
   a green run.

## 8. Everyday deploys and rollback

- **Deploy:** merge to `dev`, `uat` or `prod`. The workflow builds (or reuses) the images for that commit,
  points the jobs at them, runs migrations, rolls out the API, waits for `/health/ready`, then rolls out the
  admin portal and, on production, the share site.
- **Promote:** merge `dev` → `uat` → `prod`, as the branches already exist.
- **Roll back:** Actions → *Deploy to Azure* → *Run workflow* on the older commit's branch, or
  `az containerapp update -g <rg> -n rhemapod-<env>-api --image <registry>/rhemapod-api:<older sha>`.
  Migrations are additive by house rule, so older code runs against a newer schema. The exception is
  the `comment_guidelines` drop (DEPLOYMENT.md §3).
- **Infrastructure changes:** edit `infra/azure/`, open a PR (the *Azure infra check* workflow compiles it),
  then run `deploy.sh platform …` or `deploy.sh app …`. These keep the image that's already running.

## 9. Cutting over from Render

Nothing here happens automatically. Render keeps running until you switch DNS and then delete it.

1. **Decide where today's data goes.** Render's database is the dev stack that TestFlight and the
   internal Android builds use today, through `api.rhemapod.com`. Its media is in the `-dev` R2 buckets,
   so it fits Azure **dev**:
   ```bash
   pg_dump --no-owner --no-acl -Fc "<Render external database URL>" > render.dump
   # open your IP on the nonprod server (§7), then:
   pg_restore --clean --if-exists --no-owner --no-acl -d "<dev database-url>" render.dump
   ```
   `--clean` replaces whatever the first Azure deploy created. Re-run the dev deploy afterwards so the
   migrate job brings the restored data up to the latest schema. Then follow "Restores, imports and erased accounts" (DEPLOYMENT.md §15). Render's free database expires
   30 days after creation, so check its date.
2. **Keep the testers' apps working.** Their builds call `api.rhemapod.com`. You have two options:
   - Point `api.rhemapod.com` / `admin.rhemapod.com` at Azure **dev** for now. Set those as dev's
     `apiHost` / `adminHost`, then follow §6. Production moves onto them at launch, and dev moves to `api-dev.`.
   - Or ship new builds pointing at `api-dev.rhemapod.com` first (below), and leave the hostnames for production.
3. **Mobile build profiles** (`mobile/eas.json`). Until production exists, every tester build talks to
   **test**, and dev is for development only:
   - `testflight` (iOS, OTA channel `production`) and `android-internal` (Android, OTA channel `staging`,
     extends `testflight`): `EXPO_PUBLIC_API_BASE_URL=https://api-test.rhemapod.com`.
     At launch, `testflight` moves to `https://api.rhemapod.com` (production) and `android-internal`
     keeps `api-test.` in its own `env`.
   - `preview`: `https://api-dev.rhemapod.com`. `development` builds use `mobile/.env` (local or `api-dev.`).
   - `npm run update` follows the profile's `env`, so over-the-air updates pick up the same URLs.
   `EXPO_PUBLIC_*` values are baked into each build, so testers need a new build or OTA update before
   the old host goes away.
4. **DNS.** Swap the CNAMEs from `*.onrender.com` to the Azure hosts (§6). Keep the TTL low the day before.
5. **Watch for a few days**, then suspend the Render services and delete them. Delete `render.yaml`,
   `.env.render.example`, `scripts/render-start.sh` and DEPLOYMENT-RENDER.md in the same change.

## 10. Cost guardrails

- **Budgets.** Each platform resource group has a monthly budget: `monthlyBudget` in
  `params/nonprod.bicepparam` ($15) and `params/prod-platform.bicepparam` ($120). Emails go to
  `BUDGET_ALERT_EMAILS` at 50%, 80% and 100% spent, and when Azure forecasts an overrun. They're alerts
  only: pay-as-you-go Azure has no hard spending cap.
- **Scale caps.** `apiMaxReplicas` / `adminMaxReplicas` per environment (1 everywhere except the production API at 3).
  Scheduled jobs run one copy at a time with a 15-minute timeout.
- **Fixed tiers.** Postgres is B1ms and Redis B0. Nothing resizes itself. Postgres storage auto-grows only
  in production (`postgresStorageAutoGrow`), because storage can never shrink.
- **Logs.** Log Analytics stops ingesting for the day at `logDailyCapGb` (0.15 GB nonprod, 0.5 GB prod),
  inside the free 5 GB a month.
- **Images.** Each deploy purges builds older than 14 days beyond the newest 20. Images running in
  test or production are locked against deletion.
- **Outside Azure.** The costs that grow with listeners are Cloudflare Stream (minutes stored and watched),
  R2 storage, the Glacier archive and Workers AI translation. Set billing notifications in Cloudflare and AWS too.

### Cold starts and warm hours (dev, test)

With no traffic for about 5 minutes, dev and test scale to zero. The next request then waits about
10–30 seconds while a replica starts and runs preflight. Test has warm hours on, 09:00–20:00 UK time every day. Dev has them off. To change either one, edit
`warmHours` in `params/dev.bicepparam` or `params/test.bicepparam`. Set `enabled`, `timezone`, and `start` / `end`. The start and end are cron
expressions, so they control days as well as hours: `'0 9 * * *'` means 09:00 every day, and
`'0 9 * * 1-5'` means 09:00 on weekdays. Then run `deploy.sh app <env>` and commit the change.
Between start and end, one API replica and one admin replica stay running. Outside that window they
scale to zero again.

What it costs: the always-on Redis container already uses up the subscription's free Container Apps
allowance, so warm time is billed. A warm replica at the dev/test size (0.25 vCPU, 0.5 GiB) costs
about 0.8 US cents an hour.

| Warm window | Per app | API + admin, one environment | Both environments |
|---|---|---|---|
| Off (default) | $0 | $0 | $0 |
| Weekdays 08:00–19:00 (default window) | ~$2 / month | ~$4 | ~$8 |
| Every day 09:00–20:00 (test today) | ~$2.70 | ~$5.40 | ~$11 |
| Every day 08:00–22:00 | ~$3.40 | ~$7 | ~$14 |
| Always on | ~$6 | ~$12 | ~$24 |

An outside "keep-alive" ping every few minutes costs about the same and breaks silently, so use the
warm window instead. The scheduled jobs don't wake the API: they run in their own short-lived containers.

### Rough monthly totals before real traffic

Check these in the Azure pricing calculator. Dev + test costs about $5–10 with warm hours off. Postgres is
free for 12 months on a new Azure free account, then about $15–20 more. Production *(later)* is about $50–80.

## 11. Adding production later

1. Decide the subscription. Export `AZURE_ACR_SUBSCRIPTION_ID` if the registry stays in the dev/test one.
2. Set up Cloudflare Stream, the Glacier archive and the production R2 buckets (§3). Fill in the
   placeholders in `params/prod.bicepparam`.
3. `deploy.sh platform prod`, then `deploy.sh app prod`. Set the secrets (§4), and run
   `setup-github-oidc.sh prod`.
4. Create the GitHub environment `production`. Add yourself as a **required reviewer**, limit it to the `prod`
   branch, and set the printed variables. Then run `gh variable set AZURE_PROD_DEPLOY_ENABLED --body true`.
5. Run the workflow on `prod`, then `deploy.sh app prod --image-tag <sha>`. Then follow §6 for
   `api.` / `admin.` / `open.rhemapod.com`, and §9 for the mobile builds.
