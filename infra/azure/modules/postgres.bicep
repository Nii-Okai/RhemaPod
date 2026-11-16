// Azure Database for PostgreSQL flexible server, plus its databases.
//
// Public endpoint, TLS required by the server, reachable only from Azure
// (the 0.0.0.0 "Allow Azure services" rule). Open your own IP temporarily for
// a one-off restore or seed, then remove it (DEPLOYMENT-AZURE.md §7).

param name string
param location string
param tags object = {}

@description('Burstable B1ms is the smallest tier. Production can grow to B2s or General Purpose later without recreating the server.')
param skuName string = 'Standard_B1ms'
param skuTier string = 'Burstable'

param storageSizeGB int = 32
param storageAutoGrow bool = false

@description('The privacy policy publishes 30 days of backup retention, so keep this at 30 in production.')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

param administratorLogin string = 'rhemapod'

@secure()
param administratorLoginPassword string

@description('Databases to create on the server.')
param databaseNames array = ['rhemapod']

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: '17'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: storageAutoGrow ? 'Enabled' : 'Disabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    authConfig: {
      passwordAuth: 'Enabled'
      activeDirectoryAuth: 'Disabled'
    }
  }
}

// The first migration runs CREATE EXTENSION "uuid-ossp"; Azure only allows
// extensions on this list.
resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'azure.extensions'
  properties: {
    value: 'UUID-OSSP'
    source: 'user-override'
  }
}

resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [extensions]
}

@batchSize(1)
resource databases 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = [
  for db in databaseNames: {
    parent: server
    name: db
    properties: {
      charset: 'UTF8'
      collation: 'en_US.utf8'
    }
    dependsOn: [allowAzure]
  }
]

output fqdn string = server.properties.fullyQualifiedDomainName
output serverName string = server.name
output administratorLogin string = administratorLogin
