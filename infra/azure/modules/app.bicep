// One RhemaPod environment. Called by main.bicep; see that file for the
// parameter descriptions. Everything here is per environment: its own
// identity, Key Vault, apps and jobs. The platform (Container Apps environment,
// Postgres server, Redis) is shared with any other environment in the same
// resource group and is only referenced here.

param envName string
param platformName string
param location string
param deployerObjectId string
param acrName string
param acrResourceGroup string
param acrSubscriptionId string
param imageTag string
param deployApps bool
param apiHost string
param adminHost string
param customDomainStage string
param databaseName string
param redisMode string
param redisDatabase int
param apiMinReplicas int
param apiMaxReplicas int
param adminMinReplicas int
param adminMaxReplicas int
param appCpu string
param appMemory string
param warmHours object
param apiSettings object
param apiSecretNames array
param cronJobs array
param deployShareSite bool
param shareHost string
param bindShareDomain bool
param staticSiteLocation string
param tags object

@secure()
param postgresAdminPassword string

@secure()
param redisPassword string

var suffix = take(uniqueString(resourceGroup().id), 6)
var kvName = 'kv-rp-${envName}-app-${suffix}'
var allTags = union(tags, { app: 'rhemapod', environment: envName })
var prefix = 'rhemapod-${envName}'
var acrLoginServer = '${acrName}.azurecr.io'
var apiImage = '${acrLoginServer}/rhemapod-api:${imageTag}'
var adminImage = '${acrLoginServer}/rhemapod-admin:${imageTag}'

// Built-in role definition ids.
var keyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var keyVaultSecretsOfficer = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

// ── Platform (shared, referenced only) ───────────────────────────────────────
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: 'cae-rhemapod-${platformName}'
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: 'vnet-rhemapod-${platformName}'
}

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: 'psql-rhemapod-${platformName}-${suffix}'
}

resource managedRedis 'Microsoft.Cache/redisEnterprise@2025-04-01' existing = if (redisMode == 'managed') {
  name: 'redis-rhemapod-${platformName}-${suffix}'
}

var redisUrl = redisMode == 'managed'
  ? 'rediss://:${redisPassword}@${managedRedis!.properties.hostName}:10000/0'
  : 'redis://:${redisPassword}@rhemapod-${platformName}-redis:6379/${redisDatabase}'

// The app rewrites postgresql:// to postgresql+psycopg://. The generated
// password is hex, so it needs no URL escaping.
var databaseUrl = 'postgresql://${pg.properties.administratorLogin}:${postgresAdminPassword}@${pg.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'

// ── Identity and secrets ─────────────────────────────────────────────────────
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${prefix}'
  location: location
  tags: allTags
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  tags: allTags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
    enablePurgeProtection: envName == 'prod' ? true : null
  }
}

resource appReadsSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, identity.id, keyVaultSecretsUser)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUser)
  }
}

resource deployerManagesSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, deployerObjectId, keyVaultSecretsOfficer)
  properties: {
    principalId: deployerObjectId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficer)
  }
}

resource databaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: { value: databaseUrl }
}

resource redisUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'redis-url'
  properties: { value: redisUrl }
}

module acrPull 'acr-pull.bicep' = {
  name: 'acr-pull-${envName}'
  scope: resourceGroup(acrSubscriptionId, acrResourceGroup)
  params: {
    acrName: acrName
    principalId: identity.properties.principalId
  }
}

// ── Shared container configuration ───────────────────────────────────────────
var secretNames = union(['database-url', 'redis-url'], apiSecretNames)

var containerSecrets = [
  for name in secretNames: {
    name: name
    keyVaultUrl: 'https://${kvName}${environment().suffixes.keyvaultDns}/secrets/${name}'
    identity: identity.id
  }
]

var secretEnv = [
  for name in secretNames: {
    name: toUpper(replace(name, '-', '_'))
    secretRef: name
  }
]

// Set here so they can't drift from the hostnames and network above. Don't
// repeat them in apiSettings.
var derivedEnv = [
  { name: 'FRONTEND_BASE_URL', value: 'https://${adminHost}' }
  { name: 'ALLOWED_ORIGINS', value: '["https://${adminHost}"]' }
  // The Container Apps ingress proxies sit in the environment's subnet.
  { name: 'TRUSTED_PROXIES', value: '["${vnet.properties.subnets[0].properties.addressPrefix}"]' }
  { name: 'SENTRY_RELEASE', value: imageTag }
]

var settingsEnv = [
  for item in items(apiSettings): {
    name: item.key
    value: string(item.value)
  }
]

var apiEnv = concat(derivedEnv, settingsEnv, secretEnv)

var registries = [
  {
    server: acrLoginServer
    identity: identity.id
  }
]

var userIdentity = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${identity.id}': {}
  }
}

// HTTP load, plus (optionally) one warm replica during working hours so the
// first request of the day doesn't wait for a cold start (DEPLOYMENT-AZURE.md §10).
var scaleRules = concat(
  [
    {
      name: 'http'
      http: { metadata: { concurrentRequests: '30' } }
    }
  ],
  warmHours.enabled
    ? [
        {
          name: 'warm-hours'
          custom: {
            type: 'cron'
            metadata: {
              timezone: warmHours.timezone
              start: warmHours.start
              end: warmHours.end
              desiredReplicas: '1'
            }
          }
        }
      ]
    : []
)

