// production: its own platform (rg-rhemapod-prod). Deploys from the `prod`
// branch after a required approval on the GitHub `production` environment.
// Takes over api.rhemapod.com, admin.rhemapod.com and open.rhemapod.com at
// cutover (DEPLOYMENT-AZURE.md §9), not before.
using '../main.bicep'

import { commonSettings, commonSecrets, productionOnlySecrets, hourlyJobs, frequentJobs } from '../settings.bicep'

param envName = 'prod'
param platformName = 'prod'
param location = readEnvironmentVariable('AZURE_LOCATION', 'germanywestcentral')
param deployerObjectId = readEnvironmentVariable('DEPLOYER_OBJECT_ID')
param acrName = readEnvironmentVariable('AZURE_ACR_NAME')
param acrResourceGroup = readEnvironmentVariable('AZURE_ACR_RESOURCE_GROUP', 'rg-rhemapod-shared')
param acrSubscriptionId = readEnvironmentVariable('AZURE_ACR_SUBSCRIPTION_ID', '')
param imageTag = readEnvironmentVariable('IMAGE_TAG', '')
param deployApps = bool(readEnvironmentVariable('DEPLOY_APPS', 'false'))

param apiHost = 'api.rhemapod.com'
param adminHost = 'admin.rhemapod.com'
param customDomainStage = 'none'

param databaseName = 'rhemapod'
param redisMode = 'managed'
param redisDatabase = 0

// Always one warm replica: no cold starts for listeners.
param apiMinReplicas = 1
param apiMaxReplicas = 3
param adminMinReplicas = 0
param adminMaxReplicas = 1
param appCpu = '0.5'
param appMemory = '1Gi'

param apiSettings = union(commonSettings, {
  ENVIRONMENT: 'production'
  DEBUG: 'false'
  // Production bucket names must not contain -dev or -staging.
  OBJECT_STORE_RAW_BUCKET: 'sermon-raw'
  OBJECT_STORE_MEDIA_BUCKET: 'sermon-media'
  // Cloudflare Stream and the Glacier archive (DEPLOYMENT.md §12). Fill these
  // in before the first production deploy; the secrets are in Key Vault.
  CF_ACCOUNT_ID: '<cloudflare-account-id>'
  CF_STREAM_CUSTOMER_SUBDOMAIN: '<customer-xxxx.cloudflarestream.com>'
  ARCHIVE_STORE_BUCKET: '<glacier-archive-bucket>'
  ARCHIVE_STORE_REGION: '<aws-region>'
  PUSH_NOTIFICATIONS_ENABLED: 'true'
  SENTRY_DSN: ''
})
param apiSecretNames = concat(commonSecrets, productionOnlySecrets)
param cronJobs = concat(hourlyJobs, frequentJobs)

param deployShareSite = true
param shareHost = 'open.rhemapod.com'
param bindShareDomain = false
