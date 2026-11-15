// test: pre-release checks on the shared nonprod platform. Deploys from the
// `uat` branch. Runs as ENVIRONMENT=staging, because the app reserves
// ENVIRONMENT=test for the pytest suite; staging gets the internet-facing
// checks (signed webhooks only, no CDN without signing) without production's
// hard requirement for Cloudflare Stream and the Glacier archive.
using '../main.bicep'

import { commonSettings, commonSecrets, hourlyJobs } from '../settings.bicep'

param envName = 'test'
param platformName = 'nonprod'
param location = readEnvironmentVariable('AZURE_LOCATION', 'germanywestcentral')
param deployerObjectId = readEnvironmentVariable('DEPLOYER_OBJECT_ID')
param acrName = readEnvironmentVariable('AZURE_ACR_NAME')
param acrResourceGroup = readEnvironmentVariable('AZURE_ACR_RESOURCE_GROUP', 'rg-rhemapod-shared')
param acrSubscriptionId = readEnvironmentVariable('AZURE_ACR_SUBSCRIPTION_ID', '')
param imageTag = readEnvironmentVariable('IMAGE_TAG', '')
param deployApps = bool(readEnvironmentVariable('DEPLOY_APPS', 'false'))

param apiHost = 'api-test.rhemapod.com'
param adminHost = 'admin-test.rhemapod.com'
param customDomainStage = 'none'

param databaseName = 'rhemapod_test'
param redisMode = 'container'
param redisDatabase = 1

param apiMinReplicas = 0
param apiMaxReplicas = 1
param adminMinReplicas = 0
param adminMaxReplicas = 1

// The smallest size Container Apps offers; plenty for testing.
param appCpu = '0.25'
param appMemory = '0.5Gi'

// Warm hours: one API and one admin replica stay running between start and
// end, so nobody waits for a cold start then; outside it they scale to zero.
// start/end are cron expressions (minute hour day-of-month month day-of-week)
// in `timezone`: '0 9 * * *' is 09:00 every day, '0 9 * * 1-5' weekdays only.
// About 0.8 US cents per app per warm hour at this size: 09:00–20:00 every day
// is about $2.70 a month per app, about $5.40 for test's API + admin.
param warmHours = {
  enabled: true
  timezone: 'Europe/London'
  start: '0 9 * * *'
  end: '0 20 * * *'
}

param apiSettings = union(commonSettings, {
  ENVIRONMENT: 'staging'
  DEBUG: 'false'
  // Its own R2 buckets and token, never the dev ones (DEPLOYMENT-AZURE.md §3).
  OBJECT_STORE_RAW_BUCKET: 'sermon-raw-staging'
  OBJECT_STORE_MEDIA_BUCKET: 'sermon-media-staging'
  PUSH_NOTIFICATIONS_ENABLED: 'false'
  SENTRY_DSN: ''
})
param apiSecretNames = commonSecrets
param cronJobs = hourlyJobs