// ── Custom domains (two passes; DEPLOYMENT-AZURE.md §6) ──────────────────────
resource apiCert 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = if (deployApps && customDomainStage == 'bound') {
  parent: cae
  name: '${prefix}-api'
  location: location
  tags: allTags
  properties: {
    subjectName: apiHost
    domainControlValidation: 'CNAME'
  }
}

resource adminCert 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = if (deployApps && customDomainStage == 'bound') {
  parent: cae
  name: '${prefix}-admin'
  location: location
  tags: allTags
  properties: {
    subjectName: adminHost
    domainControlValidation: 'CNAME'
  }
}

var apiDomains = customDomainStage == 'none'
  ? []
  : [
      customDomainStage == 'bound'
        ? { name: apiHost, bindingType: 'SniEnabled', certificateId: apiCert.id }
        : { name: apiHost, bindingType: 'Disabled' }
    ]

var adminDomains = customDomainStage == 'none'
  ? []
  : [
      customDomainStage == 'bound'
        ? { name: adminHost, bindingType: 'SniEnabled', certificateId: adminCert.id }
        : { name: adminHost, bindingType: 'Disabled' }
    ]

// ── API ──────────────────────────────────────────────────────────────────────
resource api 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: '${prefix}-api'
  location: location
  tags: allTags
  identity: userIdentity
  dependsOn: [appReadsSecrets, acrPull, databaseUrlSecret, redisUrlSecret]
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
        customDomains: apiDomains
      }
      registries: registries
      secrets: containerSecrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          // Preflight, then uvicorn. No migrations: those run once per deploy
          // in the migrate job, never per replica.
          command: ['sh', 'scripts/container-start.sh']
          env: apiEnv
          resources: {
            cpu: json(appCpu)
            memory: appMemory
          }
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health/live', port: 8000 }
              initialDelaySeconds: 10
              periodSeconds: 15
              failureThreshold: 10
            }
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 8000 }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 8000 }
              periodSeconds: 15
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: apiMinReplicas
        maxReplicas: apiMaxReplicas
        rules: scaleRules
      }
    }
  }
}

// ── Admin portal ─────────────────────────────────────────────────────────────
resource admin 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: '${prefix}-admin'
  location: location
  tags: allTags
  identity: userIdentity
  dependsOn: [acrPull]
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        customDomains: adminDomains
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'admin'
          image: adminImage
          env: [
            // The BFF calls the API over its always-valid default host, so the
            // portal works before custom-domain DNS exists.
            { name: 'API_BASE_URL', value: 'https://${api!.properties.configuration.ingress.fqdn}' }
            // CSRF origin check: must be the hostname people actually use.
            { name: 'PORTAL_ORIGIN', value: 'https://${adminHost}' }
          ]
          resources: {
            cpu: json(appCpu)
            memory: appMemory
          }
          probes: [
            {
              type: 'Liveness'
              tcpSocket: { port: 3000 }
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: adminMinReplicas
        maxReplicas: adminMaxReplicas
        rules: scaleRules
      }
    }
  }
}

// ── Migration job (started by the deploy workflow before the apps update) ────
resource migrate 'Microsoft.App/jobs@2024-03-01' = if (deployApps) {
  name: '${prefix}-migrate'
  location: location
  tags: allTags
  identity: userIdentity
  dependsOn: [appReadsSecrets, acrPull, databaseUrlSecret, redisUrlSecret]
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: registries
      secrets: containerSecrets
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: apiImage
          command: ['alembic', 'upgrade', 'head']
          env: apiEnv
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}

// ── Scheduled jobs (DEPLOYMENT.md §5) ────────────────────────────────────────
resource scheduled 'Microsoft.App/jobs@2024-03-01' = [
  for job in cronJobs: if (deployApps) {
    name: '${prefix}-${job.name}'
    location: location
    tags: allTags
    identity: userIdentity
    dependsOn: [appReadsSecrets, acrPull, databaseUrlSecret, redisUrlSecret]
    properties: {
      environmentId: cae.id
      workloadProfileName: 'Consumption'
      configuration: {
        triggerType: 'Schedule'
        replicaTimeout: 900
        replicaRetryLimit: 1
        scheduleTriggerConfig: {
          cronExpression: job.cron
          parallelism: 1
          replicaCompletionCount: 1
        }
        registries: registries
        secrets: containerSecrets
      }
      template: {
        containers: [
          {
            name: job.name
            image: apiImage
            command: ['python', '-m', job.module]
            env: apiEnv
            resources: {
              cpu: json('0.25')
              memory: '0.5Gi'
            }
          }
        ]
      }
    }
  }
]

// ── Share site (open.rhemapod.com) ───────────────────────────────────────────
resource shareSite 'Microsoft.Web/staticSites@2023-12-01' = if (deployShareSite) {
  name: 'swa-${prefix}-share'
  location: staticSiteLocation
  tags: allTags
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

resource shareDomain 'Microsoft.Web/staticSites/customDomains@2023-12-01' = if (deployShareSite && bindShareDomain) {
  parent: shareSite
  name: shareHost
  properties: {
    validationMethod: 'cname-delegation'
  }
}

output apiDefaultHost string = deployApps ? api!.properties.configuration.ingress.fqdn : ''
output adminDefaultHost string = deployApps ? admin!.properties.configuration.ingress.fqdn : ''
output keyVaultName string = kv.name
output shareSiteDefaultHost string = deployShareSite ? shareSite!.properties.defaultHostname : ''
output shareSiteName string = deployShareSite ? shareSite.name : ''
