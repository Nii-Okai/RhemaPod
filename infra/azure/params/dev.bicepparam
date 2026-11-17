// dev: hosted copy of the local dev stack, on the shared nonprod platform.
// Deploys from the `dev` branch. Same R2 -dev buckets and Resend key as local
// dev; Stream and the archive stay on their stubs.
using '../main.bicep'

import { commonSettings, commonSecrets, hourlyJobs } from '../settings.bicep'

param envName = 'dev'
param platformName = 'nonprod'
param location = readEnvironmentVariable('AZURE_LOCATION', 'germanywestcentral')
param deployerObjectId = readEnvironmentVariable('DEPLOYER_OBJECT_ID')
param acrName = readEnvironmentVariable('AZURE_ACR_NAME')
param acrResourceGroup = readEnvironmentVariable('AZURE_ACR_RESOURCE_GROUP', 'rg-rhemapod-shared')
param acrSubscriptionId = readEnvironmentVariable('AZURE_ACR_SUBSCRIPTION_ID', '')
param imageTag = readEnvironmentVariable('IMAGE_TAG', '')
param deployApps = bool(readEnvironmentVariable('DEPLOY_APPS', 'false'))

param apiHost = 'api-dev.rhemapod.com'
param adminHost = 'admin-dev.rhemapod.com'
// none → added → bound, one commit each (DEPLOYMENT-AZURE.md §6).
param customDomainStage = 'bound'

param databaseName = 'rhemapod_dev'
param redisMode = 'container'
param redisDatabase = 0

param apiMinReplicas = 0
param apiMaxReplicas = 1
param adminMinReplicas = 0
param adminMaxReplicas = 1

// The smallest size Container Apps offers; plenty for testing.
param appCpu = '0.25'
param appMemory = '0.5Gi'

// Set enabled to true to keep the API and admin portal warm in these hours
// (no cold starts). About 0.8 US cents per app per warm hour at this size; the
// default weekday 08:00–19:00 window is about $2 a month per app, $4 for this
// environment's API + admin. Off: they scale to zero after ~5 idle minutes.
param warmHours = {
  enabled: false
  timezone: 'Europe/London'
  start: '0 8 * * 1-5'
  end: '0 19 * * 1-5'
}

param apiSettings = union(commonSettings, {
  ENVIRONMENT: 'development'
  DEBUG: 'true' // exposes /docs, dev only
  OBJECT_STORE_RAW_BUCKET: 'sermon-raw-dev'
  OBJECT_STORE_MEDIA_BUCKET: 'sermon-media-dev'
  PUSH_NOTIFICATIONS_ENABLED: 'false'
  SENTRY_DSN: '' // paste the backend DSN to turn Sentry on (not a secret)
})
param apiSecretNames = commonSecrets
param cronJobs = hourlyJobs
