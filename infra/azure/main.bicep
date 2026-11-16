// One RhemaPod environment (dev, test or prod) on top of its platform
// (platform.bicep): the API, the admin portal, the migration job, the scheduled
// jobs, the environment's own Key Vault and identity, and (prod) the share site.
//
// This file only reads the platform's generated passwords and hands them to
// modules/app.bicep as secure parameters; everything else lives there.
//
// Deploy with infra/azure/deploy.sh app <dev|test|prod> (DEPLOYMENT-AZURE.md).

targetScope = 'resourceGroup'

@allowed(['dev', 'test', 'prod'])
param envName string

@allowed(['nonprod', 'prod'])
param platformName string

param location string = resourceGroup().location

@description('Object id of the person running the deployment (Key Vault Secrets Officer on this environment\'s vault).')
param deployerObjectId string

// ── Images ───────────────────────────────────────────────────────────────────
param acrName string
param acrResourceGroup string
param acrSubscriptionId string = subscription().subscriptionId

@description('Image tag (commit SHA) for both images. deploy.sh passes the tag already running so an infra change never rolls the code back.')
param imageTag string = ''

@description('false on the first run: creates the Key Vault and identity only, so the secrets can be filled in before any container references them.')
param deployApps bool = false

// ── Hostnames ────────────────────────────────────────────────────────────────
param apiHost string
param adminHost string

@description('none: default *.azurecontainerapps.io hosts only. added: hostnames attached (after the DNS records exist). bound: managed certificates issued and bound.')
@allowed(['none', 'added', 'bound'])
param customDomainStage string = 'none'

// ── Data ─────────────────────────────────────────────────────────────────────
param databaseName string

@allowed(['container', 'managed'])
param redisMode string

@description('Redis database number. dev and test share one Redis container, so they use different numbers. Managed Redis supports 0 only.')
param redisDatabase int = 0

// ── Scale ────────────────────────────────────────────────────────────────────
param apiMinReplicas int = 0
param apiMaxReplicas int = 1
param adminMinReplicas int = 0
param adminMaxReplicas int = 1

@description('vCPU and memory for each API and admin replica. Container Apps pairs them: 0.25/0.5Gi, 0.5/1Gi, 1/2Gi …')
param appCpu string = '0.5'
param appMemory string = '1Gi'

@description('Keep one API and one admin replica running between start and end (cron expressions in timezone), so nobody waits for a cold start then. Billed while warm (DEPLOYMENT-AZURE.md §10).')
param warmHours object = {
  enabled: false
  timezone: 'Europe/London'
  start: '0 8 * * 1-5'
  end: '0 19 * * 1-5'
}

// ── App configuration ────────────────────────────────────────────────────────
@description('Non-secret API settings as NAME: "value" (all strings).')
param apiSettings object

@description('Key Vault secret names wired into the API as environment variables (secret-key → SECRET_KEY). database-url and redis-url are added automatically.')
param apiSecretNames array

@description('Scheduled jobs: [{ name, cron, module }].')
param cronJobs array = []

// ── Share site (prod) ────────────────────────────────────────────────────────
param deployShareSite bool = false
param shareHost string = ''
param bindShareDomain bool = false
@description('Static Web Apps is offered in fewer regions than Container Apps.')
param staticSiteLocation string = 'westeurope'

param tags object = {}

resource platformKv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: 'kv-rp-${platformName}-${take(uniqueString(resourceGroup().id), 6)}'
}

module app 'modules/app.bicep' = {
  name: 'app-${envName}'
  params: {
    envName: envName
    platformName: platformName
    location: location
    deployerObjectId: deployerObjectId
    acrName: acrName
    acrResourceGroup: acrResourceGroup
    acrSubscriptionId: acrSubscriptionId
    imageTag: imageTag
    deployApps: deployApps
    apiHost: apiHost
    adminHost: adminHost
    customDomainStage: customDomainStage
    databaseName: databaseName
    redisMode: redisMode
    redisDatabase: redisDatabase
    apiMinReplicas: apiMinReplicas
    apiMaxReplicas: apiMaxReplicas
    adminMinReplicas: adminMinReplicas
    adminMaxReplicas: adminMaxReplicas
    appCpu: appCpu
    appMemory: appMemory
    warmHours: warmHours
    apiSettings: apiSettings
    apiSecretNames: apiSecretNames
    cronJobs: cronJobs
    deployShareSite: deployShareSite
    shareHost: shareHost
    bindShareDomain: bindShareDomain
    staticSiteLocation: staticSiteLocation
    tags: tags
    postgresAdminPassword: platformKv.getSecret('postgres-admin-password')
    redisPassword: platformKv.getSecret('redis-password')
  }
}

output apiDefaultHost string = app.outputs.apiDefaultHost
output adminDefaultHost string = app.outputs.adminDefaultHost
output keyVaultName string = app.outputs.keyVaultName
output shareSiteDefaultHost string = app.outputs.shareSiteDefaultHost
output shareSiteName string = app.outputs.shareSiteName
